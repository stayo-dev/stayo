import { describe, expect, it } from 'vitest';
import { hostelsTabMode, singleHostelOverview, type HostelLike } from './hostelsTab';

const hostel = (over: Partial<HostelLike> = {}): HostelLike => ({
  id: 'h1',
  name: 'Sri Adithya Boys Hostel',
  location: 'Guntur',
  status: 'ACTIVE',
  occupancyLabel: '26%',
  occupancyPercent: 26,
  revenue: '₹80,000',
  outstanding: '₹24,000',
  outstandingValue: 24000,
  vacant: 34,
  activeTenants: 12,
  totalCapacity: 46,
  ...over,
});

describe('hostelsTabMode', () => {
  it('shows the single hostel directly rather than a list of one', () => {
    // An owner with one hostel does not need a list to choose from — the tab
    // is that hostel, so managing it is the tab itself rather than a tap away.
    expect(hostelsTabMode([hostel()])).toBe('single');
  });

  it('lists hostels once there is a choice to make', () => {
    expect(hostelsTabMode([hostel(), hostel({ id: 'h2' })])).toBe('list');
  });

  it('offers the empty state when there are none', () => {
    // This is the ADR-139 guarantee, moved: "+ Add hostel" must be reachable
    // by an owner who has no hostels, or the account is a dead end.
    expect(hostelsTabMode([])).toBe('empty');
  });

  it('falls back to the list when the only hostel is archived', () => {
    // The overview would have nothing live to show, and the archived hostel
    // still needs to be reachable to be reactivated — which only the list does.
    expect(hostelsTabMode([hostel({ status: 'ARCHIVED' })])).toBe('list');
  });

  it('uses the list when an archived hostel sits alongside a live one', () => {
    // Showing the single overview here would hide the archived hostel
    // entirely; only the list has an Archived tab.
    expect(hostelsTabMode([hostel(), hostel({ id: 'h2', status: 'ARCHIVED' })])).toBe('list');
  });

  it('survives a missing or malformed list rather than throwing on the tab', () => {
    expect(hostelsTabMode(undefined)).toBe('empty');
    expect(hostelsTabMode(null as any)).toBe('empty');
  });
});

describe('singleHostelOverview', () => {
  it('summarises the one hostel an owner has', () => {
    const view = singleHostelOverview([hostel()]);

    expect(view).not.toBeNull();
    expect(view!.name).toBe('Sri Adithya Boys Hostel');
    expect(view!.occupancyLabel).toBe('26%');
    expect(view!.beds).toBe('12 of 46 beds filled');
    expect(view!.hasDues).toBe(true);
  });

  it('says beds are unbuilt rather than reporting nought occupancy', () => {
    // Zero capacity means no rooms exist yet, which is a different situation
    // from an empty hostel and needs a different sentence — see ADR-139.
    const view = singleHostelOverview([hostel({ totalCapacity: 0, activeTenants: 0, vacant: 0 })]);

    expect(view!.beds).toBe('No rooms added yet');
    expect(view!.needsRooms).toBe(true);
  });

  it('does not flag dues when nothing is outstanding', () => {
    const view = singleHostelOverview([hostel({ outstandingValue: 0, outstanding: '₹0' })]);
    expect(view!.hasDues).toBe(false);
  });

  it('returns nothing when the tab is not in single mode', () => {
    expect(singleHostelOverview([])).toBeNull();
    expect(singleHostelOverview([hostel(), hostel({ id: 'h2' })])).toBeNull();
  });
});
