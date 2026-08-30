import { describe, expect, it } from 'vitest';
import {
  canGiveWord,
  commitmentStatement,
  formatDay,
  formatDuration,
  formatMoney,
  formatWindow,
  hasStatableTerm,
  monthWord,
  promises,
} from './commitmentTerm';

const TERM = {
  duration_months: 11,
  start_date: '2026-09-01',
  end_date: '2027-07-31',
  monthly_rent: 8000,
  security_deposit: 16000,
};

describe('whether there is a term worth committing to', () => {
  it('accepts a real duration', () => {
    expect(hasStatableTerm(TERM)).toBe(true);
  });

  // `agreement_duration_months` is nullable, so the ceremony has to be skippable
  // rather than blocking a signature it cannot describe.
  it('refuses a missing or nonsensical one', () => {
    expect(hasStatableTerm(null)).toBe(false);
    expect(hasStatableTerm({ ...TERM, duration_months: null })).toBe(false);
    expect(hasStatableTerm({ ...TERM, duration_months: 0 })).toBe(false);
  });
});

describe('formatting', () => {
  it('pluralises correctly, including the one-month case', () => {
    expect(monthWord(11)).toBe('months');
    expect(monthWord(1)).toBe('month');
    expect(formatDuration(TERM)).toBe('11 months');
    expect(formatDuration({ ...TERM, duration_months: 1 })).toBe('1 month');
  });

  // Never `new Date(iso)`: that applies the viewer's timezone and can show a
  // window one day off from the one recorded against their name.
  it('formats a day without a timezone shift', () => {
    expect(formatDay('2026-09-01')).toBe('1 Sep 2026');
    expect(formatDay('2027-07-31')).toBe('31 Jul 2027');
    expect(formatDay('2026-01-01')).toBe('1 Jan 2026');
    expect(formatDay('2026-12-31')).toBe('31 Dec 2026');
  });

  it('returns nothing for an absent or malformed date', () => {
    expect(formatDay(null)).toBe('');
    expect(formatDay('01-09-2026')).toBe('');
  });

  it('shows the window only when both ends are known', () => {
    expect(formatWindow(TERM)).toBe('1 Sep 2026 → 31 Jul 2027');
    expect(formatWindow({ ...TERM, end_date: null })).toBe('');
  });

  it('formats rupees with Indian grouping', () => {
    expect(formatMoney(8000)).toBe('₹8,000');
    expect(formatMoney(150000)).toBe('₹1,50,000');
    expect(formatMoney(null)).toBe('');
  });
});

describe('the sentence the tenant agrees to', () => {
  // Must stay byte-identical to the server's commitmentStatement: the server
  // stores what it generates, and the record has to be the words they read.
  it('names the hostel, the length and the window, in the first person', () => {
    expect(commitmentStatement('Sunrise Residency', TERM)).toBe(
      'I am committing to stay at Sunrise Residency for 11 months — from 1 Sep 2026 until 31 Jul 2027.',
    );
  });

  it('drops the window when the dates are unknown', () => {
    expect(commitmentStatement('Sunrise Residency', { ...TERM, start_date: null, end_date: null })).toBe(
      'I am committing to stay at Sunrise Residency for 11 months.',
    );
  });

  it('falls back rather than naming an empty hostel', () => {
    expect(commitmentStatement('   ', TERM)).toContain('stay at this hostel for');
  });

  it('is empty when there is no term', () => {
    expect(commitmentStatement('H', { ...TERM, duration_months: null })).toBe('');
  });
});

describe('giving the word', () => {
  // A pre-ticked commitment is not a commitment. Both boxes, deliberately.
  it('needs both confirmations', () => {
    expect(canGiveWord({ readAgreement: true, acceptTerm: true })).toBe(true);
    expect(canGiveWord({ readAgreement: true, acceptTerm: false })).toBe(false);
    expect(canGiveWord({ readAgreement: false, acceptTerm: true })).toBe(false);
    expect(canGiveWord({ readAgreement: false, acceptTerm: false })).toBe(false);
  });
});

describe('the two sides of the promise', () => {
  // Listing only the tenant's obligations reads as extraction. Both halves are
  // what makes it a mutual word.
  it('states what the hostel owes as well as what the tenant owes', () => {
    const { tenant, hostel } = promises({ hostelName: 'Sunrise Residency', roomNumber: '105', term: TERM });

    expect(tenant[0]).toContain('11 months');
    expect(tenant[0]).toContain('1 Sep 2026 → 31 Jul 2027');
    expect(tenant[1]).toContain('₹8,000');

    expect(hostel[0]).toContain('room 105');
    expect(hostel[1]).toContain('₹8,000');
    expect(hostel[2]).toContain('₹16,000');
  });

  it('degrades to honest wording when the room or money is unknown', () => {
    const { tenant, hostel } = promises({
      hostelName: 'Sunrise Residency',
      roomNumber: null,
      term: { ...TERM, monthly_rent: null, security_deposit: null },
    });

    expect(hostel[0]).toContain('your bed');
    expect(hostel[0]).not.toContain('room null');
    expect(tenant[1]).toBe('Pay the rent on time each month');
    expect(hostel[2]).toBe('Return your deposit when you settle up');
  });

  it('never claims a penalty or a lock-in', () => {
    // notice_period_days is NULL on every live template, so move-out records no
    // violation at all. Copy implying otherwise would be false, and a
    // commitment screen caught bluffing damages the trust it exists to build.
    const all = Object.values(promises({ hostelName: 'H', roomNumber: '1', term: TERM })).flat().join(' ');
    expect(all).not.toMatch(/penalt|forfeit|cannot leave|not allowed to leave|lock-?in/i);
  });
});
