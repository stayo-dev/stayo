export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionAdminService } from "@/src/services/platform-billing/subscription-admin-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/platform-admin/subscriptions/[id]/resume
 * Body: { reason: string }  — required. Admin-only, audited.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const result = await subscriptionAdminService.resume({
      subscriptionId: id,
      adminId: (session as any).sub,
      reason: body?.reason,
    });
    return apiResponse(result);
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscriptions.resume");
  }
}
