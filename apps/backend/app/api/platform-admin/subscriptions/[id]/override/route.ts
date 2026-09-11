export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionOverrideService } from "@/src/services/platform-billing/subscription-override-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/platform-admin/subscriptions/[id]/override
 * Body: { days?: 1..30, until?: ISO, reason: string }   — reason required.
 *
 * Admin-only (ADR-172, Phase 3). Temporarily grants access even after the paid
 * period has ended ("we'll pay tomorrow"). Max 30 days per action; the actor is
 * recorded and the action is audited. Once `admin_override_until` passes,
 * normal PAUSED enforcement resumes.
 *
 * DELETE clears an override before it expires.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const result = await subscriptionOverrideService.setOverride({
      subscriptionId: id,
      adminId: (session as any).sub,
      reason: body?.reason,
      days: body?.days,
      until: body?.until,
    });
    return apiResponse(result);
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscriptions.override.set");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const result = await subscriptionOverrideService.clearOverride({
      subscriptionId: id,
      adminId: (session as any).sub,
      reason: body?.reason,
    });
    return apiResponse(result);
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscriptions.override.clear");
  }
}
