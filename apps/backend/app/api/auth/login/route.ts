export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { LoginSchema } from "@/lib/validators";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { getClientIp } from "@/lib/security/api-guard";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, getSessionCookieOptions, TENANT_REFRESH_DAYS } from "@/lib/services/session-lifecycle-service";
import { setCsrfCookie } from "@/lib/security/csrf";


/**
 * 🔐 AUTH LOGIN (Production Secure)
 * Rate-limited per identifier (email) + IP.
 * Sets secure, HTTP-only cookies for session management.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req) ?? undefined;

  try {
    const body = await req.json().catch(() => ({}));

    const validated = LoginSchema.safeParse(body);

    if (!validated.success) {
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }

    const { email, password } = validated.data;

    // ── Rate limit check (per email identifier + IP) ───────────────────────
    const rlResult = await rateLimitService.checkRateLimit(email, "REGULAR", ip);
    if (!rlResult.allowed) {
      return apiError(
        `Too many login attempts. Please wait ${Math.ceil((rlResult.retryAfterSeconds ?? 900) / 60)} minutes.`,
        "RATE_LIMITED",
        429,
      );
    }

    let loginResult: Awaited<ReturnType<typeof authService.login>>;
    try {
      loginResult = await authService.login(email, password, {
        ipAddress: ip,
        userAgent: req.headers.get("user-agent"),
      });
    } catch (loginErr: any) {
      // Record failed attempt before re-throwing
      await rateLimitService.recordAttempt(email, "REGULAR", false, ip, req.headers.get("user-agent") ?? undefined, loginErr?.message);
      throw loginErr;
    }

    // Record successful attempt
    await rateLimitService.recordAttempt(email, "REGULAR", true, ip);

    // ADR-031: `refresh_token` is now included in the JSON body — the
    // frontend needs it to call `supabase.auth.setSession({access_token,
    // refresh_token})`, since Supabase's own client-side session storage
    // is what actually keeps the session alive/refreshing, not this
    // cookie. (Real tradeoff, documented in the ADR: the refresh token is
    // now JS-readable for that reason, where it previously wasn't.) The
    // httpOnly cookies below are kept anyway as a harmless fallback for
    // the SSE/legacy-cookie token-extraction path in middleware.ts.
    const response = NextResponse.json({
      success: true,
      ...loginResult,
    }, { status: 200 });

    response.cookies.set("hms_session", loginResult.access_token, {
      ...getSessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS),
    });
    response.cookies.set("hms_refresh_token", loginResult.refresh_token, {
      ...getSessionCookieOptions(60 * 60 * 24 * TENANT_REFRESH_DAYS),
    });
    setCsrfCookie(response, 60 * 60 * 24 * TENANT_REFRESH_DAYS);

    console.log(`[auth.login] Login successful for ${email}`);
    return response;
  } catch (error: any) {
    console.error("Detailed API Error [auth.login]:", error);
    const message = error?.message || "Login failed";

    if (
      message.includes("DATABASE_URL") ||
      message.includes("Error validating datasource") ||
      message.includes("Authentication failed against database server") ||
      message.includes("provided database credentials")
    ) {
      return apiError(
        "Server configuration error: the Vercel backend database connection is missing, invalid, or using incorrect credentials.",
        "SERVER_MISCONFIGURED",
        500
      );
    }
    
    if (message.startsWith("UNAUTHORIZED")) {
      return apiError(message.split(": ")[1] || "Invalid credentials", "UNAUTHORIZED", 401);
    }
    if (message.startsWith("FORBIDDEN")) {
      return apiError(message.split(": ")[1] || "Access denied", "FORBIDDEN", 403);
    }
    if (message.startsWith("PASSWORD_RESET_REQUIRED")) {
      return apiError(
        message.split(": ")[1] || "Password reset required",
        "PASSWORD_RESET_REQUIRED",
        403
      );
    }
    if (message.startsWith("ONBOARDING_EXPIRED")) {
      return apiError(
        message.split(": ")[1] || "Onboarding credentials expired",
        "ONBOARDING_EXPIRED",
        403
      );
    }
    if (message.startsWith("VALIDATION_ERROR")) {
      return apiError(message.split(": ")[1] || "Validation failed", "VALIDATION_ERROR", 400);
    }

    /**
     * `INTERNAL:` — the credentials were already accepted and the failure is
     * on the Supabase side (`ensureSupabaseIdentity` / `signInWithSupabasePassword`,
     * see lib/auth/supabase-identity.ts). Until this branch existed, every one
     * of those fell through to the generic 500 below and the UI said
     * "Something went wrong. Please try again." — indistinguishable from a bug
     * in our own code, and actively misleading, because the single most common
     * cause is a transient `fetch failed`: the server simply could not reach
     * Supabase. Observed live on 2026-08-09, where three attempts a minute
     * apart alternated success / `fetch failed` / success.
     *
     * Reported as 503, not 500: the request was well-formed and the caller's
     * password was right, so retrying is genuinely the correct advice rather
     * than a platitude. The upstream message is deliberately not forwarded —
     * it is Supabase-internal and means nothing to the person reading it.
     */
    if (message.startsWith("INTERNAL")) {
      const unreachable =
        message.includes("fetch failed") ||
        message.includes("ETIMEDOUT") ||
        message.includes("ECONNREFUSED") ||
        message.includes("ENOTFOUND") ||
        message.includes("EAI_AGAIN");
      return apiError(
        unreachable
          ? "Couldn't reach the sign-in service. Check your connection and try again."
          : "Sign-in is temporarily unavailable. Please try again in a moment.",
        "AUTH_PROVIDER_UNAVAILABLE",
        503,
      );
    }


    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
