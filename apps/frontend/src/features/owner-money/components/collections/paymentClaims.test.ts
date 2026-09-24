import { describe, it, expect } from 'vitest';
import {
  formatPaise,
  waitingFor,
  claimsHeading,
  claimSummary,
  CONFIRM_LABEL,
  CONFIRM_HELP,
  type PaymentClaim,
} from './paymentClaims';

/**
 * The copy on the screen where an owner turns a tenant's word into recorded
 * rent. With no gateway there is no third-party check, so the wording must
 * place that judgement with the owner rather than implying Stayo made it.
 */

const claim: PaymentClaim = {
  id: 'c1',
  tenant_name: 'Mohammed Afreed',
  hostel_name: 'Sri Adithya Boys Hostel',
  rent_month: 'September 2026',
  claimed_amount: 850000,
  mismatch_note: null,
  utr: '412345678901',
  proof_url: null,
  state: 'PENDING',
  created_at: '2026-09-23T10:00:00.000Z',
};

describe('formatPaise', () => {
  it('renders paise as grouped rupees the Indian way', () => {
    expect(formatPaise(850000)).toBe('₹8,500');
    expect(formatPaise(148000000)).toBe('₹14,80,000');
  });

  it('survives a missing amount rather than printing NaN', () => {
    expect(formatPaise(undefined as unknown as number)).toBe('₹0');
  });
});

describe('waitingFor', () => {
  const now = new Date('2026-09-23T12:00:00.000Z');

  it('counts in minutes, then hours, then days', () => {
    expect(waitingFor('2026-09-23T11:30:00.000Z', now)).toBe('30 min ago');
    expect(waitingFor('2026-09-23T10:00:00.000Z', now)).toBe('2 hours ago');
    expect(waitingFor('2026-09-22T12:00:00.000Z', now)).toBe('yesterday');
    expect(waitingFor('2026-09-20T12:00:00.000Z', now)).toBe('3 days ago');
  });

  it('singularises one hour', () => {
    expect(waitingFor('2026-09-23T11:00:00.000Z', now)).toBe('1 hour ago');
  });

  it('says "just now" rather than "0 min ago"', () => {
    expect(waitingFor('2026-09-23T12:00:00.000Z', now)).toBe('just now');
  });

  it('never reports a negative wait from a clock skew', () => {
    expect(waitingFor('2026-09-23T12:05:00.000Z', now)).toBe('just now');
  });

  it('returns nothing for an unparseable date instead of "NaN days ago"', () => {
    expect(waitingFor('not-a-date', now)).toBe('');
  });
});

describe('claimsHeading', () => {
  it('names the count, since that decides whether he opens it now', () => {
    expect(claimsHeading(0)).toBe('No payments waiting');
    expect(claimsHeading(1)).toBe('1 payment to confirm');
    expect(claimsHeading(4)).toBe('4 payments to confirm');
  });
});

describe('claimSummary', () => {
  it('leads with the amount and the month he matches against', () => {
    expect(claimSummary(claim)).toBe('₹8,500 · September 2026');
  });

  it('omits the month when the claim carries none', () => {
    expect(claimSummary({ ...claim, rent_month: null })).toBe('₹8,500');
  });
});

describe('the confirm copy', () => {
  it('never says "verify" — nothing was verified', () => {
    // There is no gateway and no callback. Implying a check that never
    // happened is how an owner stops reading the reference.
    expect(CONFIRM_LABEL.toLowerCase()).not.toContain('verif');
    expect(CONFIRM_HELP.toLowerCase()).not.toContain('verif');
  });

  it('tells him to check his bank statement before confirming', () => {
    expect(CONFIRM_HELP).toMatch(/bank statement/i);
  });

  it('says what confirming causes, not just that it confirms', () => {
    expect(CONFIRM_HELP).toMatch(/records the rent/i);
  });
});
