import { describe, it, expect } from 'vitest';
import {
  stripVoice,
  promiseLine,
  monthRows,
  monthReconciles,
  formatInr,
  formatPromiseDate,
  type PayoutSummary,
} from './payoutState';

const month = {
  monthLabel: 'August',
  direct: 41200,
  inYourBank: 64300,
  withStayo: 18500,
  throughStayo: 82800,
  collected: 124000,
  stillToCollect: 32400,
  tenantsOwing: 6,
};

const summary = (patch: Partial<PayoutSummary> = {}): PayoutSummary => ({
  paidToday: { count: 0, total: 0, tenants: [] },
  withStayo: { total: 0, expectedBy: null },
  failed: null,
  lastPaid: null,
  everOnline: false,
  promise: { judged: 0, onTime: 0, streak: 0, allOnTime: false },
  month,
  bank: null,
  degraded: false,
  ...patch,
});

describe('stripVoice priority', () => {
  it('leads with a failed transfer even when today was a good day', () => {
    // The whole point of the priority rule: an owner told only the pleasant
    // half of the truth trusts the pleasant half less next time.
    const voice = stripVoice(
      summary({
        failed: { total: 12000, count: 1, reason: 'Your bank rejected the account number' },
        paidToday: { count: 3, total: 18500, tenants: [] },
        withStayo: { total: 18500, expectedBy: '2026-08-27' },
      }),
    );
    expect(voice.tone).toBe('alert');
    expect(voice.headline).toContain("didn't reach your bank");
    expect(voice.detail).toContain('bank rejected the account number');
  });

  it('offers no action on failure while its destination does not exist', () => {
    // `/owner/more/payout-account` was never a route, so this button did
    // nothing at the worst possible moment — the owner has just been told
    // money did not reach his bank. Piece B of the configuration redesign
    // builds the bank-account row and restores the action.
    const voice = stripVoice(summary({ failed: { total: 12000, count: 1, reason: null } }));
    expect(voice.action).toBeUndefined();
    // The reason still has to survive: it is what tells the owner whether his
    // own bank details are at fault, which only he can correct.
    expect(voice.detail).toContain('rejected');
  });

  it('says who paid today before it says what is pending', () => {
    const voice = stripVoice(
      summary({
        paidToday: { count: 3, total: 18500, tenants: [] },
        withStayo: { total: 18500, expectedBy: '2026-08-27' },
      }),
    );
    expect(voice.tone).toBe('incoming');
    expect(voice.headline).toBe('3 tenants paid today · ₹18,500');
    expect(voice.detail).toBe('In your bank by Thu 27 Aug');
  });

  it('says "1 tenant", not "1 tenants"', () => {
    const voice = stripVoice(summary({ paidToday: { count: 1, total: 6000, tenants: [] } }));
    expect(voice.headline).toBe('1 tenant paid today · ₹6,000');
  });

  it('never promises a date it does not have', () => {
    const voice = stripVoice(summary({ paidToday: { count: 2, total: 9000, tenants: [] } }));
    expect(voice.detail).not.toContain('by');
    expect(voice.detail).toContain("You'll see the date");
  });

  it('falls back to what is pending when nobody paid today', () => {
    const voice = stripVoice(summary({ withStayo: { total: 18500, expectedBy: '2026-08-27' } }));
    expect(voice.headline).toBe('₹18,500 with Stayo');
    expect(voice.detail).toBe('In your bank by Thu 27 Aug');
  });

  it('reports being settled with the amount and the day it landed', () => {
    const voice = stripVoice(
      summary({ lastPaid: { total: 31900, paidAt: '2026-08-21T10:00:00.000Z' }, everOnline: true }),
    );
    expect(voice.tone).toBe('settled');
    expect(voice.headline).toBe("You're all settled");
    expect(voice.detail).toBe('₹31,900 reached your bank on 21 Aug');
  });

  it('explains itself rather than showing a ₹0 box to an owner with no online rent', () => {
    const voice = stripVoice(summary());
    expect(voice.tone).toBe('quiet');
    expect(voice.headline).toBe('No online rent yet');
    expect(voice.detail).toContain('stays with you');
    expect(voice.detail).not.toContain('₹0');
  });

  it('never says the word "settlement" to an owner', () => {
    // Owners do not use the word — the same reason Obligations became Charges.
    const cases = [
      summary({ failed: { total: 1, count: 1, reason: 'x' } }),
      summary({ paidToday: { count: 1, total: 1, tenants: [] } }),
      summary({ withStayo: { total: 1, expectedBy: '2026-08-27' } }),
      summary({ lastPaid: { total: 1, paidAt: '2026-08-21T10:00:00.000Z' } }),
      summary(),
    ];
    for (const c of cases) {
      const v = stripVoice(c);
      expect(`${v.headline} ${v.detail}`.toLowerCase()).not.toContain('settlement');
    }
  });
});

describe('promiseLine', () => {
  it('stays silent until there is an actual record', () => {
    expect(promiseLine({ judged: 0, onTime: 0, streak: 0, allOnTime: false })).toBeNull();
    expect(promiseLine({ judged: 1, onTime: 1, streak: 1, allOnTime: true })).toBeNull();
  });

  it('claims a clean record only when it is clean', () => {
    expect(promiseLine({ judged: 8, onTime: 8, streak: 8, allOnTime: true })).toBe(
      'Last 8 payouts — all on time',
    );
  });

  it('admits a missed promise instead of only ever reporting good news', () => {
    expect(promiseLine({ judged: 8, onTime: 6, streak: 2, allOnTime: false })).toBe(
      '6 of the last 8 payouts arrived on time',
    );
  });
});

describe('month block', () => {
  it('nests the parts under the totals they belong to', () => {
    const rows = monthRows(month);
    expect(rows.map((r) => r.key)).toEqual([
      'collected',
      'direct',
      'throughStayo',
      'inYourBank',
      'withStayo',
    ]);
    // "reached your bank" and "with Stayo" are parts of "paid through Stayo",
    // not siblings of it — the indentation is what makes this read as a
    // reconciliation instead of five unrelated stats.
    expect(rows.find((r) => r.key === 'throughStayo')?.depth).toBe(1);
    expect(rows.find((r) => r.key === 'inYourBank')?.depth).toBe(2);
  });

  it('marks money the owner already holds so it is never read as owed', () => {
    expect(monthRows(month).find((r) => r.key === 'direct')?.hint).toBe('you already have this');
  });

  it('reconciles', () => {
    expect(monthReconciles(month)).toBe(true);
  });

  it('catches a block that does not add up', () => {
    expect(monthReconciles({ ...month, withStayo: 1 })).toBe(false);
  });
});

describe('formatting', () => {
  it('uses Indian digit grouping', () => {
    expect(formatInr(124000)).toBe('₹1,24,000');
  });

  it('gives a promise a weekday, so it is a day and not a date', () => {
    expect(formatPromiseDate('2026-08-27')).toBe('Thu 27 Aug');
    expect(formatPromiseDate(null)).toBeNull();
    expect(formatPromiseDate('not-a-date')).toBeNull();
  });
});
