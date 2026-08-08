import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Guards the 2026-08-08 auth-bypass bug: the owner's "Sign out" control was
 * wired to `useMoreNav().signOut`, which called `journey.reset()` (mock
 * onboarding state) and `navigate('/')` — and nothing else. No
 * `POST /api/auth/logout`, no `supabase.auth.signOut()`, no session
 * revocation. The Supabase session survived in localStorage, so navigating to
 * `/login` re-hydrated `user` from `GET /auth/me` and `AuthContext`'s
 * redirect effect dropped the "signed-out" owner straight back into
 * `/owner/home`.
 *
 * The failure was silent and looked correct: you land on the marketing page,
 * exactly as a real sign-out would. Only coming back to `/login` revealed it.
 *
 * This test asserts every user-facing sign-out control reaches
 * `AuthContext.logout()`, either directly or through a hook it imports.
 * Rendering isn't available here (node environment, no jsdom — see
 * vitest.config.ts), so this reads source text, matching the invariant-check
 * style used in `apps/backend/tests/auth-hardening-security.test.ts`.
 */
const SRC = path.resolve(__dirname, '..');

const ALIASES: Record<string, string> = {
  '@lib': path.join(SRC, 'lib'),
  '@features': path.join(SRC, 'features'),
  '@domains': path.join(SRC, 'domains'),
  '@platforms': path.join(SRC, 'platforms'),
  '@shared': path.join(SRC, 'shared'),
  '@infrastructure': path.join(SRC, 'infrastructure'),
  '@context': path.join(SRC, 'context'),
  '@': SRC,
};

/** A control a user would read as "end my session". */
const SIGN_OUT_LABEL = /(?:>|["'`])\s*(?:sign|log)\s?out\b/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function resolveLocalImport(spec: string, fromFile: string): string | null {
  let base: string | null = null;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(fromFile), spec);
  else {
    const alias = Object.keys(ALIASES)
      .sort((a, b) => b.length - a.length)
      .find((a) => spec === a || spec.startsWith(`${a}/`));
    if (alias) base = path.join(ALIASES[alias], spec.slice(alias.length));
  }
  if (!base) return null;

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, 'index.ts'),
    path.join(base, 'index.tsx'),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The file's own source plus the source of every first-party module it imports. */
function sourceWithLocalImports(file: string): string {
  const own = fs.readFileSync(file, 'utf8');
  const specs = [...own.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
  const imported = specs
    .map((spec) => resolveLocalImport(spec, file))
    .filter((p): p is string => Boolean(p))
    .map((p) => fs.readFileSync(p, 'utf8'));
  return [own, ...imported].join('\n');
}

const filesWithSignOutControl = walk(SRC).filter((file) =>
  SIGN_OUT_LABEL.test(fs.readFileSync(file, 'utf8')),
);

describe('every sign-out control actually ends the session', () => {
  it('finds sign-out controls to check (guards against the regex silently matching nothing)', () => {
    expect(filesWithSignOutControl.length).toBeGreaterThan(0);
  });

  it.each(filesWithSignOutControl.map((f) => path.relative(SRC, f)))(
    '%s reaches AuthContext logout',
    (relative) => {
      const combined = sourceWithLocalImports(path.join(SRC, relative));

      // `logout` is AuthContext's only session-terminating action: it posts to
      // /api/auth/logout (server-side revocation + Redis deny-list), calls
      // supabase.auth.signOut(), clears the query cache and session storage,
      // and redirects. A control that navigates without it is cosmetic.
      expect(combined).toMatch(/\blogout\b/);
    },
  );
});
