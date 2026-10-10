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

  it('the installed app reopens on "/" — the page that must recognise a signed-in user', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(SRC, '../public/site.webmanifest'), 'utf8'));
    expect(manifest.start_url).toBe('/');
    expect(clerkRestoreModeForPath(manifest.start_url)).toBe('load-if-signed-in');
  });

  it('"/" holds the boot screen while a possible session is restored, instead of showing "Log in"', () => {
    const routes = read('app/router/PublicRoutes.tsx');
    const root = routes.slice(routes.indexOf('function RootHomepage'));
    expect(root).toMatch(/const \{ loading \} = useAuth\(\)/);
    expect(root).toMatch(/maySessionExist\(/);
    expect(root).toMatch(/if \(restoring\) return <PublicRouteFallback \/>/);
  });

  it('AuthContext redirects signed-in users from entry pages, and keeps the hint in step with the session', () => {
    const src = read('context/AuthContext.tsx');
    expect(src).toMatch(/signedInEntryRedirect\(\{\s*pathname: location\.pathname/);
    // Set on every sign-in and every restore; cleared on logout and server expiry.
    expect(src.match(/writeSessionHint\(hintStorage\(\), true\)/g)).toHaveLength(2);
    expect(src.match(/writeSessionHint\(hintStorage\(\), false\)/g)).toHaveLength(2);
    expect(src).toMatch(/writeSessionHint\(hintStorage\(\), restored !== null\)/);
    expect(src).toMatch(/maySessionExist\(\{/);
  });

  it('the homepage login hands a resident with a tenancy to their dashboard', () => {
    expect(read('app/pages/public/HomePage.tsx')).toMatch(/crossSurfaceHandoff\([^)]*, 'home'\)/);
  });

  it('nothing but the boolean hint is written to localStorage by the auth layer', () => {
    for (const rel of ['context/AuthContext.tsx', 'lib/auth/sessionRestore.ts', 'lib/auth/clerkLoader.ts', 'lib/auth/clerkBrowser.ts']) {
      const writes = [...read(rel).matchAll(/localStorage\.setItem\(([^,]+),/g)].map((m) => m[1].trim());
      expect(writes).toEqual([]);
    }
    expect(read('lib/auth/sessionRestore.ts')).toMatch(/storage\?\.setItem\(SESSION_HINT_KEY, '1'\)/);
  });

  it('AuthContext reaches the Clerk loader only through import()', () => {
    const src = read('context/AuthContext.tsx');
    expect(src).toContain("await import('@lib/auth/clerkLoader')");
    expect(src).not.toMatch(/from ['"]@lib\/auth\/clerkLoader['"]/);
  });
});
