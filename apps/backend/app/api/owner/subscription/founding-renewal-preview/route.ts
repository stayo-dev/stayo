export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { resolveOwnerId, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET /api/owner/subscription/founding-renewal-preview
 *
 * Founding Partner only (business rules, 2026-09-12). What the current
 * activation/renewal costs RIGHT NOW: base ₹2,000 + ₹10 per active tenant
 * beyond the 250 included, computed from the owner's LIVE active-tenant
 * count — never a stored/previously-purchased extra-bed quantity, so a
 * quantity from a past period never carries forward. Read-only.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const ownerId = resolveOwnerId(session);
    const preview = await subscriptionPaymentService.foundingRenewalPreview(ownerId);
    return apiResponse(preview);
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.founding-renewal-preview");
  }
}
