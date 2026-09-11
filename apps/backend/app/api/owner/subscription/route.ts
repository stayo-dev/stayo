export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionService } from "@/src/services/platform-billing/subscription-service";
import { resolveOwnerId, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET /api/owner/subscription
 *
 * The current owner's single Stayo subscription (ADR-172), plus their recent
 * subscription payments and invoices. Owner-scoped by the authenticated
 * session — never accepts an ownerId from the request.
 *
 * Stayo has NO trial period. The first time an owner looks, a subscription is
 * created in PENDING_PAYMENT — the owner must submit a payment and have an
 * admin approve it before the subscription becomes ACTIVE.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const ownerId = resolveOwnerId(session);
    const data = await subscriptionService.getForOwner(ownerId);
    return apiResponse(data);
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.get");
  }
}
