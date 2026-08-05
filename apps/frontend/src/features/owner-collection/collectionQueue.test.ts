import { describe, expect, it } from 'vitest';
import {
  formatINR,
  relativeDay,
  lastPaymentLabel,
  lastReminderLabel,
  urgencyLabel,
  locationLabel,
  topReasons,
  whatsAppNumber,
  queueViewState,
  type CollectionQueueRow,
  type CollectionQueue,
} from './collectionQueue';

const TODAY = new Date('2026-08-05T10:00:00Z');
const isoDaysAgo = (n: number) => new Date(Date.UTC(2026, 7, 5 - n)).toISOString();

function row(overrides: Partial<CollectionQueueRow> = {}): CollectionQueueRow {
  return {
    tenantId: 't1',
    tenantName: 'Rahul Sharma',
    phone: '9876543210',
    hostelId: 'h1',
    hostelName: 'MG Road',
    room: '203',
    outstanding: 8000,
    daysOverdue: 12,
    daysUntilDue: null,
    lastPaymentAt: isoDaysAgo(40),
    lastPaymentAmount: 8000,
    lastReminderAt: isoDaysAgo(1),
    reminderCount: 2,
    previousLatePayments: 1,
    bucket: 'NEEDS_ATTENTION',
    score: 47,
    factors: [
      { id: 'overdue', label: '12 days overdue', points: 24 },
      { id: 'amount', label: '₹8,000 outstanding', points: 8 },
      { id: 'repeat', label: 'Paid late 1 time before', points: 10 },
    ],
    recommendation: null,
    ...overrides,
  };
}

describe('formatINR', () => {
  it('uses Indian grouping', () => {
    expect(formatINR(132600)).toBe('₹1,32,600');
  });
});

describe('relativeDay', () => {
  it('describes the gap, not the date', () => {
    expect(relativeDay(isoDaysAgo(0), TODAY)).toBe('today');
    expect(relativeDay(isoDaysAgo(1), TODAY)).toBe('yesterday');
    expect(relativeDay(isoDaysAgo(5), TODAY)).toBe('5 days ago');
  });

  it('collapses long gaps into months', () => {
    expect(relativeDay(isoDaysAgo(35), TODAY)).toBe('a month ago');
    expect(relativeDay(isoDaysAgo(70), TODAY)).toBe('2 months ago');
  });

  it('handles a future date without saying "-3 days ago"', () => {
    expect(relativeDay(new Date(Date.UTC(2026, 7, 10)).toISOString(), TODAY)).toBe('scheduled');
  });

  it('returns null for missing or unparseable input', () => {
    expect(relativeDay(null, TODAY)).toBeNull();
    expect(relativeDay('not-a-date', TODAY)).toBeNull();
  });
});

describe('lastPaymentLabel', () => {
  it('reads naturally', () => {
    expect(lastPaymentLabel(row({ lastPaymentAt: isoDaysAgo(3) }), TODAY)).toBe('Last paid 3 days ago');
  });

  it('says "Never paid" rather than an empty gap', () => {
    expect(lastPaymentLabel(row({ lastPaymentAt: null }), TODAY)).toBe('Never paid');
  });
});

describe('lastReminderLabel', () => {
  it('reads naturally', () => {
    expect(lastReminderLabel(row({ lastReminderAt: isoDaysAgo(1) }), TODAY)).toBe('Reminded yesterday');
  });

  it('is explicit when nothing has been sent', () => {
    expect(lastReminderLabel(row({ lastReminderAt: null }), TODAY)).toBe('No reminder sent');
  });
});

describe('urgencyLabel', () => {
  it('leads with overdue when the tenant is late', () => {
    expect(urgencyLabel(row({ daysOverdue: 12 }))).toBe('12 days overdue');
  });

  it('singularises one day', () => {
    expect(urgencyLabel(row({ daysOverdue: 1 }))).toBe('1 day overdue');
  });

  it('prefers overdue over a due date when both are present', () => {
    expect(urgencyLabel(row({ daysOverdue: 4, daysUntilDue: 2 }))).toBe('4 days overdue');
  });

  it('says due today', () => {
    expect(urgencyLabel(row({ daysOverdue: 0, daysUntilDue: 0 }))).toBe('Due today');
  });

  it('counts down to a future due date', () => {
    expect(urgencyLabel(row({ daysOverdue: 0, daysUntilDue: 3 }))).toBe('Due in 3 days');
    expect(urgencyLabel(row({ daysOverdue: 0, daysUntilDue: 1 }))).toBe('Due in 1 day');
  });

  it('falls back to a neutral word when there is no date at all', () => {
    expect(urgencyLabel(row({ daysOverdue: 0, daysUntilDue: null }))).toBe('Outstanding');
  });
});

describe('locationLabel', () => {
  it('combines room and hostel', () => {
    expect(locationLabel(row())).toBe('Room 203 · MG Road');
  });

  it('omits the room cleanly when unallocated', () => {
    expect(locationLabel(row({ room: '' }))).toBe('MG Road');
  });
});

describe('topReasons — the queue must explain itself', () => {
  it('shows the highest-scoring reasons first', () => {
    expect(topReasons(row())).toEqual(['12 days overdue', 'Paid late 1 time before']);
  });

  it('caps how many are shown on a scannable row', () => {
    expect(topReasons(row(), 1)).toEqual(['12 days overdue']);
    expect(topReasons(row(), 5)).toHaveLength(3);
  });

  it('handles a row with no factors', () => {
    expect(topReasons(row({ factors: [] }))).toEqual([]);
  });

  it('does not mutate the factor order on the row', () => {
    const r = row();
    topReasons(r);
    expect(r.factors[0].id).toBe('overdue');
  });
});

describe('whatsAppNumber', () => {
  it('prefixes a bare Indian number and preserves a prefixed one', () => {
    expect(whatsAppNumber('9876543210')).toBe('919876543210');
    expect(whatsAppNumber('+91 98765 43210')).toBe('919876543210');
  });

  it('refuses to guess an unknown country code', () => {
    expect(whatsAppNumber('447700900000')).toBeNull();
    expect(whatsAppNumber(null)).toBeNull();
  });
});

describe('queueViewState', () => {
  const queue = (totalTenants: number): CollectionQueue => ({
    groups: [],
    totalTenants,
    totalOutstanding: 0,
    generatedAt: TODAY.toISOString(),
  });

  it('shows the queue when there is work', () => {
    expect(queueViewState({ isLoading: false, isError: false, queue: queue(3) })).toBe('ready');
  });

  it('celebrates an empty queue rather than showing a blank list', () => {
    expect(queueViewState({ isLoading: false, isError: false, queue: queue(0) })).toBe('all-clear');
  });

  it('never flashes "all clear" while loading', () => {
    expect(queueViewState({ isLoading: true, isError: false, queue: undefined })).toBe('loading');
    expect(queueViewState({ isLoading: true, isError: false, queue: queue(0) })).toBe('loading');
  });

  it('surfaces errors instead of pretending there is no work', () => {
    expect(queueViewState({ isLoading: false, isError: true, queue: undefined })).toBe('error');
  });
});
