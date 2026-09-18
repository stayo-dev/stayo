import { describe, expect, it } from 'vitest';
import { ownerDoor } from './homeHeader';

describe('ownerDoor', () => {
  it('invites a signed-out visitor to list, and declares owner intent', () => {
    const door = ownerDoor({ isLoading: false, isAuthenticated: false, hostelCount: 0 });
    expect(door).toEqual({ label: 'List your hostel', to: '/owners', declaresOwnerIntent: true });
  });

  it('sends an onboarded owner to their dashboard instead of the pitch', () => {
    const door = ownerDoor({ isLoading: false, isAuthenticated: true, hostelCount: 1 });
    expect(door).toEqual({ label: 'Go to dashboard', to: '/owner/home', declaresOwnerIntent: false });
  });

  it('treats a signed-in account with no hostel as a prospect, not an owner', () => {
    expect(ownerDoor({ isLoading: false, isAuthenticated: true, hostelCount: 0 }).to).toBe('/owners');
  });

  it('shows the signed-out wording while the session is still settling', () => {
    expect(ownerDoor({ isLoading: true, isAuthenticated: true, hostelCount: 3 }).label).toBe('List your hostel');
  });
});
