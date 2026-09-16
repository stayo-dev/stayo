import { describe, it, expect } from 'vitest';
import { buildKpis, buildFunnel, buildReviewQueue, conversionRate } from './overviewModel';

const kpis = {
  new_leads: 47,
  active_hostels: 3910,
  owners_total: 1284,
  collections: 342000,
  pending_approvals: 6,
};

describe('buildKpis', () => {
  it('returns five cards, in order (KYC Approvals was removed)', () => {
    const cards = buildKpis(kpis);
    expect(cards).toHaveLength(5);
    expect(cards.map((c) => c.key)).toEqual([
      'revenue', 'leads', 'hostels', 'owners', 'reports',
    ]);
  });

  it('formats collected revenue in lakh notation', () => {
    expect(buildKpis(kpis).find((c) => c.key === 'revenue')?.value).toBe('₹3.4L');
  });

  it('labels the revenue card for the period the API actually returns', () => {
    // The design says "Revenue today", but /dashboard returns a month-to-date
    // figure. ADR-172: it is Stayo subscription revenue, not tenant rent.
    expect(buildKpis(kpis).find((c) => c.key === 'revenue')?.label).toBe('Subscription revenue');
  });

  it('reports the open-ticket count passed in, and routes to Reports & Bugs', () => {
    const reports = buildKpis(kpis, 7).find((c) => c.key === 'reports');
    expect(reports?.value).toBe('7');
    expect(reports?.unavailable).toBeUndefined();
    expect(reports?.to).toBe('/admin/reports');
  });

  it('shows open reports as an em dash when the count is not passed in', () => {
    expect(buildKpis(kpis).find((c) => c.key === 'reports')?.value).toBe('—');
  });

  it('never invents a delta for metrics the API returns no comparison for', () => {
    const cards = buildKpis(kpis);
    expect(cards.find((c) => c.key === 'hostels')?.delta).toBeUndefined();
    expect(cards.find((c) => c.key === 'owners')?.delta).toBeUndefined();
  });

  it('routes every card somewhere, so the whole KPI row is clickable', () => {
    const cards = buildKpis(kpis, 7);
    expect(cards.every((c) => typeof c.to === 'string' && c.to.startsWith('/admin'))).toBe(true);
  });

  it('survives a missing kpis payload', () => {
    const cards = buildKpis(undefined);
    expect(cards).toHaveLength(5);
    expect(cards.find((c) => c.key === 'leads')?.value).toBe('—');
  });
});

describe('buildFunnel', () => {
  const counts = {
    NEW: 100, UNDER_REVIEW: 40, CONTACTED: 5, DEMO: 3, NEGOTIATING: 2,
    APPROVED: 10, INVITE_SENT: 20,
    OWNER_ACTIVATED: 15, HOSTEL_CREATED: 8, LIVE: 12, LOST: 25,
  };

  it('is cumulative — each stage counts everyone who reached it or passed it', () => {
    const rows = buildFunnel(counts);
    const captured = rows.find((r) => r.key === 'captured');
    // every lead ever captured, lost ones included
    expect(captured?.count).toBe(240);
  });

  it('folds CONTACTED/DEMO/NEGOTIATING into "In review" instead of dropping them', () => {
    // Previously these three statuses were never read by buildFunnel, so a
    // lead sitting in one of them vanished from every stage, including
    // "Leads captured" (the intended full-inflow count).
    const rows = buildFunnel(counts);
    const reviewed = rows.find((r) => r.key === 'reviewed');
    // invited(65) + UNDER_REVIEW(40) + CONTACTED(5) + DEMO(3) + NEGOTIATING(2)
    expect(reviewed?.count).toBe(115);
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
  it('keeps just the reports row (KYC and Discovery listings rows were both removed)', () => {
    expect(buildReviewQueue({ reports: 2 })).toHaveLength(1);
  });

  it('routes the row to the screen that clears it', () => {
    const rows = buildReviewQueue({ reports: 2 });
    expect(rows.find((r) => r.key === 'reports')?.to).toBe('/admin/reports');
  });

  it('reports the open-ticket count passed in, not a placeholder', () => {
    const reports = buildReviewQueue({ reports: 3 }).find((r) => r.key === 'reports');
    expect(reports?.unavailable).toBeUndefined();
    expect(reports?.count).toBe(3);
  });
});
