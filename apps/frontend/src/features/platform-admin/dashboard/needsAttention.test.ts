import { describe, it, expect } from 'vitest';
import { deriveAttention, deriveSnapshot } from './needsAttention';

const money = (n: number) => `₹${n.toLocaleString('en-IN')}`;

describe('deriveAttention', () => {
  it('shows nothing when nothing needs doing', () => {
    // A permanent "0 pending" row teaches the admin to skip the one section
    // that exists to be read.
    expect(deriveAttention({ new_leads: 0, pending_approvals: 0, documents_awaiting_review: 0, pending_dues: 0 })).toEqual([]);
  });

  it('puts document verification first — it blocks owners going live', () => {
    const items = deriveAttention({ documents_awaiting_review: 3, new_leads: 5 });
    expect(items[0]).toMatchObject({ code: 'DOCUMENT_REVIEW', severity: 'high', to: '/admin/documents' });
  });

  it('routes hostel approvals at the owner, not a platform-wide hostel list', () => {
    // Approving happens inside the owner profile, so the admin sees whose
    // property it is. It also avoids a cross-screen filter link, which stops
    // filtering silently the moment the query param goes unread.
    const items = deriveAttention({ pending_approvals: 4 });
    expect(items[0]).toMatchObject({ code: 'HOSTEL_APPROVALS', to: '/admin/owners' });
  });

  it('keeps every destination inside the owner-first surfaces', () => {
    const items = deriveAttention({ documents_awaiting_review: 1, pending_approvals: 1, new_leads: 1 }, 2);
    expect(items.every((i) => !i.to.includes('/admin/hostels'))).toBe(true);
  });

  it('orders high severity above medium above low', () => {
    const items = deriveAttention(
      { documents_awaiting_review: 1, new_leads: 2, pending_dues: 5000, pending_approvals: 1 },
      3,
    );
    expect(items.map((i) => i.severity)).toEqual(['high', 'high', 'medium', 'medium', 'low']);
  });

  it('pluralises each label from its real count', () => {
    expect(deriveAttention({ documents_awaiting_review: 1 })[0].label).toBe('1 document to verify');
    expect(deriveAttention({ documents_awaiting_review: 6 })[0].label).toBe('6 documents to verify');
    expect(deriveAttention({ pending_approvals: 1 })[0].label).toBe('1 hostel awaiting approval');
  });

  it('surfaces owners needing attention, which comes from the owners list not the KPIs', () => {
    const items = deriveAttention({}, 7);
    expect(items).toEqual([
      { code: 'OWNERS_AT_RISK', label: '7 owners need attention', count: 7, to: '/admin/owners', severity: 'medium' },
    ]);
  });

  it('treats missing KPI fields as nothing to do rather than throwing', () => {
    expect(deriveAttention({})).toEqual([]);
  });
});

describe('deriveSnapshot', () => {
  it('describes the platform business, not the owners’ tenants', () => {
    // "791 tenants" is not the admin's number to act on — tenants belong to
    // owners, and it crowded out the figures that describe Stayo itself.
    const labels = deriveSnapshot({ owners_total: 184, active_hostels: 132 }, money).map((f) => f.label);
    expect(labels).toEqual(['Owners', 'Live hostels', 'MRR', 'Collected']);
    expect(labels).not.toContain('Total Tenants');
  });

  it('formats money through the caller’s formatter', () => {
    const figures = deriveSnapshot({ platform_revenue: 184000, collections: 162000 }, money);
    expect(figures.find((f) => f.label === 'MRR')?.value).toBe('₹1,84,000');
  });

  it('defaults missing figures to zero rather than blank', () => {
    const figures = deriveSnapshot({}, money);
    expect(figures.map((f) => f.value)).toEqual(['0', '0', '₹0', '₹0']);
  });

  it('makes every figure a destination', () => {
    expect(deriveSnapshot({}, money).every((f) => f.to.startsWith('/admin/'))).toBe(true);
  });
});
