export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { getLogger } from "@/lib/logger";
import { emailOtpService } from "@/lib/services/auth/email-otp-service";
import { OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { requestIp, resolveOnboardingForEmail } from "../resolve-onboarding";

const logger = getLogger("api.tenants.activate.email.send");

/**
 * POST /api/tenants/activate/email/send  { token, email }
 *
 * Emails a six-digit code to the address a tenant gave on the Identity
 * screen. Onboarding cannot finish without proving one — see
 * `EmailOtpService` and `resolveAccountEmail`.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const onboarding = await resolveOnboardingForEmail(body?.token);
    if (!onboarding.ok) return apiError(onboarding.message, onboarding.code, onboarding.status);

    const result = await emailOtpService.sendCode({
      invitationId: onboarding.invitationId,
      email: body?.email,
      ownProfileId: onboarding.profileId,
      tenantName: onboarding.tenantName,
      hostelName: onboarding.hostelName,
      requestIp: requestIp(req),
    });
    return apiResponse(result);
  } catch (error: any) {
    if (error instanceof OtpServiceError) return apiError(error.message, error.code, error.status);
    logger.error("email_otp.send_route_failed", { error: error?.message || String(error) });
    return apiError("We couldn't send the code. Try again in a moment.", "EMAIL_SEND_FAILED", 500);
  }
}
