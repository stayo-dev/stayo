import { describe, it, expect } from 'vitest';
import {
  periodRange,
  methodLabel,
  compactRupees,
  coversSummary,
  coverLines,
  dayLabel,
  groupByDay,
  recordedLine,
  initials,
  summaryLine,
  emptyMessage,
  type ReceivedCover,
  type ReceivedPayment,
} from './received';

// 7 Oct 2026, 10:30 local.
const NOW = new Date(2026, 9, 7, 10, 30);

const rent = (month: string, extra: Partial<ReceivedCover> = {}): ReceivedCover => ({
  type: 'RENT',
  month,
  label: null,
  amount: 7000,
  reversed: false,
  ...extra,
});

function payment(over: Partial<ReceivedPayment> = {}): ReceivedPayment {
  return {
    id: 'p1',
    tenantId: 't1',
    tenantName: 'Harsha',
    room: '204',
    hostelId: 'h1',
    hostelName: 'Sri Adithya Boys Hostel',
    method: 'CASH',
    reference: null,
    paidOn: '2026-10-07',
    recordedAt: new Date(2026, 9, 7, 9, 5).toISOString(),
    amount: 7000,
    reversedAmount: 0,
    covers: [rent('2026-10')],
    ...over,
  };
}

describe('periodRange', () => {
  it('uses local calendar days', () => {
    expect(periodRange('today', NOW)).toEqual({ from: '2026-10-07', to: '2026-10-07' });
    expect(periodRange('week', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(periodRange('month', NOW)).toEqual({ from: '2026-10-01', to: '2026-10-07' });
    expect(periodRange('last_month', NOW)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
    expect(periodRange('all', NOW)).toEqual({ from: null, to: null });
  });

  it('crosses the year boundary for last month in January', () => {
    expect(periodRange('last_month', new Date(2027, 0, 15))).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });
});

describe('labels', () => {
  it('names methods the way an owner says them', () => {
    expect(methodLabel('BANK_TRANSFER')).toBe('Bank');
    expect(methodLabel('cash')).toBe('Cash');
    expect(methodLabel('NEFT_IMPS')).toBe('Neft imps');
  });

  it('compacts amounts without ever rounding up', () => {
    expect(compactRupees(900)).toBe('₹900');
    expect(compactRupees(45_560)).toBe('₹45.5k');
    expect(compactRupees(120_000)).toBe('₹1.2L');
    expect(compactRupees(199_999)).toBe('₹1.9L');
    expect(compactRupees(300_000)).toBe('₹3L');
  });

  it('builds initials', () => {
    expect(initials('B Avinash Kumar')).toBe('BK');
    expect(initials('Harsha')).toBe('HA');
    expect(initials('  ')).toBe('?');
  });

  it('summarises counts and reversals', () => {
    expect(summaryLine({ count: 1, total: 7000, reversedCount: 0 })).toBe('1 payment');
    expect(summaryLine({ count: 14, total: 1, reversedCount: 2 })).toBe('14 payments · 2 reversed');
  });

  it('says why the list is empty', () => {
    expect(emptyMessage('month', false)).toBe('No rent received this month.');
    expect(emptyMessage('all', false)).toBe('No rent recorded yet.');
    expect(emptyMessage('today', true)).toMatch(/search or method/);
  });
});

describe('coversSummary', () => {
  it('names one, two, and a run of months', () => {
    expect(coversSummary([rent('2026-10')], '2026-10-07')).toBe('Oct rent');
    expect(coversSummary([rent('2026-10'), rent('2026-09')], '2026-10-07')).toBe('Sep + Oct rent');
    expect(coversSummary([rent('2026-07'), rent('2026-08'), rent('2026-09'), rent('2026-10')], '2026-10-07')).toBe(
      'Jul – Oct rent',
    );
    expect(coversSummary([rent('2026-05'), rent('2026-08'), rent('2026-10')], '2026-10-07')).toBe("3 months' rent");
  });

  it('marks months from another year', () => {
    expect(coversSummary([rent('2025-12'), rent('2026-01')], '2026-01-04')).toBe("Dec '25 + Jan rent");
  });

  it('adds one-off charges and installment labels after rent', () => {
    const covers: ReceivedCover[] = [
      rent('2026-10'),
      { type: 'SECURITY_DEPOSIT', month: null, label: null, amount: 5000, reversed: false },
      { type: 'RENT', month: '2026-10', label: 'Installment 2', amount: 1000, reversed: false },
    ];
    expect(coversSummary(covers, '2026-10-07')).toBe('Oct rent, Deposit, Installment 2');
  });

  it('leaves out reversed parts', () => {
    expect(coversSummary([rent('2026-09', { reversed: true }), rent('2026-10')], '2026-10-07')).toBe('Oct rent');
  });

  it('lists every part, reversed included, for the expanded row', () => {
    expect(coverLines([rent('2026-09', { reversed: true }), rent('2026-10')], '2026-10-07')).toEqual([
      { label: 'Sep rent', amount: 7000, reversed: true },
      { label: 'Oct rent', amount: 7000, reversed: false },
    ]);
  });
});

describe('days', () => {
  it('labels today, yesterday, and older days', () => {
    expect(dayLabel('2026-10-07', NOW)).toBe('Today');
    expect(dayLabel('2026-10-06', NOW)).toBe('Yesterday');
    expect(dayLabel('2026-10-05', NOW)).toBe('Mon, 5 Oct');
    expect(dayLabel('2025-12-31', NOW)).toBe('Wed, 31 Dec 2025');
  });

  it('groups consecutive rows by day with a running total', () => {
    const days = groupByDay(
      [
        payment({ id: 'a', amount: 7000 }),
        payment({ id: 'b', amount: 16000 }),
        payment({ id: 'c', paidOn: '2026-10-05', amount: 5000 }),
      ],
      NOW,
    );
    expect(days.map((d) => [d.label, d.total, d.payments.length])).toEqual([
      ['Today', 23000, 2],
      ['Mon, 5 Oct', 5000, 1],
    ]);
  });

  it('shows only the time when recorded the day it was paid, the date as well when back-dated', () => {
    expect(recordedLine(payment(), NOW)).toBe('9:05 am');
    expect(recordedLine(payment({ paidOn: '2026-10-01' }), NOW)).toBe('Today, 9:05 am');
  });
});
