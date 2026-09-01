import { prisma } from "@/lib/db";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import {
  evaluateTenancyEligibility,
  type AccountSnapshot,
  type TenancyEligibility,
  type TenancySnapshot,
  type EligibilityOptions,
} from "./tenancy-eligibility-rules";

export type { TenancyEligibility, TenancyDisclosure } from "./tenancy-eligibility-rules";

/**
 * The single answer to "may this person start a tenancy?".
 *
 * An owner or admin account can never be somebody's tenant; a person may hold one
 * live tenancy at a time; and they may not start a new one until every stay they
 * actually moved into has a `COMPLETED` move-out. The rules themselves are pure
 * (`tenancy-eligibility-rules.ts`); this file only gathers the data they need.
 *
 * Callers must use this rather than hand-rolling a `profile.tenants` check —
 * `tenant-invitation-lifecycle-service` used to do that and produced the
 * misleading `ALREADY_EXISTS: User with this email already exists`, which told an
 * owner nothing about why the invite failed.
 */
const REFUSAL_MESSAGES: Record<
  Extract<TenancyEligibility, { eligible: false }>["code"],
  string
> = {
  PHONE_BELONGS_TO_NON_TENANT: "This phone number belongs to a non-tenant Stayo account",
  TENANT_HAS_ACTIVE_TENANCY: "This person already has an active tenancy",
  PREVIOUS_TENANCY_NOT_SETTLED: "This person's previous stay has not been settled",
};

export class TenancyEligibilityError extends Error {
  code: Extract<TenancyEligibility, { eligible: false }>["code"];
  status = 409;
  disclosure: unknown;

  constructor(result: Extract<TenancyEligibility, { eligible: false }>) {
    super(REFUSAL_MESSAGES[result.code]);
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

  /**
   * Whether this phone number currently holds a live (INVITED/ACTIVE) tenancy
   * at this specific hostel — used to stop a lead being created for someone
   * who is already that hostel's tenant. Deliberately hostel-scoped, unlike
   * `loadLiveTenanciesByPhone`: a live tenancy elsewhere must not block a
   * lead here (that cross-hostel case is `evaluateTenancyEligibility`'s job,
   * at invitation time).
   */
  async hasLiveTenancyAtHostel(phone: string | null | undefined, hostelId: string, tx?: any): Promise<boolean> {
    const normalized = normalizeIndianPhone(phone ?? null);
    if (!normalized) return false;

    const tenancies = await this.loadTenanciesWhere(
      { phone_1: normalized, hostel_id: hostelId, status: { in: ["ACTIVE", "INVITED"] } },
      tx
    );
    return tenancies.length > 0;
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
    tx?: any,
    /** See `EligibilityOptions.ignoreTenancyId` — used by the claim flow. */
    options: EligibilityOptions = {}
  ): Promise<TenancyEligibility> {
    const id = String(profileId || "").trim();
    if (!id) return { eligible: true };

    const tenancies = await this.loadTenancies(id, tx);
    return evaluateTenancyEligibility(tenancies, invitingOwnerId, options);
  }

  /** As `checkEligibility`, but throws a 409 the routes can serialise directly. */
  async assertCanStartNewTenancy(
    profileId: string,
    invitingOwnerId: string | null,
    tx?: any,
    options: EligibilityOptions = {}
  ) {
    const result = await this.checkEligibility(profileId, invitingOwnerId, tx, options);
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
  ): Promise<{ account: AccountSnapshot | null; tenancies: TenancySnapshot[] }> {
    const account = await this.resolveAccountByContact(contact, tx);
    const byProfile = account ? await this.loadTenancies(account.id, tx) : [];

    const phone = normalizeIndianPhone(contact.phone ?? null);
    const byPhone = phone ? await this.loadLiveTenanciesByPhone(phone, tx) : [];

    const seen = new Set(byProfile.map((t) => t.id));
    const tenancies = [...byProfile, ...byPhone.filter((t) => !seen.has(t.id))];

    return { account, tenancies };
  }

  /**
   * Resolves an email/phone to the account behind it, or null if none exists.
   *
   * Returns the `role` as well as the id, because "what kind of account is
   * this?" is now one of the eligibility rules — an owner or admin account
   * cannot be invited as somebody's tenant, and it typically has no tenancies
   * at all, so the tenancy-shaped rules would never notice it.
   */
  private async resolveAccountByContact(
    contact: { email?: string | null; phone?: string | null },
    tx?: any
  ): Promise<AccountSnapshot | null> {
    const db = tx || prisma;
    const email = contact.email?.trim().toLowerCase() || null;
    const phone = contact.phone?.trim() || null;
    if (!email && !phone) return null;

    const profile = await db.profile.findFirst({
      where: {
        OR: [...(email ? [{ email }] : []), ...(phone ? [{ phone }] : [])],
      },
      select: { id: true, role: true },
    });
    return profile ? { id: profile.id, role: String(profile.role) } : null;
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
    const { account, tenancies } = await this.loadTenanciesForContact(contact, tx);
    // No account and no tenancy is the ordinary new-tenant case. This can no
    // longer short-circuit on `tenancies.length === 0` alone: an owner account
    // has no tenancies, and refusing it is the whole point of the account-role
    // rule.
    if (!account && tenancies.length === 0) return { eligible: true };

    return evaluateTenancyEligibility(tenancies, invitingOwnerId, { account });
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
    const { account, tenancies } = await this.loadTenanciesForContact(contact, tx);
    const hasAccount = Boolean(account);
    if (!account && tenancies.length === 0) return { hasAccount, eligibility: { eligible: true } };

    return {
      hasAccount,
      eligibility: evaluateTenancyEligibility(tenancies, invitingOwnerId, { account }),
    };
  }
}

export const tenancyEligibilityService = new TenancyEligibilityService();
