export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError } from "@/lib/auth";

/**
 * POST /api/platform-admin/hostels/[id]/subscription   — REMOVED (ADR-172).
 *
 * This was the legacy per-hostel "assign plan" shortcut. It created a
 * `hostel_subscriptions` row directly in status TRIAL, bypassing the
 * owner-level subscription model and its payment lifecycle
 * (SUBMITTED → UNDER_REVIEW → APPROVED/REJECTED).
 *
 * Stayo billing is now one subscription per OWNER. Plan changes go through
 * `POST /api/platform-admin/subscriptions/[id]/change-plan`; activation only
 * ever happens by approving a real payment via
 * `POST /api/platform-admin/subscription-payments/[id]/approve` (or by first
 * recording a cash payment at `/api/platform-admin/subscription-payments/cash`).
 * There is deliberately no admin path that activates a subscription without a
 * reviewed payment.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") {
    return apiError("Admin access only", "FORBIDDEN", 403);
  }
  return apiError(
    "Per-hostel subscription assignment has been removed. Stayo subscriptions are owner-level (ADR-172) — use /api/platform-admin/subscriptions/[id]/change-plan and the subscription payment approval flow.",
    "ENDPOINT_REMOVED",
    410,
  );
}
