export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/** GET /api/platform-admin/plans — the subscription plan catalog. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const plans = await prisma.subscription_plans.findMany({ orderBy: { price_amount: "asc" } });
    return apiResponse({ plans });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch plans");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * POST /api/platform-admin/plans   — REMOVED (ADR-172).
 *
 * Created a plan with only `name` / `price_amount` (rupees) / `billing_cycle`
 * — no `code`, no `price_paise`, no `capacity_min/max`. Such a row is unusable
 * by the owner-level billing code (which reads `price_paise` and enforces
 * capacity by `code`) and no frontend calls this. The plan catalog
 * (FOUNDING/STARTER/GROWTH/PROFESSIONAL/PORTFOLIO) is seeded and managed via
 * migration, not ad-hoc admin creation.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") {
    return apiError("Admin access only", "FORBIDDEN", 403);
  }
  return apiError(
    "Ad-hoc plan creation has been removed. Subscription plans are managed via migration (ADR-172).",
    "ENDPOINT_REMOVED",
    410,
  );
}
