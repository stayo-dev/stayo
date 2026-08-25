/**
 * How long the activation link has left, phrased for someone who is being
 * welcomed rather than chased.
 *
 * An invitation lasts seven days from the moment it is sent
 * (`DEFAULT_INVITE_DAYS`), and nothing told the tenant that. They found out by
 * clicking a dead link days later, at which point the only route forward was to
 * ask the owner to resend.
 *
 * Two rules shape this:
 *
 * 1. **Urgency is earned, not constant.** Six days out, a ticking clock is
 *    pressure with no purpose — it reads as a sales countdown and cheapens the
 *    welcome the rest of onboarding is trying to build. So distant deadlines are
 *    stated calmly as a date, and only the last day escalates.
 * 2. **Once they have started, there is no deadline at all.** `resolveByToken`
 *    skips the expiry check when the invitation is ACTIVATION_STARTED, so a
 *    tenant mid-flow is genuinely not on a clock. Showing one would be a lie
 *    that costs exactly the trust this flow is built on.
 */

export type ExpiryTone = 'held' | 'calm' | 'soon' | 'urgent' | 'expired';

export type ExpiryNotice = {
  tone: ExpiryTone;
  /** The line to show, already phrased. Empty when nothing should be shown. */
  label: string;
  /** Whether to re-render every minute — only worth it near the end. */
  live: boolean;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** `31 Aug`, from parts — never `toLocaleDateString` on a shifted Date. */
function formatDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${date.getDate()} ${months[date.getMonth()]}`;
}

function plural(value: number, unit: string): string {
  return `${value} ${unit}${value === 1 ? '' : 's'}`;
}

export function expiryNotice(input: {
  expiresAt: string | null | undefined;
  /** True once activation has begun — the expiry check no longer applies. */
  held?: boolean;
  now: Date;
}): ExpiryNotice {
  // Someone already underway is not on a clock. Say so, warmly, instead of
  // showing a countdown that the server would ignore anyway.
  if (input.held) {
    return { tone: 'held', label: 'Your place is held — finish whenever you’re ready', live: false };
  }

  const raw = String(input.expiresAt ?? '').trim();
  if (!raw) return { tone: 'calm', label: '', live: false };

  const expires = new Date(raw);
  if (Number.isNaN(expires.getTime())) return { tone: 'calm', label: '', live: false };

  const remaining = expires.getTime() - input.now.getTime();

  if (remaining <= 0) {
    return { tone: 'expired', label: 'This link has expired — ask the hostel to send a new one', live: false };
  }

  if (remaining < HOUR) {
    const minutes = Math.max(1, Math.ceil(remaining / MINUTE));
    return { tone: 'urgent', label: `Expires in ${plural(minutes, 'minute')}`, live: true };
  }

  if (remaining < DAY) {
    const hours = Math.floor(remaining / HOUR);
    return { tone: 'urgent', label: `Expires in ${plural(hours, 'hour')}`, live: true };
  }

  if (remaining < 2 * DAY) {
    return { tone: 'soon', label: 'Expires tomorrow', live: false };
  }

  const days = Math.floor(remaining / DAY);
  if (remaining < 3 * DAY) {
    return { tone: 'soon', label: `Expires in ${plural(days, 'day')}`, live: false };
  }

  // Far out: a date, not a countdown. Nothing here needs hurrying.
  return { tone: 'calm', label: `This link is valid until ${formatDate(expires)}`, live: false };
}
