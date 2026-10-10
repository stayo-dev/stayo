export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { specialMealService } from "@/src/services/meals/special-meal-service";

/**
 * 🕐 CRON — special-meal reminders for today (≈08:00 IST).
 * Daily only: Vercel Hobby rejects sub-daily crons at deploy time. Fails closed
 * on a missing CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ success: true, ...(await specialMealService.runRound("REMIND")) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}
