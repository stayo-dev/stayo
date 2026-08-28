import { describe, it, expect } from 'vitest';
import { leadToInviteWizardData, type AcceptedLeadSource } from './leadPrefill';

const baseLead: AcceptedLeadSource = {
  student_name: 'Asha Rao',
  student_phone: '9876543210',
  student_email: 'asha@example.com',
  hostel_id: 'hostel-1',
};

describe('leadToInviteWizardData', () => {
  it('carries no room fields when the lead expressed no preference', () => {
    const data = leadToInviteWizardData(baseLead);
    expect(data.preferredFloorId).toBeUndefined();
    expect(data.preferredRoomId).toBeUndefined();
    expect(data.roomId).toBeUndefined();
  });

  it('carries the floor only, without touching roomId, for a floor-only preference', () => {
    const data = leadToInviteWizardData({
      ...baseLead,
      preferred_floor: { id: 'floor-ground', name: 'Ground' },
    });
    expect(data.preferredFloorId).toBe('floor-ground');
    expect(data.preferredRoomId).toBeUndefined();
    expect(data.roomId).toBeUndefined();
  });

  it('preselects roomId/roomLabel when the preferred room is confirmed available', () => {
    const data = leadToInviteWizardData({
      ...baseLead,
      preferred_floor: { id: 'floor-ground', name: 'Ground' },
      preferred_room: { id: 'room-g103', room_no: 'G103' },
      preferred_room_available: true,
    });
    expect(data.roomId).toBe('room-g103');
    expect(data.roomLabel).toBe('G103');
    expect(data.preferredRoomAvailable).toBe(true);
  });

  it('does NOT preselect roomId when the preferred room is confirmed unavailable', () => {
    const data = leadToInviteWizardData({
      ...baseLead,
      preferred_floor: { id: 'floor-ground', name: 'Ground' },
      preferred_room: { id: 'room-g103', room_no: 'G103' },
      preferred_room_available: false,
    });
    expect(data.roomId).toBeUndefined();
    expect(data.roomLabel).toBeUndefined();
    // Still carried, so the Stay step can explain what was preferred and why
    // it wasn't preselected.
    expect(data.preferredRoomId).toBe('room-g103');
    expect(data.preferredRoomNo).toBe('G103');
    expect(data.preferredRoomAvailable).toBe(false);
  });

  it('does NOT preselect roomId when availability is unknown (e.g. lead already converted)', () => {
    const data = leadToInviteWizardData({
      ...baseLead,
      preferred_room: { id: 'room-g103', room_no: 'G103' },
      preferred_room_available: undefined,
    });
    expect(data.roomId).toBeUndefined();
    expect(data.preferredRoomAvailable).toBe(false);
  });
});
