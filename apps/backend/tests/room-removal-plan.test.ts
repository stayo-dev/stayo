import { describe, it, expect } from 'vitest';
import { planRoomRemoval, type RoomAttachments } from '@/lib/services/property/room-removal-plan';

const nothing: RoomAttachments = {
  activeAllocations: 0,
  activeInvitationReservations: 0,
  allocations: 0,
  invitations: 0,
  invitationReservations: 0,
  reservations: 0,
};

const room = (over: Partial<RoomAttachments> = {}): RoomAttachments => ({ ...nothing, ...over });

describe('planRoomRemoval — people first', () => {
  it('refuses a room someone lives in', () => {
    const plan = planRoomRemoval(room({ activeAllocations: 1, allocations: 1 }));
    expect(plan).toEqual({ action: 'refuse', reason: 'Cannot delete room with active tenants' });
  });

  it('refuses a room with a bed held for an invite', () => {
    const plan = planRoomRemoval(room({ activeInvitationReservations: 1, invitationReservations: 1 }));
    expect(plan).toEqual({
      action: 'refuse',
      reason: 'Cannot delete room with active invitation reservations',
    });
  });

  it('names the tenant as the reason when a room has both a tenant and an invite', () => {
    const plan = planRoomRemoval(room({ activeAllocations: 1, activeInvitationReservations: 1 }));
    expect(plan).toEqual({ action: 'refuse', reason: 'Cannot delete room with active tenants' });
  });
});

describe('planRoomRemoval — a room no one ever used', () => {
  it('purges a room with nothing attached', () => {
    expect(planRoomRemoval(nothing)).toEqual({ action: 'purge' });
  });

  it('purges a room that was only ever edited', () => {
    // The regression this whole module exists for: `room_activity_logs` is
    // written on every edit, nothing reads it, and its RESTRICT foreign key
    // made an edited-but-unused room permanently undeletable. Activity logs
    // are not part of `RoomAttachments` at all — they never hold a room back.
    expect(planRoomRemoval(nothing)).toEqual({ action: 'purge' });
  });
});

describe('planRoomRemoval — a room with history', () => {
  it('retires a room whose tenant has moved out', () => {
    const plan = planRoomRemoval(room({ allocations: 3 }));
    expect(plan.action).toBe('retire');
  });

  it('retires a room that carries a spent invitation', () => {
    expect(planRoomRemoval(room({ invitations: 1 })).action).toBe('retire');
  });

  it('retires a room that carries an expired invitation reservation', () => {
    expect(planRoomRemoval(room({ invitationReservations: 2 })).action).toBe('retire');
  });

  it('retires a room that carries an old room reservation', () => {
    expect(planRoomRemoval(room({ reservations: 1 })).action).toBe('retire');
  });

  it('tells the owner the history is kept rather than apologising', () => {
    const plan = planRoomRemoval(room({ allocations: 1 }));
    expect(plan).toEqual({
      action: 'retire',
      reason: 'Room removed. Its past tenants and payment history are kept.',
    });
  });
});
