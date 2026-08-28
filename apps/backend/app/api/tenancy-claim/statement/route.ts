export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { getLogger } from "@/lib/logger";
import { tenancyClaimService, TenancyClaimError } from "@/src/services/tenants/tenancy-claim-service";
import { TenancyClaimStatementSchema } from "@/lib/validators/tenancy-claim";

const logger = getLogger("api.tenancy-claim.statement");

/**
 * Public (pre-auth), like `/api/auth/send-phone-otp` and
 * `/tenancy-claim/lookup`. Requires the same fresh, verified
 * `TENANCY_CLAIM`-purpose OTP proof and `claim_token` as `lookup`/`confirm`
 * — see `tenancyClaimService.statement`'s doc comment.
 *
 * Unlike `lookup`, this DOES return financial data (rent months, payments,
 * outstanding total) for the one tenancy id requested — that's the point:
 * a person about to inherit an owner-kept ledger gets to read it first. The
 * proof this reads is never consumed here, so calling this does not use up
 * the single-use proof `confirm` still needs to finish the claim.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const validated = TenancyClaimStatementSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Invalid request", "VALIDATION_ERROR", 400);
    }

    const statement = await tenancyClaimService.statement({
      tenantId: validated.data.tenant_id,
      phone: validated.data.phone,
      claimToken: validated.data.claim_token,
      requestIp: getRequestIp(req),
    });

    return apiResponse(statement);
  } catch (error: any) {
    if (error instanceof TenancyClaimError) {
      return apiError(error.message, error.code, error.status);
    }

    logger.error("tenancy_claim.statement_failed", {
      error: error?.message || String(error),
    });
    return apiError("Failed to load statement", "TENANCY_CLAIM_STATEMENT_FAILED", 500);
  }
}

function getRequestIp(req: NextRequest) {
  const forwardedFor = req.headers.get("x-forwarded-for");
  if (forwardedFor) return forwardedFor.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}
