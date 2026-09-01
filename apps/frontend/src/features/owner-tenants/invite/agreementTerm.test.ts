import { describe, expect, it } from 'vitest';
import {
  AGREEMENT_MONTH_OPTIONS,
  AGREEMENT_PRESETS,
  MAX_AGREEMENT_MONTHS,
  MIN_AGREEMENT_MONTHS,
  agreementEndDate,
  clampAgreementMonths,
  describeAgreementEnd,
  indexForMonths,
  indexFromScroll,
  monthsAtIndex,
  scrollLeftForIndex,
} from './agreementTerm';

describe('AGREEMENT_MONTH_OPTIONS', () => {
  it('covers the full range, low to high, with no gaps', () => {
    expect(AGREEMENT_MONTH_OPTIONS[0]).toBe(MIN_AGREEMENT_MONTHS);
    expect(AGREEMENT_MONTH_OPTIONS[AGREEMENT_MONTH_OPTIONS.length - 1]).toBe(MAX_AGREEMENT_MONTHS);
    expect(AGREEMENT_MONTH_OPTIONS).toHaveLength(MAX_AGREEMENT_MONTHS - MIN_AGREEMENT_MONTHS + 1);
  });

  it('offers every preset, or a one-tap chip would scroll to nothing', () => {
    for (const preset of AGREEMENT_PRESETS) {
      expect(AGREEMENT_MONTH_OPTIONS).toContain(preset);
    }
  });

  it('includes 11 months — the Indian norm the old free-text field made owners type out', () => {
    expect(AGREEMENT_PRESETS).toContain(11);
  });
});

describe('clampAgreementMonths', () => {
  it('leaves an in-range value alone', () => {
    expect(clampAgreementMonths(12)).toBe(12);
  });

  it('pulls values outside the range back to the ends', () => {
    expect(clampAgreementMonths(0)).toBe(MIN_AGREEMENT_MONTHS);
    expect(clampAgreementMonths(-5)).toBe(MIN_AGREEMENT_MONTHS);
    expect(clampAgreementMonths(999)).toBe(MAX_AGREEMENT_MONTHS);
  });

  it('treats a non-number as the shortest term rather than NaN', () => {
    expect(clampAgreementMonths(Number.NaN)).toBe(MIN_AGREEMENT_MONTHS);
  });

  it('rounds a fractional month to a whole one', () => {
    expect(clampAgreementMonths(11.4)).toBe(11);
    expect(clampAgreementMonths(11.6)).toBe(12);
  });
});

describe('indexForMonths / monthsAtIndex', () => {
  it('round-trips every offered value', () => {
    for (const months of AGREEMENT_MONTH_OPTIONS) {
      expect(monthsAtIndex(indexForMonths(months))).toBe(months);
    }
  });

  it('resolves the empty form value to the first option instead of failing', () => {
    expect(indexForMonths('')).toBe(0);
    expect(monthsAtIndex(indexForMonths(''))).toBe(MIN_AGREEMENT_MONTHS);
  });

  it('reads a stored string, since the wizard keeps form state as text', () => {
    expect(indexForMonths('12')).toBe(indexForMonths(12));
  });

  it('clamps an index past either end rather than returning undefined', () => {
    expect(monthsAtIndex(-3)).toBe(MIN_AGREEMENT_MONTHS);
    expect(monthsAtIndex(9999)).toBe(MAX_AGREEMENT_MONTHS);
  });
});

describe('indexFromScroll / scrollLeftForIndex', () => {
  const ITEM = 44;

  it('round-trips an index through a scroll position', () => {
    for (const index of [0, 5, 11, AGREEMENT_MONTH_OPTIONS.length - 1]) {
      expect(indexFromScroll(scrollLeftForIndex(index, ITEM), ITEM)).toBe(index);
    }
  });

  it('snaps to the nearest item when the scroll stops between two', () => {
    expect(indexFromScroll(ITEM * 3 + ITEM * 0.4, ITEM)).toBe(3);
    expect(indexFromScroll(ITEM * 3 + ITEM * 0.6, ITEM)).toBe(4);
  });

  it('clamps a rubber-band overscroll at both ends', () => {
    expect(indexFromScroll(-200, ITEM)).toBe(0);
    expect(indexFromScroll(ITEM * 999, ITEM)).toBe(AGREEMENT_MONTH_OPTIONS.length - 1);
  });

  it('survives a zero item width, which is what a not-yet-laid-out ring measures', () => {
    expect(indexFromScroll(500, 0)).toBe(0);
  });
});

describe('agreementEndDate', () => {
  function iso(date: Date | null) {
    return date ? date.toISOString().slice(0, 10) : null;
  }

  it('ends the day before the anniversary, so 12 months from 1 Aug is 31 Jul', () => {
    expect(iso(agreementEndDate('2026-08-01', 12))).toBe('2027-07-31');
  });

  it('handles the 11-month norm', () => {
    expect(iso(agreementEndDate('2026-08-01', 11))).toBe('2027-06-30');
  });

  it('clamps to the end of a shorter month rather than rolling into the next one', () => {
    // 31 Aug + 6 months would be 31 Feb; the term ends on the last day February has.
    expect(iso(agreementEndDate('2026-08-31', 6))).toBe('2027-02-27');
  });

  it('gets February right in a leap year', () => {
    expect(iso(agreementEndDate('2027-08-31', 6))).toBe('2028-02-28');
  });

  it('crosses a year boundary correctly', () => {
    expect(iso(agreementEndDate('2026-12-15', 3))).toBe('2027-03-14');
  });

  it('returns null rather than a guess when the inputs are unusable', () => {
    expect(agreementEndDate('', 12)).toBeNull();
    expect(agreementEndDate('not-a-date', 12)).toBeNull();
    expect(agreementEndDate('2026-08-01', 0)).toBeNull();
    expect(agreementEndDate('2026-08-01', Number.NaN)).toBeNull();
  });
});

describe('describeAgreementEnd', () => {
  it('states the date the owner actually reasons about', () => {
    expect(describeAgreementEnd('2026-08-01', 12)).toBe('Ends 31 Jul 2027');
  });

  it('says nothing at all until there is a joining date to count from', () => {
    expect(describeAgreementEnd('', 12)).toBeNull();
  });
});
