export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { getClientIp } from "@/lib/security/api-guard";
import { ForgotPasswordByPhoneSchema } from "@/lib/validators/otp";

/**
 * Start a password reset by WhatsApp code, for people who don't have (or
 * can't reach) the email on their account — tenants especially, who were
 * often onboarded with an owner-supplied email.
 *
 * Mirrors the email route's contract exactly: one generic 200 whether or not
 * the number is registered, so this cannot be used to discover which phone
 * numbers have Stayo accounts. Rate limits sit in front of the lookup for the
 * same reason — a limit applied only to real accounts would leak through
 * timing and status codes alike.
 */
const GENERIC_MESSAGE =
  "If an account exists for this number, you will receive a verification code on WhatsApp.";

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

    await authService.requestPasswordResetByPhone(phone, { ipAddress: ip, userAgent });

    return apiResponse({ success: true, message: GENERIC_MESSAGE }, 200);
  } catch (error) {
    console.error("[auth.forgot-password.phone] request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError("Could not process password reset right now", "PASSWORD_RESET_ERROR", 500);
  }
}
