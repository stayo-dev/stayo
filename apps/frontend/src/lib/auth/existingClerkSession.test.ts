import { describe, expect, it } from 'vitest';
import { decideExistingSession, readHandoffProfileId, shouldSignOutBeforeGoogle } from './existingClerkSession';

describe('decideExistingSession (ADR-204)', () => {
  it('redeems the ticket as usual when the browser holds no Clerk session', () => {
    expect(
      decideExistingSession({ hasActiveSession: false, sessionExternalId: null, expectedProfileId: 'p1' }),
    ).toBe('redeem');
    // What a stale identity field says is irrelevant without a session.
    expect(
      decideExistingSession({ hasActiveSession: false, sessionExternalId: 'p2', expectedProfileId: 'p1' }),
    ).toBe('redeem');
  });

  it('reuses the session when it already belongs to the person signing in', () => {
    expect(
      decideExistingSession({ hasActiveSession: true, sessionExternalId: 'p1', expectedProfileId: 'p1' }),
    ).toBe('reuse');
    expect(
      decideExistingSession({ hasActiveSession: true, sessionExternalId: ' p1 ', expectedProfileId: 'p1' }),
    ).toBe('reuse');
  });

  it('replaces a session that belongs to someone else — never adopts it', () => {
    expect(
      decideExistingSession({ hasActiveSession: true, sessionExternalId: 'p2', expectedProfileId: 'p1' }),
    ).toBe('replace');
  });

  it('replaces when either side cannot be identified — unknown is never "the same person"', () => {
    const cases: Array<[unknown, unknown]> = [
      [null, 'p1'], // Clerk user with no externalId (never linked by our backend)
      [undefined, 'p1'],
      ['', 'p1'],
      ['p1', undefined], // a response that names no profile
      ['p1', ''],
      [null, null], // two unknowns must not compare equal
      ['', ''],
    ];
    for (const [sessionExternalId, expectedProfileId] of cases) {
      expect(decideExistingSession({ hasActiveSession: true, sessionExternalId, expectedProfileId })).toBe(
        'replace',
      );
    }
  });

  it('never returns "reuse" without a session', () => {
    for (const ext of [null, 'p1']) {
      for (const expected of [undefined, 'p1']) {
        expect(
          decideExistingSession({ hasActiveSession: false, sessionExternalId: ext, expectedProfileId: expected }),
        ).not.toBe('reuse');
      }
    }
  });
});

describe('shouldSignOutBeforeGoogle', () => {
  it('signs out first whenever a session already exists — identity is unknown until Google decides it', () => {
    expect(shouldSignOutBeforeGoogle(true)).toBe(true);
  });

  it('does nothing extra when the browser holds no session', () => {
    expect(shouldSignOutBeforeGoogle(false)).toBe(false);
  });
});

describe('readHandoffProfileId', () => {
  it('reads user_id, the profile the sign-in is for', () => {
    expect(readHandoffProfileId({ user_id: 'abc', sign_in_ticket: 't' })).toBe('abc');
  });

  it('is empty when the response does not say', () => {
    expect(readHandoffProfileId({})).toBe('');
    expect(readHandoffProfileId(null)).toBe('');
    expect(readHandoffProfileId({ user_id: 42 })).toBe('');
  });
});
