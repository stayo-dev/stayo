export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { getClientIp } from "@/lib/security/api-guard";
import { VerifyResetOtpSchema } from "@/lib/validators/otp";

/**
 * Exchange a verified WhatsApp code for a short-lived reset token, which the
 * client then submits to POST /api/auth/reset-password — the same endpoint the
 * emailed link uses. Setting the password stays in one place (one-time-use
 * lock, session revocation and Supabase identity sync included) rather than
 * being reimplemented for the phone channel.
 *
 * The OTP service's own errors (invalid, expired, attempts exceeded, replay)
 * are passed through with their codes so the UI can tell "wrong code" from
 * "expired code" — unlike the account lookup itself, which stays generic.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req) ?? "unknown";
  const userAgent = req.headers.get("user-agent") || undefined;

  try {
    const body = await req.json().catch(() => ({}));
    const validated = VerifyResetOtpSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Enter the 6-digit code sent to your number", "VALIDATION_ERROR", 400);
    }

    const result = await authService.verifyPasswordResetOtp({
      phone: validated.data.phone,
      otp: validated.data.otp,
      meta: { ipAddress: ip, userAgent },
    });

    return apiResponse(result, 200);
  } catch (error: any) {
    if (error instanceof OtpServiceError) {
      return apiError(error.message, error.code, error.status);
    }

    const message = String(error?.message || "Verification failed");
    if (message.startsWith("VALIDATION_ERROR")) {
      return apiError(message.split(": ")[1] || "Invalid or expired code", "VALIDATION_ERROR", 400);
    }

    console.error("[auth.verify-reset-otp] verification failed", { error: message });
    return apiError("Could not verify that code right now", "PASSWORD_RESET_ERROR", 500);
  }
}
