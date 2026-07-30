export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { hostelIntegrityDashboard } from "@/lib/services/hostel-integrity-dashboard";

export async function GET(req: NextRequest) {
  const refreshDualRead = req.nextUrl.searchParams.get("dualRead") === "true";
  const metrics = await hostelIntegrityDashboard.getMetrics({ refreshDualRead });
  return NextResponse.json({ success: true, metrics });
}
