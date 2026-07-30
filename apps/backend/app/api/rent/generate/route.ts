export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { rentGenerationService } from "@/src/services/payments/rent-generation-service";
import { invalidateHostelDashboardCache } from "@/lib/cache/dashboard-cache";
import { timed } from "@/lib/perf";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";

/**
 * 🏦 RENT GENERATION — Owner Manual Trigger
 * GET  /api/rent/generate — Preview what will be generated (no automation check needed)
 * POST /api/rent/generate — Actually generate rent obligations (requires automation)
 *
 * Plan gate: POST requires automation feature (Starter+).
 * Free plan owners receive a 402 with upgrade instructions.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const { searchParams } = new URL(req.url);
    const monthStr = searchParams.get("month");
    const hostelId = searchParams.get("hostelId") || undefined;
    if (!hostelId) {
      return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);
    }
    await requireHostelBelongsToOwner(session.sub, hostelId);

    let targetDate: Date | undefined;
    if (monthStr) {
      const [year, month] = monthStr.split("-").map(Number);
      targetDate = new Date(Date.UTC(year, month - 1, 1));
    }

    const preview = await rentGenerationService.previewMonthlyRent(targetDate, session.sub, hostelId);
    return apiResponse(preview);
  } catch (error: any) {
    return apiError(error.message || "Failed to preview rent generation");
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json().catch(() => ({}));
    const monthStr = body?.month;
    const hostelId = body?.hostelId;
    await requireHostelBelongsToOwner(session.sub, hostelId);

    let targetDate: Date | undefined;
    if (monthStr) {
      const [year, month] = monthStr.split("-").map(Number);
      targetDate = new Date(Date.UTC(year, month - 1, 1));
    }

    const summary = await timed(
      "rent.generate",
      () => rentGenerationService.generateMonthlyRent(targetDate, session.sub, "manual", hostelId),
      { owner_id: session.sub, hostel_id: hostelId, slow_ms: 15_000 }
    );

    try { invalidateHostelDashboardCache(hostelId); } catch { /* best-effort */ }

    return apiResponse(summary, 201);
  } catch (error: any) {
    return apiError(error.message || "Failed to generate rent obligations");
  }
}
