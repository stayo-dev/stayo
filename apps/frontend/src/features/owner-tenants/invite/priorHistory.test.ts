import { describe, it, expect } from 'vitest';
import { monthLabel, todayIso, isBackdated } from './priorHistory';

/**
 * Presentation helpers only. The money arithmetic these tests used to cover
 * now lives on the backend, beside the code that actually creates the
 * obligations — see `tests/prior-tenancy-payment.test.ts` and ADR-141.
 */
describe('monthLabel', () => {
  it('names a month the way an owner reads it', () => {
    expect(monthLabel('2026-05')).toBe('May 2026');
    expect(monthLabel('2025-12')).toBe('December 2025');
  });

  it('hands back anything it cannot parse rather than inventing a month', () => {
    expect(monthLabel('nonsense')).toBe('nonsense');
    expect(monthLabel('2026-13')).toBe('2026-13');
  });
});

describe('todayIso', () => {
  it('reports the local calendar date, not the UTC one', () => {
    // 1 January, 00:30 local. `toISOString()` in any positive-offset zone
    // reports 31 December, which would drop a month from the stay.
    expect(todayIso(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
  });

  it('pads single-digit months and days', () => {
    expect(todayIso(new Date(2026, 4, 3))).toBe('2026-05-03');
  });
});

describe('isBackdated', () => {
  it('is true only when the move-in month is genuinely behind us', () => {
    expect(isBackdated('2026-05-12', '2026-08-29')).toBe(true);
    expect(isBackdated('2026-08-02', '2026-08-29')).toBe(false);
    expect(isBackdated('2026-09-02', '2026-08-29')).toBe(false);
  });

  it('compares months, not days — later in the same month is not backdated', () => {
    expect(isBackdated('2026-08-28', '2026-08-01')).toBe(false);
  });

  it('is false for anything it cannot read', () => {
    expect(isBackdated('', '2026-08-29')).toBe(false);
  });
});
