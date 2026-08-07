import { describe, it, expect } from 'vitest';
import { formatINR, formatCompactINR, hasRevenueActivity, describeArr } from './revenueFormat';

const kpis = (over: Partial<Parameters<typeof hasRevenueActivity>[0]> = {}) => ({
  mrr: 0,
  arr: 0,
  collected_this_month: 0,
  pending_collections: 0,
  lifetime_revenue: 0,
  ...over,
});

describe('formatINR', () => {
  it('uses Indian digit grouping', () => {
    expect(formatINR(150000)).toBe('₹1,50,000');
    expect(formatINR(1000)).toBe('₹1,000');
  });

  it('shows zero as a real value, not a blank', () => {
    expect(formatINR(0)).toBe('₹0');
  });

  it('never renders NaN at an admin', () => {
    expect(formatINR(Number.NaN)).toBe('₹0');
    expect(formatINR(undefined as unknown as number)).toBe('₹0');
  });
});

describe('formatCompactINR', () => {
  // Lakh and crore, not K/M — this is how the number is actually said here.
  it('uses lakh and crore above their thresholds', () => {
    expect(formatCompactINR(420000)).toBe('₹4.2L');
    expect(formatCompactINR(13000000)).toBe('₹1.3Cr');
  });

  it('uses K between a thousand and a lakh', () => {
    expect(formatCompactINR(45000)).toBe('₹45K');
  });

  it('leaves small amounts exact', () => {
    expect(formatCompactINR(750)).toBe('₹750');
    expect(formatCompactINR(0)).toBe('₹0');
  });

  it('drops a trailing .0 rather than printing ₹4.0L', () => {
    expect(formatCompactINR(400000)).toBe('₹4L');
    expect(formatCompactINR(10000000)).toBe('₹1Cr');
  });

  it('keeps the sign on a negative', () => {
    expect(formatCompactINR(-45000)).toBe('-₹45K');
  });

  it('never renders NaN', () => {
    expect(formatCompactINR(Number.NaN)).toBe('₹0');
  });
});

describe('hasRevenueActivity', () => {
  // The whole point: without this the page renders search, six filter chips,
  // a billing toggle and four export buttons above "no subscriptions yet" —
  // controls that filter nothing and exports that produce empty files.
  it('is false for a platform with no subscriptions and no money', () => {
    expect(hasRevenueActivity(kpis(), 0)).toBe(false);
  });

  it('is true as soon as one subscription exists', () => {
    expect(hasRevenueActivity(kpis(), 1)).toBe(true);
  });

  // A cancelled subscription leaves no rows but real lifetime revenue; hiding
  // the export then would hide history that genuinely exists.
  it('is true when money was taken historically, even with no live subscription', () => {
    expect(hasRevenueActivity(kpis({ lifetime_revenue: 5000 }), 0)).toBe(true);
  });

  it('is true when there are outstanding collections to chase', () => {
    expect(hasRevenueActivity(kpis({ pending_collections: 900 }), 0)).toBe(true);
  });

  it('is false when the KPIs have not loaded yet', () => {
    expect(hasRevenueActivity(undefined, 0)).toBe(false);
  });
});

describe('describeArr', () => {
  // ARR is MRR × 12 by definition; two independent cards invite reading them
  // as separate measurements.
  it('states the relationship to MRR', () => {
    expect(describeArr(kpis({ mrr: 45000 }))).toBe('₹45K × 12 months');
  });

  it('says nothing when there is no MRR to relate to', () => {
    expect(describeArr(kpis())).toBeNull();
    expect(describeArr(undefined)).toBeNull();
  });
});
