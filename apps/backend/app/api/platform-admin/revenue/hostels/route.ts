export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError } from "@/lib/auth";

/**
 * GET /api/platform-admin/revenue/hostels   — REMOVED (ADR-172).
 *
 * Returned per-hostel `hostel_subscriptions` cards. Stayo billing is
 * owner-level now: the authoritative subscription revenue surface is
 * `GET /api/platform-admin/revenue` (MRR/ARR/collected from
 * `owner_subscriptions` + `subscription_invoices`) and the per-owner list is
 * `GET /api/platform-admin/subscriptions`. No frontend consumes this route.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") {
    return apiError("Admin access only", "FORBIDDEN", 403);
  }
  return apiError(
    "Per-hostel revenue has been removed. Use /api/platform-admin/revenue and /api/platform-admin/subscriptions (ADR-172).",
    "ENDPOINT_REMOVED",
    410,
  );
}
