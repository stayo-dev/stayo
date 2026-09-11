export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionAdminService } from "@/src/services/platform-billing/subscription-admin-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET /api/platform-admin/subscriptions?status=&search=&limit=&offset=
 *
 * The admin subscription dashboard list (ADR-172, Phase 5) — one row per owner:
 * status, plan, period, next renewal, usage vs capacity, latest payment,
 * subscription amount, pending plan, active override. Cross-owner (admin
 * persona). `status_counts` drives the filter chips.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const { searchParams } = new URL(req.url);
    const data = await subscriptionAdminService.listSubscriptions({
      status: searchParams.get("status") ?? undefined,
      // Founding / Starter / Growth / Professional / Portfolio filter chip.
      planCode: searchParams.get("plan_code") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
      offset: searchParams.get("offset") ? Number(searchParams.get("offset")) : undefined,
    });
    return apiResponse(data);
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscriptions.list");
  }
}
