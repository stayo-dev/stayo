import { describe, expect, it } from 'vitest';
import { isRowInteractive, tallyConfigRows, type ConfigRow } from './configRows';

/**
 * The counting rule is the load-bearing decision of the Configuration
 * redesign, so it lives here as pure functions rather than inline in a hook.
 *
 * Two states deliberately count as neither configured nor needing attention:
 *
 * - `off` — a setting switched off on purpose is not a gap. Flagging it would
 *   nag owners about choices they made.
 * - `unavailable` — a row shown for a subsystem that does not exist yet (room
 *   types, amenities, payment methods...). If these counted, "6 areas
 *   configured" and the hub's progress ring would be measuring features
 *   nobody can use. That is the difference between a status dashboard and a
 *   decorative one.
 */
const row = (state: ConfigRow['state'], key = state): ConfigRow => ({
  key,
  title: key,
  detail: '',
  state,
  route: '/somewhere',
});

describe('tallyConfigRows', () => {
  it('counts configured rows', () => {
    const tally = tallyConfigRows([row('configured', 'a'), row('configured', 'b')]);

    expect(tally.configured).toBe(2);
    expect(tally.attention).toBe(0);
  });

  it('counts rows needing attention', () => {
    const tally = tallyConfigRows([row('configured'), row('attention', 'x'), row('attention', 'y')]);

    expect(tally.configured).toBe(1);
    expect(tally.attention).toBe(2);
  });

  it('excludes deliberately-off rows from both counts', () => {
    const tally = tallyConfigRows([row('configured'), row('off')]);

    expect(tally.configured).toBe(1);
    expect(tally.attention).toBe(0);
  });

  it('excludes unavailable rows from both counts', () => {
    const tally = tallyConfigRows([row('configured'), row('unavailable', 'room-types')]);

    expect(tally.configured).toBe(1);
    expect(tally.attention).toBe(0);
  });

  it('never lets an unavailable row inflate the total it is measured against', () => {
    const withoutPlaceholder = tallyConfigRows([row('configured'), row('attention', 'x')]);
    const withPlaceholder = tallyConfigRows([
      row('configured'),
      row('attention', 'x'),
      row('unavailable', 'room-types'),
      row('unavailable', 'amenities'),
    ]);

    expect(withPlaceholder).toEqual(withoutPlaceholder);
  });

  it('tallies an empty screen to zeroes rather than throwing', () => {
    expect(tallyConfigRows([])).toEqual({ configured: 0, attention: 0 });
  });
});

describe('isRowInteractive', () => {
  it('lets a configured row with a route be tapped', () => {
    expect(isRowInteractive(row('configured'))).toBe(true);
  });

  it('refuses an unavailable row even when a route is present', () => {
    // The route is incidental — an unavailable row must never navigate, or it
    // becomes the "looks real, does nothing" pattern this design rejects.
    expect(isRowInteractive(row('unavailable'))).toBe(false);
  });

  it('refuses any row without a route', () => {
    expect(isRowInteractive({ ...row('configured'), route: undefined })).toBe(false);
  });
});
