export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { partnerFallbackService } from "@/src/services/marketing/partner-fallback-service";

/**
 * 🕐 CRON — Marketplace partner held-enquiry fallback
 * GET /api/cron/partner-lead-fallback
 *
 * A HELD enquiry is a student waiting to hear where they might live, kept
 * waiting because their prospective landlord has not joined Stayo. This
 * sweep ends that wait: after the threshold the student hears from us, with
 * hostels that are on Stayo and answering.
 *
 * Runs **once daily**, like every other cron here — Vercel's Hobby plan
 * allows exactly one run per day and rejects anything more frequent at
 * deploy time. So the threshold in `partner-fallback-policy.ts` is when an
 * enquiry becomes *eligible*, not when the message goes out: eligible at
 * 12 hours, rescued somewhere between 12 and 36. Tightening that is a
 * schedule change and needs nothing here.
 *
 * De-duplication is `fallback_at` on the row, so running more often is safe.
 *
 * Protected by CRON_SECRET bearer token, same as every other cron here.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await partnerFallbackService.sweep();
    return NextResponse.json({ ok: true, ...result });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: String(error?.message || error) },
      { status: 500 }
    );
  }
}
