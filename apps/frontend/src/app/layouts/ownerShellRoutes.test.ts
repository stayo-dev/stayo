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

  it('is true for the Hostel Drilldown pane and its tabs', () => {
    expect(isOwnerFullBleedPath('/owner/hostels/abc123')).toBe(true);
    expect(isOwnerFullBleedPath('/owner/hostels/abc123/overview')).toBe(true);
    expect(isOwnerFullBleedPath('/owner/hostels/abc123/rooms')).toBe(true);
    expect(isOwnerFullBleedPath('/owner/hostels/abc123/tenants')).toBe(true);
    expect(isOwnerFullBleedPath('/owner/hostels/abc123/settings')).toBe(true);
  });

  it('is false for the Hostels list itself', () => {
    expect(isOwnerFullBleedPath('/owner/hostels')).toBe(false);
  });

  it('is false for the Hostel Builder routes (they live outside OwnerAppShell anyway)', () => {
    expect(isOwnerFullBleedPath('/owner/hostels/new')).toBe(false);
    expect(isOwnerFullBleedPath('/owner/hostels/abc123/build')).toBe(false);
  });

  it('is false for an unknown hostel drilldown sub-segment', () => {
    expect(isOwnerFullBleedPath('/owner/hostels/abc123/anything')).toBe(false);
    expect(isOwnerFullBleedPath('/owner/hostels/abc123/overview/deep')).toBe(false);
  });
});
