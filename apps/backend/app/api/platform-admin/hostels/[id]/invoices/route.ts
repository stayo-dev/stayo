export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError } from "@/lib/auth";

/**
 * POST /api/platform-admin/hostels/[id]/invoices   — REMOVED (ADR-172).
 *
 * This was the legacy per-hostel "record invoice" shortcut: it created a
 * `platform_invoices` row, flipped the `hostel_subscriptions` row straight to
 * ACTIVE and advanced its renewal date — with no payment record and no review.
 * It is a hidden bypass of the owner-level payment lifecycle.
 *
 * Recording a subscription payment collected outside the app is now:
 *   1. POST /api/platform-admin/subscription-payments/cash   (creates a
 *      SUBMITTED payment against the OWNER)
 *   2. POST /api/platform-admin/subscription-payments/[id]/approve   (atomic:
 *      payment APPROVED + subscription ACTIVE + period set + invoice issued)
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") {
    return apiError("Admin access only", "FORBIDDEN", 403);
  }
  return apiError(
    "Per-hostel invoice recording has been removed. Record a cash subscription payment at /api/platform-admin/subscription-payments/cash and approve it (ADR-172).",
    "ENDPOINT_REMOVED",
    410,
  );
}
