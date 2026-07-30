export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

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

  try {
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

    return NextResponse.json({ success: true, totalHostels: hostels.length, created, alreadyExists, noPublishedLastMonth });
  } catch (error: any) {
    console.error("[CRON food-carry-forward] failed:", error);
    return NextResponse.json({ success: false, error: error?.message || "Carry-forward failed" }, { status: 500 });
  }
}
