export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { getClientIp } from "@/lib/security/api-guard";
import { clearCsrfCookie } from "@/lib/security/csrf";
import { ResetPasswordSchema } from "@/lib/validators";

export async function POST(req: NextRequest) {
  const ip = getClientIp(req) ?? "unknown";
  const userAgent = req.headers.get("user-agent") || undefined;

  try {
    const body = await req.json().catch(() => ({}));
    const validated = ResetPasswordSchema.safeParse(body);
    if (!validated.success) {
      return apiError(
        validated.error.errors[0]?.message || "Validation error",
        "VALIDATION_ERROR",
        400,
      );
    }

    const result = await authService.completePasswordReset({
      code: validated.data.code,
      accessToken: validated.data.access_token,
      newPassword: validated.data.new_password,
      meta: {
        ipAddress: ip,
        userAgent,
      },
    });

    const response = NextResponse.json(result, { status: 200 });
    response.cookies.set("hms_session", "", { httpOnly: true, expires: new Date(0), path: "/" });
    response.cookies.set("hms_refresh_token", "", { httpOnly: true, expires: new Date(0), path: "/" });
    clearCsrfCookie(response);
    return response;
  } catch (error: any) {
    const message = String(error?.message || "Password reset failed");
    if (message.startsWith("VALIDATION_ERROR")) {
      return apiError(message.split(": ")[1] || "Reset link is invalid or expired", "VALIDATION_ERROR", 400);
    }
    console.error("[auth.reset-password] reset failed", {
      error: message,
    });
    return apiError("Could not reset password right now", "PASSWORD_RESET_ERROR", 500);
  }
}
