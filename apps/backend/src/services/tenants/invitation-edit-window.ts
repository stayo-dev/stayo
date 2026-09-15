/**
 * Whether an invitation's terms may still be changed — the one predicate,
 * shared (ADR-208).
 *
 * Before ADR-165 this question had an easy answer: an invited tenancy sat at
 * `tenants.status = 'INVITED'` until the person activated it, so every guard
 * on the edit path simply asked `status === 'INVITED'`. ADR-165 made an
 * invited tenancy **live from the moment it is created** — `status = 'ACTIVE'`,
 * the bed held, rent generating — and moved "has the person themselves agreed
 * yet?" onto `acceptance_status`.
 *
 * The frontend was migrated (`showsInvitationManagement`) and so was
 * `resendInvitation` (`tenantAlreadyOwnerManaged`). Two guards were not, and
 * both were on the same path:
 *
 *   1. `invitationService.updateInvitation` threw
 *      `Invitation can be edited only before tenant activation` — a condition
 *      that, after ADR-165, is never true for a newly invited tenant. The
 *      owner saw a "Review & send" button that could not succeed.
 *   2. `initializeOnboardingFinancials` returned `TENANT_NOT_INVITED` and
 *      created nothing — silently. Since `resendInvitation` deletes the
 *      tenant's unpaid obligations immediately before calling it, fixing (1)
 *      alone would have deleted a tenant's dues and regenerated none.
 *
 * Hence one predicate in one place, used by both.
 *
 * PURE — takes two strings, returns a decision. No Prisma, no I/O.
 */

/** The tenancy fields this decision reads. Strings, not Prisma enums, so callers can pass raw rows. */
export interface TenancyAcceptanceState {
  /** `tenants.status` — ACTIVE, INVITED, CANCELLED, EXPIRED, INACTIVE… */
  status: string | null | undefined;
  /** `tenants.acceptance_status` — NOT_REQUIRED | PENDING | ACCEPTED (never null; defaults to NOT_REQUIRED). */
  acceptanceStatus: string | null | undefined;
}

/** Tenancy states in which an invitation is still running. */
const LIVE_STATUSES = new Set(['ACTIVE', 'INVITED']);

const norm = (value: string | null | undefined) => String(value ?? '').trim().toUpperCase();

/**
 * True while the tenancy is live and the person has not accepted it yet.
 *
 * Two shapes qualify, and the second is the whole point:
 *
 * - **`INVITED`** — a pre-ADR-165 row, or the brief window inside
 *   `createInvitation` before the owner-managed tenancy is applied. Accepted
 *   regardless of `acceptance_status`, which on those rows is the
 *   `NOT_REQUIRED` default.
 * - **`ACTIVE` + `PENDING`** — every tenancy created since ADR-165.
 *
 * **Liveness is checked separately from acceptance, deliberately.**
 * `closeUnacceptedTenancy` leaves `acceptance_status` at `PENDING` when it
 * cancels or expires a tenancy — the terminal `tenants.status` is the signal
 * it expects readers to key on. So `acceptance_status === 'PENDING'` alone
 * would treat a cancelled invitation as editable.
 *
 * `ACCEPTED` is never editable: the person has agreed to these terms, and
 * changing them afterwards is the change-request flow, not an invitation edit.
 */
export function isUnacceptedTenancy(tenancy: TenancyAcceptanceState): boolean {
  const status = norm(tenancy.status);
  if (status === 'INVITED') return true;
  if (!LIVE_STATUSES.has(status)) return false;
  return norm(tenancy.acceptanceStatus) === 'PENDING';
}

export type InvitationEditVerdict =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Whether the owner may still change this invitation's terms.
 *
 * The refusals name what actually happened, because "only before tenant
 * activation" was shown to owners whose tenant had demonstrably not activated.
 *
 * Note what is **not** checked here: whether the tenant has payments on record.
 * Under ADR-165 an unaccepted tenancy is live, so rent generates and the owner
 * can record payments against it long before acceptance — `updateInvitation`'s
 * old blanket "cannot be edited after payment activity exists" refused exactly
 * the normal case. It was also redundant: `resendInvitation` deletes only
 * obligations matching `payments: { none: {} }`, and
 * `initializeOnboardingFinancials` skips any period that still has one, so a
 * paid obligation survives an edit untouched and is never duplicated.
 */
export function canEditInvitation(tenancy: TenancyAcceptanceState): InvitationEditVerdict {
  if (isUnacceptedTenancy(tenancy)) return { allowed: true };

  if (norm(tenancy.acceptanceStatus) === 'ACCEPTED') {
    return { allowed: false, reason: 'This tenant has already accepted these terms. Use a change request instead.' };
  }

  const status = norm(tenancy.status);
  if (status === 'CANCELLED' || status === 'EXPIRED') {
    return { allowed: false, reason: 'This invitation was cancelled. Invite the tenant again to offer new terms.' };
  }

  return { allowed: false, reason: 'This tenancy is no longer an open invitation.' };
}
