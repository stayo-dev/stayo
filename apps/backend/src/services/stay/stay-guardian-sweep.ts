import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { istDateOf } from "@/lib/timezone";
import { sendStayGuardianUpdate } from "@/lib/services/notifications/command-center/stay-guardian-updates";
import { fromDbDate } from "./stay-rows";

const logger = getLogger("stay.guardian-sweep");

/**
 * The backstop for guardian stay updates (ADR-234).
 *
 * ── Why it is daily, and what that costs ──
 *
 * This account is on Vercel Hobby, where a sub-daily cron *fails the
 * deployment outright rather than degrading* — see the header of
 * `app/api/cron/partner-lead-fallback/route.ts` and
 * `.github/workflows/keep-warm.yml`. Every cron in `vercel.json` is daily for
 * that reason, and a `*​/30` schedule here would not run late; it would break
 * the deploy. A GitHub Actions schedule could tick faster, but ADR-179
 * deliberately moved all six business crons out of Actions and into
 * `vercel.json`, and reversing that for a secondary path is the wrong trade.
 *
 * So two things follow, and both are load-bearing:
 *
 * 1. **The inline send is the real delivery path.** This recovers messages
 *    that would otherwise be lost forever; it is not a substitute for prompt
 *    delivery and must not be reasoned about as one.
 * 2. **Both templates are self-dating**, which is what makes a late send
 *    survivable: "checked in at 7:40 PM, 27 Sep" is still true the next
 *    morning. A template saying "just now" could not be swept.
 *
 * The 48-hour window is slack around a daily run, not a delivery promise.
 * `isStaleDeparture` is what actually decides.
 */

const LOOKBACK_HOURS = 48;

/**
 * A departure notice expires; a return notice does not.
 *
 * "has left and is expected back on Sunday" must not reach a parent on Monday,
 * or reach one whose child is already home. A return is a completed fact and
 * reads correctly whenever it lands.
 */
export function isStaleDeparture(input: {
  leaveStatus: string | null;
  expectedReturnDate: string | null;
  today: string;
}): boolean {
  if (input.leaveStatus !== "ACTIVE") return true;
  if (!input.expectedReturnDate) return true;
  return input.expectedReturnDate < input.today;
}

export async function runStayGuardianSweep(
  now: Date = new Date(),
): Promise<{ considered: number; sent: number; skipped: number; stale: number }> {
  const today = istDateOf(now);
  const since = new Date(now.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  // Only tenants with a live consent. Without this the sweep reloads every
  // leave in the system daily to reach the same NO_CONSENT as yesterday.
  const consents: Array<{ tenant_id: string }> = await (prisma as any).stay_guardian_consent.findMany({
    where: { granted: true, revoked_at: null, stopped_at: null },
    select: { tenant_id: true },
  });
  if (consents.length === 0) return { considered: 0, sent: 0, skipped: 0, stale: 0 };

  const events = await (prisma as any).stay_events.findMany({
    where: {
      type: { in: ["LEAVE_STARTED", "RETURNED"] },
      occurred_at: { gte: since },
      tenant_id: { in: consents.map((row) => row.tenant_id) },
    },
    select: {
      id: true,
      tenant_id: true,
      type: true,
      leave_type: true,
      expected_return_date: true,
      occurred_at: true,
    },
    orderBy: { seq: "asc" },
  });

  const result = { considered: events.length, sent: 0, skipped: 0, stale: 0 };
  if (events.length === 0) return result;

  // A LEAVE_STARTED event's id IS its leave's id — see applyStayEvent.
  const departureIds = events
    .filter((e: any) => e.type === "LEAVE_STARTED")
    .map((e: any) => e.id);
  const leaves: Array<{ id: string; status: string }> = departureIds.length
    ? await (prisma as any).stay_leaves.findMany({
        where: { id: { in: departureIds } },
        select: { id: true, status: true },
      })
    : [];
  const statusById = new Map(leaves.map((l) => [l.id, l.status]));

  for (const event of events as any[]) {
    if (event.type === "LEAVE_STARTED") {
      const stale = isStaleDeparture({
        leaveStatus: statusById.get(event.id) ?? null,
        expectedReturnDate: event.expected_return_date ? fromDbDate(event.expected_return_date) : null,
        today,
      });
      if (stale) {
        result.stale += 1;
        continue;
      }
    }

    try {
      const outcome = await sendStayGuardianUpdate({
        eventId: event.id,
        tenantId: event.tenant_id,
        eventType: event.type,
        leaveType: event.leave_type ?? null,
        expectedReturnDate: event.expected_return_date ? fromDbDate(event.expected_return_date) : null,
        occurredAt: new Date(event.occurred_at).toISOString(),
      });
      if (outcome.sent) result.sent += 1;
      else result.skipped += 1;
    } catch (error: any) {
      // One bad row must not abandon the rest of the run.
      logger.warn("stay_guardian_sweep.event_failed", {
        event_id: event.id,
        error: error?.message || String(error),
      });
    }
  }

  logger.info("stay_guardian_sweep.done", result);
  return result;
}
