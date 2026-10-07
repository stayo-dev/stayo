import { describe, expect, it } from 'vitest';
import type { MockTenant } from '@shared/mocks/tenants';
import {
  countTenants,
  duesBucketOf,
  filterTenants,
  inviteStageOf,
  monthsUnpaidLabel,
  parseFilterParams,
} from './tenantListFilters';

const NOW = new Date('2026-10-07T12:00:00Z').getTime();
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

function tenant(over: Partial<MockTenant>): MockTenant {
  return {
    id: over.id ?? 't',
    name: 'Tenant',
    initials: 'TT',
    phone: '+91 90000 00000',
    hostelId: 'h',
    hostelName: 'H',
    room: '101',
    rent: 8000,
    status: 'active',
    statusLabel: 'Active',
    outstanding: 0,
    overdueDays: 0,
    joinedDate: '',
    agreementStatus: 'Signed',
    kycStatus: 'Verified',
    obligations: [],
    activity: [],
    documents: [],
    stay: { hostelName: 'H', roomBed: '101', moveInDate: '', agreementPeriod: '', monthlyRent: 8000, deposit: 0, billingFrequency: '' },
    ...over,
  } as MockTenant;
}

const behind = (id: string, months: number, amount: number, extra: Partial<MockTenant> = {}) =>
  tenant({ id, status: 'overdue', paymentOverdue: true, outstanding: amount, overdueAmount: amount, overdueRentCount: months, ...extra });

describe('inviteStageOf', () => {
  it('reads not opened, opened and creating account from the invitation', () => {
    expect(inviteStageOf({ status: 'PENDING', expires_at: iso(3) }, NOW)).toBe('not-opened');
    expect(inviteStageOf({ status: 'OPENED', opened_at: iso(-1), expires_at: iso(3) }, NOW)).toBe('opened');
    expect(inviteStageOf({ status: 'ACTIVATION_STARTED', activation_started_at: iso(-1), expires_at: iso(3) }, NOW)).toBe('signing-up');
  });

  it('puts an expired link ahead of how far the tenant got, because the link is dead either way', () => {
    expect(inviteStageOf({ status: 'PENDING', expires_at: iso(-2) }, NOW)).toBe('expired');
    expect(inviteStageOf({ status: 'EXPIRED', opened_at: iso(-9), expires_at: iso(-2) }, NOW)).toBe('expired');
  });

  it('reads an opened_at timestamp even when status was never advanced', () => {
    expect(inviteStageOf({ status: 'SUPERSEDED', opened_at: iso(-1), expires_at: iso(3) }, NOW)).toBe('opened');
  });

  it('treats a missing or cancelled invitation as no link', () => {
    expect(inviteStageOf(null, NOW)).toBe('no-link');
    expect(inviteStageOf({ status: 'CANCELLED', expires_at: iso(3) }, NOW)).toBe('no-link');
  });

  it('treats a finished sign-up as awaiting acceptance', () => {
    expect(inviteStageOf({ status: 'ACTIVATED', expires_at: iso(-5) }, NOW)).toBe('accepting');
  });
});

describe('dues buckets', () => {
  it('buckets by rent periods unpaid, with deposits and other charges separate', () => {
    expect(duesBucketOf(behind('a', 1, 8000))).toBe('1');
    expect(duesBucketOf(behind('b', 2, 16000))).toBe('2');
    expect(duesBucketOf(behind('c', 5, 40000))).toBe('3plus');
    expect(duesBucketOf(behind('d', 0, 16000))).toBe('other');
  });

  it('labels months only when rent is actually behind', () => {
    expect(monthsUnpaidLabel(behind('a', 1, 8000))).toBe('1 month unpaid');
    expect(monthsUnpaidLabel(behind('b', 3, 24000))).toBe('3 months unpaid');
    expect(monthsUnpaidLabel(behind('d', 0, 16000))).toBeNull();
  });
});

describe('countTenants', () => {
  const list = [
    behind('a', 1, 8000),
    behind('b', 3, 24000),
    // Invited and behind: an invited tenancy is live and bills rent, so it counts as overdue too.
    behind('c', 2, 16000, { status: 'invited', inviteStage: 'expired' }),
    tenant({ id: 'd', status: 'invited', inviteStage: 'not-opened' }),
    tenant({ id: 'e', status: 'invited' }),
    tenant({ id: 'f', status: 'dues', outstanding: 8000 }),
  ];

  it('counts each view and each drill-down bucket', () => {
    const c = countTenants(list);
    expect(c).toMatchObject({ all: 6, unpaid: 3, invited: 3, unpaidAmount: 48000 });
    expect(c.dues).toEqual({ '1': 1, '2': 1, '3plus': 1, other: 0 });
    expect(c.stages).toMatchObject({ expired: 1, 'not-opened': 1, 'no-link': 1, opened: 0 });
  });

  it('does not count a balance that is not yet due', () => {
    expect(countTenants([tenant({ status: 'dues', outstanding: 8000 })]).unpaid).toBe(0);
  });
});

describe('filterTenants', () => {
  const list = [
    behind('one', 1, 8000),
    behind('three', 3, 24000),
    behind('three-more', 3, 30000),
    tenant({ id: 'opened', name: 'Ravi', status: 'invited', inviteStage: 'opened' }),
    tenant({ id: 'expired', name: 'Sai', status: 'invited', inviteStage: 'expired' }),
    tenant({ id: 'paid' }),
  ];
  const ids = (out: MockTenant[]) => out.map((t) => t.id);

  it('sorts overdue tenants furthest behind first, then by amount', () => {
    expect(ids(filterTenants(list, { view: 'unpaid', sub: 'any', search: '' }))).toEqual(['three-more', 'three', 'one']);
  });

  it('narrows overdue tenants to a months bucket', () => {
    expect(ids(filterTenants(list, { view: 'unpaid', sub: '3plus', search: '' }))).toEqual(['three-more', 'three']);
  });

  it('puts expired links first among invited tenants, and narrows by stage', () => {
    expect(ids(filterTenants(list, { view: 'invited', sub: 'any', search: '' }))).toEqual(['expired', 'opened']);
    expect(ids(filterTenants(list, { view: 'invited', sub: 'opened', search: '' }))).toEqual(['opened']);
  });

  it('applies search on top of the view', () => {
    expect(ids(filterTenants(list, { view: 'invited', sub: 'any', search: 'ravi' }))).toEqual(['opened']);
  });

  it('keeps the original order for All', () => {
    expect(ids(filterTenants(list, { view: 'all', sub: 'any', search: '' }))).toEqual(ids(list));
  });
});

describe('parseFilterParams', () => {
  it('reads a valid view and drill-down from the URL', () => {
    expect(parseFilterParams(new URLSearchParams('view=unpaid&show=2'))).toEqual({ view: 'unpaid', sub: '2' });
    expect(parseFilterParams(new URLSearchParams('view=invited&show=not-opened'))).toEqual({ view: 'invited', sub: 'not-opened' });
  });

  it('falls back to defaults for unknown or mismatched values', () => {
    expect(parseFilterParams(new URLSearchParams('view=bogus&show=2'))).toEqual({ view: 'all', sub: 'any' });
    expect(parseFilterParams(new URLSearchParams('view=unpaid&show=expired'))).toEqual({ view: 'unpaid', sub: 'any' });
  });
});
