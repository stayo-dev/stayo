/**
 * Route authorisation while Supabase and Clerk coexist (ADR-176, Phase 2).
 *
 * The centrepiece is the matrix in "Clerk cannot influence authorisation": it
 * asserts that every Clerk state produces an identical decision. That is the
 * mechanical guarantee that adding Clerk to the app in this phase changed
 * nobody's access — and the test Phase 3 must deliberately rewrite when Clerk
 * sessions start carrying a profile.
 */

import { describe, expect, it } from 'vitest';
import {
  decideCallbackAction,
  decideRouteAccess,
  clerkPresence,
  shouldExplainUnlinkedClerkSession,
  type ClerkSessionState,
} from './sessionAuthority';

const OWNER = { role: 'OWNER' };

const CLERK_STATES: Array<[string, ClerkSessionState | null]> = [
  ['not configured', null],
  ['still loading', { isLoaded: false, isSignedIn: false }],
  ['signed out', { isLoaded: true, isSignedIn: false }],
  ['signed in', { isLoaded: true, isSignedIn: true }],
];

describe('decideRouteAccess — the pre-Clerk behaviour, unchanged', () => {
  it('waits while the profile session is resolving', () => {
    expect(
      decideRouteAccess({ profileLoading: true, profile: null, clerk: null }),
    ).toBe('loading');
  });

  it('sends a visitor with no profile to /login', () => {
    expect(
      decideRouteAccess({ profileLoading: false, profile: null, clerk: null }),
    ).toBe('redirect-login');
  });

  it('allows a profile when no roles are required', () => {
    expect(
      decideRouteAccess({ profileLoading: false, profile: OWNER, clerk: null }),
    ).toBe('allow');
  });

  it('allows a profile whose role is permitted', () => {
    expect(
      decideRouteAccess({
        profileLoading: false,
        profile: OWNER,
        clerk: null,
        allowedRoles: ['OWNER', 'ADMIN'],
      }),
    ).toBe('allow');
  });

  it('sends a wrong-role profile home, not to /login', () => {
    // They are signed in; /login would be a lie, and the root is the chooser.
    expect(
      decideRouteAccess({
        profileLoading: false,
        profile: { role: 'TENANT' },
        clerk: null,
        allowedRoles: ['OWNER'],
      }),
    ).toBe('redirect-home');
  });
});

describe('Clerk cannot influence authorisation in Phase 2', () => {
  const scenarios = [
    { name: 'loading', input: { profileLoading: true, profile: null }, expected: 'loading' },
    { name: 'no profile', input: { profileLoading: false, profile: null }, expected: 'redirect-login' },
    { name: 'allowed role', input: { profileLoading: false, profile: OWNER, allowedRoles: ['OWNER'] }, expected: 'allow' },
    { name: 'wrong role', input: { profileLoading: false, profile: OWNER, allowedRoles: ['TENANT'] }, expected: 'redirect-home' },
  ] as const;

  for (const scenario of scenarios) {
    for (const [label, clerk] of CLERK_STATES) {
      it(`${scenario.name} + Clerk ${label} → ${scenario.expected}`, () => {
        expect(decideRouteAccess({ ...scenario.input, clerk })).toBe(scenario.expected);
      });
    }
  }

  it('a Clerk session never substitutes for a profile', () => {
    // The escalation this whole phase has to avoid: a fresh Clerk signup, with
    // no row in `profiles` and therefore no role, reaching a dashboard.
    expect(
      decideRouteAccess({
        profileLoading: false,
        profile: null,
        clerk: { isLoaded: true, isSignedIn: true },
        allowedRoles: ['OWNER'],
      }),
    ).toBe('redirect-login');
  });
});

describe('clerkPresence', () => {
  it('distinguishes not-configured from signed-out', () => {
    // Different causes, different UI: one is a deployment gap, the other is a
    // person who simply has not signed in.
    expect(clerkPresence(null)).toBe('not-configured');
    expect(clerkPresence({ isLoaded: true, isSignedIn: false })).toBe('signed-out');
  });

  it('reports loading before Clerk has resolved', () => {
    expect(clerkPresence({ isLoaded: false, isSignedIn: false })).toBe('loading');
    expect(clerkPresence({ isLoaded: false, isSignedIn: true })).toBe('loading');
  });

  it('reports signed-in only once loaded', () => {
    expect(clerkPresence({ isLoaded: true, isSignedIn: true })).toBe('signed-in');
  });
});

describe('shouldExplainUnlinkedClerkSession', () => {
  it('explains when Clerk knows them but Stayo does not', () => {
    expect(
      shouldExplainUnlinkedClerkSession({
        profileLoading: false,
        profile: null,
        clerk: { isLoaded: true, isSignedIn: true },
      }),
    ).toBe(true);
  });

  it('stays quiet once a profile is present', () => {
    expect(
      shouldExplainUnlinkedClerkSession({
        profileLoading: false,
        profile: OWNER,
        clerk: { isLoaded: true, isSignedIn: true },
      }),
    ).toBe(false);
  });

  it('stays quiet while anything is still loading', () => {
    expect(
      shouldExplainUnlinkedClerkSession({
        profileLoading: true,
        profile: null,
        clerk: { isLoaded: true, isSignedIn: true },
      }),
    ).toBe(false);
    expect(
      shouldExplainUnlinkedClerkSession({
        profileLoading: false,
        profile: null,
        clerk: { isLoaded: false, isSignedIn: false },
      }),
    ).toBe(false);
  });

  it('stays quiet for an ordinary signed-out visitor', () => {
    expect(
      shouldExplainUnlinkedClerkSession({
        profileLoading: false,
        profile: null,
        clerk: { isLoaded: true, isSignedIn: false },
      }),
    ).toBe(false);
    expect(
      shouldExplainUnlinkedClerkSession({ profileLoading: false, profile: null, clerk: null }),
    ).toBe(false);
  });
});

describe('decideCallbackAction — /auth/callback must not judge Clerk too early', () => {
  it('waits while Clerk is still loading', () => {
    // The bug this encodes: Clerk's SDK loads asynchronously, so on the first
    // render after a Google redirect `window.Clerk.session` is not populated.
    // Concluding here reported "Google sign-in did not complete" for a
    // perfectly good sign-in — and the callback effect ran once, so it never
    // re-checked. Every Google sign-in failed this way.
    expect(
      decideCallbackAction({ hasSupabaseSession: false, clerk: { isLoaded: false, isSignedIn: false } }),
    ).toBe('wait');
  });

  it('resolves once Clerk reports a session', () => {
    expect(
      decideCallbackAction({ hasSupabaseSession: false, clerk: { isLoaded: true, isSignedIn: true } }),
    ).toBe('resolve');
  });

  it('reports no session when Clerk has loaded and is signed out', () => {
    expect(
      decideCallbackAction({ hasSupabaseSession: false, clerk: { isLoaded: true, isSignedIn: false } }),
    ).toBe('no-session');
  });

  it('reports no session when Clerk is not configured — nothing is coming', () => {
    expect(decideCallbackAction({ hasSupabaseSession: false, clerk: null })).toBe('no-session');
  });

  it('resolves immediately on a Supabase session, without waiting for Clerk', () => {
    // Password sign-in still lands here; it must not be delayed by Clerk.
    expect(
      decideCallbackAction({ hasSupabaseSession: true, clerk: { isLoaded: false, isSignedIn: false } }),
    ).toBe('resolve');
    expect(decideCallbackAction({ hasSupabaseSession: true, clerk: null })).toBe('resolve');
  });

  it('never returns wait once Clerk has settled, so the page cannot hang', () => {
    for (const clerk of [null, { isLoaded: true, isSignedIn: true }, { isLoaded: true, isSignedIn: false }]) {
      expect(decideCallbackAction({ hasSupabaseSession: false, clerk })).not.toBe('wait');
    }
  });
});
