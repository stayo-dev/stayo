/**
 * Whether a floor or a room can be deleted.
 *
 * `DELETE /api/floors/:id` and `DELETE /api/rooms/:id` both existed with **no
 * frontend caller anywhere**, so an owner could add a floor or a room and
 * never remove it. (Hostels are different — archiving one has been wired to
 * the dashboard's hostel menu for a long time, via `ArchiveHostelModal` and
 * `useArchiveHostel`; there was never a gap there.)
 *
 * Both of these are **real deletes**, not archives, which is why each surface
 * says so out loud.
 *
 * Pure, because `apps/frontend` tests run without a DOM and this is the part
 * worth being sure about: what makes a delete unsafe. The server stays the
 * authority — this only avoids offering an action certain to be refused.
 */

/**
 * Flat rather than a discriminated union: this app compiles with
 * `strict: false`, and without `strictNullChecks` TypeScript will not narrow
 * `{ ok: true } | { ok: false; reason: string }` on the `ok` check — every
 * read of `.reason` becomes an error at the call site.
 */
export interface RemovalEligibility {
  ok: boolean;
  /** Why not, when `ok` is false. Null when the delete is allowed. */
  reason: string | null;
}

// ── Rooms ──────────────────────────────────────────────────────────────────

export interface RoomRemovalSubject {
  /** Beds with a tenant living in them. */
  occupiedBeds: number;
  /** Beds held for an invited tenant who has not moved in yet. */
  reservedBeds: number;
  /** ARCHIVED / INACTIVE hostels reject every operational write. */
  hostelStatus?: string;
}

/**
 * Whether a room can be deleted.
 *
 * Mirrors `DELETE /api/rooms/:id`, which refuses on active allocations, on
 * active invitation reservations, and on a hostel that is not ACTIVE. A
 * reserved bed is called out separately from an occupied one because the fix
 * is different — cancel the invitation, versus move someone out.
 *
 * Unlike a hostel, this is a **real delete**: `prisma.rooms.delete`.
 */
export function canDeleteRoom(subject: RoomRemovalSubject): RemovalEligibility {
  const status = subject.hostelStatus;
  if (status === 'ARCHIVED' || status === 'INACTIVE') {
    return { ok: false, reason: `This hostel is ${status.toLowerCase()}, so its rooms cannot be changed.` };
  }
  if (subject.occupiedBeds > 0) {
    const people = subject.occupiedBeds === 1 ? '1 tenant is' : `${subject.occupiedBeds} tenants are`;
    return { ok: false, reason: `${people} living in this room. Move them out before deleting it.` };
  }
  if (subject.reservedBeds > 0) {
    const beds = subject.reservedBeds === 1 ? '1 bed is' : `${subject.reservedBeds} beds are`;
    return { ok: false, reason: `${beds} held for an invited tenant. Cancel the invite before deleting this room.` };
  }
  return { ok: true, reason: null };
}

// ── Floors ─────────────────────────────────────────────────────────────────

export interface FloorRemovalSubject {
  /** Rooms still on the floor. The backend refuses above zero. */
  roomCount: number;
  hostelStatus?: string;
}

/**
 * Whether a floor can be deleted.
 *
 * `propertyService.deleteFloor` refuses a floor with any **active** room, so
 * the floor has to be emptied first — one room at a time, which is the point:
 * deleting a floor should never be a way to delete rooms you have not looked
 * at. Also a real delete, not an archive.
 */
export function canDeleteFloor(subject: FloorRemovalSubject): RemovalEligibility {
  const status = subject.hostelStatus;
  if (status === 'ARCHIVED' || status === 'INACTIVE') {
    return { ok: false, reason: `This hostel is ${status.toLowerCase()}, so its floors cannot be changed.` };
  }
  if (subject.roomCount > 0) {
    const rooms = subject.roomCount === 1 ? '1 room' : `${subject.roomCount} rooms`;
    return { ok: false, reason: `Delete the ${rooms} on this floor first.` };
  }
  return { ok: true, reason: null };
}
