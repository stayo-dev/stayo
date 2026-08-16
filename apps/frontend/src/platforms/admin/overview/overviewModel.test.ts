import { describe, it, expect } from 'vitest';
import { buildKpis, buildFunnel, buildReviewQueue, conversionRate } from './overviewModel';

const kpis = {
  new_leads: 47,
  active_hostels: 3910,
  owners_total: 1284,
  documents_awaiting_review: 4,
  collections: 342000,
  pending_approvals: 6,
};

describe('buildKpis', () => {
  it('returns the design\'s six cards, in order', () => {
    const cards = buildKpis(kpis);
    expect(cards).toHaveLength(6);
    expect(cards.map((c) => c.key)).toEqual([
      'revenue', 'leads', 'kyc', 'hostels', 'owners', 'reports',
    ]);
  });

  it('formats collected revenue in lakh notation', () => {
    expect(buildKpis(kpis).find((c) => c.key === 'revenue')?.value).toBe('₹3.4L');
  });

  it('labels the revenue card for the period the API actually returns', () => {
    // The design says "Revenue today", but /dashboard returns a month-to-date
    // figure. Showing a monthly number under a daily label would misreport.
    expect(buildKpis(kpis).find((c) => c.key === 'revenue')?.label).toBe('Revenue this month');
  });

  it('marks the KYC card as needing action only when something is pending', () => {
    expect(buildKpis(kpis).find((c) => c.key === 'kyc')?.delta).toBe('action');
    expect(buildKpis({ ...kpis, documents_awaiting_review: 0 }).find((c) => c.key === 'kyc')?.delta)
      .toBeUndefined();
  });

  it('shows open reports as unavailable rather than as zero', () => {
    const reports = buildKpis(kpis).find((c) => c.key === 'reports');
    expect(reports?.value).toBe('—');
    expect(reports?.unavailable).toBe(true);
  });

  it('never invents a delta for metrics the API returns no comparison for', () => {
    const cards = buildKpis(kpis);
    expect(cards.find((c) => c.key === 'hostels')?.delta).toBeUndefined();
    expect(cards.find((c) => c.key === 'owners')?.delta).toBeUndefined();
  });

  it('survives a missing kpis payload', () => {
    const cards = buildKpis(undefined);
    expect(cards).toHaveLength(6);
    expect(cards.find((c) => c.key === 'leads')?.value).toBe('—');
  });
});

describe('buildFunnel', () => {
  const counts = {
    NEW: 100, UNDER_REVIEW: 40, APPROVED: 10, INVITE_SENT: 20,
    OWNER_ACTIVATED: 15, HOSTEL_CREATED: 8, LIVE: 12, LOST: 25,
  };

  it('is cumulative — each stage counts everyone who reached it or passed it', () => {
    const rows = buildFunnel(counts);
    const captured = rows.find((r) => r.key === 'captured');
    // every lead ever captured, lost ones included
    expect(captured?.count).toBe(230);
  });

  it('counts a lead that went live as having passed through every earlier stage', () => {
    const rows = buildFunnel(counts);
    expect(rows.find((r) => r.key === 'activated')?.count).toBe(35); // activated+created+live
    expect(rows.find((r) => r.key === 'live')?.count).toBe(12);
  });

  it('narrows monotonically, so the funnel can never widen further down', () => {
    const rows = buildFunnel(counts);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].count).toBeLessThanOrEqual(rows[i - 1].count);
    }
  });

  it('sizes each bar against the widest stage', () => {
    const rows = buildFunnel(counts);
    expect(rows[0].width).toBe('100%');
  });

  it('returns zero-width bars rather than NaN when there are no leads at all', () => {
    const rows = buildFunnel({});
    expect(rows.every((r) => r.width === '0%')).toBe(true);
    expect(rows.every((r) => r.count === 0)).toBe(true);
  });
});

describe('conversionRate', () => {
  it('reports live leads as a percentage of every captured lead', () => {
    expect(conversionRate({ NEW: 88, LIVE: 12 })).toBe('12.0%');
  });

  it('returns an em dash instead of dividing by zero', () => {
    expect(conversionRate({})).toBe('—');
  });
});

describe('buildReviewQueue', () => {
  it('keeps the design\'s three rows', () => {
    expect(buildReviewQueue({ kyc: 4, listings: 2 })).toHaveLength(3);
  });

  it('routes each row to the screen that clears it', () => {
    const rows = buildReviewQueue({ kyc: 4, listings: 2 });
    expect(rows.find((r) => r.key === 'kyc')?.to).toBe('/admin/kyc');
    expect(rows.find((r) => r.key === 'listings')?.to).toBe('/admin/listings');
  });

  it('shows the bug-report row as unavailable, not as an empty queue', () => {
    const reports = buildReviewQueue({ kyc: 0, listings: 0 }).find((r) => r.key === 'reports');
    expect(reports?.unavailable).toBe(true);
    expect(reports?.count).toBe('—');
  });
});
