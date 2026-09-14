/**
 * The people in a room, shaped for the owner's Rooms tab.
 *
 * Since ADR-199 that tab draws the hostel as a building with every tenant's
 * face in the room they live in, so each occupant carries their photo and the
 * overdue verdict for the red dot. The verdict is `payment_status` from
 * `financialService.getTenantPaymentSummary()`, which the caller already
 * computes — composed here, never recalculated. `pending_dues` alone cannot
 * drive the dot: it includes rent that is not yet due.
 *
 * Pure: the caller loads the rows and computes the summary.
 */
import { realEmailOrNull } from "@/src/services/tenants/invited-profile-resolver";

/**
 * An invitation that is live and holds a bed.
 *
 * QUEUED belongs here: a bulk-imported invitation is created but not yet sent,
 * and it still reserves a room, still blocks a competing invite, and must
 * still be cancelled with its tenancy. Leaving it out let "send all" message
 * someone whose tenancy had been cancelled.
 */
export const ACTIVE_INVITE_STATUSES = ["PENDING", "OPENED", "ACTIVATION_STARTED", "QUEUED"];

/** The slice of `getTenantPaymentSummary()` a room occupant needs. */
export interface OccupantPaymentSummary {
  pending_amount: number;
  payment_status: string;
}

/** A tenant living in the room, from their active allocation. */
export function activeOccupant(allocation: any, summary: OccupantPaymentSummary) {
  const tenant = allocation.tenant;
  const profile = tenant.profiles;
  const invitation = tenant.tenant_invitations?.[0];
  return {
    tenant_id: tenant.id,
    name: profile?.name ?? invitation?.name ?? "Tenant",
    email: realEmailOrNull(profile?.email) ?? realEmailOrNull(tenant.personal_email) ?? realEmailOrNull(invitation?.email),
    phone: profile?.phone ?? tenant.phone_1 ?? invitation?.phone ?? null,
    joined_date: allocation.start_date,
    rent: Number(tenant.monthly_rent),
    pending_dues: Number(summary.pending_amount || 0),
    payment_status: summary.payment_status,
    photo_url: tenant.photo_url || null,
    status: tenant.status,
  };
}

/** Someone invited into the room who has not moved in yet. */
export function invitedOccupantsFromReservations(reservations: any[] = []) {
  return reservations
    .filter((reservation: any) => ACTIVE_INVITE_STATUSES.includes(String(reservation.invitation?.status || "")))
    .map((reservation: any) => ({
      tenant_id: reservation.tenant_id,
      profile_id: reservation.tenant?.profile_id ?? null,
      invitation_id: reservation.invitation_id,
      name: reservation.invitation?.name ?? reservation.tenant?.profiles?.name ?? "Invited tenant",
      email: reservation.invitation?.email ?? reservation.tenant?.personal_email ?? null,
      phone: reservation.invitation?.phone ?? reservation.tenant?.phone_1 ?? null,
      joined_date: reservation.tenant?.joined_on ?? reservation.reserved_at,
      rent: Number(reservation.tenant?.monthly_rent || 0),
      pending_dues: 0,
      payment_status: "INVITED",
      photo_url: reservation.tenant?.photo_url || null,
      status: "INVITED",
      invite_status: reservation.invitation?.status || "PENDING",
      occupant_type: "INVITED",
      badge: "Invited",
    }));
}
