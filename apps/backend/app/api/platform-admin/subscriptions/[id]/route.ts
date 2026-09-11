export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionAdminService } from "@/src/services/platform-billing/subscription-admin-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET /api/platform-admin/subscriptions/[id]
 * Full detail for the admin drawer: subscription + owner + plan + usage +
 * payments + invoices + active override. Admin-only.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const data = await subscriptionAdminService.getSubscriptionDetail(id);
    return apiResponse(data);
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscriptions.detail");
  }
}
