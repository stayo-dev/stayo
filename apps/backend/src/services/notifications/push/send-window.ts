/**
 * Quiet hours for **scheduled** pushes only — rent reminders, daily briefings,
 * expiry nudges.
 *
 * Real-time events deliberately bypass this. A lead, a payment or a complaint
 * is a reaction to something that just happened, and holding a lead until
 * morning destroys the speed-to-lead advantage that makes it worth pushing at
 * all. That is the most arguable call in this feature; if it proves wrong the
 * fix is a per-owner preference, not a global gate.
 *
 * Note the precedent: `app/api/cron/daily-briefings/route.ts` already enforces
 * its own 07:30–22:00 window. These two should not drift apart silently.
 *
 * PURE — computed by UTC offset rather than `Intl`, so it is deterministic and
 * needs no timezone database. India has no daylight saving, so a fixed +5:30
 * is correct year-round.
 */

const IST_OFFSET_MINUTES = 5 * 60 + 30;

export const SEND_WINDOW_START_HOUR_IST = 8;
export const SEND_WINDOW_END_HOUR_IST = 21;

export function withinSendWindow(now: Date): boolean {
  const istMinutes = now.getTime() / 60000 + IST_OFFSET_MINUTES;
  const minutes = ((istMinutes % 1440) + 1440) % 1440;
  return (
    minutes >= SEND_WINDOW_START_HOUR_IST * 60 &&
    minutes < SEND_WINDOW_END_HOUR_IST * 60
  );
}
