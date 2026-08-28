import { prisma } from "../../../lib/db";
import {
  EARLY_EXIT_DECAY_MONTHS,
  computeTenantScore,
  projectEarlyExit,
  type PaymentCycle,
  type ScoreInput,
  type Tenancy,
  type TenantScoreResult,
} from "./tenant-score-model";
import { isAgreementRequired } from "./agreement-requirement";

/**
 * A tenant's credibility, computed across every tenancy the **person** has had.
 *
 * **This score follows the person, not the tenancy** — a deliberate departure
 * from the boundary [[Decisions#ADR-110]]–112 drew for the document vault,
 * where one hostel's verdict must never silently follow someone to the next.
 * The product decision was explicit: an owner deciding whether to take a
 * tenant on wants that person's record, and a commitment penalty that resets
 * at every new hostel would deter nothing.
 *
 * The leak is deliberately narrowed to a **number**. `getForOwner` returns the
 * portable score and grade, but only the insights belonging to *that owner's*
 * tenancies — so an owner learns how reliable someone is without reading a
 * narrative of another hostel's tenancy.
 *
 * **No new table, and no cache.** The score is derived at read time from
 * tenancies and obligations that already exist. Caching it was the original
 * plan — into `tenant_behavior_scores` — but `payment-service` still writes
 * the *old* algorithm's number into that same row after every payment, so a
 * cache there would be silently overwritten with a figure from the model this
 * replaces. Deriving on read costs two queries and cannot disagree with
 * itself. (Given that a single Prisma column addition has taken this system's
 * production down before, a scoring feature is also not worth putting a schema
 * change on the critical path for.)
 */

const DEFAULT_EXPECTED_TENURE_MONTHS = 6;

/** How long a stay at this hostel is meant to be, when no agreement says. */
function expectedTenureFor(preferencesConfig: unknown): number {
  const root = preferencesConfig && typeof preferencesConfig === "object"
    ? (preferencesConfig as Record<string, any>)
    : {};
  const configured = Number(root.tenant_rules?.expected_tenure_months);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_EXPECTED_TENURE_MONTHS;
}

interface TenancyRow {
  id: string;
  hostel_id: string;
  joined_on: Date | null;
  exit_date: Date | null;
  status: string;
  hostels: { preferences_config: unknown } | null;
  agreements: Array<{ agreement_duration_months: number | null }>;
}

/**
 * The expected length of one stay: the agreement's own duration when a signed
 * one exists, otherwise the hostel's configured tenure. Agreements are
 * optional by design (ADR-059) — keying this to them alone would leave every
 * hostel that switched signing off with no commitment signal at all, which is
 * most of them.
 */
function expectedMonthsFor(row: TenancyRow): number {
  const fromAgreement = row.agreements?.[0]?.agreement_duration_months;
  if (Number.isFinite(Number(fromAgreement)) && Number(fromAgreement) > 0) {
    return Number(fromAgreement);
  }
  return expectedTenureFor(row.hostels?.preferences_config);
}

export class TenantReputationService {
  /** Every tenancy this person has held, oldest first. */
  private async loadTenancies(profileId: string): Promise<TenancyRow[]> {
    const rows = await prisma.tenants.findMany({
      where: { profile_id: profileId },
      orderBy: { joined_on: "asc" },
      select: {
        id: true,
        hostel_id: true,
        joined_on: true,
        exit_date: true,
        status: true,
        hostels: { select: { preferences_config: true } },
        agreements: {
          orderBy: { generated_at: "desc" },
          take: 1,
          select: { agreement_duration_months: true },
        },
      },
    });
    return rows as unknown as TenancyRow[];
  }

  /**
   * Rent cycles across every tenancy. `SECURITY_DEPOSIT` and one-off charges
   * are excluded: the signal is whether they pay their rent on schedule, and
   * a deposit paid at move-in says nothing about that.
   */
  private async loadCycles(tenantIds: string[]): Promise<PaymentCycle[]> {
    if (tenantIds.length === 0) return [];

    const obligations = await prisma.rent_obligations.findMany({
      where: {
        tenant_id: { in: tenantIds },
        obligation_type: "RENT",
        is_superseded: false,
        status: { notIn: ["WAIVED", "CANCELLED"] },
      },
      orderBy: { due_date: "asc" },
      select: {
        due_date: true,
        status: true,
        payments: { select: { payment_date: true }, orderBy: { payment_date: "desc" }, take: 1 },
      },
    });

    return obligations.map((obligation: any) => ({
      dueDate: obligation.due_date.toISOString(),
      // Settled when fully paid; otherwise still outstanding, and the model
      // treats it as late by however long it has been so.
      settledAt:
        obligation.status === "PAID" && obligation.payments[0]
          ? obligation.payments[0].payment_date.toISOString()
          : null,
    }));
  }

  private async buildInput(profileId: string, now = new Date()): Promise<{
    input: ScoreInput;
    rows: TenancyRow[];
  }> {
    const rows = await this.loadTenancies(profileId);
    const cycles = await this.loadCycles(rows.map((r) => r.id));

    const tenancies: Tenancy[] = rows
      .filter((row) => row.joined_on)
      .map((row) => ({
        startedAt: row.joined_on!.toISOString(),
        // A tenancy is over when the tenant has left. `exit_date` is the
        // recorded departure; a FORMER_TENANT with none is closed as of now
        // rather than being treated as still running.
        endedAt: row.exit_date
          ? row.exit_date.toISOString()
          : row.status === "FORMER_TENANT"
            ? now.toISOString()
            : null,
        expectedMonths: expectedMonthsFor(row),
      }));

    return { input: { cycles, tenancies, now }, rows };
  }

  /** The person's portable score. */
  async getForProfile(profileId: string, now = new Date()): Promise<TenantScoreResult> {
    const { input } = await this.buildInput(profileId, now);
    return computeTenantScore(input);
  }

  /**
   * The score as one owner may see it: the portable number and grade, with
   * insights limited to their own tenancy. See the class comment — the number
   * crosses hostels by decision; the narrative does not.
   */
  async getForOwner(tenantId: string, now = new Date()) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { id: true, profile_id: true, joined_on: true },
    });
    if (!tenant?.profile_id) throw new Error("NOT_FOUND: Tenant record not found");

    const portable = await this.getForProfile(tenant.profile_id, now);

    // Recomputed from this tenancy alone, so the sentences an owner reads
    // describe behaviour at their own hostel.
    const localCycles = await this.loadCycles([tenant.id]);
    const local = computeTenantScore({ cycles: localCycles, tenancies: [], now });

    return {
      score: portable.score,
      grade: portable.grade,
      status: portable.status,
      cycles_needed: portable.cyclesNeeded,
      components: portable.components,
      early_exits: portable.earlyExits,
      trend: portable.trend,
      /** Scoped to this hostel. Empty until there is enough of it to describe. */
      insights: local.insights,
      recovers_in_months: EARLY_EXIT_DECAY_MONTHS,
    };
  }

  /**
   * What leaving now would cost, for telling the tenant *before* they decide.
   * Produced by the same scorer, so the figure quoted to them cannot drift
   * from the one their owner will see.
   */
  async projectExit(tenantId: string, now = new Date()) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { profile_id: true },
    });
    if (!tenant?.profile_id) throw new Error("NOT_FOUND: Tenant record not found");

    const { input, rows } = await this.buildInput(tenant.profile_id, now);
    const index = rows.findIndex((row) => row.id === tenantId && row.joined_on);
    if (index < 0) {
      return { current: null, projected: null, drop: 0, wouldBeEarly: false, recoversInMonths: EARLY_EXIT_DECAY_MONTHS };
    }

    // `buildInput` filters rows without joined_on, so the model's index is
    // over that filtered list, not the raw rows.
    const modelIndex = rows.filter((row) => row.joined_on).findIndex((row) => row.id === tenantId);
    return projectEarlyExit(input, { tenancyIndex: modelIndex });
  }

}

export const tenantReputationService = new TenantReputationService();
