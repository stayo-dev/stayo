import { describe, expect, it } from 'vitest';
import { accessModeLabel } from './accessMode';

describe('accessModeLabel', () => {
  it('marks an owner-managed tenant as not on the app', () => {
    expect(accessModeLabel('OWNER_MANAGED')).toBe('Not on app');
  });

  it('shows nothing for a normal tenant — the common case needs no badge', () => {
    expect(accessModeLabel('SELF_SERVE')).toBeNull();
    expect(accessModeLabel(undefined)).toBeNull();
  });
});
