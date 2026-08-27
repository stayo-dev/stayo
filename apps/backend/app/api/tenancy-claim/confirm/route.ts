export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse, getSession } from "@/lib/auth";
import { getLogger } from "@/lib/logger";
import { tenancyClaimService, TenancyClaimError } from "@/src/services/tenants/tenancy-claim-service";
import { TenancyClaimConfirmSchema } from "@/lib/validators/tenancy-claim";

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
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const validated = TenancyClaimConfirmSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Invalid request", "VALIDATION_ERROR", 400);
    }

    const session = await getSession(req);
    const profileId = session && session.role === "TENANT" ? session.sub : null;

    const result = await tenancyClaimService.confirm({
      tenantId: validated.data.tenant_id,
      phone: validated.data.phone,
      profileId,
      requestIp: getRequestIp(req),
    });

    return apiResponse(result);
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
