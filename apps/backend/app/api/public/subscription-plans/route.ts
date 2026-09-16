export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { apiResponse } from "@/lib/auth";
import { subscriptionService } from "@/src/services/platform-billing/subscription-service";
import { subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET /api/public/subscription-plans
 *
 * Unauthenticated — the landing page's pricing section needs the same
 * public tiers (Starter / Growth / Professional / Portfolio) the owner
 * console's plan picker shows, and prices/capacity are business rules, not
 * secrets. No owner-specific data is returned; see subscriptionService.listPublicPlans.
 */
export async function GET() {
  try {
    const plans = await subscriptionService.listPublicPlans();
    return apiResponse({ plans });
  } catch (error) {
    return subscriptionErrorResponse(error, "public.subscription-plans");
  }
}
