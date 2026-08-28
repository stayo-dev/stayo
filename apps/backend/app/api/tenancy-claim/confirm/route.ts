export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { apiError, apiResponse, getSession } from "@/lib/auth";
import { getLogger } from "@/lib/logger";
import { tenancyClaimService, TenancyClaimError } from "@/src/services/tenants/tenancy-claim-service";
import { TenancyClaimConfirmSchema } from "@/lib/validators/tenancy-claim";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, getSessionCookieOptions, TENANT_REFRESH_DAYS } from "@/lib/services/session-lifecycle-service";
import { setCsrfCookie } from "@/lib/security/csrf";

const logger = getLogger("api.tenancy-claim.confirm");

/**
 * Public (pre-auth), like `/api/auth/send-phone-otp` — but identity-aware:
 * this path is registered in `IDENTITY_OPTIONAL_UNDER_PUBLIC`
 * (`lib/auth/public-route-exceptions.ts`), so `middleware.ts` still verifies
 * and passes through a signed-in caller's session instead of stripping it,
 * the same way GET .../reviews does for a signed-in reviewer.
 *
 * `profileId` is read from that verified session, never from the request
 * body — a client-supplied id would let anyone attach a stranger's tenancy
 * (and the `mobile_verified`/consent record that comes with it) to an
 * account that is not theirs. See `tenancy-claim-service.ts`'s module
 * comment for the full security model.
 */

/**
 * Mirrors `createActivationResponse` in `app/api/tenants/activate/route.ts`:
 * when `tenancyClaimService.confirm` minted a session (a new/attached
 * unauthenticated claimant, not an already-signed-in one — see that
 * service's module comment), set the same session + refresh + CSRF cookies
 * activation sets, and return `session` in the body so the frontend can call
 * `supabase.auth.setSession()`. Falls back to the plain `apiResponse` shape
 * when there's no session to attach (already-signed-in caller, or the
 * session-mint step failed after the claim itself durably committed).
 */
function createClaimResponse(result: any) {
  if (result && typeof result === "object" && "session" in result && result.session) {
    const { session, ...rest } = result;

    const response = NextResponse.json({
      success: true,
      ...rest,
      session,
    }, { status: 200 });

    response.cookies.set("hms_session", session.access_token, {
      ...getSessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS),
    });
    response.cookies.set("hms_refresh_token", session.refresh_token, {
      ...getSessionCookieOptions(60 * 60 * 24 * TENANT_REFRESH_DAYS),
    });
    setCsrfCookie(response, 60 * 60 * 24 * TENANT_REFRESH_DAYS);

    return response;
  }

  return apiResponse(result);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const validated = TenancyClaimConfirmSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Invalid request", "VALIDATION_ERROR", 400);
    }

    const { password, confirm_password } = validated.data;
    if ((password || confirm_password) && password !== confirm_password) {
      return apiError("Passwords do not match", "VALIDATION_ERROR", 400);
    }

    const session = await getSession(req);
    const profileId = session && session.role === "TENANT" ? session.sub : null;

    const result = await tenancyClaimService.confirm({
      tenantId: validated.data.tenant_id,
      phone: validated.data.phone,
      claimToken: validated.data.claim_token,
      profileId,
      requestIp: getRequestIp(req),
      requestUserAgent: req.headers.get("user-agent"),
      acknowledgements: validated.data.acknowledgements,
      typedSignatureName: validated.data.typed_signature_name,
      name: validated.data.name,
      email: validated.data.email,
      password,
      dispute: {
        itemRefs: validated.data.disputed_items ?? null,
        note: validated.data.dispute_note ?? null,
      },
    });

    return createClaimResponse(result);
  } catch (error: any) {
    if (error instanceof TenancyClaimError) {
      return apiError(error.message, error.code, error.status);
    }
    // The one-live-tenancy-per-person refusal, reused rather than
    // reimplemented — see tenancy-claim-service.ts step 3.
    if (error?.name === "TenancyEligibilityError") {
      return apiError(error.message, error.code, error.status ?? 409, error.disclosure);
    }

    logger.error("tenancy_claim.confirm_failed", {
      error: error?.message || String(error),
    });
    return apiError("Failed to confirm claim", "TENANCY_CLAIM_CONFIRM_FAILED", 500);
  }
}

function getRequestIp(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}
