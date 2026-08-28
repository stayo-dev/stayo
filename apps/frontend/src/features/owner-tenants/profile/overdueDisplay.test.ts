import { describe, expect, it } from 'vitest';
import { nextPaymentDue, toOverdueDisplay } from './overdueDisplay';

/**
 * The OVERDUE tile.
 *
 * It used to render `overdue_amount > 0 ? 1 : 0` under the word "days" — a
 * boolean wearing a unit, so a tenant three months late and a tenant one day
 * late both read "1 days", and everyone else read "0 days". Days overdue comes
 * from the oldest unpaid obligation's due date or it isn't shown at all.
 */

const TODAY = '2026-08-26T00:00:00.000Z';

function obligation(overrides: Record<string, unknown> = {}) {
  return { due_date: '2026-08-15', status: 'PENDING', ...overrides };
}

describe('toOverdueDisplay', () => {
  it('counts days from the oldest unpaid obligation still due', () => {
    const result = toOverdueDisplay({
      overdueAmount: 8000,
      outstanding: 8000,
      obligations: [obligation({ due_date: '2026-08-15' })],
      today: TODAY,
    });
    expect(result.days).toBe(11);
  });

  it('uses the oldest obligation when several are unpaid', () => {
    const result = toOverdueDisplay({
      overdueAmount: 16000,
      outstanding: 16000,
      obligations: [
        obligation({ due_date: '2026-08-15' }),
        obligation({ due_date: '2026-06-05' }),
        obligation({ due_date: '2026-07-10' }),
      ],
      today: TODAY,
    });
    expect(result.days).toBe(82);
  });

  it('ignores paid obligations when finding the oldest', () => {
    const result = toOverdueDisplay({
      overdueAmount: 8000,
      outstanding: 8000,
      obligations: [
        obligation({ due_date: '2026-01-01', status: 'PAID' }),
        obligation({ due_date: '2026-08-15' }),
      ],
      today: TODAY,
    });
    expect(result.days).toBe(11);
  });

  it('ignores obligations not yet due when counting days overdue', () => {
    const result = toOverdueDisplay({
      overdueAmount: 8000,
      outstanding: 8000,
      obligations: [
        obligation({ due_date: '2026-08-15' }),
        obligation({ due_date: '2026-09-15' }),
      ],
      today: TODAY,
    });
    expect(result.days).toBe(11);
  });

  it('reads as needing follow-up while anything is overdue', () => {
    const result = toOverdueDisplay({
      overdueAmount: 8000,
      outstanding: 8000,
      obligations: [obligation()],
      today: TODAY,
    });
    expect(result.tone).toBe('destructive');
    expect(result.label).toBe('Needs follow-up');
  });

  it('shows no day count when nothing is overdue', () => {
    const result = toOverdueDisplay({
      overdueAmount: 0,
      outstanding: 0,
      obligations: [],
      today: TODAY,
    });
    expect(result.days).toBeNull();
    expect(result.tone).toBe('success');
    expect(result.label).toBe('Paid on time');
  });

  it('distinguishes pending-but-not-yet-overdue from overdue', () => {
    const result = toOverdueDisplay({
      overdueAmount: 0,
      outstanding: 8000,
      obligations: [obligation({ due_date: '2026-09-15' })],
      today: TODAY,
    });
    expect(result.days).toBeNull();
    expect(result.tone).toBe('warning');
    expect(result.label).toBe('Not yet due');
  });

  it('reports the overdue amount as overdue even when due dates are unusable', () => {
    const result = toOverdueDisplay({
      overdueAmount: 8000,
      outstanding: 8000,
      obligations: [obligation({ due_date: 'not-a-date' })],
      today: TODAY,
    });
    expect(result.days).toBeNull();
    expect(result.tone).toBe('destructive');
    expect(result.label).toBe('Needs follow-up');
  });

  it('counts a payment due today as not yet overdue', () => {
    const result = toOverdueDisplay({
      overdueAmount: 0,
      outstanding: 8000,
      obligations: [obligation({ due_date: '2026-08-26' })],
      today: TODAY,
    });
    expect(result.days).toBeNull();
    expect(result.label).toBe('Not yet due');
  });

  it('never reports negative days', () => {
    const result = toOverdueDisplay({
      overdueAmount: 8000,
      outstanding: 8000,
      obligations: [obligation({ due_date: '2027-01-01' })],
      today: TODAY,
    });
    expect(result.days).toBeNull();
  });

  it('treats a missing obligation list as no day count rather than throwing', () => {
    const result = toOverdueDisplay({
      overdueAmount: 8000,
      outstanding: 8000,
      obligations: undefined,
      today: TODAY,
    });
    expect(result.days).toBeNull();
    expect(result.tone).toBe('destructive');
  });

  it('phrases a single day in the singular', () => {
    const result = toOverdueDisplay({
      overdueAmount: 8000,
      outstanding: 8000,
      obligations: [obligation({ due_date: '2026-08-25' })],
      today: TODAY,
    });
    expect(result.days).toBe(1);
    expect(result.unit).toBe('day');
  });

  it('phrases several days in the plural', () => {
    const result = toOverdueDisplay({
      overdueAmount: 8000,
      outstanding: 8000,
      obligations: [obligation({ due_date: '2026-08-24' })],
      today: TODAY,
    });
    expect(result.days).toBe(2);
    expect(result.unit).toBe('days');
  });
});

describe('nextPaymentDue', () => {
  it('finds the soonest unpaid charge', () => {
    const result = nextPaymentDue(
      [
        { due_date: '2026-10-05', status: 'PENDING' },
        { due_date: '2026-09-05', status: 'PENDING' },
      ],
      TODAY,
    );
    expect(result.dueDate).toBe('2026-09-05');
  });

  it('ignores charges that are already settled', () => {
    const result = nextPaymentDue(
      [
        { due_date: '2026-08-27', status: 'PAID' },
        { due_date: '2026-09-05', status: 'PENDING' },
      ],
      TODAY,
    );
    expect(result.dueDate).toBe('2026-09-05');
  });

  it('counts down to a future charge', () => {
    const result = nextPaymentDue([{ due_date: '2026-08-30', status: 'PENDING' }], TODAY);
    expect(result.daysAway).toBe(4);
    expect(result.label).toBe('in 4 days');
  });

  it('says today rather than "in 0 days"', () => {
    const result = nextPaymentDue([{ due_date: '2026-08-26', status: 'PENDING' }], TODAY);
    expect(result.label).toBe('Due today');
  });

  it('reads an overdue charge as late, not as a countdown', () => {
    const result = nextPaymentDue([{ due_date: '2026-08-17', status: 'PENDING' }], TODAY);
    expect(result.daysAway).toBe(-9);
    expect(result.isOverdue).toBe(true);
    expect(result.label).toBe('9 days late');
  });

  it('prefers the overdue one when something is both late and upcoming', () => {
    const result = nextPaymentDue(
      [
        { due_date: '2026-09-05', status: 'PENDING' },
        { due_date: '2026-08-17', status: 'PENDING' },
      ],
      TODAY,
    );
    expect(result.isOverdue).toBe(true);
  });

  it('says so plainly when nothing is owed', () => {
    const result = nextPaymentDue([], TODAY);
    expect(result.dueDate).toBeNull();
    expect(result.label).toBe('Nothing due');
  });

  it('phrases a single day in the singular', () => {
    expect(nextPaymentDue([{ due_date: '2026-08-27', status: 'PENDING' }], TODAY).label).toBe('in 1 day');
    expect(nextPaymentDue([{ due_date: '2026-08-25', status: 'PENDING' }], TODAY).label).toBe('1 day late');
  });

  it('skips a charge with an unusable date rather than throwing', () => {
    const result = nextPaymentDue(
      [
        { due_date: 'not-a-date', status: 'PENDING' },
        { due_date: '2026-09-05', status: 'PENDING' },
      ],
      TODAY,
    );
    expect(result.dueDate).toBe('2026-09-05');
  });
});
