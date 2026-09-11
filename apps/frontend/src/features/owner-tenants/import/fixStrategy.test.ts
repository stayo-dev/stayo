import { describe, expect, it } from 'vitest';
import { planFixes } from './fixStrategy';
import { buildReviewQueue } from './reviewQueue';

const issue = (row: number) => ({
  code: 'PHONE_INVALID',
  severity: 'BLOCKER' as const,
  row,
  title: 't',
  detail: 'd',
  field: 'phone',
  fix: { kind: 'EDIT_FIELD' },
});

const clean = (n: number) => ({ row: n, data: { name: `T${n}` }, issues: [] });
const broken = (n: number) => ({ row: n, data: { name: `T${n}` }, issues: [issue(n)] });

const queue = (brokenCount: number, cleanCount: number) =>
  buildReviewQueue({
    valid: Array.from({ length: cleanCount }, (_, i) => clean(100 + i)),
    invalid: Array.from({ length: brokenCount }, (_, i) => broken(2 + i)),
    duplicates: [],
  });

describe('a handful of problems', () => {
  it('is quicker to fix on screen', () => {
    expect(planFixes(queue(3, 40)).strategy).toBe('IN_SCREEN');
  });

  it('says so in the owner\'s terms', () => {
    const plan = planFixes(queue(3, 40));
    expect(plan.title).toBe('3 rows need a change');
    expect(plan.reason).toContain('quicker than opening the sheet');
  });

  it('speaks of one row as one row', () => {
    expect(planFixes(queue(1, 40)).title).toBe('One row needs a change');
  });

  it('has nothing to say about a clean import', () => {
    const plan = planFixes(queue(0, 40));
    expect(plan.rows).toBe(0);
    expect(plan.strategy).toBe('IN_SCREEN');
  });
});

describe('a lot of problems', () => {
  it('sends the owner back to the spreadsheet', () => {
    // Forty separate web interactions with no fill-down is worse than Excel.
    expect(planFixes(queue(40, 100)).strategy).toBe('IN_SHEET');
  });

  it('explains why, rather than just changing the buttons', () => {
    expect(planFixes(queue(40, 100)).reason).toContain('marked in colour');
  });

  it('switches when most of a small file is wrong', () => {
    // 5 of 8 rows: few in number, but the sheet is mostly broken.
    expect(planFixes(queue(5, 3)).strategy).toBe('IN_SHEET');
  });

  it('does not switch for two bad rows in a tiny file', () => {
    // Two is two, whatever the share — opening Excel for that is silly.
    expect(planFixes(queue(2, 1)).strategy).toBe('IN_SCREEN');
  });

  it('does not switch for a handful in a big file', () => {
    expect(planFixes(queue(6, 140)).strategy).toBe('IN_SCREEN');
  });
});
