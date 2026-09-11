export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionService } from "@/src/services/platform-billing/subscription-service";
import { resolveOwnerId, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET /api/owner/subscription/plans
 *
 * The public plans this owner may choose (Starter / Growth / Professional /
 * Portfolio). FOUNDING is never listed — it is auto-assigned to the first 10
 * owners at subscription creation, not owner-selectable.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const ownerId = resolveOwnerId(session);
    const plans = await subscriptionService.listPlansForOwner(ownerId);
    return apiResponse({ plans });
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.plans");
  }
}
