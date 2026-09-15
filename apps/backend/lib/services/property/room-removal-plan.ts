/**
 * What "delete this room" should actually do.
 *
 * `DELETE /api/rooms/:id` used to check for active tenants and live invitation
 * reservations and then call `prisma.rooms.delete()`. Five foreign keys point
 * at `rooms` with `ON DELETE RESTRICT` — `room_activity_logs`,
 * `room_allocations`, `room_reservations`, `tenant_invitations` and
 * `tenant_invitation_reservations` — so any room with *history* still failed,
 * and failed as a raw Prisma error shown to the owner:
 *
 *   Invalid `prisma.rooms.delete()` invocation:
 *   Foreign key constraint violated: `room_activity_logs_room_id_fkey (index)`
 *
 * `room_activity_logs` is the one that made this common. It is written on every
 * room edit and nothing in the codebase ever reads it, so merely renaming a
 * room once was enough to make it permanently undeletable.
 *
 * The rule now has three outcomes (ADR-207):
 *
 * - **refuse** — someone lives there, or a bed is held for an invite. Nothing
 *   is removed while a person is attached to the room.
 * - **purge** — the room was never used by anyone. Its unread activity logs go
 *   with it and the row is deleted. This is the common case: a room added by
 *   mistake, or one the owner created while setting the hostel up.
 * - **retire** — the room has real history: a past tenant, a past invite, an
 *   old reservation. `is_active: false` takes it out of the building and every
 *   listing (`GET /api/rooms` already filters on it) while the allocations,
 *   obligations and receipts that hang off it stay exactly where they are.
 *
 * Retiring is not a new idea here — it is how `planFloorRoomSave` already
 * removes a room the owner deleted from the hostel builder.
 *
 * PURE — takes counts, returns a decision. No Prisma, no I/O, so it is
 * testable without the provisioned database this repo does not have.
 * Same reasoning as `planFloorRoomSave` and `buildSettlementPlan`.
 */

/** Everything attached to a room that bears on whether it can go. */
export interface RoomAttachments {
  /** Tenants living there right now. */
  activeAllocations: number;
  /** Beds held for an invitation that has not been answered. */
  activeInvitationReservations: number;
  /** Every `room_allocations` row, current and historical. */
  allocations: number;
  /** Every `tenant_invitations` row ever pointed at this room. */
  invitations: number;
  /** Every `tenant_invitation_reservations` row, live or spent. */
  invitationReservations: number;
  /** Every `room_reservations` row. */
  reservations: number;
}

export type RoomRemovalPlan =
  | { action: 'refuse'; reason: string }
  /** Delete the row. `clearActivityLogs` rows must go first, in the same transaction. */
  | { action: 'purge' }
  /** Keep the row and its history; take it out of the hostel. */
  | { action: 'retire'; reason: string };

/**
 * Decide what removing a room means for the room described by `attachments`.
 *
 * Order matters: people first. A room is refused while anyone is attached to
 * it live, regardless of what else it carries.
 */
export function planRoomRemoval(attachments: RoomAttachments): RoomRemovalPlan {
  if (attachments.activeAllocations > 0) {
    return { action: 'refuse', reason: 'Cannot delete room with active tenants' };
  }
  if (attachments.activeInvitationReservations > 0) {
    return { action: 'refuse', reason: 'Cannot delete room with active invitation reservations' };
  }

  // Anything below is history, and history is the reason the row has to stay.
  // `room_activity_logs` is deliberately not consulted: nothing reads it, so
  // it is never a reason to keep a room the owner wants gone.
  const history =
    attachments.allocations +
    attachments.invitations +
    attachments.invitationReservations +
    attachments.reservations;

  if (history > 0) {
    return {
      action: 'retire',
      reason: 'Room removed. Its past tenants and payment history are kept.',
    };
  }

  return { action: 'purge' };
}
