export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shouldAutoClose } from "@/lib/services/food/voting-expiry";
import { shouldAutoClosePoll } from "@/lib/services/food/poll-expiry";

/**
 * 🕐 CRON — Food Schedule Carry-Forward
 * GET /api/cron/food-carry-forward
 *
 * Runs daily (same cadence convention as the other daily crons in this
 * project — the idempotency check below makes every run after the first
 * successful one on a given month a no-op, so a daily cadence safely covers
 * "the 1st" even across retries/failures/timezone edges).
 *
 * For every active hostel with no schedule row yet for the current month,
 * clones last month's PUBLISHED schedule's 28 meal cells into a new DRAFT
 * row for the current month (source=CARRIED_FORWARD). Hostels with no
 * published schedule last month are left alone — nothing to carry forward,
 * not treated as an error. Protected by CRON_SECRET, same as the other
 * cron routes.
 *
 * Also closes any voting period whose `voting_ends_at` has passed but whose
 * status is still OPEN — voting had no other way to close itself, and the
 * owner's Generate button is gated on a CLOSED period.
 *
 * Third responsibility, added with Food Polls (see ADR-057): closes any
 * `food_polls` row still OPEN past its own `closes_at`, same shape as the
 * voting-period expiry above.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const previousMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));

  let created = 0;
  let alreadyExists = 0;
  let noPublishedLastMonth = 0;
  let votingClosed = 0;
  let pollsClosed = 0;

  try {
    // Expiry is a SQL predicate, not a scan — this runs daily against every
    // OPEN period in the system. `shouldAutoClose` still gates the update as
    // the single tested statement of the rule.
    const openPeriods = await prisma.food_voting_periods.findMany({
      where: { status: "OPEN", voting_ends_at: { lte: now } },
      select: { id: true, status: true, voting_ends_at: true },
    });
    const expired = openPeriods.filter((p: any) => shouldAutoClose(p, now)).map((p: any) => p.id);
    if (expired.length > 0) {
      const result = await prisma.food_voting_periods.updateMany({
        where: { id: { in: expired } },
        data: { status: "CLOSED", updated_at: new Date() },
      });
      votingClosed = result.count;
    }

    const openPolls = await prisma.food_polls.findMany({
      where: { status: "OPEN", closes_at: { lte: now } },
      select: { id: true, status: true, closes_at: true },
    });
    const expiredPolls = openPolls.filter((p: any) => shouldAutoClosePoll(p, now)).map((p: any) => p.id);
    if (expiredPolls.length > 0) {
      const result = await prisma.food_polls.updateMany({
        where: { id: { in: expiredPolls } },
        data: { status: "CLOSED", closed_at: now, updated_at: now },
      });
      pollsClosed = result.count;
    }

    const hostels = await prisma.hostels.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, owner_id: true },
    });

    for (const hostel of hostels) {
      const existing = await prisma.food_schedules.findUnique({
        where: { hostel_id_month: { hostel_id: hostel.id, month: currentMonth } },
      });
      if (existing) {
        alreadyExists += 1;
        continue;
      }

      const previous = await prisma.food_schedules.findUnique({
        where: { hostel_id_month: { hostel_id: hostel.id, month: previousMonth } },
        include: { food_schedule_meals: true },
      });
      if (!previous || previous.status !== "PUBLISHED") {
        noPublishedLastMonth += 1;
        continue;
      }

      await prisma.$transaction(async (tx) => {
        const newSchedule = await tx.food_schedules.create({
          data: {
            hostel_id: hostel.id,
            owner_id: hostel.owner_id,
            month: currentMonth,
            status: "DRAFT",
            source: "CARRIED_FORWARD",
          },
        });
        await tx.food_schedule_meals.createMany({
          data: previous.food_schedule_meals.map((m) => ({
            schedule_id: newSchedule.id,
            day_of_week: m.day_of_week,
            meal_type: m.meal_type,
            menu_item_id: m.menu_item_id,
            item_name: m.item_name,
          })),
        });
      });
      created += 1;
    }

    return NextResponse.json({ success: true, totalHostels: hostels.length, created, alreadyExists, noPublishedLastMonth, votingClosed, pollsClosed });
  } catch (error: any) {
    console.error("[CRON food-carry-forward] failed:", error);
    return NextResponse.json({ success: false, error: error?.message || "Carry-forward failed" }, { status: 500 });
  }
}
