export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { getClientIp } from "@/lib/security/api-guard";
import { ForgotPasswordSchema } from "@/lib/validators";

const GENERIC_MESSAGE = "If an account exists for this email, you will receive password reset instructions shortly.";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req) ?? "unknown";
  const userAgent = req.headers.get("user-agent") || undefined;

  try {
    const body = await req.json().catch(() => ({}));
    const validated = ForgotPasswordSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Enter a valid email address", "VALIDATION_ERROR", 400);
    }

    const email = validated.data.email.trim().toLowerCase();
    const [emailLimit, ipLimit] = await Promise.all([
      rateLimitService.checkStatelessLimit({
        scope: "password-reset:email",
        identifier: email,
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

    if (!emailLimit.allowed || !ipLimit.allowed) {
      return apiError(
        "Too many reset requests. Please wait before trying again.",
        "RATE_LIMITED",
        429,
      );
    }

    await authService.requestPasswordReset(email, {
      ipAddress: ip,
      userAgent,
    });

    return apiResponse({ success: true, message: GENERIC_MESSAGE }, 200);
  } catch (error) {
    console.error("[auth.forgot-password] request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError("Could not process password reset right now", "PASSWORD_RESET_ERROR", 500);
  }
}
