export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { getLogger } from "@/lib/logger";
import { emailOtpService } from "@/lib/services/auth/email-otp-service";
import { OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { resolveOnboardingForEmail } from "../resolve-onboarding";

const logger = getLogger("api.tenants.activate.email.verify");

/**
 * POST /api/tenants/activate/email/verify  { token, email, code }
 *
 * Confirms the code. On success the address is marked verified for this
 * invitation only; the ACCOUNT step then writes it onto the account and
 * spends the verification.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const onboarding = await resolveOnboardingForEmail(body?.token);
    if (!onboarding.ok) return apiError(onboarding.message, onboarding.code, onboarding.status);

    const result = await emailOtpService.verifyCode({
      invitationId: onboarding.invitationId,
      email: body?.email,
      code: body?.code,
    });
    return apiResponse({ verified: true, email: result.email });
  } catch (error: any) {
    if (error instanceof OtpServiceError) return apiError(error.message, error.code, error.status);
    logger.error("email_otp.verify_route_failed", { error: error?.message || String(error) });
    return apiError("We couldn't check the code. Try again in a moment.", "OTP_VERIFY_FAILED", 500);
  }
}
