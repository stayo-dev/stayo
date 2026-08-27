export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { getLogger } from "@/lib/logger";
import { tenancyClaimService, TenancyClaimError } from "@/src/services/tenants/tenancy-claim-service";
import { TenancyClaimLookupSchema } from "@/lib/validators/tenancy-claim";

const logger = getLogger("api.tenancy-claim.lookup");

/**
 * Public (pre-auth), like `/api/auth/send-phone-otp`. Requires a fresh,
 * verified `TENANCY_CLAIM`-purpose OTP for the phone, AND the `claim_token`
 * returned by that verification (`POST /auth/verify-phone-otp`'s
 * `claim_token` field) — see `claim-eligibility.ts`'s module comment for why
 * the token is required, not just a fresh verified proof.
 *
 * Returns display data only, never obligations/balances/payment history: a
 * mistyped digit must not expose a stranger's finances.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const validated = TenancyClaimLookupSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Invalid phone number", "VALIDATION_ERROR", 400);
    }

    const tenancies = await tenancyClaimService.lookup({
      phone: validated.data.phone,
      claimToken: validated.data.claim_token,
      requestIp: getRequestIp(req),
    });

    return apiResponse({ tenancies });
  } catch (error: any) {
    if (error instanceof TenancyClaimError) {
      return apiError(error.message, error.code, error.status);
    }

    logger.error("tenancy_claim.lookup_failed", {
      error: error?.message || String(error),
    });
    return apiError("Failed to look up tenancy", "TENANCY_CLAIM_LOOKUP_FAILED", 500);
  }
}

function getRequestIp(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}
