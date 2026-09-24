import { describe, expect, it } from 'vitest';
import {
  DEFAULT_AFTER_SSO,
  SSO_CALLBACK_PATH,
  buildSsoCallbackPath,
  readSsoCallbackDestination,
} from './ssoCallbackDestination';

/** What the callback page sees: the query part of the path the button built. */
const searchOf = (path: string) => path.slice(path.indexOf('?'));

describe('SSO callback destination (2026-09-24, Discover Google sign-up lost its flag)', () => {
  it('builds a path on the SSO callback route', () => {
    expect(buildSsoCallbackPath('/auth/callback').startsWith(`${SSO_CALLBACK_PATH}?`)).toBe(true);
  });

  it('round-trips Discover sign-up with its flag intact — the ADR-233 case', () => {
    const path = buildSsoCallbackPath('/auth/callback?flow=discover_signup');
    expect(readSsoCallbackDestination(searchOf(path))).toBe('/auth/callback?flow=discover_signup');
  });

  it('round-trips the lead-signup destination', () => {
    const path = buildSsoCallbackPath('/lead-signup/callback');
    expect(readSsoCallbackDestination(searchOf(path))).toBe('/lead-signup/callback');
  });

  it('keeps the destination distinct from params Clerk may append to the callback URL', () => {
    const path = buildSsoCallbackPath('/auth/callback?flow=discover_signup');
    expect(readSsoCallbackDestination(`${searchOf(path)}&__clerk_status=verified`)).toBe(
      '/auth/callback?flow=discover_signup',
    );
  });

  it('falls back to the default callback when no destination was carried', () => {
    expect(readSsoCallbackDestination('')).toBe(DEFAULT_AFTER_SSO);
    expect(readSsoCallbackDestination('?other=1')).toBe(DEFAULT_AFTER_SSO);
  });

  it.each([
    ['protocol-relative', '//evil.example/steal'],
    ['backslash trick', '/\\evil.example'],
    ['absolute URL', 'https://evil.example/'],
    ['javascript scheme', 'javascript:alert(1)'],
    ['bare path', 'auth/callback'],
    ['control character', '/auth/callback\n//evil.example'],
  ])('refuses a destination that could leave this origin (%s)', (_label, destination) => {
    const search = `?${new URLSearchParams({ after: destination }).toString()}`;
    expect(readSsoCallbackDestination(search)).toBe(DEFAULT_AFTER_SSO);
  });
});
