import { describe, it, expect } from 'vitest';
import { isOwnerFullBleedPath } from './ownerShellRoutes';

describe('isOwnerFullBleedPath', () => {
  it('is true for a Tenant Detail route', () => {
    expect(isOwnerFullBleedPath('/owner/tenants/abc123')).toBe(true);
    expect(isOwnerFullBleedPath('/owner/tenants/00000000-0000-0000-0000-000000000000')).toBe(true);
  });

  it('is false for the tenant list itself', () => {
    expect(isOwnerFullBleedPath('/owner/tenants')).toBe(false);
  });

  it('is false for the sibling queue routes (they live outside OwnerAppShell anyway)', () => {
    expect(isOwnerFullBleedPath('/owner/tenants/verifications')).toBe(false);
    expect(isOwnerFullBleedPath('/owner/tenants/activations')).toBe(false);
  });

  it('is false for any other owner route', () => {
    expect(isOwnerFullBleedPath('/owner/home')).toBe(false);
    expect(isOwnerFullBleedPath('/owner/money')).toBe(false);
    expect(isOwnerFullBleedPath('/owner/more/configuration/finance/deposit')).toBe(false);
  });

  it('is false when there is a deeper segment', () => {
    expect(isOwnerFullBleedPath('/owner/tenants/abc123/anything')).toBe(false);
  });
});
