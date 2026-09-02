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
  it('no longer decides anything about hostels', () => {
    // The hostels list moved to its own tab. ADR-139's guarantee — that an
    // owner with no hostels can always reach "+ Add hostel" — moved with it
    // and is asserted in `hostelsTab.ts`; a permanent tab keeps it more
    // strongly than a button below a screenful of scrolling did.
    expect('hostels' in deriveHomeSections(empty)).toBe(false);
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
    // The hostel is real; the checklist is what asks them to finish adding
    // rooms. (The hostels list itself is no longer a Home section — see the
    // test above.)
    const sections = deriveHomeSections({ ...empty, hostelCount: 1, roomCapacity: 0 });
    expect(sections.setupMode).toBe(false);
  });

  it('never treats a negative or fractional count as presence', () => {
    expect(deriveHomeSections({ ...empty, tenantCount: -1 }).actionCenter).toBe(false);
    expect(deriveHomeSections({ ...empty, monthTarget: -500 }).monthCard).toBe(false);
  });
});
