import { describe, it, expect } from 'vitest';
import { groupRentMonths, groupRangeLabel, type ClaimRentMonth } from './rentMonthGroups';

const m = (
  month: string,
  over: Partial<ClaimRentMonth> = {},
): ClaimRentMonth => ({
  obligation_id: `o-${month}`,
  rent_month: `${month}-01`,
  amount: 8000,
  status: 'PENDING',
  outstanding: 8000,
  ...over,
});

/**
 * The first screen a tenant ever sees of Stayo. Folding identical months is
 * what makes it reviewable; folding a month that differs would hide the one
 * thing they are looking for. See ADR-151.
 */
describe('groupRentMonths', () => {
  it('folds a run of identical consecutive months into one row', () => {
    const groups = groupRentMonths([m('2026-02'), m('2026-03'), m('2026-04'), m('2026-05')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].collapsed).toBe(true);
    expect(groups[0].months).toHaveLength(4);
    expect(groups[0].outstanding).toBe(32000);
  });

  it('never folds a month that differs in amount — a rent change must stay visible', () => {
    const groups = groupRentMonths([
      m('2026-02'), m('2026-03'),
      m('2026-04', { amount: 9000, outstanding: 9000 }),
      m('2026-05', { amount: 9000, outstanding: 9000 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].amount).toBe(8000);
    expect(groups[1].amount).toBe(9000);
  });

  it('never folds a paid month in among unpaid ones', () => {
    // The single most important thing a tenant is scanning for.
    const groups = groupRentMonths([
      m('2026-02'), m('2026-03'),
      m('2026-04', { status: 'PAID', outstanding: 0 }),
      m('2026-05'), m('2026-06'),
    ]);
    expect(groups).toHaveLength(3);
    expect(groups[1].months).toHaveLength(1);
    expect(groups[1].status).toBe('PAID');
  });

  it('separates a partly-paid month from fully unpaid ones', () => {
    const groups = groupRentMonths([
      m('2026-02'), m('2026-03'),
      m('2026-04', { status: 'PARTIAL', outstanding: 3000 }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[1].outstanding).toBe(3000);
  });

  it('breaks a run where a month is missing, rather than implying continuity', () => {
    const groups = groupRentMonths([m('2026-02'), m('2026-03'), m('2026-06'), m('2026-07')]);
    expect(groups).toHaveLength(2);
    expect(groups[0].months.map((x) => x.rent_month)).toEqual(['2026-02-01', '2026-03-01']);
  });

  it('leaves a short run listed rather than summarised', () => {
    // Two identical rows read better as themselves than as "2 months".
    const groups = groupRentMonths([m('2026-02'), m('2026-03')]);
    expect(groups).toHaveLength(1);
    expect(groups[0].collapsed).toBe(false);
  });

  it('keeps a single month as a plain row', () => {
    const groups = groupRentMonths([m('2026-02')]);
    expect(groups[0].collapsed).toBe(false);
    expect(groups[0].months).toHaveLength(1);
  });

  it('carries every month through, so nothing can be lost in the fold', () => {
    const input = [m('2026-02'), m('2026-03'), m('2026-04'), m('2026-05', { status: 'PAID', outstanding: 0 })];
    const total = groupRentMonths(input).flatMap((g) => g.months);
    expect(total.map((x) => x.obligation_id)).toEqual(input.map((x) => x.obligation_id));
  });

  it('survives an empty or missing list', () => {
    expect(groupRentMonths([])).toEqual([]);
    expect(groupRentMonths(undefined as any)).toEqual([]);
  });

  it('sums outstanding across the run rather than reporting one month', () => {
    const groups = groupRentMonths([m('2026-02'), m('2026-03'), m('2026-04')]);
    expect(groups[0].outstanding).toBe(24000);
  });
});

describe('groupRangeLabel', () => {
  it('states the year once for a run inside one year', () => {
    const [group] = groupRentMonths([m('2026-02'), m('2026-03'), m('2026-07')].slice(0, 2));
    expect(groupRangeLabel(group)).toBe('Feb – Mar 2026');
  });

  it('states both years for a run that crosses one', () => {
    const [group] = groupRentMonths([m('2025-11'), m('2025-12'), m('2026-01')]);
    expect(groupRangeLabel(group)).toBe('Nov 2025 – Jan 2026');
  });

  it('names a single month plainly', () => {
    const [group] = groupRentMonths([m('2026-02')]);
    expect(groupRangeLabel(group)).toBe('Feb 2026');
  });
});
