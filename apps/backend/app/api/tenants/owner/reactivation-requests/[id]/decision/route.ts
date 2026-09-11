export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { billingErrorResponse } from "@/src/services/platform-billing/subscription-http";


/**
 * 👨‍🎓 PROCESS REACTIVATION REQUEST
 * POST /api/tenants/owner/reactivation-requests/[id]/decision
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    if (!body.action) {
      return apiError("action (approve/reject) is required", "VALIDATION_ERROR", 400);
    }
    const normalizedAction = String(body.action).toLowerCase().trim();
    if (normalizedAction !== "approve" && normalizedAction !== "reject") {
      return apiError("action must be 'approve' or 'reject'", "VALIDATION_ERROR", 400);
    }
    
    const result = await tenantService.processReactivationRequest(
      params.id,
      session.sub,
      normalizedAction,
      body.notes
    );

    return apiResponse(result);
  } catch (error: any) {
    // processReactivationRequest is one of the ADR-172 tenant-activation
    // paths — an approve decision can hit the capacity/inactive-subscription
    // guard, which must keep its 402/409, not fall through to a 500 below.
    const billing = billingErrorResponse(error);
    if (billing) return billing;
    const msg = typeof error?.message === "string" ? error.message : String(error ?? "Unknown error");
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    return apiError(msg || "Failed to process reactivation request");
  }
}
