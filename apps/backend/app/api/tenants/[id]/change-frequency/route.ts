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

/**
 * POST /api/tenants/:id/change-frequency
 *
 * Owner-initiated billing frequency change — applies immediately, no tenant
 * approval, reusing the same cooldown/clean-period/commitment guards as the
 * tenant-request→owner-approve flow (billing-transition-service.ts). See
 * Business-Rules.md for the known limitation: for agreement-based tenants
 * this records the change but does not yet alter actual obligation
 * generation cadence (agreement-rent-schedule-service.ts always generates
 * monthly today).
 *
 * Body: { requested_frequency, reason?, identityToken }
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
    const { requested_frequency, reason, identityToken } = body;

    if (!requested_frequency) return ApiResponse.error(ApiError.badRequest("requested_frequency is required"));

    const identity = await verifyIdentityConfirmation(identityToken, IDENTITY_PURPOSE, IDENTITY_ACTION, session.sub);

    // The service consumes the identity token inside its own write
    // transaction (via identityJti) so both commit or roll back together —
    // it does not need (and must not get) a second, separately-opened
    // transaction wrapped around it here.
    const result = await billingTransitionService.ownerInitiateChange(scope.owner_id, params.id, {
      requested_frequency,
      reason,
      identityJti: identity.jti,
    });

    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error in POST [tenants.change-frequency]:", error);
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
    if ([
      "UNSUPPORTED_PAYMENT_FREQUENCY",
      "CUSTOM_INSTALLMENTS_NOT_AVAILABLE_IN_V1",
      "ONLY_ACTIVE_TENANTS_CAN_CHANGE_FREQUENCY",
      "REQUESTED_FREQUENCY_ALREADY_ACTIVE",
      "FREQUENCY_NOT_ALLOWED_BY_HOSTEL",
      "FREQUENCY_CHANGE_COOLDOWN_ACTIVE",
      "UNCLEAN_BILLING_PERIOD",
      "MINIMUM_COMMITMENT_NOT_MET",
    ].includes(msg)) {
      return ApiResponse.error(ApiError.badRequest(msg));
    }
    return ApiResponse.error(new ApiError(error.message || "Failed to change billing frequency"));
  }
}
