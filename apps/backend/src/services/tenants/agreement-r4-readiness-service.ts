import { prisma } from "@/lib/db";
import { currentAgreementWhere } from "./agreement-status";
import { agreementLifecycleRecoveryService } from "./agreement-lifecycle-recovery-service";
import { renewalDecisionService } from "./renewal-decision-service";

const REQUIRED_SCHEMA_COLUMNS = [
  "agreement_start_date",
  "agreement_end_date",
  "agreement_duration_months",
  "contract_rent",
  "contract_security_deposit",
  "contract_maintenance",
  "contract_maintenance_type",
  "contract_payment_frequency",
  "renewed_from_agreement_id",
  "renewed_to_agreement_id",
  "renewed_at",
  "expiry_notified_30d_at",
  "expiry_notified_15d_at",
  "expired_notified_at",
  "terminated_at",
] as const;

type ReadinessInput = {
  ownerId?: string | null;
  hostelId?: string | null;
  now?: Date;
};

function dateValue(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function utcDateOnly(input: Date) {
  return new Date(Date.UTC(input.getUTCFullYear(), input.getUTCMonth(), input.getUTCDate()));
}

function dateDiffDays(target: Date, base: Date) {
  const targetDate = utcDateOnly(target);
  const baseDate = utcDateOnly(base);
  return Math.ceil((targetDate.getTime() - baseDate.getTime()) / 86_400_000);
}

function audiencePayload(agreement: any, decision: any, now: Date) {
  const endDate = dateValue(agreement.agreement_end_date);
  const daysUntilExpiry = endDate ? dateDiffDays(endDate, now) : null;

  return {
    agreementId: agreement.id,
    tenantId: agreement.tenant_id,
    tenantName: agreement.tenant?.profiles?.name || null,
    hostelId: agreement.hostel_id,
    hostelName: agreement.hostel?.name || null,
    ownerId: agreement.hostel?.owner_id || null,
    status: agreement.status,
    agreementEndDate: agreement.agreement_end_date,
    daysUntilExpiry: daysUntilExpiry !== null && daysUntilExpiry >= 0 ? daysUntilExpiry : null,
    daysOverdue: daysUntilExpiry !== null && daysUntilExpiry < 0 ? Math.abs(daysUntilExpiry) : 0,
    decisionState: decision.decision_state,
    states: decision.states,
  };
}

function emptyAudiences() {
  return {
    "30day": [] as any[],
    "15day": [] as any[],
    expiryDay: [] as any[],
    overdue7: [] as any[],
    critical30: [] as any[],
    expiredAndRentOverdue: [] as any[],
  };
}

export class AgreementR4ReadinessService {
  constructor(private readonly db = prisma) {}

  async getRenewalAudiences(input: ReadinessInput = {}) {
    const now = input.now || new Date();
    const agreements = await this.db.agreement.findMany({
      where: {
        status: currentAgreementWhere(),
        agreement_end_date: { not: null },
        ...(input.hostelId ? { hostel_id: input.hostelId } : {}),
        ...(input.ownerId ? { hostel: { owner_id: input.ownerId } } : {}),
      },
      include: this.agreementDecisionInclude(),
      orderBy: [{ agreement_end_date: "asc" }, { generated_at: "desc" }],
    });

    const audiences = emptyAudiences();

    for (const agreement of agreements) {
      const decision = renewalDecisionService.evaluateAgreement(agreement, now);
      const row = audiencePayload(agreement, decision, now);
      const daysUntilExpiry = row.daysUntilExpiry;
      const daysOverdue = row.daysOverdue;

      if (daysUntilExpiry === 30) audiences["30day"].push(row);
      if (daysUntilExpiry === 15) audiences["15day"].push(row);
      if (daysUntilExpiry === 0) audiences.expiryDay.push(row);
      if (daysOverdue === 7 && decision.states.includes("RENEWAL_DECISION_PENDING")) audiences.overdue7.push(row);
      if (daysOverdue >= 30 && decision.states.includes("RENEWAL_OVERDUE_CRITICAL")) audiences.critical30.push(row);
      if (decision.states.includes("EXPIRED_AND_RENT_OVERDUE")) audiences.expiredAndRentOverdue.push(row);
    }

    return audiences;
  }

  async getR4Readiness(input: ReadinessInput = {}) {
    const [completion, schema] = await Promise.all([
      agreementLifecycleRecoveryService.getRecoveryCompletion(input),
      this.checkSchemaCompatibility(),
    ]);
    const audience = await this.checkAudienceGeneration(input);
    const queue = await this.checkRenewalQueue(input);
    const decision = await this.checkRenewalDecisionEngine(input);

    const renewalAudienceCounts = {
      "30day": audience.audiences["30day"].length,
      "15day": audience.audiences["15day"].length,
      expiryDay: audience.audiences.expiryDay.length,
      overdue7: audience.audiences.overdue7.length,
      critical30: audience.audiences.critical30.length,
    };

    const reasons = [
      completion.coveragePercent !== 100 && `Lifecycle coverage is ${completion.coveragePercent}%`,
      completion.pending > 0 && `${completion.pending} agreement${completion.pending === 1 ? "" : "s"} pending lifecycle recovery`,
      !queue.ok && `Renewal queue failed: ${queue.error}`,
      !decision.ok && `Renewal decision engine failed: ${decision.error}`,
      !audience.ok && `Audience generation failed: ${audience.error}`,
      !schema.ok && `Schema compatibility failed: missing ${schema.missingColumns.join(", ")}`,
    ].filter(Boolean) as string[];

    return {
      coveragePercent: completion.coveragePercent,
      agreementsPending: completion.pending,
      agreementsCompleted: completion.completed,
      renewalAudienceCounts,
      r4Ready: reasons.length === 0,
      checks: {
        lifecycleCoverage: completion.coveragePercent === 100 && completion.pending === 0,
        renewalQueue: queue.ok,
        renewalDecisionEngine: decision.ok,
        expiringAudienceGeneration: audience.ok,
        schemaCompatibility: schema.ok,
      },
      reasons,
    };
  }

  private async checkAudienceGeneration(input: ReadinessInput) {
    try {
      const audiences = await this.getRenewalAudiences(input);
      return { ok: true, audiences };
    } catch (error: any) {
      return { ok: false, error: error.message || "unknown error", audiences: emptyAudiences() };
    }
  }

  async runAudit(input: ReadinessInput = {}) {
    const readiness = await this.getR4Readiness(input);
    return {
      status: readiness.r4Ready ? "PASS" : "FAIL",
      readiness,
      reasons: readiness.reasons,
    };
  }

  private async checkRenewalQueue(input: ReadinessInput) {
    try {
      const ownerIds = input.ownerId ? [input.ownerId] : await this.ownerIds();
      for (const ownerId of ownerIds) {
        await renewalDecisionService.getOwnerRenewalQueue(ownerId, {
          hostelId: input.hostelId,
          filter: "all",
          now: input.now,
        });
      }
      return { ok: true, ownersChecked: ownerIds.length };
    } catch (error: any) {
      return { ok: false, error: error.message || "unknown error" };
    }
  }

  private async checkRenewalDecisionEngine(input: ReadinessInput) {
    try {
      const agreements = await this.db.agreement.findMany({
        where: {
          status: currentAgreementWhere(),
          ...(input.hostelId ? { hostel_id: input.hostelId } : {}),
          ...(input.ownerId ? { hostel: { owner_id: input.ownerId } } : {}),
        },
        include: this.agreementDecisionInclude(),
        take: 1000,
      });
      for (const agreement of agreements) {
        renewalDecisionService.evaluateAgreement(agreement, input.now || new Date());
      }
      return { ok: true, agreementsChecked: agreements.length };
    } catch (error: any) {
      return { ok: false, error: error.message || "unknown error" };
    }
  }

  private async checkSchemaCompatibility() {
    const rows = await this.db.$queryRawUnsafe<Array<{ column_name: string }>>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'Agreement'
         and column_name = any($1::text[])`,
      [...REQUIRED_SCHEMA_COLUMNS]
    );
    const present = new Set(rows.map((row) => row.column_name));
    const missingColumns = REQUIRED_SCHEMA_COLUMNS.filter((column) => !present.has(column));
    return { ok: missingColumns.length === 0, missingColumns };
  }

  private async ownerIds() {
    const hostels = await this.db.hostels.findMany({
      select: { owner_id: true },
      distinct: ["owner_id"],
    });
    return hostels.map((hostel: any) => hostel.owner_id).filter(Boolean);
  }

  private agreementDecisionInclude() {
    return {
      hostel: { select: { id: true, name: true, owner_id: true, preferences_config: true } },
      renewed_to_agreement: true,
      renewed_agreements: {
        where: { status: { notIn: ["VOID", "TERMINATED"] } },
        orderBy: { generated_at: "desc" },
        take: 1,
      },
      tenant: {
        include: {
          profiles: { select: { name: true, phone: true } },
          room_allocations: {
            where: { is_active: true, end_date: null },
            include: { room: { select: { id: true, room_no: true } } },
            take: 1,
          },
          move_out_requests: {
            orderBy: { created_at: "desc" },
            take: 3,
          },
          rent_obligations: {
            where: { status: { in: ["PENDING", "PARTIAL"] }, is_superseded: false },
            orderBy: { due_date: "asc" },
            take: 20,
          },
        },
      },
    };
  }
}

export const agreementR4ReadinessService = new AgreementR4ReadinessService();
