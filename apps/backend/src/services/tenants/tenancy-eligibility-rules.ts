/**
 * Pure rules for "may this person start a tenancy?".
 *
 * Kept free of Prisma so the rules are unit-testable without a database — the
 * service layer (`tenancy-eligibility-service.ts`) does the querying and hands
 * plain data in here.
 *
 * Three rules, in order:
 *   1. The account behind the phone number must be one this owner may make a
 *      tenant. An owner may never be a tenant of the hostel they own, and an
 *      admin account is never a tenant — but an owner of a *different* hostel
 *      may be ([[Decisions#ADR-162]]), so this is scoped, not a blanket "owners
 *      can never be tenants". Checked first because such an account typically
 *      holds no tenancies at all, so the two rules below would wave it
 *      straight through.
 *   2. A person may hold only one live tenancy. Accepting a hostel's invitation
 *      means they cannot join another until they leave.
 *   3. Leaving is not enough — the move-out must be COMPLETED (settlement
 *      finalised). `FORMER_TENANT` alone is set at the exit date, which can be
 *      before the settlement money has moved.
 */

/** Statuses that mean the tenancy is live. Mirrors `lib/tenancy/active-tenancy.ts`. */
const LIVE_STATUSES = ["INVITED", "ACTIVE"];

export type TenancySnapshot = {
  id: string;
  status: string;
  ownerId: string | null;
  hostelName: string | null;
  roomNumber: string | null;
  /**
   * Whether this tenancy ever reached activation. An invitation that expired or
   * was cancelled before the tenant ever moved in owes no settlement, so it must
   * not block them from joining somewhere else.
   */
  wasActivated: boolean;
  /** Whether a `move_out_requests` row for this tenancy reached COMPLETED. */
  hasCompletedMoveOut: boolean;
};

/**
 * The account a contact resolves to, as far as eligibility cares: who it is,
 * and what kind of account it is. `null` when no account exists yet — the
 * ordinary new-tenant case, which the role rule must never refuse.
 */
export type AccountSnapshot = {
  id: string;
  /** `profile.role` — OWNER | TENANT | ADMIN. */
  role: string;
};

export type TenancyDisclosure = {
  /**
   * `OWN` — the person already lives in a hostel belonging to the owner who is
   * asking, so naming it is just showing them their own roster.
   * `OTHER` — they live at another owner's property. Deliberately unnamed: the
   * inviting owner is not entitled to another owner's tenant roster, nor to know
   * where a person lives.
   */
  scope: "OWN" | "OTHER";
  hostelName: string | null;
  roomNumber: string | null;
  tenantId: string | null;
};

export type TenancyEligibility =
  | { eligible: true }
  | {
      eligible: false;
      code:
        | "PHONE_BELONGS_TO_NON_TENANT"
        | "TENANT_HAS_ACTIVE_TENANCY"
        | "PREVIOUS_TENANCY_NOT_SETTLED";
      disclosure: TenancyDisclosure;
    };

export function isLiveTenancy(tenancy: Pick<TenancySnapshot, "status">) {
  return LIVE_STATUSES.includes(String(tenancy.status));
}

function discloseTo(tenancy: TenancySnapshot, invitingOwnerId: string | null): TenancyDisclosure {
  const isOwn = Boolean(invitingOwnerId) && tenancy.ownerId === invitingOwnerId;
  if (!isOwn) {
    return { scope: "OTHER", hostelName: null, roomNumber: null, tenantId: null };
  }
  return {
    scope: "OWN",
    hostelName: tenancy.hostelName,
    roomNumber: tenancy.roomNumber,
    tenantId: tenancy.id,
  };
}

/**
 * @param tenancies every tenancy the person has ever held
 * @param invitingOwnerId the owner asking; controls how much the refusal reveals
 */
export interface EligibilityOptions {
  /**
   * A tenancy to leave out of the judgement — the one being taken over.
   *
   * **Claiming a tenancy is not starting a new one.** Since
   * [[Decisions#ADR-136]] every owner-managed tenancy carries a `profile_id`,
   * so by the time someone claims theirs, the profile is already bound to the
   * very tenancy in question. Asking "may this profile start a new tenancy?"
   * then finds that tenancy, sees it is live, and refuses — which broke the
   * claim flow for exactly the tenancies it exists to serve.
   *
   * Only the claimed tenancy is excused. A second live tenancy elsewhere, or
   * an unsettled previous stay, still blocks — that is the guard's real job
   * and the reason it is not simply skipped at the call site. See ADR-153.
   */
  ignoreTenancyId?: string;
  /**
   * The account the contact resolves to, when one exists. Supplying it enables
   * the account-role rule; omitting it (the claim flow, and any caller that
   * already knows it is holding a tenant) simply skips that rule rather than
   * failing open on a guess.
   */
  account?: AccountSnapshot | null;
}

export function evaluateTenancyEligibility(
  tenancies: readonly TenancySnapshot[],
  invitingOwnerId: string | null,
  options: EligibilityOptions = {}
): TenancyEligibility {
  const considered = options.ignoreTenancyId
    ? tenancies.filter((tenancy) => tenancy.id !== options.ignoreTenancyId)
    : tenancies;

  // The same rule `owner-managed-tenancy-service` enforces when it decides
  // whether a non-TENANT profile may be bound to a tenancy — but that one
  // fires deep inside the invite's write transaction, after the owner has
  // filled in four steps. Evaluating it here makes the identical refusal
  // available to the pre-submit check, answered while they are still typing
  // the phone number.
  //
  // Hostel-scoped, per [[Decisions#ADR-162]]: an OWNER of a *different* hostel
  // is a legitimate tenant and must pass. The wizard only ever invites into
  // the asking owner's own hostels, so "is this the asking owner's own
  // account?" is exactly the hostel-scoped question — and it is answerable at
  // the Tenant step, which is before any hostel has been chosen.
  const account = options.account;
  if (account) {
    const role = String(account.role).toUpperCase();
    const isOwnAccount = Boolean(invitingOwnerId) && account.id === invitingOwnerId;
    // Fails closed on an absent `invitingOwnerId`: with nobody to compare
    // against, an owner account is never *known* to be a different hostel's,
    // so it is refused rather than waved through. Same principle ADR-162
    // applies to its own hostel-owner comparisons.
    const isDifferentHostelOwner =
      role === "OWNER" && Boolean(invitingOwnerId) && account.id !== invitingOwnerId;
    if (role !== "TENANT" && !isDifferentHostelOwner) {
      return {
        eligible: false,
        code: "PHONE_BELONGS_TO_NON_TENANT",
        disclosure: {
          // `OWN` means "this is your own account" — the owner typed their own
          // number. Nothing else is ever disclosed: not a name, not a hostel,
          // not whose account it is.
          scope: isOwnAccount ? "OWN" : "OTHER",
          hostelName: null,
          roomNumber: null,
          tenantId: null,
        },
      };
    }
  }

  const live = considered.find(isLiveTenancy);
  if (live) {
    return {
      eligible: false,
      code: "TENANT_HAS_ACTIVE_TENANCY",
      disclosure: discloseTo(live, invitingOwnerId),
    };
  }

  const unsettled = considered.find(
    (tenancy) => tenancy.wasActivated && !tenancy.hasCompletedMoveOut
  );
  if (unsettled) {
    return {
      eligible: false,
      code: "PREVIOUS_TENANCY_NOT_SETTLED",
      disclosure: discloseTo(unsettled, invitingOwnerId),
    };
  }

  return { eligible: true };
}
