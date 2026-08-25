import { describe, expect, it } from 'vitest';
import { expiryNotice } from './linkExpiry';

const NOW = new Date('2026-08-25T12:00:00.000Z');
const at = (iso: string) => expiryNotice({ expiresAt: iso, now: NOW });

describe('someone already underway', () => {
  // resolveByToken skips the expiry check once the invitation is
  // ACTIVATION_STARTED, so a countdown here would be a deadline that does not
  // exist — and the server would ignore it anyway.
  it('is told their place is held, not given a clock', () => {
    const notice = expiryNotice({ expiresAt: '2026-08-25T12:30:00.000Z', held: true, now: NOW });
    expect(notice.tone).toBe('held');
    expect(notice.live).toBe(false);
    expect(notice.label).toMatch(/held/i);
    expect(notice.label).not.toMatch(/expire/i);
  });
});

describe('urgency is earned, not constant', () => {
  // Six days out a ticking clock is pressure with no purpose — it reads as a
  // sales countdown and undercuts the welcome the rest of onboarding builds.
  it('states a plain date when the deadline is far off', () => {
    const notice = at('2026-08-31T12:00:00.000Z');
    expect(notice.tone).toBe('calm');
    expect(notice.label).toBe('This link is valid until 31 Aug');
    expect(notice.live).toBe(false);
  });

  it('counts days once it is close', () => {
    expect(at('2026-08-27T18:00:00.000Z')).toMatchObject({ tone: 'soon', label: 'Expires in 2 days', live: false });
  });

  it('says tomorrow rather than "1 day"', () => {
    expect(at('2026-08-26T18:00:00.000Z')).toMatchObject({ tone: 'soon', label: 'Expires tomorrow' });
  });

  it('switches to hours inside the last day, and starts ticking', () => {
    expect(at('2026-08-25T17:00:00.000Z')).toMatchObject({ tone: 'urgent', label: 'Expires in 5 hours', live: true });
  });

  it('uses minutes in the final hour', () => {
    expect(at('2026-08-25T12:42:00.000Z')).toMatchObject({ tone: 'urgent', label: 'Expires in 42 minutes', live: true });
  });

  it('never rounds down to zero while time remains', () => {
    // "Expires in 0 minutes" on a link that still works would be worse than
    // saying nothing.
    expect(at('2026-08-25T12:00:20.000Z')).toMatchObject({ label: 'Expires in 1 minute' });
  });

  it('singularises correctly', () => {
    expect(at('2026-08-25T13:00:00.000Z').label).toBe('Expires in 1 hour');
  });
});

describe('once it is gone', () => {
  it('says so, and names the way forward', () => {
    const notice = at('2026-08-25T11:59:00.000Z');
    expect(notice.tone).toBe('expired');
    expect(notice.live).toBe(false);
    expect(notice.label).toMatch(/ask the hostel/i);
  });
});

describe('when there is nothing to say', () => {
  // A legacy profile-token activation has no `expires_at` on the payload;
  // inventing a deadline would be worse than staying quiet.
  it('shows nothing for a missing or unparseable date', () => {
    expect(expiryNotice({ expiresAt: null, now: NOW }).label).toBe('');
    expect(expiryNotice({ expiresAt: '', now: NOW }).label).toBe('');
    expect(expiryNotice({ expiresAt: 'not-a-date', now: NOW }).label).toBe('');
  });
});
