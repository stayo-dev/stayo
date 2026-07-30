export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { billingTransitionService } from "@/lib/services/billing-transition-service";
import { verifyIdentityConfirmation } from "@/src/services/payments/identity-confirmation-guard";

const IDENTITY_PURPOSE = "CHANGE_FREQUENCY";
const IDENTITY_ACTION = "change_frequency";

const KNOWN_ERRORS = [
  "VALIDATION_ERROR",
  "TENANT_NOT_FOUND",
  "ONLY_ACTIVE_TENANTS_CAN_CHANGE_FREQUENCY",
  "FREQUENCY_CHANGE_COOLDOWN_ACTIVE",
  "UNCLEAN_BILLING_PERIOD",
];

/**
 * POST /api/tenants/:id/change-frequency/custom
 *
 * Owner-defined custom installment schedule — a fixed list of {due_date,
 * amount} charges, not a recurring cadence. See
 * billing-transition-service.ts::ownerSetCustomSchedule for the full
 * safety-guard rationale (why this is safe for agreement-based tenants
 * despite the CUSTOM_INSTALLMENTS gap in the periodic-frequency path).
 *
 * Body: { installments: {due_date, amount, label?}[], reason?, identityToken }
 */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) {
    return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
  }
  if (!["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { installments, reason, identityToken } = body;

    if (!Array.isArray(installments) || installments.length === 0) {
      return ApiResponse.error(ApiError.badRequest("installments is required"));
    }

    const identity = await verifyIdentityConfirmation(identityToken, IDENTITY_PURPOSE, IDENTITY_ACTION, session.sub);

    // The service consumes the identity token inside its own write
    // transaction (via identityJti) so both commit or roll back together.
    const result = await billingTransitionService.ownerSetCustomSchedule(scope.owner_id, params.id, {
      installments,
      reason,
      identityJti: identity.jti,
    });

    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error in POST [tenants.change-frequency.custom]:", error);
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("IDENTITY_REQUIRED")) {
      return ApiResponse.error(new ApiError(msg.replace(/^IDENTITY_REQUIRED:\s*/, ""), 403, "IDENTITY_REQUIRED"));
    }
    if (msg.startsWith("IDENTITY_EXPIRED")) {
      return ApiResponse.error(new ApiError(msg.replace(/^IDENTITY_EXPIRED:\s*/, ""), 403, "IDENTITY_EXPIRED"));
    }
    if (msg === "TENANT_NOT_FOUND") {
      return ApiResponse.error(ApiError.notFound("Tenant not found"));
    }
    if (KNOWN_ERRORS.some((code) => msg.startsWith(code))) {
      return ApiResponse.error(ApiError.badRequest(msg));
    }
    return ApiResponse.error(new ApiError(error.message || "Failed to set custom installment schedule"));
  }
}
