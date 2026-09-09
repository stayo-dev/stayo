/**
 * Which provider speaks for the browser during the migration (ADR-176 Phase 3).
 *
 * The ordering here is the migration's safety property, not a preference:
 * Supabase first means every already-signed-in user keeps working, and a
 * half-finished Clerk sign-in can never displace a live Supabase session.
 */

import { describe, expect, it } from 'vitest';
import { pickSessionSource } from './clerkBrowser';

describe('pickSessionSource', () => {
  it('prefers Supabase when it has a session', () => {
    expect(pickSessionSource({ hasSupabaseSession: true, hasClerkSession: false })).toBe('supabase');
  });

  it('uses Clerk when Supabase has nothing', () => {
    expect(pickSessionSource({ hasSupabaseSession: false, hasClerkSession: true })).toBe('clerk');
  });

  it('still prefers Supabase when BOTH exist — Clerk never displaces a live session', () => {
    expect(pickSessionSource({ hasSupabaseSession: true, hasClerkSession: true })).toBe('supabase');
  });

  it('reports none when neither does', () => {
    expect(pickSessionSource({ hasSupabaseSession: false, hasClerkSession: false })).toBe('none');
  });
});
