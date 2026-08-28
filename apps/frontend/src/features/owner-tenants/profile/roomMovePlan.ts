/**
 * Which operation a room move actually is.
 *
 * Two backend endpoints do this, and they are not interchangeable:
 *
 *  - `POST /api/allocations/shift` moves a bed **inside one hostel**.
 *  - `POST /api/tenants/transfer` moves a tenant **between hostels**. It closes
 *    the old allocation, opens a new one, rewrites `tenants.hostel_id` and
 *    writes a `tenant_transfer_logs` audit row. It also enforces guards a shift
 *    has no reason to — an open dispute, an unresolved exit settlement, an
 *    archived or inactive destination.
 *
 * `transferTenant` **refuses** a same-hostel move outright ("Use room shift
 * instead of hostel transfer"), and a shift cannot cross hostels. So sending
 * either one the other's job is a guaranteed error, and the decision is the
 * destination's to make — never the owner's, who should just be picking a room.
 */

export type RoomMoveKind = 'shift' | 'transfer';

export interface RoomMovePlan {
  /** Null while no destination is chosen. */
  kind: RoomMoveKind | null;
  crossHostel: boolean;
  /** What the owner needs to know before confirming, or null when nothing is unusual. */
  consequence: string | null;
  confirmLabel: string;
}

export interface RoomMoveInput {
  currentHostelId: string | null | undefined;
  targetHostelId: string | null | undefined;
  targetRoomNo?: string;
  targetHostelName?: string;
}

export function planRoomMove({
  currentHostelId,
  targetHostelId,
  targetRoomNo,
  targetHostelName,
}: RoomMoveInput): RoomMovePlan {
  const target = String(targetHostelId ?? '');
  const current = String(currentHostelId ?? '');

  if (!target) {
    return { kind: null, crossHostel: false, consequence: null, confirmLabel: 'Pick a room' };
  }

  // An unknown current hostel resolves to `transfer` rather than `shift`:
  // transfer is the operation that can span both cases, and it validates the
  // real relationship server-side instead of trusting a guess made here.
  const crossHostel = current !== target;
  const kind: RoomMoveKind = crossHostel ? 'transfer' : 'shift';

  // Tied to the hostel, not the room — the owner should see what changing
  // hostel means the moment they pick one, not only once a bed is chosen.
  const consequence = crossHostel
    ? `${targetHostelName ?? 'The new hostel'} becomes this tenant's hostel. Past charges and payment history stay with their current one; only future charges follow them.`
    : null;

  if (!targetRoomNo) {
    return { kind, crossHostel, consequence, confirmLabel: 'Pick a room' };
  }

  const destination = crossHostel && targetHostelName
    ? `Room ${targetRoomNo} · ${targetHostelName}`
    : `Room ${targetRoomNo}`;

  return { kind, crossHostel, consequence, confirmLabel: `Move to ${destination}` };
}
