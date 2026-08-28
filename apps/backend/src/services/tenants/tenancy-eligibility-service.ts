import { prisma } from "@/lib/db";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import {
  evaluateTenancyEligibility,
  type TenancyEligibility,
  type TenancySnapshot,
} from "./tenancy-eligibility-rules";

export type { TenancyEligibility, TenancyDisclosure } from "./tenancy-eligibility-rules";

/**
 * The single answer to "may this person start a tenancy?".
 *
 * A person may hold one live tenancy at a time, and may not start a new one until
 * every stay they actually moved into has a `COMPLETED` move-out. The rules
 * themselves are pure (`tenancy-eligibility-rules.ts`); this file only gathers the
 * data they need.
 *
 * Callers must use this rather than hand-rolling a `profile.tenants` check —
 * `tenant-invitation-lifecycle-service` used to do that and produced the
 * misleading `ALREADY_EXISTS: User with this email already exists`, which told an
 * owner nothing about why the invite failed.
 */
export class TenancyEligibilityError extends Error {
  code: "TENANT_HAS_ACTIVE_TENANCY" | "PREVIOUS_TENANCY_NOT_SETTLED";
  status = 409;
  disclosure: unknown;

  constructor(result: Extract<TenancyEligibility, { eligible: false }>) {
    super(
      result.code === "TENANT_HAS_ACTIVE_TENANCY"
        ? "This person already has an active tenancy"
        : "This person's previous stay has not been settled"
    );
    this.name = "TenancyEligibilityError";
    this.code = result.code;
    this.disclosure = result.disclosure;
  }
}

export class TenancyEligibilityService {
  /** Every tenancy a profile has ever held, shaped for the pure rules. */
  private async loadTenancies(profileId: string, tx?: any): Promise<TenancySnapshot[]> {
    return this.loadTenanciesWhere({ profile_id: profileId }, tx);
  }

  /**
   * Live tenancies carrying this phone number, whatever profile they point at.
   *
   * This exists because `profile_id` is not a reliable index of a person.
   * Adoption used to leave it null, which made an owner-managed tenancy
   * invisible to every profile-keyed guard — in production one phone
   * accumulated three tenancies in one hostel, the third invite accepted two
   * minutes after the adoption. Adoption now links a profile, but this check
   * stands independently: it catches the rows already orphaned, and it does not
   * depend on a future code path remembering to set `profile_id`.
   *
   * Only `ACTIVE` and `INVITED` count. A `FORMER_TENANT`, `CANCELLED` or
   * `EXPIRED` tenancy must never block a returning resident.
   */
  private async loadLiveTenanciesByPhone(phone: string, tx?: any): Promise<TenancySnapshot[]> {
    return this.loadTenanciesWhere(
      { phone_1: phone, status: { in: ["ACTIVE", "INVITED"] } },
      tx
    );
  }

  private async loadTenanciesWhere(where: any, tx?: any): Promise<TenancySnapshot[]> {
    const db = tx || prisma;

    const tenancies = await db.tenants.findMany({
      where,
      select: {
        id: true,
        status: true,
        owner_id: true,
        activation_completed_at: true,
        hostels: { select: { name: true } },
        room_allocations: {
          where: { is_active: true, end_date: null },
          select: { room: { select: { room_no: true } } },
          take: 1,
        },
        move_out_requests: {
          where: { status: "COMPLETED" },
          select: { id: true },
          take: 1,
        },
      },
    });

    return tenancies.map((tenancy: any) => ({
      id: tenancy.id,
      status: String(tenancy.status),
      ownerId: tenancy.owner_id ?? null,
      hostelName: tenancy.hostels?.name ?? null,
      roomNumber: tenancy.room_allocations?.[0]?.room?.room_no ?? null,
      wasActivated: Boolean(tenancy.activation_completed_at),
      hasCompletedMoveOut: (tenancy.move_out_requests?.length ?? 0) > 0,
    }));
  }

  /**
   * @param invitingOwnerId scopes how much a refusal reveals: an owner may see
   *   which of *their own* hostels the person lives in, but never another
   *   owner's hostel name, room or tenant record.
   */
  async checkEligibility(
    profileId: string,
    invitingOwnerId: string | null,
    tx?: any
  ): Promise<TenancyEligibility> {
    const id = String(profileId || "").trim();
    if (!id) return { eligible: true };

    const tenancies = await this.loadTenancies(id, tx);
    return evaluateTenancyEligibility(tenancies, invitingOwnerId);
  }

  /** As `checkEligibility`, but throws a 409 the routes can serialise directly. */
  async assertCanStartNewTenancy(profileId: string, invitingOwnerId: string | null, tx?: any) {
    const result = await this.checkEligibility(profileId, invitingOwnerId, tx);
    if (!result.eligible) throw new TenancyEligibilityError(result);
    return result;
  }

  /**
   * Everything relevant to "may this contact start a tenancy?" — the tenancies
   * of any profile matching the email/phone, PLUS any live tenancy carrying that
   * phone directly, deduplicated. Either source alone has a blind spot.
   */
  private async loadTenanciesForContact(
    contact: { email?: string | null; phone?: string | null },
    tx?: any
  ): Promise<{ hasAccount: boolean; tenancies: TenancySnapshot[] }> {
    const profileId = await this.resolveProfileIdByContact(contact, tx);
    const byProfile = profileId ? await this.loadTenancies(profileId, tx) : [];

    const phone = normalizeIndianPhone(contact.phone ?? null);
    const byPhone = phone ? await this.loadLiveTenanciesByPhone(phone, tx) : [];

    const seen = new Set(byProfile.map((t) => t.id));
    const tenancies = [...byProfile, ...byPhone.filter((t) => !seen.has(t.id))];

    return { hasAccount: Boolean(profileId), tenancies };
  }

  /** Resolves an email/phone to a profile id, or null if no account exists. */
  private async resolveProfileIdByContact(
    contact: { email?: string | null; phone?: string | null },
    tx?: any
  ): Promise<string | null> {
    const db = tx || prisma;
    const email = contact.email?.trim().toLowerCase() || null;
    const phone = contact.phone?.trim() || null;
    if (!email && !phone) return null;

    const profile = await db.profile.findFirst({
      where: {
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
      select: { id: true },
    });
    return profile?.id ?? null;
  }

  /**
   * Same question, asked before a profile exists — an owner typing an email or
   * phone number into the invite form. Resolves to a profile first; someone with
   * no account cannot have a tenancy.
   */
  async checkEligibilityByContact(
    contact: { email?: string | null; phone?: string | null },
    invitingOwnerId: string | null,
    tx?: any
  ): Promise<TenancyEligibility> {
    const { tenancies } = await this.loadTenanciesForContact(contact, tx);
    if (tenancies.length === 0) return { eligible: true };

    return evaluateTenancyEligibility(tenancies, invitingOwnerId);
  }

  /** As `checkEligibilityByContact`, but throws a 409 the routes can serialise directly. */
  async assertCanStartNewTenancyByContact(
    contact: { email?: string | null; phone?: string | null },
    invitingOwnerId: string | null,
    tx?: any
  ) {
    const result = await this.checkEligibilityByContact(contact, invitingOwnerId, tx);
    if (!result.eligible) throw new TenancyEligibilityError(result);
    return result;
  }

  /**
   * The pre-submit answer to "can I invite this phone number?" — same rule,
   * same OWN/OTHER disclosure scoping as `assertCanStartNewTenancyByContact`,
   * but never throws and never mutates. Safe to call on every debounced
   * keystroke in the invite wizard.
   *
   * `hasAccount` distinguishes "nobody found" (ordinary new-tenant flow) from
   * "a Stayo account exists and is currently eligible" (shown as a light
   * existing-account signal, never as history — see ADR-075).
   */
  async previewEligibilityByContact(
    contact: { email?: string | null; phone?: string | null },
    invitingOwnerId: string | null,
    tx?: any
  ): Promise<{ hasAccount: boolean; eligibility: TenancyEligibility }> {
    const { hasAccount, tenancies } = await this.loadTenanciesForContact(contact, tx);
    if (tenancies.length === 0) return { hasAccount, eligibility: { eligible: true } };

    return { hasAccount, eligibility: evaluateTenancyEligibility(tenancies, invitingOwnerId) };
  }
}

export const tenancyEligibilityService = new TenancyEligibilityService();
