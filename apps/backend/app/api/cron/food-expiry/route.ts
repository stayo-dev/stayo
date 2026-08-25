export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { shouldAutoClose } from "@/lib/services/food/voting-expiry";
import { shouldAutoClosePoll } from "@/lib/services/food/poll-expiry";

/**
 * 🕐 CRON — Food Expiry
 * GET /api/cron/food-expiry
 *
 * Runs daily (same cadence convention as the other daily crons in this
 * project). Closes any voting period whose `voting_ends_at` has passed but
 * whose status is still OPEN, and any `food_polls` row still OPEN past its
 * own `closes_at` — both had no other way to close themselves.
 *
 * Renamed from `food-carry-forward`: this cron used to also clone last
 * month's PUBLISHED schedule into a new DRAFT for any hostel missing a
 * current-month schedule. That responsibility was removed — food scheduling
 * is now fully manual (see ADR-114), and a hostel's schedule row for a given
 * month is instead created on demand, empty, the first time the owner opens
 * the Timetable for that month (`POST /api/food/schedules`). Voting-period
 * and poll expiry are unrelated systems and are unaffected by that change.
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

    return NextResponse.json({ success: true, votingClosed, pollsClosed });
  } catch (error: any) {
    console.error("[CRON food-expiry] failed:", error);
    return NextResponse.json({ success: false, error: error?.message || "Expiry sweep failed" }, { status: 500 });
  }
}
