export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { getClientIp } from "@/lib/security/api-guard";
import { ForgotPasswordByPhoneSchema } from "@/lib/validators/otp";

/**
 * Start a password reset by WhatsApp code, for people who don't have (or
 * can't reach) the email on their account — tenants especially, who were
 * often onboarded with an owner-supplied email.
 *
 * Unlike the email route, this one **tells the caller whether the number is
 * registered** (amended 2026-08-08, ADR-055). The signup routes already
 * disclose the same fact with "Phone number already registered", so the
 * generic reply protected nothing while stranding anyone who mistyped a digit
 * on a code-entry screen for five minutes. Rate limits still sit in front of
 * the lookup so this cannot sweep a number range.
 */

export async function POST(req: NextRequest) {
  const ip = getClientIp(req) ?? "unknown";
  const userAgent = req.headers.get("user-agent") || undefined;

  try {
    const body = await req.json().catch(() => ({}));
    const validated = ForgotPasswordByPhoneSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Enter a valid phone number", "VALIDATION_ERROR", 400);
    }

    const phone = validated.data.phone;
    const [phoneLimit, ipLimit] = await Promise.all([
      rateLimitService.checkStatelessLimit({
        scope: "password-reset:phone",
        identifier: phone,
        maxAttempts: 5,
        windowSeconds: 15 * 60,
        failOpen: true,
      }),
      rateLimitService.checkStatelessLimit({
        scope: "password-reset:ip",
        identifier: ip,
        maxAttempts: 20,
        windowSeconds: 60 * 60,
        failOpen: true,
      }),
    ]);

    if (!phoneLimit.allowed || !ipLimit.allowed) {
      return apiError(
        "Too many reset requests. Please wait before trying again.",
        "RATE_LIMITED",
        429,
      );
    }

    const result = await authService.requestPasswordResetByPhone(phone, { ipAddress: ip, userAgent });

    if (!result.account_exists) {
      return apiError(result.message, "NO_ACCOUNT_FOR_PHONE", 404);
    }

    return apiResponse({ success: true, message: result.message, account_exists: true }, 200);
  } catch (error) {
    // An OtpServiceError here means the code could not be sent (provider
    // unavailable, or this number/IP hit its limit). Surfaced with its own
    // code so the UI keeps the caller on the phone step instead of advancing
    // to a code screen for a code that will never arrive.
    if (error instanceof OtpServiceError) {
      return apiError(error.message, error.code, error.status);
    }
    console.error("[auth.forgot-password.phone] request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError("Could not send a code right now. Please try email instead.", "OTP_SEND_FAILED", 502);
  }
}
