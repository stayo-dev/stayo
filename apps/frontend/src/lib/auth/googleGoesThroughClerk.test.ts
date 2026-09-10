/**
 * Google sign-in must never route to Supabase again (ADR-176 Phase 3).
 *
 * The bug this exists to catch was visible in production: "Continue with
 * Google" navigated to `https://<project>.supabase.co/auth/v1/authorize?
 * provider=google`. Note that URL never appears in source — the Supabase SDK
 * builds it at runtime from `VITE_SUPABASE_URL` — so grepping the built bundle
 * for it proves nothing. The greppable truth is the *call*:
 * `signInWithOAuth`.
 *
 * Scans source rather than the bundle so it runs in the ordinary suite, with no
 * build step.
 */

import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    // Test files legitimately name the forbidden patterns — this one does.
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/** Source with block and line comments stripped, so prose about the old flow is ignored. */
function code(file: string): string {
  return fs
    .readFileSync(file, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

const FILES = walk(SRC);

describe('no Supabase Google OAuth anywhere in the app', () => {
  it('scans a real file set (guards against a vacuous pass)', () => {
    expect(FILES.length).toBeGreaterThan(200);
  });

  it('calls signInWithOAuth nowhere', () => {
    const offenders = FILES.filter((f) => code(f).includes('signInWithOAuth')).map((f) =>
      path.relative(SRC, f),
    );
    expect(offenders).toEqual([]);
  });

  it("requests provider: 'google' from Supabase nowhere", () => {
    const offenders = FILES.filter((f) => /provider:\s*['"]google['"]/.test(code(f))).map((f) =>
      path.relative(SRC, f),
    );
    expect(offenders).toEqual([]);
  });

  it('never builds a Supabase authorize URL by hand', () => {
    const offenders = FILES.filter((f) => code(f).includes('/auth/v1/authorize')).map((f) =>
      path.relative(SRC, f),
    );
    expect(offenders).toEqual([]);
  });

  it('the dead GoogleSignInModal is gone', () => {
    expect(fs.existsSync(path.join(SRC, 'shared/ui-patterns/GoogleSignInModal.tsx'))).toBe(false);
  });
});

describe('every Google button goes through Clerk', () => {
  const googleButtons = FILES.filter((f) => code(f).includes('Continue with Google'));

  it('there are Google buttons to check', () => {
    expect(googleButtons.length).toBeGreaterThan(0);
  });

  it.each(['shared/ui-patterns/LoginModal.tsx', 'features/owner-onboarding/components/HostelLeadModal.tsx'])(
    '%s launches Clerk',
    (rel) => {
      const source = code(path.join(SRC, rel));
      expect(source).toContain('ClerkGoogleSignIn');
      expect(source).not.toContain('signInWithOAuth');
    },
  );

  it('every file rendering a Google button renders ClerkGoogleSignIn', () => {
    // Catches a third Google button being added later against the old pattern.
    const offenders = googleButtons
      .filter((f) => !code(f).includes('ClerkGoogleSignIn'))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('the Clerk launcher asks for the Google OAuth strategy', () => {
    expect(code(path.join(SRC, 'shared/ui-patterns/ClerkGoogleButton.tsx'))).toContain(
      "strategy: 'oauth_google'",
    );
  });
});

describe('Supabase session infrastructure is left intact', () => {
  // Phase 3 is dual-authority, not a cutover: removing these would sign out
  // every existing user.
  it('the Supabase client still exists and is still used for sessions', () => {
    const client = code(path.join(SRC, 'lib/supabaseClient.ts'));
    expect(client).toContain('createClient');

    const apiClient = code(path.join(SRC, 'lib/api-client.ts'));
    expect(apiClient).toContain('supabase.auth.getSession()');
  });

  it('AuthContext still listens to Supabase auth state', () => {
    expect(code(path.join(SRC, 'context/AuthContext.tsx'))).toContain('onAuthStateChange');
  });
});
