export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { migrationAuditService } from "@/lib/services/migration-audit-service";
import { financialInvariantService } from "@/lib/services/financial-invariant-service";

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  if (authHeader !== `Bearer ${cronSecret}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const audit = await migrationAuditService.runFullAudit();
    const invariants = await financialInvariantService.runAll();
    return NextResponse.json({ success: true, audit, invariants });
  } catch (error: any) {
    console.error("[CRON] migration audit failed", error);
    return NextResponse.json({ success: false, error: error.message || "Migration audit failed" }, { status: 500 });
  }
}
