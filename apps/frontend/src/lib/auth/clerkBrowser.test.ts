/**
 * Which provider speaks for the browser (ADR-204: Clerk is the only
 * authentication provider).
 *
 * Clerk first. A Supabase session answers only for a browser with no Clerk
 * session — an account signed in before the cutover that has not moved yet.
 * The reverse order (ADR-176 Phase 3) protected those sessions while Clerk was
 * additive; kept now, a stale Supabase session would shadow a fresh Clerk
 * sign-in and the backend would refuse it.
 */

import { describe, expect, it } from 'vitest';
import { pickSessionSource, shouldAwaitClerk } from './clerkBrowser';

describe('pickSessionSource', () => {
  it('uses Clerk when it has a session', () => {
    expect(pickSessionSource({ hasSupabaseSession: false, hasClerkSession: true })).toBe('clerk');
  });

  it('prefers Clerk when BOTH exist — a leftover Supabase session never shadows Clerk', () => {
    expect(pickSessionSource({ hasSupabaseSession: true, hasClerkSession: true })).toBe('clerk');
  });

  it('falls back to Supabase only when Clerk has nothing (transition only)', () => {
    expect(pickSessionSource({ hasSupabaseSession: true, hasClerkSession: false })).toBe('supabase');
  });

  it('reports none when neither does', () => {
    expect(pickSessionSource({ hasSupabaseSession: false, hasClerkSession: false })).toBe('none');
  });
});

/**
 * A cold load of the owner app (refresh, or the homepage sign-in's full-page
 * handoff) used to resolve "signed out" before Clerk's SDK had loaded, and
 * ProtectedRoute bounced a signed-in owner to /login.
 */
describe('shouldAwaitClerk', () => {
  it('waits when nothing is found yet and a mounted Clerk has not loaded', () => {
    expect(shouldAwaitClerk({ source: 'none', awaitClerk: true, clerkLoaded: false })).toBe(true);
  });

  it('stops waiting once Clerk has loaded — its answer is final', () => {
    expect(shouldAwaitClerk({ source: 'none', awaitClerk: true, clerkLoaded: true })).toBe(false);
  });

  it('never waits on a shell that does not mount Clerk — nothing is coming', () => {
    expect(shouldAwaitClerk({ source: 'none', awaitClerk: false, clerkLoaded: false })).toBe(false);
  });

  it('never waits when a session is already in hand', () => {
    expect(shouldAwaitClerk({ source: 'supabase', awaitClerk: true, clerkLoaded: false })).toBe(false);
    expect(shouldAwaitClerk({ source: 'clerk', awaitClerk: true, clerkLoaded: false })).toBe(false);
  });
});
