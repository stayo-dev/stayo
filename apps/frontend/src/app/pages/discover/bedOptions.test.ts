import { describe, expect, it } from 'vitest';
import { buildBedOptions, countVacantBeds } from './bedOptions';

const room = (capacity: number, available_beds: number) => ({ capacity, available_beds });

/** Sri Adithya's shape: 4-bed rooms with 104 beds free, a single and a double. */
const rooms = [...Array.from({ length: 26 }, () => room(4, 4)), room(1, 1), room(2, 2)];
const twoFourBedTiers = [
  { name: '4-Bed', sharing: 4, price: 8200, availability: 'AVAILABLE' },
  { name: '4-Bed', sharing: 4, price: 8500, availability: 'AVAILABLE' },
];

describe('two tiers of one sharing size', () => {
  it('does not repeat the whole pool on each tier', () => {
    const options = buildBedOptions(rooms, twoFourBedTiers);
    expect(options.map((o) => o.availableBeds)).toEqual([null, null]);
  });

  it('counts the pool once in the header total, not once per tier', () => {
    // 26 rooms × 4 = 104 — not 208.
    expect(countVacantBeds(rooms, twoFourBedTiers)).toBe(104);
  });

  it('still reads a shared pool as full when no bed is free', () => {
    const full = Array.from({ length: 3 }, () => room(4, 0));
    expect(buildBedOptions(full, twoFourBedTiers).map((o) => o.availableBeds)).toEqual([0, 0]);
    expect(countVacantBeds(full, twoFourBedTiers)).toBe(0);
  });
});

describe('a single tier of its size', () => {
  it('quotes the live count', () => {
    const [option] = buildBedOptions(rooms, [{ name: '4-Bed', sharing: 4, price: 8200 }]);
    expect(option.availableBeds).toBe(104);
  });

  it('is full when the owner marks it FULL, whatever the rooms say', () => {
    const [option] = buildBedOptions(rooms, [{ sharing: 4, price: 8200, availability: 'FULL' }]);
    expect(option.availableBeds).toBe(0);
    expect(countVacantBeds(rooms, [{ sharing: 4, price: 8200, availability: 'FULL' }])).toBe(0);
  });
});

describe('a platform-listed hostel with no rooms', () => {
  it('reads an AVAILABLE tier as open with no count, never Full', () => {
    const [option] = buildBedOptions([], [{ sharing: 4, price: 7500, availability: 'AVAILABLE' }]);
    expect(option.availableBeds).toBeNull();
  });

  it('reads a tier that is not claimed available as full', () => {
    const [option] = buildBedOptions([], [{ sharing: 4, price: 7500, availability: 'BEDS_LEFT' }]);
    expect(option.availableBeds).toBe(0);
  });

  it('has no vacancy count to show', () => {
    expect(countVacantBeds([], [{ sharing: 4, price: 7500, availability: 'AVAILABLE' }])).toBe(0);
  });
});

describe('no published tiers', () => {
  it('falls back to the real rooms, one option per size', () => {
    const options = buildBedOptions(rooms, []);
    expect(options.map((o) => [o.capacity, o.availableBeds])).toEqual([[1, 1], [2, 2], [4, 104]]);
    expect(countVacantBeds(rooms, [])).toBe(107);
  });
});
