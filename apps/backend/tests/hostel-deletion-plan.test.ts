import { describe, it, expect } from 'vitest';
import { hasNoHistory, planHostelDeletion, type HostelHistory } from '@/lib/services/property/hostel-deletion-plan';

const EMPTY: HostelHistory = {
  tenants: 0,
  payments: 0,
  obligations: 0,
  allocations: 0,
  agreements: 0,
  receipts: 0,
  expenses: 0,
  leads: 0,
};

const plan = (over: Partial<HostelHistory> = {}, status = 'ARCHIVED') =>
  planHostelDeletion({ status, history: { ...EMPTY, ...over } });

describe('planHostelDeletion', () => {
  it('allows deleting an archived hostel that never carried anything', () => {
    expect(plan()).toEqual({ ok: true });
  });

  // Two steps on purpose: nothing live should be destroyable in one press.
  it('refuses anything that is not already archived', () => {
    for (const status of ['ACTIVE', 'INACTIVE', 'PENDING', '']) {
      const result = plan({}, status);
      expect(result).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect((result as any).reason).toMatch(/Archive this hostel first/);
    }
  });

  it('checks the status before the history, so the actionable reason comes first', () => {
    const result = plan({ payments: 3 }, 'ACTIVE');
    expect((result as any).reason).toMatch(/Archive this hostel first/);
  });
});

describe('planHostelDeletion — history is never destroyed', () => {
  const cases: Array<[keyof HostelHistory, RegExp]> = [
    ['tenants', /1 tenant record on record/],
    ['payments', /1 payment on record/],
    ['obligations', /1 rent obligation on record/],
    ['allocations', /1 room allocation on record/],
    ['agreements', /1 agreement on record/],
    ['receipts', /1 receipt on record/],
    ['expenses', /1 expense on record/],
    ['leads', /1 enquiry on record/],
  ];

  it.each(cases)('refuses on a single %s', (key, pattern) => {
    const result = plan({ [key]: 1 } as Partial<HostelHistory>);
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect((result as any).reason).toMatch(pattern);
  });

  it('pluralises the count', () => {
    expect((plan({ payments: 4 }) as any).reason).toMatch(/4 payments on record/);
  });

  // The owner should not read "cannot be deleted" as "your data is at risk".
  it('says the hostel stays archived and its history stays intact', () => {
    expect((plan({ tenants: 2 }) as any).reason).toMatch(/stays archived.*history stays intact/);
  });

  it('reports tenants before payments when both exist', () => {
    expect((plan({ tenants: 1, payments: 9 }) as any).reason).toMatch(/tenant record/);
  });

  it('treats a missing counter as zero rather than throwing', () => {
    const partial = { ...EMPTY } as any;
    delete partial.leads;
    expect(planHostelDeletion({ status: 'ARCHIVED', history: partial })).toEqual({ ok: true });
  });
});

describe('hasNoHistory', () => {
  it('is true only when every counter is zero', () => {
    expect(hasNoHistory(EMPTY)).toBe(true);
    expect(hasNoHistory({ ...EMPTY, receipts: 1 })).toBe(false);
    expect(hasNoHistory({ ...EMPTY, leads: 1 })).toBe(false);
  });
});
