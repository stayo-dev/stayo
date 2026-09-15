import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { isSessionEndedCode, readSessionHandoff } from './sessionHandoff';

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

describe('readSessionHandoff (ADR-204)', () => {
  it('reads a Clerk ticket', () => {
    expect(readSessionHandoff({ sign_in_ticket: 'tkt', access_token: null })).toEqual({
      kind: 'clerk_ticket',
      ticket: 'tkt',
    });
  });

  it('prefers the ticket even if a token pair is present too — Clerk is the authority', () => {
    expect(readSessionHandoff({ sign_in_ticket: 'tkt', access_token: 'a', refresh_token: 'r' }).kind).toBe(
      'clerk_ticket',
    );
  });

  it('accepts a legacy token pair only when both halves are present (backend mid-deploy)', () => {
    expect(readSessionHandoff({ access_token: 'a', refresh_token: 'r' })).toEqual({
      kind: 'supabase',
      accessToken: 'a',
      refreshToken: 'r',
    });
    expect(readSessionHandoff({ access_token: 'a' }).kind).toBe('none');
  });

  it('reports none for an empty or missing body', () => {
    expect(readSessionHandoff(undefined).kind).toBe('none');
    expect(readSessionHandoff({ sign_in_ticket: '   ' }).kind).toBe('none');
  });
});

describe('isSessionEndedCode', () => {
  it('treats idle, revoked and moved-account refusals as "drop the session"', () => {
    for (const code of ['SESSION_INACTIVE', 'SESSION_REVOKED', 'SIGN_IN_AGAIN', 'sign_in_again']) {
      expect(isSessionEndedCode(code)).toBe(true);
    }
    expect(isSessionEndedCode('UNAUTHORIZED')).toBe(false);
    expect(isSessionEndedCode(undefined)).toBe(false);
  });
});

describe('every sign-in surface goes through establishSession', () => {
  // A surface that calls supabase.auth.setSession directly would drop the
  // Clerk ticket on the floor and leave the person signed out.
  it.each([
    'context/AuthContext.tsx',
    'platforms/tenant/onboarding/ActivationPage.tsx',
    'app/pages/public/OwnerActivationPage.tsx',
    'portal/pages/ActivateAccountPage.tsx',
  ])('%s', (file) => {
    const src = read(file);
    expect(src).not.toContain('supabase.auth.setSession');
    expect(src).toContain('establishSession(');
  });

  it('the API client advertises ticket support on every request', () => {
    const src = read('lib/api-client.ts');
    expect(src).toContain('AUTH_CAPABILITIES_HEADER');
  });

  it('the API client sends the Clerk token before any Supabase one', () => {
    const src = read('lib/api-client.ts');
    expect(src.indexOf('getClerkToken()')).toBeGreaterThan(-1);
    expect(src.indexOf('getClerkToken()')).toBeLessThan(src.indexOf('supabase.auth.getSession()'));
  });
});
