import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {},
}));

import { resolveTenantName, resolveTenantPhone } from '@/lib/tenants/tenant-identity';

/** Pure — no database. Runs under `npm run test:pure`. */

describe('resolveTenantName', () => {
  it('prefers the profile name when the tenant has an account', () => {
    expect(resolveTenantName({
      profiles: { name: 'Rakesh Kumar' },
      display_name: 'Rakesh K',
    })).toBe('Rakesh Kumar');
  });

  it('falls back to display_name for an owner-managed tenant with no profile', () => {
    expect(resolveTenantName({ profiles: null, display_name: 'Rakesh Kumar' }))
      .toBe('Rakesh Kumar');
  });

  it('falls back to the invitation name when neither is set', () => {
    expect(resolveTenantName({
      profiles: null,
      display_name: null,
      tenant_invitations: [{ name: 'Rakesh Kumar' }],
    })).toBe('Rakesh Kumar');
  });

  it('never returns an empty string — reminders address a person, not a blank', () => {
    expect(resolveTenantName({})).toBe('Tenant');
    expect(resolveTenantName({ display_name: '   ' })).toBe('Tenant');
  });
});

describe('resolveTenantPhone', () => {
  it('prefers the profile phone, in E.164', () => {
    expect(resolveTenantPhone({
      profiles: { phone: '+919876543210' },
      phone_1: '+918008046952',
    })).toBe('+919876543210');
  });

  it('falls back to phone_1 for an owner-managed tenant', () => {
    expect(resolveTenantPhone({ profiles: null, phone_1: '9876543210' }))
      .toBe('+919876543210');
  });

  it('normalizes every accepted notation to the stored form', () => {
    expect(resolveTenantPhone({ phone_1: '098765 43210' })).toBe('+919876543210');
    expect(resolveTenantPhone({ phone_1: '+91 98765 43210' })).toBe('+919876543210');
  });

  it('returns null rather than a half-number, so no send is attempted', () => {
    expect(resolveTenantPhone({ phone_1: '98765' })).toBeNull();
    expect(resolveTenantPhone({})).toBeNull();
  });

  it('matches the frontend canonicalPhone contract exactly', () => {
    // apps/frontend/src/shared/lib/phone.ts::canonicalPhone produces this form.
    // A divergence here silently creates duplicate tenancies at claim time.
    expect(resolveTenantPhone({ phone_1: '8008046952' })).toBe('+918008046952');
  });
});
