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
import { pickSessionSource } from './clerkBrowser';

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
