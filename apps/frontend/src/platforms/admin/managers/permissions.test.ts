import { describe, expect, it } from 'vitest';
import { hasManagerPermission, isAdminRole, isManagerRole } from './permissions';

describe('hasManagerPermission', () => {
  it('grants ADMIN every permission unconditionally', () => {
    expect(hasManagerPermission('admin', [], 'MANAGE_SETTINGS')).toBe(true);
    expect(hasManagerPermission('ADMIN', undefined, 'MANAGE_HOSTELS')).toBe(true);
  });

  it('grants MANAGER only the permissions in their list', () => {
    expect(hasManagerPermission('manager', ['MANAGE_HOSTELS'], 'MANAGE_HOSTELS')).toBe(true);
    expect(hasManagerPermission('manager', ['MANAGE_HOSTELS'], 'MANAGE_OWNERS')).toBe(false);
    expect(hasManagerPermission('manager', undefined, 'MANAGE_HOSTELS')).toBe(false);
  });

  it('denies every other role, including a falsy/unknown one', () => {
    expect(hasManagerPermission('owner', ['MANAGE_HOSTELS'], 'MANAGE_HOSTELS')).toBe(false);
    expect(hasManagerPermission(undefined, ['MANAGE_HOSTELS'], 'MANAGE_HOSTELS')).toBe(false);
  });
});

describe('role predicates', () => {
  it('normalizes case', () => {
    expect(isAdminRole('Admin')).toBe(true);
    expect(isManagerRole('Manager')).toBe(true);
    expect(isAdminRole('manager')).toBe(false);
  });
});
