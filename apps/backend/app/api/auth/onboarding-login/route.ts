export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, getSessionCookieOptions, TENANT_REFRESH_DAYS } from "@/lib/services/session-lifecycle-service";
import { setCsrfCookie } from "@/lib/security/csrf";
import { z } from "zod";

const OnboardingLoginSchema = z.object({
  phone: z.string().min(10, "Phone number is required"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

/**
 * 🔐 Onboarding Login (Phone + Password)
 * POST /api/auth/onboarding-login
 * Access: Public
 * 
 * For tenants imported via bulk import to login with phone + onboarding password
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const validated = OnboardingLoginSchema.safeParse(body);

    if (!validated.success) {
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }

    const { phone, password } = validated.data;
    const ipAddress = req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "unknown";
    const userAgent = req.headers.get("user-agent") || undefined;

    const rateLimitCheck = await rateLimitService.checkRateLimit(
      phone,
      "ONBOARDING",
      ipAddress
    );

    if (!rateLimitCheck.allowed) {
      await rateLimitService.recordAttempt(
        phone,
        "ONBOARDING",
        false,
        ipAddress,
        userAgent,
        "RATE_LIMIT_EXCEEDED"
      );

      return apiError(
        `Too many login attempts. Please try again in ${Math.ceil((rateLimitCheck.retryAfterSeconds || 0) / 60)} minutes.`,
        "RATE_LIMIT_EXCEEDED",
        429
      );
    }

    try {
      const loginResult = await authService.loginWithPhone(phone, password, {
        ipAddress,
        userAgent,
      });

      await rateLimitService.recordAttempt(
        phone,
        "ONBOARDING",
        true,
        ipAddress,
        userAgent
      );

      // ADR-031: refresh_token is included in the JSON body — the frontend
      // needs it for supabase.auth.setSession(). See the identical note in
      // app/api/auth/login/route.ts.
      const response = NextResponse.json(loginResult, { status: 200 });

      response.cookies.set("hms_session", loginResult.access_token, {
        ...getSessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS),
      });

      response.cookies.set("hms_refresh_token", loginResult.refresh_token, {
        ...getSessionCookieOptions(60 * 60 * 24 * TENANT_REFRESH_DAYS),
      });
      setCsrfCookie(response, 60 * 60 * 24 * TENANT_REFRESH_DAYS);

      return response;
    } catch (authError: any) {
      const errorMessage = authError.message || "Login failed";

      await rateLimitService.recordAttempt(
        phone,
        "ONBOARDING",
        false,
        ipAddress,
        userAgent,
        errorMessage
      );

      throw authError;
    }
  } catch (error: any) {
    if (error.message.startsWith("UNAUTHORIZED")) {
      return apiError(error.message.split(": ")[1] || "Invalid credentials", "UNAUTHORIZED", 401);
    }
    if (error.message.startsWith("FORBIDDEN")) {
      return apiError(error.message.split(": ")[1] || "Access denied", "FORBIDDEN", 403);
    }
    if (error.message.startsWith("PASSWORD_RESET_REQUIRED")) {
      return apiError(
        error.message.split(": ")[1] || "Password reset required",
        "PASSWORD_RESET_REQUIRED",
        403
      );
    }
    return apiError(error.message || "Login failed", "LOGIN_ERROR", 500);
  }
}
