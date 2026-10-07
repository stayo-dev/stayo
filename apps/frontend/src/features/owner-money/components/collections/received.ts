/**
 * Money → Collections → Received: every wording and grouping decision.
 *
 * "Where can I see who paid?" — the screen answers it newest-first, grouped by
 * day, one row per collection, each saying which months it paid for. Pure, no
 * React; the components only render what this returns.
 */

export type ReceivedCover = {
  type: string;
  /** YYYY-MM, or null for a one-off charge. */
  month: string | null;
  label: string | null;
  amount: number;
  reversed: boolean;
};

export type ReceivedPayment = {
  id: string;
  tenantId: string;
  tenantName: string;
  room: string | null;
  hostelId: string;
  hostelName: string;
  method: string;
  reference: string | null;
  /** YYYY-MM-DD — the day the money changed hands. */
  paidOn: string;
  /** ISO — when it was entered into Stayo. */
  recordedAt: string;
  amount: number;
  reversedAmount: number;
  covers: ReceivedCover[];
};

export type ReceivedSummary = { count: number; total: number; reversedCount: number };

export type ReceivedPeriod = 'today' | 'week' | 'month' | 'last_month' | 'all';

export const PERIOD_OPTIONS: { id: ReceivedPeriod; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'week', label: 'Last 7 days' },
  { id: 'month', label: 'This month' },
  { id: 'last_month', label: 'Last month' },
  { id: 'all', label: 'All time' },
];

export type ReceivedMethodFilter = 'all' | 'CASH' | 'UPI' | 'BANK_TRANSFER' | 'ONLINE' | 'CHEQUE';

export const METHOD_OPTIONS: { id: ReceivedMethodFilter; label: string }[] = [
  { id: 'all', label: 'Any method' },
  { id: 'CASH', label: 'Cash' },
  { id: 'UPI', label: 'UPI' },
  { id: 'BANK_TRANSFER', label: 'Bank' },
  { id: 'ONLINE', label: 'Online' },
  { id: 'CHEQUE', label: 'Cheque' },
];

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** The owner's local calendar day, YYYY-MM-DD. */
export function localDay(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * The dates a period chip asks the server for. Calendar days in the owner's own
 * timezone — "today" is his today, not UTC's, which in India differs until
 * 5:30 am.
 */
export function periodRange(period: ReceivedPeriod, now: Date = new Date()): { from: string | null; to: string | null } {
  const y = now.getFullYear();
  const m = now.getMonth();
  const today = localDay(now);
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'week':
      return { from: localDay(new Date(y, m, now.getDate() - 6)), to: today };
    case 'month':
      return { from: localDay(new Date(y, m, 1)), to: today };
    case 'last_month':
      return { from: localDay(new Date(y, m - 1, 1)), to: localDay(new Date(y, m, 0)) };
    case 'all':
      return { from: null, to: null };
  }
}

/** Finishes "₹X received …" and the empty state. */
export function periodPhrase(period: ReceivedPeriod): string {
  return {
    today: 'today',
    week: 'in the last 7 days',
    month: 'this month',
    last_month: 'last month',
    all: 'so far',
  }[period];
}

export function methodLabel(method: string): string {
  const known: Record<string, string> = {
    CASH: 'Cash',
    UPI: 'UPI',
    BANK_TRANSFER: 'Bank',
    ONLINE: 'Online',
    CHEQUE: 'Cheque',
    OTHER: 'Other',
  };
  const key = method.toUpperCase();
  if (known[key]) return known[key];
  const words = key.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function formatRupees(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/** Short enough for a tab label: ₹900, ₹45.5k, ₹1.2L. */
export function compactRupees(amount: number): string {
  const a = Math.round(amount);
  if (a >= 100_000) return `₹${trim1(a / 100_000)}L`;
  if (a >= 1_000) return `₹${trim1(a / 1_000)}k`;
  return `₹${a}`;
}

function trim1(n: number): string {
  // Round down so a tab never claims more than was received.
  const v = Math.floor(n * 10) / 10;
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function monthName(ym: string, paidYear: number): string {
  const [y, m] = ym.split('-').map(Number);
  const name = MONTHS[m - 1] ?? ym;
  return y === paidYear ? name : `${name} '${String(y).slice(2)}`;
}

function monthIndex(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return y * 12 + (m - 1);
}

const ONE_OFF: Record<string, string> = {
  SECURITY_DEPOSIT: 'Deposit',
  DEPOSIT: 'Deposit',
  ADVANCE: 'Advance',
  LATE_FEE: 'Late fee',
  ELECTRICITY: 'Electricity',
  MAINTENANCE: 'Maintenance',
};

function coverName(c: ReceivedCover): string {
  if (c.label) return c.label;
  if (ONE_OFF[c.type]) return ONE_OFF[c.type];
  const words = c.type.toLowerCase().replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * What a collection paid for, in one short line: "Oct rent", "Sep + Oct rent",
 * "Jul – Oct rent", "Oct rent, Deposit". Reversed parts are left out — they
 * were not, in the end, paid.
 */
export function coversSummary(covers: ReceivedCover[], paidOn: string): string {
  const live = covers.filter((c) => !c.reversed);
  const paidYear = Number(paidOn.slice(0, 4));
  const rentMonths = [
    ...new Set(live.filter((c) => c.type === 'RENT' && c.month && !c.label).map((c) => c.month as string)),
  ].sort();
  const others = [
    ...new Set(live.filter((c) => !(c.type === 'RENT' && c.month && !c.label)).map(coverName)),
  ];

  const parts: string[] = [];
  if (rentMonths.length === 1) {
    parts.push(`${monthName(rentMonths[0], paidYear)} rent`);
  } else if (rentMonths.length === 2) {
    parts.push(`${monthName(rentMonths[0], paidYear)} + ${monthName(rentMonths[1], paidYear)} rent`);
  } else if (rentMonths.length > 2) {
    const first = rentMonths[0];
    const last = rentMonths[rentMonths.length - 1];
    const contiguous = monthIndex(last) - monthIndex(first) === rentMonths.length - 1;
    parts.push(
      contiguous
        ? `${monthName(first, paidYear)} – ${monthName(last, paidYear)} rent`
        : `${rentMonths.length} months' rent`,
    );
  }
  parts.push(...others);
  return parts.join(', ');
}

/** One line per thing paid for, oldest first — the expanded row. */
export function coverLines(covers: ReceivedCover[], paidOn: string): { label: string; amount: number; reversed: boolean }[] {
  const paidYear = Number(paidOn.slice(0, 4));
  return covers.map((c) => ({
    label: c.type === 'RENT' && c.month && !c.label ? `${monthName(c.month, paidYear)} rent` : coverName(c),
    amount: c.amount,
    reversed: c.reversed,
  }));
}

/** "Today", "Yesterday", "Mon, 5 Oct", or "Mon, 5 Oct 2025" for another year. */
export function dayLabel(day: string, now: Date = new Date()): string {
  const today = localDay(now);
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1));
  if (day === today) return 'Today';
  if (day === yesterday) return 'Yesterday';
  const [y, m, d] = day.split('-').map(Number);
  const weekday = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  const base = `${weekday}, ${d} ${MONTHS[m - 1]}`;
  return y === now.getFullYear() ? base : `${base} ${y}`;
}

export type ReceivedDay = { day: string; label: string; total: number; payments: ReceivedPayment[] };

/** Consecutive rows that share a day, in the order the server sent them. */
export function groupByDay(payments: ReceivedPayment[], now: Date = new Date()): ReceivedDay[] {
  const out: ReceivedDay[] = [];
  for (const p of payments) {
    const last = out[out.length - 1];
    if (last && last.day === p.paidOn) {
      last.payments.push(p);
      last.total += p.amount;
    } else {
      out.push({ day: p.paidOn, label: dayLabel(p.paidOn, now), total: p.amount, payments: [p] });
    }
  }
  return out;
}

/** "9:12 am" — when it was entered, in the owner's own time. */
export function recordedTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const h = d.getHours();
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${hour}:${pad(d.getMinutes())} ${h < 12 ? 'am' : 'pm'}`;
}

/**
 * The "Recorded" line in the expanded row. Says the date too when it was
 * entered on a different day from when it was paid — back-dated cash is common,
 * and the gap is exactly what an owner checking his books wants to see.
 */
export function recordedLine(p: ReceivedPayment, now: Date = new Date()): string {
  const recordedDay = localDay(new Date(p.recordedAt));
  const time = recordedTime(p.recordedAt);
  if (recordedDay === p.paidOn) return time;
  return `${dayLabel(recordedDay, now)}, ${time}`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function summaryLine(summary: ReceivedSummary): string {
  const n = summary.count;
  const base = `${n} payment${n === 1 ? '' : 's'}`;
  return summary.reversedCount > 0 ? `${base} · ${summary.reversedCount} reversed` : base;
}

export function emptyMessage(period: ReceivedPeriod, filtered: boolean): string {
  if (filtered) return 'No payments match this search or method.';
  return period === 'all' ? 'No rent recorded yet.' : `No rent received ${periodPhrase(period)}.`;
}
