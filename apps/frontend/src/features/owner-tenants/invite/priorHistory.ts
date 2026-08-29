/**
 * Small date helpers for the already-living-here path.
 *
 * Deliberately **no money arithmetic**. An earlier version of this module
 * computed which months were owed and how much had been paid — a second
 * implementation of logic the backend already owns in
 * `onboarding-financials-service` (which raises the obligations) and
 * `lib/billing/invite-settlement-preview.ts` (which decides where a payment
 * lands). That preview module's own header warns that a preview disagreeing
 * with what the system creates is worse than no preview, and this is money, so
 * the wizard asks the server through
 * `POST /api/owners/invitations/settlement-preview` and renders the answer.
 *
 * What is left here is presentation only: reading a date, naming a month.
 * See ADR-141.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Reads `YYYY-MM` without going through `new Date()`, which parses it as UTC
 * midnight and renders it locally — reporting the previous month for anyone
 * west of Greenwich.
 */
function parseMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})/.exec(String(value ?? ''));
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}

export function monthLabel(month: string): string {
  const parsed = parseMonth(month);
  if (!parsed) return month;
  return `${MONTH_NAMES[parsed.month - 1]} ${parsed.year}`;
}

/**
 * Today as `YYYY-MM-DD` in the viewer's own calendar.
 *
 * Built from local date parts rather than `toISOString()`, which converts to
 * UTC first and so reports yesterday for anyone east of Greenwich late in the
 * evening — in India, every evening after 5:30pm.
 */
export function todayIso(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Whether the move-in month is genuinely behind us. */
export function isBackdated(joiningDate: string, today: string): boolean {
  const from = parseMonth(joiningDate);
  const to = parseMonth(today);
  if (!from || !to) return false;
  return from.year * 12 + from.month < to.year * 12 + to.month;
}

/** One row of the server's answer — what it will raise for a given month. */
export interface PreviewMonth {
  key: string;
  due_date: string;
  amount: number;
  settled: boolean;
}

/** The shape `POST /api/owners/invitations/settlement-preview` returns. */
export interface InviteSettlementPreview {
  months: PreviewMonth[];
  amount_paid: number;
  amount_includes_deposit: boolean;
  truncated: boolean;
  security_deposit: number;
  maintenance_amount: number;
}
