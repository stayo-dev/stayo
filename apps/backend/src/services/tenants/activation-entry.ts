/**
 * May this tenancy enter the activation flow?
 *
 * **The distinction this module exists to draw.** `tenants.status` answers "is
 * this tenancy live" — the person is in a room, rent is generating, they count
 * toward occupancy. It has never answered "has this person completed their own
 * onboarding", and [[Decisions#ADR-133]] said so explicitly: *access is a
 * second axis, not a redefinition of ACTIVE*. One place did not follow that.
 * `resolveInvitation` refused any `ACTIVE` tenancy outright, and
 * `computeState` derived `activationCompleted` from `status === "ACTIVE"`.
 *
 * That is correct for a tenant who activated themselves — they went INVITED →
 * ACTIVE by finishing. It is wrong for an owner-managed tenancy, which is
 * `ACTIVE` from the moment the owner created it, without the tenant ever
 * seeing a single onboarding screen. So a tenant claiming their account was
 * told their activation was already complete, and the identity, documents,
 * guardian details and residency agreement a new tenant provides were never
 * asked for.
 *
 * **Why the obvious field does not answer it.** `activation_completed_at`
 * looks like the answer and is not: adoption stamps it at the moment the owner
 * creates the tenancy (`owner-managed-tenancy-service.ts`), so it is already
 * set for precisely the tenants who have never onboarded. It records "this
 * tenancy is set up", not "this person went through onboarding".
 *
 * What does separate the two is which write last touched the invitation.
 * `completeActivation` moves it to `ACTIVATED`, and that is the only write in
 * the system that fires when a *tenant* finishes the ceremony. Adoption moves
 * it to `SUPERSEDED` and records a `tenant_owner_attestations` row — the owner
 * attesting on the tenant's behalf, which is the opposite claim.
 *
 * A tenancy with no invitation at all (created directly, never invited) has
 * neither signal, so it falls back to the timestamp — correct there, because
 * nothing else could have stamped it — unless an attestation says an owner set
 * it up.
 *
 * Pure, because these are the guards on a legal ceremony and the branches
 * matter more than the plumbing around them. See ADR-155.
 */

export interface ActivationEntrySubject {
  /** `tenants.status`. */
  status: string;
  /**
   * `tenants.activation_completed_at`. Beware: adoption sets this too, so it
   * is only trustworthy in the absence of the two signals below.
   */
  activationCompletedAt: Date | string | null | undefined;
  /**
   * `tenant_invitations.status` for this tenancy, when it has an invitation.
   * `ACTIVATED` is written only by `completeActivation`.
   */
  invitationStatus?: string | null;
  /**
   * Whether a `tenant_owner_attestations` row exists — i.e. an owner set this
   * tenancy up on the tenant's behalf.
   */
  ownerAttested?: boolean | null;
}

export type ActivationEntryVerdict =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

/**
 * The owner set this tenancy up on the tenant's behalf, and the tenant has not
 * since finished onboarding themselves.
 *
 * This is the *positive* test for the adopted-and-not-yet-claimed case, kept
 * separate because callers that already had a correct guard for self-serve
 * tenants need to carve out this case rather than replace their rule.
 */
export function isAwaitingTenantOnboarding(subject: ActivationEntrySubject): boolean {
  // The tenant finished the ceremony. Only `completeActivation` writes this.
  if (String(subject.invitationStatus ?? "").toUpperCase() === "ACTIVATED") return false;
  return Boolean(subject.ownerAttested);
}

/** Whether the tenant has been through onboarding themselves. */
export function hasCompletedActivation(subject: ActivationEntrySubject): boolean {
  if (String(subject.invitationStatus ?? "").toUpperCase() === "ACTIVATED") return true;

  // An owner set this tenancy up. Whatever the timestamp says, the tenant has
  // not been asked for their identity, documents, guardian or signature.
  if (isAwaitingTenantOnboarding(subject)) return false;

  // No invitation and no attestation: nothing but the tenant's own completion
  // could have stamped this.
  return Boolean(subject.activationCompletedAt);
}

export function canEnterActivation(subject: ActivationEntrySubject): ActivationEntryVerdict {
  const status = String(subject.status ?? "").toUpperCase();

  if (status === "CANCELLED") {
    return { allowed: false, code: "CANCELLED", message: "Invitation was cancelled" };
  }
  if (status === "EXPIRED") {
    return { allowed: false, code: "EXPIRED", message: "Invitation expired" };
  }

  if (status === "ACTIVE") {
    // Already finished once. Re-entering would re-run a ceremony that has a
    // signed agreement and a consent record behind it.
    if (hasCompletedActivation(subject)) {
      return { allowed: false, code: "ALREADY_ACTIVE", message: "Account already active" };
    }
    // Live, but the tenant has never onboarded — an owner-managed tenancy,
    // now being claimed. This is the case the old `status`-only guard refused.
    return { allowed: true };
  }

  if (status === "INVITED") return { allowed: true };

  return { allowed: false, code: "INVALID", message: "Activation is not available for this tenant" };
}

/**
 * Statuses the final completion write may transition from.
 *
 * An owner-managed tenancy is already `ACTIVE`, so completing onboarding stamps
 * `activation_completed_at` rather than flipping a status that is already
 * right. `activation_completed_at: null` remains in the same `WHERE` — on this
 * legacy no-invitation path nothing else can have stamped it, so it still
 * makes the write idempotent.
 */
export const ACTIVATABLE_STATUSES = ["INVITED", "ACTIVE"] as const;
