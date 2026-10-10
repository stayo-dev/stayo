import { describe, expect, it } from 'vitest';
import { lastNDays, sumDailyCollections } from './cashflowSeries';

describe('lastNDays', () => {
  it('ends on today, oldest first', () => {
    expect(lastNDays(3, new Date(2026, 9, 10, 12))).toEqual(['2026-10-08', '2026-10-09', '2026-10-10']);
  });
  it('uses the local day just after midnight', () => {
    expect(lastNDays(1, new Date(2026, 9, 10, 0, 30))).toEqual(['2026-10-10']);
  });
  it('crosses a month boundary', () => {
    expect(lastNDays(2, new Date(2026, 9, 1, 12))).toEqual(['2026-09-30', '2026-10-01']);
  });
});

describe('sumDailyCollections', () => {
  const days = ['2026-10-08', '2026-10-09', '2026-10-10'];

  it('reads daily_collection from the unwrapped cashflow result', () => {
    const series = sumDailyCollections(days, [
      { daily_collection: [{ date: '2026-10-09', amount: 8500 }] },
    ]);
    expect(series).toEqual([
      { date: '2026-10-08', amount: 0 },
      { date: '2026-10-09', amount: 8500 },
      { date: '2026-10-10', amount: 0 },
    ]);
  });

  it('sums across hostels and across rows on the same day', () => {
    const series = sumDailyCollections(days, [
      { daily_collection: [{ date: '2026-10-10', amount: 1000 }, { date: '2026-10-10 09:15:00+00', amount: '500' }] },
      { daily_collection: [{ date: '2026-10-10', amount: 2500 }] },
    ]);
    expect(series[2]).toEqual({ date: '2026-10-10', amount: 4000 });
  });

  it('ignores rows outside the window and missing results', () => {
    const series = sumDailyCollections(days, [
      undefined,
      null,
      { daily_collection: [{ date: '2026-09-01', amount: 999 }] },
    ]);
    expect(series.every((d) => d.amount === 0)).toBe(true);
  });
});
