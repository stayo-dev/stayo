export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { billingErrorResponse } from "@/src/services/platform-billing/subscription-http";


/**
 * 👨‍🎓 REACTIVATE TENANT
 * POST /api/tenants/[id]/reactivate
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
    if (body.monthly_rent === undefined || body.monthly_rent === null || !Number.isFinite(body.monthly_rent) || body.joined_on === undefined || body.joined_on === null) {
      return apiError("Valid monthly_rent and joined_on are required", "VALIDATION_ERROR", 400);
    }
    
    const joinedOnDate = new Date(body.joined_on);
    if (isNaN(joinedOnDate.getTime())) {
      return apiError("Invalid joined_on date", "VALIDATION_ERROR", 400);
    }

    const result = await tenantService.reactivateTenant(
      params.id, 
      body.monthly_rent, 
      joinedOnDate, 
      session.sub
    );

    return apiResponse(result);
  } catch (error: any) {
    // reactivateTenant is one of the ADR-172 tenant-activation paths — a
    // capacity/inactive-subscription block surfaces as a SubscriptionError
    // here and must keep its intended status (402/409), not fall through to
    // the generic message-prefix handling below (which would 500 it).
    const billing = billingErrorResponse(error);
    if (billing) return billing;
    const msg = typeof error?.message === "string" ? error.message : (String(error) || "Failed to reactivate tenant");
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    return apiError(msg || "Failed to reactivate tenant");
  }
}
