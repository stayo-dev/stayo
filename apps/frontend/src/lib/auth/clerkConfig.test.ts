/**
 * Clerk publishable-key resolution (ADR-176, Phase 2).
 *
 * The behaviour that matters here is what happens when the key is *absent or
 * wrong*: Clerk is additive in this phase, so a misconfiguration must degrade to
 * "Clerk unavailable, Supabase unaffected" and never take the product down.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveClerkConfig,
  CLERK_KEY_VAR,
  CLERK_KEY_WRONG_VAR,
} from './clerkConfig';

describe('resolveClerkConfig', () => {
  it('accepts a development publishable key', () => {
    const result = resolveClerkConfig({ [CLERK_KEY_VAR]: 'pk_test_abc123' });
    expect(result).toMatchObject({ configured: true, publishableKey: 'pk_test_abc123' });
  });

  it('accepts a production publishable key', () => {
    const result = resolveClerkConfig({ [CLERK_KEY_VAR]: 'pk_live_abc123' });
    expect(result).toMatchObject({ configured: true, publishableKey: 'pk_live_abc123' });
  });

  it('trims surrounding whitespace, which survives a copy-paste from a dashboard', () => {
    const result = resolveClerkConfig({ [CLERK_KEY_VAR]: '  pk_test_abc123\n' });
    expect(result).toMatchObject({ configured: true, publishableKey: 'pk_test_abc123' });
  });

  it('reports missing config without throwing — Supabase must keep working', () => {
    const result = resolveClerkConfig({});
    expect(result).toMatchObject({ configured: false, reason: 'missing' });
    expect(result.message).toContain('Supabase Auth is unaffected');
  });

  it('names the Next.js/Vite env-prefix mix-up specifically', () => {
    // This is the mistake actually present in the repo's root .env, and it is
    // silent: Vite simply never puts a non-VITE_ var in the bundle.
    const result = resolveClerkConfig({ [CLERK_KEY_WRONG_VAR]: 'pk_test_abc123' });

    expect(result).toMatchObject({ configured: false, reason: 'wrong_env_prefix' });
    expect(result.message).toContain(CLERK_KEY_VAR);
    expect(result.message).toContain('Vite, not');
  });

  it('prefers the correct var when both are set', () => {
    const result = resolveClerkConfig({
      [CLERK_KEY_VAR]: 'pk_test_correct',
      [CLERK_KEY_WRONG_VAR]: 'pk_test_ignored',
    });
    expect(result).toMatchObject({ configured: true, publishableKey: 'pk_test_correct' });
  });

  it('rejects a secret key pasted into the client var', () => {
    // A sk_ key in a Vite var would be inlined into the bundle and served to
    // every visitor. Refusing it is the whole point of the prefix check.
    const result = resolveClerkConfig({ [CLERK_KEY_VAR]: 'sk_test_supersecret' });

    expect(result).toMatchObject({ configured: false, reason: 'malformed' });
    expect(result.message).toContain('secret key');
  });

  it('treats blank and non-string values as missing', () => {
    for (const value of ['', '   ', undefined, null, 42, {}]) {
      expect(resolveClerkConfig({ [CLERK_KEY_VAR]: value })).toMatchObject({ configured: false });
    }
  });
});
