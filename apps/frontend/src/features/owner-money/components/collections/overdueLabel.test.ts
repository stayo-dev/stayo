import { describe, it, expect } from 'vitest';
import { overdueBadgeLabel } from './overdueLabel';

/**
 * The regression this file exists for: the Action queue showed every overdue
 * tenant as "1590d overdue" — 53 real days multiplied by 30, because the value
 * travelled through a field called `overdueMonths`. Three tenants sharing one
 * due date made the wrong number look frozen rather than merely wrong.
 */
describe('overdueBadgeLabel', () => {
  it('reports the days it was given, unconverted', () => {
    // 53 days is 53 days. The ×30 that produced "1590d" was never needed:
    // the API sends days since the oldest unpaid due date.
    expect(overdueBadgeLabel(53)).toBe('53d overdue');
    expect(overdueBadgeLabel(17)).toBe('17d overdue');
  });

  it('never multiplies a month-sized number into a year-sized one', () => {
    // The guard on the actual defect: a plausible overdue count must stay
    // plausible. 52 days is under two months, not four and a half years.
    const label = overdueBadgeLabel(52);
    expect(label).toBe('52d overdue');
    expect(label).not.toContain('1560');
  });

  it('handles a single day without pretending it is thirty', () => {
    expect(overdueBadgeLabel(1)).toBe('1d overdue');
  });

  it('shows nothing alarming for a tenant who is not actually late', () => {
    expect(overdueBadgeLabel(0)).toBe('0d overdue');
    expect(overdueBadgeLabel(-4)).toBe('0d overdue');
  });

  it('never prints a fraction of a day', () => {
    expect(overdueBadgeLabel(52.7)).toBe('52d overdue');
  });

  it('survives a missing value rather than rendering NaN', () => {
    expect(overdueBadgeLabel(undefined as unknown as number)).toBe('0d overdue');
    expect(overdueBadgeLabel(NaN)).toBe('0d overdue');
  });
});
