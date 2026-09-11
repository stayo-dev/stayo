export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { resolveOwnerId, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET /api/owner/subscription/upgrade-preview?plan_id=<target>&extra_beds=<n>
 *
 * The day-prorated amount (integer paise) to upgrade to `plan_id` for the rest
 * of the current billing period (ADR-172 §7), plus any extra-bed cost
 * (business rules, 2026-09-10 — never prorated, always the full per-bed
 * price). `plan_id` may also be the owner's CURRENT plan when they just want
 * more extra beds without changing plan (e.g. a FOUNDING owner topping up
 * past their 250 included beds) — `extra_beds` must then exceed what they
 * already have. Read-only — nothing is charged or changed. A downgrade (lower
 * price, different plan) is rejected here — it takes effect next renewal with
 * no proration.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const ownerId = resolveOwnerId(session);
    const { searchParams } = new URL(req.url);
    const targetPlanId = searchParams.get("plan_id")?.trim();
    if (!targetPlanId) return apiError("plan_id is required.", "VALIDATION_ERROR", 400);
    const extraBedsParam = searchParams.get("extra_beds");
    const extraBeds = extraBedsParam ? Number(extraBedsParam) : 0;
    const preview = await subscriptionPaymentService.upgradePreview(ownerId, targetPlanId, extraBeds);
    return apiResponse(preview);
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.upgrade-preview");
  }
}
