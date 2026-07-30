export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { agreementLifecycleService } from "@/src/services/tenants/agreement-lifecycle-service";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("[CRON] CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startTime = Date.now();
  try {
    const summary = await agreementLifecycleService.processDailyLifecycle();
    return NextResponse.json({
      success: true,
      duration_ms: Date.now() - startTime,
      ...summary,
    });
  } catch (error: any) {
    console.error("[CRON] Agreement lifecycle failed:", error);
    return NextResponse.json({
      success: false,
      error: error?.message || "Agreement lifecycle cron failed.",
    }, { status: 500 });
  }
}
