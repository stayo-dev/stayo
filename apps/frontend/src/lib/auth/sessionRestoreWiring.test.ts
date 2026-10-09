/**
 * Every shell restores a session the way its tree allows (double-login fix).
 *
 * Read from source because these suites render nothing. The tenant shell
 * mounts no `ClerkProvider`, so a reload there only works if `AuthProvider`
 * loads Clerk itself — which it does for every path under `/tenant`. Owner and
 * admin shells mount the provider and must *wait* for it instead.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { clerkRestoreModeForPath } from './sessionRestore';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [full] : [];
  });
}

describe('restore mode per shell', () => {
  it('owner and admin shells wait for their ClerkProvider instead of loading Clerk twice', () => {
    expect(read('app/providers/ProtectedAppProviders.tsx')).toMatch(/<AuthProvider clerkRestore="provider">/);
    for (const shell of ['platforms/owner/router/OwnerProviderShell.tsx', 'platforms/admin/router/AdminProviderShell.tsx']) {
      expect(read(shell)).toContain('<ProtectedAppProviders>');
    }
  });

  it('only a shell that mounts ClerkProvider may use "provider" — elsewhere nothing would ever load Clerk', () => {
    const offenders = sourceFiles(SRC)
      .filter((f) => /clerkRestore="provider"/.test(fs.readFileSync(f, 'utf8')))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual(['app/providers/ProtectedAppProviders.tsx']);
    expect(read('app/providers/ProtectedAppProviders.tsx')).toContain('<ClerkAuthProvider>');
  });

  it('AuthProvider falls back to the path when a shell does not say', () => {
    expect(read('context/AuthContext.tsx')).toMatch(/clerkRestore \?\? clerkRestoreModeForPath\(location\.pathname\)/);
  });

  it('every tenant route, and the hostel QR page, loads Clerk on a reload', () => {
    const paths = [...read('platforms/tenant/router/TenantRoutes.tsx').matchAll(/path="([^"]+)"/g)].map((m) => m[1]);
    expect(paths).toContain('/payment-return');
    expect(paths).toContain('/stay/:hostelId');
    expect(paths.length).toBeGreaterThan(3);
    for (const p of paths) {
      expect([p, clerkRestoreModeForPath(p.replace(/:[^/]+/g, 'x'))]).toEqual([p, 'load']);
    }
  });

  it('the owner onboarding wizard (guarded, no ClerkProvider) loads Clerk on reload', () => {
    expect(read('features/owner-onboarding/router/OwnerJourneyRoutes.tsx')).toMatch(/path="\/onboarding"/);
    expect(clerkRestoreModeForPath('/onboarding')).toBe('load');
  });

  it('AuthContext reaches the Clerk loader only through import()', () => {
    const src = read('context/AuthContext.tsx');
    expect(src).toContain("await import('@lib/auth/clerkLoader')");
    expect(src).not.toMatch(/from ['"]@lib\/auth\/clerkLoader['"]/);
  });
});
