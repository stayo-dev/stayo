import { describe, it, expect } from 'vitest';
import { canDeleteFloor, canDeleteRoom } from './propertyRemoval';

describe('canDeleteRoom', () => {
  const empty = { occupiedBeds: 0, reservedBeds: 0 };

  it('allows deleting a room with nobody in it', () => {
    expect(canDeleteRoom(empty)).toEqual({ ok: true, reason: null });
  });

  it('refuses while someone lives there, and says to move them out', () => {
    const result = canDeleteRoom({ occupiedBeds: 2, reservedBeds: 0 });
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/2 tenants are living in this room.*Move them out/);
  });

  // Different problem, different fix — an invited tenant needs the invite
  // cancelled, not a move-out.
  it('names a reserved bed separately from an occupied one', () => {
    const result = canDeleteRoom({ occupiedBeds: 0, reservedBeds: 1 });
    expect(result.reason).toMatch(/1 bed is held for an invited tenant.*Cancel the invite/);
  });

  it('reports occupancy first when the room is both occupied and reserved', () => {
    expect(canDeleteRoom({ occupiedBeds: 1, reservedBeds: 1 }).reason).toMatch(/living in this room/);
  });

  it('gets the singular right', () => {
    expect(canDeleteRoom({ occupiedBeds: 1, reservedBeds: 0 }).reason).toMatch(/^1 tenant is/);
  });

  it('refuses on an archived or inactive hostel before anything else', () => {
    expect(canDeleteRoom({ ...empty, hostelStatus: 'ARCHIVED' }).reason).toMatch(/archived/);
    expect(canDeleteRoom({ ...empty, hostelStatus: 'INACTIVE' }).reason).toMatch(/inactive/);
    expect(canDeleteRoom({ ...empty, hostelStatus: 'ACTIVE' }).ok).toBe(true);
  });
});

describe('canDeleteFloor', () => {
  it('allows deleting an empty floor', () => {
    expect(canDeleteFloor({ roomCount: 0 })).toEqual({ ok: true, reason: null });
  });

  // Deleting a floor must never be a shortcut for deleting rooms the owner
  // has not looked at — the backend refuses, and so does this.
  it('refuses while rooms are still on it', () => {
    expect(canDeleteFloor({ roomCount: 4 }).reason).toBe('Delete the 4 rooms on this floor first.');
    expect(canDeleteFloor({ roomCount: 1 }).reason).toBe('Delete the 1 room on this floor first.');
  });

  it('refuses on an archived or inactive hostel', () => {
    expect(canDeleteFloor({ roomCount: 0, hostelStatus: 'ARCHIVED' }).ok).toBe(false);
    expect(canDeleteFloor({ roomCount: 0, hostelStatus: 'INACTIVE' }).ok).toBe(false);
  });
});
