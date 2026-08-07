import { describe, it, expect } from 'vitest';
import {
  INITIAL_DEPOSIT,
  resolveDepositAmount,
  validateDeposit,
  describeDeposit,
  type DepositState,
} from './depositPolicy';

const state = (over: Partial<DepositState> = {}): DepositState => ({ ...INITIAL_DEPOSIT, ...over });

describe('resolveDepositAmount', () => {
  // "No deposit" must be storable as an explicit 0, not left as a missing
  // value the backend has to guess at.
  it('is 0 when the owner takes no deposit', () => {
    expect(resolveDepositAmount(state({ takesDeposit: false }), 8000)).toBe(0);
    expect(resolveDepositAmount(state({ takesDeposit: false, flatAmount: '5000' }), 8000)).toBe(0);
  });

  it('multiplies months by the monthly rent', () => {
    expect(resolveDepositAmount(state({ mode: 'MONTHS', months: '2' }), 8000)).toBe(16000);
    expect(resolveDepositAmount(state({ mode: 'MONTHS', months: '1' }), 7500)).toBe(7500);
  });

  it('uses the flat amount verbatim when that mode is chosen', () => {
    expect(resolveDepositAmount(state({ mode: 'FLAT', flatAmount: '12000' }), 8000)).toBe(12000);
  });

  it('ignores the rent entirely in flat mode', () => {
    expect(resolveDepositAmount(state({ mode: 'FLAT', flatAmount: '12000' }), 0)).toBe(12000);
  });

  it('tolerates formatted input rather than producing NaN', () => {
    expect(resolveDepositAmount(state({ mode: 'FLAT', flatAmount: '₹12,000' }), 8000)).toBe(12000);
    expect(resolveDepositAmount(state({ mode: 'MONTHS', months: '2' }), '₹8,000')).toBe(16000);
  });

  it('rounds a fractional month to a whole rupee amount', () => {
    expect(resolveDepositAmount(state({ mode: 'MONTHS', months: '1.5' }), 7500)).toBe(11250);
  });

  it('returns 0 rather than NaN when the rent is not set yet', () => {
    expect(resolveDepositAmount(state({ mode: 'MONTHS', months: '2' }), '')).toBe(0);
  });
});

describe('validateDeposit', () => {
  it('accepts "no deposit" with nothing else filled in', () => {
    expect(validateDeposit(state({ takesDeposit: false }), '')).toBeNull();
  });

  it('requires a value in whichever mode is active', () => {
    expect(validateDeposit(state({ mode: 'MONTHS', months: '' }), 8000)).not.toBeNull();
    expect(validateDeposit(state({ mode: 'FLAT', flatAmount: '' }), 8000)).not.toBeNull();
  });

  it('rejects zero, negative and non-numeric answers', () => {
    expect(validateDeposit(state({ mode: 'MONTHS', months: '0' }), 8000)).not.toBeNull();
    expect(validateDeposit(state({ mode: 'FLAT', flatAmount: '0' }), 8000)).not.toBeNull();
    expect(validateDeposit(state({ mode: 'MONTHS', months: 'two' }), 8000)).not.toBeNull();
  });

  it('rejects an implausible number of months as a likely typo', () => {
    expect(validateDeposit(state({ mode: 'MONTHS', months: '24' }), 8000)).toMatch(/12 months/);
  });

  // Months mode is meaningless without a rent to multiply, and silently
  // storing 0 would be worse than saying so.
  it('explains that months mode needs a rent first', () => {
    expect(validateDeposit(state({ mode: 'MONTHS', months: '2' }), '')).toMatch(/monthly rent/i);
  });

  it('accepts valid answers in both modes', () => {
    expect(validateDeposit(state({ mode: 'MONTHS', months: '2' }), 8000)).toBeNull();
    expect(validateDeposit(state({ mode: 'FLAT', flatAmount: '15000' }), 8000)).toBeNull();
  });
});

describe('describeDeposit', () => {
  it('states plainly when nothing is taken', () => {
    expect(describeDeposit(state({ takesDeposit: false }), 8000)).toMatch(/no security deposit/i);
  });

  it('shows the resolved rupee figure for months, so the owner sees the real number', () => {
    expect(describeDeposit(state({ mode: 'MONTHS', months: '2' }), 8000)).toContain('₹16,000');
  });

  it('uses Indian digit grouping', () => {
    expect(describeDeposit(state({ mode: 'FLAT', flatAmount: '150000' }), 8000)).toContain('₹1,50,000');
  });

  it('singularises one month', () => {
    expect(describeDeposit(state({ mode: 'MONTHS', months: '1' }), 8000)).toContain('1 month ');
  });

  it('says nothing rather than something wrong while the answer is incomplete', () => {
    expect(describeDeposit(state({ mode: 'FLAT', flatAmount: '' }), 8000)).toBe('');
  });
});
