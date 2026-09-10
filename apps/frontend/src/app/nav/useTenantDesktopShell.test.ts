import { describe, it, expect } from 'vitest';
import { tenantHasDesktopShell } from './useTenantDesktopShell';

describe('tenantHasDesktopShell', () => {
  it('mounts the shell for a live tenant', () => {
    expect(tenantHasDesktopShell('LIVE')).toBe(true);
  });

  it('keeps the shell for a mid-exit tenant (read-only dashboard)', () => {
    expect(tenantHasDesktopShell('EXITING')).toBe(true);
  });

  it('does not mount the shell for an exited tenant', () => {
    expect(tenantHasDesktopShell('EXITED')).toBe(false);
  });

  it('does not mount the shell for an account with no tenancy', () => {
    expect(tenantHasDesktopShell('NONE')).toBe(false);
  });
});
