import { describe, expect, it } from 'vitest';
import {
  readPartialPolicy,
  policyHeadline,
  policyDetail,
  outcomeStatements,
  blockedExplanation,
  DEFAULT_PARTIAL_POLICY,
  formatINR,
} from './billingPolicy';

const partial = (minimumAmount = 0, minimumPercentage = 0) => ({
  enabled: true,
  minimumAmount,
  minimumPercentage,
});
const full = { enabled: false, minimumAmount: 0, minimumPercentage: 0 };

describe('readPartialPolicy', () => {
  it('reads the policy off the preferences payload', () => {
    expect(
      readPartialPolicy({
        billing: { partial_payments: { enabled: true, minimum_amount: 500, minimum_percentage: 25 } },
      }),
    ).toEqual({ enabled: true, minimumAmount: 500, minimumPercentage: 25 });
  });

  it('falls back to full-payment when the policy is missing', () => {
    expect(readPartialPolicy(undefined)).toEqual(DEFAULT_PARTIAL_POLICY);
    expect(readPartialPolicy({})).toEqual(DEFAULT_PARTIAL_POLICY);
    expect(readPartialPolicy({ billing: {} })).toEqual(DEFAULT_PARTIAL_POLICY);
  });

  it('coerces missing numbers to 0 rather than NaN', () => {
    const p = readPartialPolicy({ billing: { partial_payments: { enabled: true } } });
    expect(p.minimumAmount).toBe(0);
    expect(p.minimumPercentage).toBe(0);
  });
});

describe('policyHeadline', () => {
  it('never leaks a backend flag name', () => {
    expect(policyHeadline(full)).toBe('Full payment only');
    expect(policyHeadline(partial())).toBe('Part payments allowed');
    for (const p of [full, partial(), partial(500, 25)]) {
      expect(policyHeadline(p)).not.toMatch(/allow_partial|minimum_amount|PARTIAL_ALLOWED|FULL_PAYMENT/);
    }
  });
});

describe('policyDetail', () => {
  it('explains the full-payment consequence', () => {
    expect(policyDetail(full)).toContain('cleared in full');
  });

  it('says any amount is fine when no floor is set', () => {
    expect(policyDetail(partial())).toContain('any amount');
  });

  it('names an absolute floor', () => {
    expect(policyDetail(partial(500))).toContain('₹500');
  });

  it('names a percentage floor', () => {
    expect(policyDetail(partial(0, 25))).toContain('25%');
  });

  it('mentions both floors and that the higher wins', () => {
    const text = policyDetail(partial(500, 25));
    expect(text).toContain('25%');
    expect(text).toContain('₹500');
    expect(text).toContain('whichever is higher');
  });

  it('never leaks a backend flag name', () => {
    for (const p of [full, partial(), partial(500, 25)]) {
      expect(policyDetail(p)).not.toMatch(/allow_partial|minimum_amount|minimum_percentage/);
    }
  });
});

describe('outcomeStatements', () => {
  it('states collected and remaining in the owner\'s terms', () => {
    const out = outcomeStatements({ collected: 100, remaining: 7900, clearedCount: 0, partialCount: 1 });
    expect(out[0]).toBe('₹100 will be collected.');
    expect(out).toContain('₹7,900 will remain outstanding.');
    expect(out.some((s) => s.includes('partly unpaid'))).toBe(true);
  });

  it('says nothing is outstanding when the balance clears', () => {
    const out = outcomeStatements({ collected: 8000, remaining: 0, clearedCount: 1, partialCount: 0 });
    expect(out).toContain('1 due will be fully cleared.');
    expect(out).toContain('This tenant will have nothing outstanding.');
    expect(out.some((s) => s.includes('remain outstanding'))).toBe(false);
  });

  it('pluralises cleared dues', () => {
    const out = outcomeStatements({ collected: 16000, remaining: 0, clearedCount: 2, partialCount: 0 });
    expect(out).toContain('2 dues will be fully cleared.');
  });

  it('always ends with the receipt/notification note', () => {
    const out = outcomeStatements({ collected: 100, remaining: 0, clearedCount: 1, partialCount: 0 });
    expect(out[out.length - 1]).toContain('receipt');
  });

  it('distinguishes partly-unpaid from unpaid', () => {
    const partlyPaid = outcomeStatements({ collected: 100, remaining: 7900, clearedCount: 0, partialCount: 1 });
    const untouched = outcomeStatements({ collected: 100, remaining: 7900, clearedCount: 0, partialCount: 0 });
    expect(partlyPaid.some((s) => s.includes('partly unpaid'))).toBe(true);
    expect(untouched.some((s) => s.includes('keep showing as unpaid'))).toBe(true);
  });
});

describe('blockedExplanation', () => {
  it('explains a full-payment block and offers the settings route', () => {
    const r = blockedExplanation({ policy: full, minimumAllowed: 8000, entered: 100 });
    expect(r.title).toContain('full payments only');
    expect(r.body).toContain('₹100');
    expect(r.body).toContain('₹8,000');
    expect(r.body).toContain('allow part payments');
    expect(r.canFixInSettings).toBe(true);
  });

  it('attributes the block to the percentage rule when that is what drives it', () => {
    const r = blockedExplanation({ policy: partial(500, 25), minimumAllowed: 2500, entered: 100 });
    expect(r.body).toContain('25%');
    expect(r.body).toContain('₹2,500');
  });

  it('does not blame a percentage when the absolute floor drives it', () => {
    const r = blockedExplanation({ policy: partial(4000, 5), minimumAllowed: 4000, entered: 100 });
    expect(r.body).not.toContain('5%');
    expect(r.body).toContain('minimum part payment');
  });

  it('always tells the owner what they can do next', () => {
    for (const policy of [full, partial(500), partial(0, 25)]) {
      const r = blockedExplanation({ policy, minimumAllowed: 1000, entered: 10 });
      expect(r.body).toMatch(/billing policy/i);
    }
  });

  it('never leaks a backend flag name', () => {
    const r = blockedExplanation({ policy: full, minimumAllowed: 8000, entered: 100 });
    expect(`${r.title} ${r.body}`).not.toMatch(/allow_partial|minimum_amount|payment_policy/);
  });
});

describe('formatINR', () => {
  it('uses Indian grouping', () => {
    expect(formatINR(132600)).toBe('₹1,32,600');
    expect(formatINR(0)).toBe('₹0');
  });
});
