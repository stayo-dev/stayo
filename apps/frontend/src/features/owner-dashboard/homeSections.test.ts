import { describe, it, expect } from 'vitest';
import { deriveHomeSections } from './homeSections';

const empty = {
  hostelCount: 0,
  roomCapacity: 0,
  tenantCount: 0,
  collectedThisMonth: 0,
  monthTarget: 0,
};

describe('deriveHomeSections', () => {
  it('shows the hostels section on a completely empty account', () => {
    // The bug this module exists to prevent: Home hid the property list
    // whenever there were no properties, and the only "Add hostel" button in
    // the app lived inside it.
    expect(deriveHomeSections(empty).hostels).toBe(true);
  });

  it('shows the hostels section in every other state too', () => {
    expect(deriveHomeSections({ ...empty, hostelCount: 3, tenantCount: 40 }).hostels).toBe(true);
  });

  it('hides the Action Center until there is a tenant to act on', () => {
    expect(deriveHomeSections(empty).actionCenter).toBe(false);
    // Rooms alone are not enough: every tile is still structurally zero, and
    // the vacant-beds tile duplicates what the checklist already says.
    expect(deriveHomeSections({ ...empty, hostelCount: 1, roomCapacity: 24 }).actionCenter).toBe(false);
    expect(deriveHomeSections({ ...empty, hostelCount: 1, roomCapacity: 24, tenantCount: 1 }).actionCenter).toBe(true);
  });

  it('hides search until there is somebody to find', () => {
    expect(deriveHomeSections({ ...empty, hostelCount: 1, roomCapacity: 24 }).search).toBe(false);
    expect(deriveHomeSections({ ...empty, tenantCount: 1 }).search).toBe(true);
  });

  it('shows the month card once money is owed, before any is collected', () => {
    expect(deriveHomeSections(empty).monthCard).toBe(false);
    expect(deriveHomeSections({ ...empty, monthTarget: 57000 }).monthCard).toBe(true);
  });

  it('shows the month card when money came in with nothing outstanding', () => {
    expect(deriveHomeSections({ ...empty, collectedThisMonth: 16000 }).monthCard).toBe(true);
  });

  it('is in setup mode only while no hostel exists', () => {
    expect(deriveHomeSections(empty).setupMode).toBe(true);
    expect(deriveHomeSections({ ...empty, hostelCount: 1 }).setupMode).toBe(false);
  });

  it('treats a half-built hostel as out of setup mode', () => {
    // The hostel is real and appears in the list; the checklist, not the
    // greeting, is what asks them to finish adding rooms.
    const sections = deriveHomeSections({ ...empty, hostelCount: 1, roomCapacity: 0 });
    expect(sections.setupMode).toBe(false);
    expect(sections.hostels).toBe(true);
  });

  it('never treats a negative or fractional count as presence', () => {
    expect(deriveHomeSections({ ...empty, tenantCount: -1 }).actionCenter).toBe(false);
    expect(deriveHomeSections({ ...empty, monthTarget: -500 }).monthCard).toBe(false);
  });
});
