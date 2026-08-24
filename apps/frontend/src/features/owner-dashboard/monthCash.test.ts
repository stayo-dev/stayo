import { describe, it, expect } from 'vitest';
import { leftLabel, monthCash } from './monthCash';

describe('monthCash — an ordinary month', () => {
  it('reports in, out and what is left', () => {
    const cash = monthCash({ collected: 16000, spent: 4200, target: 57000 });
    expect(cash.collected).toBe(16000);
    expect(cash.spent).toBe(4200);
    expect(cash.left).toBe(11800);
    expect(cash.overspent).toBe(false);
  });

  it('reports collection against the month bill, not against spending', () => {
    expect(monthCash({ collected: 16000, spent: 4200, target: 57000 }).collectedPct).toBe(28);
  });

  it('reports how much of what came in has gone out', () => {
    expect(monthCash({ collected: 10000, spent: 2500, target: 40000 }).spentShareOfCollected).toBe(25);
  });

  it('rounds percentages rather than showing fractions', () => {
    const cash = monthCash({ collected: 3333, spent: 1111, target: 10000 });
    expect(Number.isInteger(cash.collectedPct)).toBe(true);
    expect(Number.isInteger(cash.spentShareOfCollected)).toBe(true);
  });
});

// A deposit refunded or a roof repaired. Not an error state.
describe('monthCash — spending more than came in', () => {
  it('reports the shortfall rather than clamping it to zero', () => {
    const cash = monthCash({ collected: 5000, spent: 7300, target: 40000 });
    expect(cash.left).toBe(-2300);
    expect(cash.overspent).toBe(true);
  });

  it('fills the bar rather than running past it', () => {
    expect(monthCash({ collected: 5000, spent: 7300, target: 40000 }).spentShareOfCollected).toBe(100);
  });

  it('says overspent instead of "Left −₹2,300", which reads as a bug', () => {
    expect(leftLabel(monthCash({ collected: 5000, spent: 7300, target: 40000 }))).toBe('Overspent by');
    expect(leftLabel(monthCash({ collected: 9000, spent: 1000, target: 40000 }))).toBe('Left');
  });

  it('treats spending with nothing collected as fully spent, not as a divide by zero', () => {
    const cash = monthCash({ collected: 0, spent: 4000, target: 40000 });
    expect(cash.spentShareOfCollected).toBe(100);
    expect(cash.left).toBe(-4000);
    expect(cash.overspent).toBe(true);
  });
});

describe('monthCash — edges that would otherwise render wrong', () => {
  it('handles a month with nothing billed yet', () => {
    const cash = monthCash({ collected: 0, spent: 0, target: 0 });
    expect(cash.collectedPct).toBe(0);
    expect(cash.spentShareOfCollected).toBe(0);
    expect(cash.overspent).toBe(false);
  });

  it('caps collection at 100% when more was collected than billed', () => {
    // Arrears paid off in a later month legitimately produce this.
    expect(monthCash({ collected: 80000, spent: 0, target: 57000 }).collectedPct).toBe(100);
  });

  it('still reports the real amounts when the percentage is capped', () => {
    expect(monthCash({ collected: 80000, spent: 0, target: 57000 }).collected).toBe(80000);
  });

  it('treats a negative input as zero rather than rendering a bar backwards', () => {
    const cash = monthCash({ collected: -500, spent: -200, target: -1 });
    expect(cash.collected).toBe(0);
    expect(cash.spent).toBe(0);
    expect(cash.collectedPct).toBe(0);
  });

  it('survives missing or unparseable numbers', () => {
    const cash = monthCash({ collected: undefined as any, spent: 'x' as any, target: null as any });
    expect(cash.collected).toBe(0);
    expect(cash.spent).toBe(0);
    expect(cash.left).toBe(0);
    expect(cash.overspent).toBe(false);
  });

  it('survives being handed nothing at all', () => {
    expect(() => monthCash(undefined as any)).not.toThrow();
    expect(monthCash(undefined as any).left).toBe(0);
  });
});
