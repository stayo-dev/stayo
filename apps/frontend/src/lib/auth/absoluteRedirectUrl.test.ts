import { describe, expect, it } from 'vitest';
import { toAbsoluteUrl } from './absoluteRedirectUrl';

const ORIGIN = 'https://yourstayo.com';

describe('toAbsoluteUrl (ADR-176, 2026-09-23 CAPTCHA/Account-Portal fix)', () => {
  it('resolves a relative path against the given origin', () => {
    expect(toAbsoluteUrl('/sign-in/sso-callback', ORIGIN)).toBe(
      'https://yourstayo.com/sign-in/sso-callback',
    );
  });

  it('resolves a bare path with no leading slash the same way', () => {
    expect(toAbsoluteUrl('auth/callback', ORIGIN)).toBe('https://yourstayo.com/auth/callback');
  });

  it('leaves an already-absolute URL alone — the origin is not re-applied', () => {
    expect(toAbsoluteUrl('https://yourstayo.com/lead-signup/callback', ORIGIN)).toBe(
      'https://yourstayo.com/lead-signup/callback',
    );
  });

  it('an absolute URL on a different origin is kept as given, not forced onto ours', () => {
    // Not a case this app has today, but the function must not silently
    // rewrite a caller's explicit choice of host.
    expect(toAbsoluteUrl('https://example.com/x', ORIGIN)).toBe('https://example.com/x');
  });

  it('preserves query params and hashes', () => {
    expect(toAbsoluteUrl('/lead-signup/callback?token=abc#section', ORIGIN)).toBe(
      'https://yourstayo.com/lead-signup/callback?token=abc#section',
    );
  });
});
