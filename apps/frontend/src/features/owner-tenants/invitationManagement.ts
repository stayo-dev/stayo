/**
 * Whether the owner sees the invitation-management screen or the full tenant
 * profile.
 *
 * `TenantDetailPage` gated this on `status === 'invited'`. That was correct
 * until [[ADR-165]] made an invited tenancy **ACTIVE from the moment it is
 * created** — the bed is held, rent generates, reminders fire — with the
 * person's own acceptance tracked separately. From then on the condition could
 * never be true, so `InvitedTenantProfileView` became unreachable and every
 * freshly invited tenant opened as a settled resident: no invitation status, no
 * resend, no cancel, no way to fix a wrong phone number before activation.
 *
 * The signal is `acceptance_status`, which is what ADR-165 introduced for
 * exactly this question. `useTenantDetail`'s own comment already said so —
 * "Since inviting now makes a tenancy immediately ACTIVE, this, not
 * `status === 'invited'`, is how *hasn't activated yet* is known" — the page
 * simply never followed it.
 *
 * **Fails closed.** Absent signals mean the ordinary profile, never the
 * invitation screen: showing cancel and resend to a settled tenant is a worse
 * error than the one being fixed, because those levers act on a real tenancy.
 */
export function showsInvitationManagement(tenant: {
  acceptanceStatus?: string | null;
  status?: string | null;
  accessMode?: string | null;
}): boolean {
  // ADR-165: invited, live, and not yet accepted by the person themselves.
  if (tenant.acceptanceStatus === 'PENDING') return true;

  // Pre-ADR-165 rows, which sat at INVITED until activation.
  if (String(tenant.status ?? '').toLowerCase() === 'invited') return true;

  return false;
}
