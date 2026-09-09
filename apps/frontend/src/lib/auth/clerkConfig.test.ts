/**
 * Clerk publishable-key resolution (ADR-176).
 *
 * Two behaviours matter here. What happens when the key is absent or wrong —
 * Clerk is additive, so a misconfiguration must degrade to "Clerk unavailable,
 * Supabase unaffected" and never take the product down. And that a secret key
 * is refused, because anything reaching `import.meta.env` is inlined into the
 * bundle and served to every visitor.
 */

import { describe, expect, it } from 'vitest';
import { resolveClerkConfig, readClerkConfig, CLERK_KEY_VAR } from './clerkConfig';

describe('resolveClerkConfig', () => {
  it('accepts a development publishable key', () => {
    expect(resolveClerkConfig('pk_test_abc123')).toMatchObject({
      configured: true,
      publishableKey: 'pk_test_abc123',
      reason: null,
    });
  });

  it('accepts a production publishable key', () => {
    expect(resolveClerkConfig('pk_live_abc123')).toMatchObject({
      configured: true,
      publishableKey: 'pk_live_abc123',
    });
  });

  it('trims surrounding whitespace, which survives a copy-paste from a dashboard', () => {
    expect(resolveClerkConfig('  pk_test_abc123\n')).toMatchObject({
      configured: true,
      publishableKey: 'pk_test_abc123',
    });
  });

  it('reports missing config without throwing — Supabase must keep working', () => {
    const result = resolveClerkConfig(undefined);

    expect(result).toMatchObject({ configured: false, reason: 'missing', publishableKey: '' });
    expect(result.message).toContain('Supabase Auth is unaffected');
  });

  it('explains that only VITE_-prefixed vars reach the browser', () => {
    // The real setup trap: the key exists in the repo-root .env under a
    // Next.js-style name, and this app reads neither that file nor that prefix.
    const result = resolveClerkConfig('');

    expect(result.message).toContain('VITE_');
    expect(result.message).toContain('apps/frontend/.env');
  });

  it('rejects a secret key outright', () => {
    // An sk_ value in a VITE_ var would be inlined into the bundle and served
    // to every visitor. This is the only thing standing between a paste-o and
    // a published credential.
    const result = resolveClerkConfig('sk_test_supersecret');

    expect(result).toMatchObject({ configured: false, reason: 'malformed' });
    expect(result.publishableKey).toBe('');
    expect(result.message).toContain('backend-only');
  });

  it('rejects anything that is not a Clerk publishable key', () => {
    for (const value of ['abc123', 'pk_', 'test_pk_abc', 'Bearer pk_test_abc']) {
      expect(resolveClerkConfig(value)).toMatchObject({ configured: false, reason: 'malformed' });
    }
  });

  it('treats blank and non-string values as missing', () => {
    for (const value of ['', '   ', undefined, null, 42, {}, []]) {
      expect(resolveClerkConfig(value)).toMatchObject({ configured: false, reason: 'missing' });
    }
  });

  it('never returns a publishableKey unless configured', () => {
    for (const value of ['', 'sk_test_x', 'nonsense', undefined]) {
      const result = resolveClerkConfig(value);
      expect(result.configured).toBe(false);
      expect(result.publishableKey).toBe('');
    }
  });
});

describe('readClerkConfig', () => {
  it('reads VITE_CLERK_PUBLISHABLE_KEY off import.meta.env', () => {
    // Whatever the local .env holds, the result must be internally consistent:
    // configured implies a publishable key, unconfigured implies a reason.
    const result = readClerkConfig();

    if (result.configured) {
      expect(result.publishableKey).toMatch(/^pk_(test|live)_/);
      expect(result.reason).toBeNull();
    } else {
      expect(result.publishableKey).toBe('');
      expect(result.message).toContain(CLERK_KEY_VAR);
    }
  });

  it('agrees with resolveClerkConfig applied to the same env value', () => {
    expect(readClerkConfig()).toEqual(
      resolveClerkConfig(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY),
    );
  });
});
