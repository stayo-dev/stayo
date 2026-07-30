export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { z } from "zod";

const ResetPasswordSchema = z.object({
  phone: z.string().min(10, "Phone number is required"),
  current_password: z.string().min(6, "Current password is required"),
  new_password: z.string().min(8, "New password must be at least 8 characters"),
  confirm_password: z.string(),
});

/**
 * 🔐 Reset Onboarding Password
 * POST /api/auth/reset-onboarding-password
 * Access: Public (but requires valid current password)
 * 
 * For imported tenants to reset their onboarding password on first login
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = ResetPasswordSchema.safeParse(body);

    if (!validated.success) {
      return apiError(
        validated.error.errors[0]?.message || "Validation error",
        "VALIDATION_ERROR",
        400
      );
    }

    const { phone, current_password, new_password, confirm_password } = validated.data;

    if (new_password !== confirm_password) {
      return apiError("Passwords do not match", "VALIDATION_ERROR", 400);
    }

    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const userAgent = req.headers.get("user-agent") || undefined;

    const rateLimitCheck = await rateLimitService.checkRateLimit(
      phone,
      "ONBOARDING",
      ipAddress
    );

    if (!rateLimitCheck.allowed) {
      return apiError(
        `Too many attempts. Please try again in ${Math.ceil((rateLimitCheck.retryAfterSeconds || 0) / 60)} minutes.`,
        "RATE_LIMIT_EXCEEDED",
        429
      );
    }

    try {
      const result = await authService.resetOnboardingPassword(
        phone,
        current_password,
        new_password
      );

      await rateLimitService.recordAttempt(
        phone,
        "ONBOARDING",
        true,
        ipAddress,
        userAgent
      );

      return apiResponse(result, 200);
    } catch (resetError: any) {
      await rateLimitService.recordAttempt(
        phone,
        "ONBOARDING",
        false,
        ipAddress,
        userAgent,
        resetError.message || "PASSWORD_RESET_FAILED"
      );

      throw resetError;
    }
  } catch (error: any) {
    if (error.message.startsWith("UNAUTHORIZED")) {
      return apiError(error.message.split(": ")[1] || "Invalid credentials", "UNAUTHORIZED", 401);
    }
    if (error.message.startsWith("VALIDATION_ERROR")) {
      return apiError(error.message.split(": ")[1] || "Validation failed", "VALIDATION_ERROR", 400);
    }
    return apiError(error.message || "Password reset failed", "RESET_ERROR", 500);
  }
}
