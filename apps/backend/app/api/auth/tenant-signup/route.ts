export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { apiError } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { TenantSignupSchema } from "@/lib/validators";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { getClientIp } from "@/lib/security/api-guard";
import {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  getSessionCookieOptions,
  TENANT_REFRESH_DAYS,
} from "@/lib/services/session-lifecycle-service";
import { setCsrfCookie } from "@/lib/security/csrf";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { resolveSignupPhoneVerification } from "@/lib/services/auth/signup-phone-verification-gate";

const OTP_PURPOSE = "PHONE_VERIFICATION";

/**
 * Self-serve tenant signup (ADR-035) — creates a marketplace account
 * (browse/save/enquire), not a tenant of any hostel; see
 * `authService.selfSignUpTenant`'s doc comment for why no `tenants` row is
 * written. Same rate limiter and same session/cookie shape as /login.
 *
 * Unlike /api/auth/owner-signup, `phone` is optional here (ADR-096). A
 * marketplace account is name + email + password; the number is collected and
 * verified once, when it is actually needed — sending an enquiry — which is
 * the same shape a Google-provisioned account already has (`phone: null`, see
 * `lib/auth/supabase-provision.ts`). A caller that *does* send a phone still
 * has to have verified it first: the OTP gate below is unchanged for that
 * case, so this loosening cannot be used to attach an unverified number.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req) ?? undefined;

  try {
    const body = await req.json().catch(() => ({}));
    const validated = TenantSignupSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }
    const { email, password, name, phone } = validated.data;

    const rlResult = await rateLimitService.checkRateLimit(email, "REGULAR", ip);
    if (!rlResult.allowed) {
      return apiError(
        `Too many attempts. Please wait ${Math.ceil((rlResult.retryAfterSeconds ?? 900) / 60)} minutes.`,
        "RATE_LIMITED",
        429,
      );
    }

    // No phone supplied is the normal path now; a supplied one keeps the gate.
    let normalizedPhone: string | null = null;
    let phoneVerified = false;
    if (phone) {
      normalizedPhone = normalizeWhatsAppPhone(phone);
      const verification = await resolveSignupPhoneVerification(normalizedPhone, OTP_PURPOSE);
      if (!verification.ok) {
        return apiError("Phone verification is required before signing up", "PHONE_NOT_VERIFIED", 400);
      }
      phoneVerified = verification.phoneVerified;
    }

    let profile;
    try {
      profile = await authService.selfSignUpTenant({
        email,
        password,
        name,
        phone: normalizedPhone,
        phoneVerified,
      });
    } catch (signupErr: any) {
      await rateLimitService.recordAttempt(
        email,
        "REGULAR",
        false,
        ip,
        req.headers.get("user-agent") ?? undefined,
        signupErr?.message,
      );
      throw signupErr;
    }
    await rateLimitService.recordAttempt(email, "REGULAR", true, ip);

    // No tenant record exists yet by design, so tenantId is null — the same
    // shape /login produces for a marketplace account.
    const sessionResult = await authService.createSessionAndTokens(
      profile,
      null,
      null,
      { ipAddress: ip, userAgent: req.headers.get("user-agent") },
      password,
    );

    // ADR-031: refresh_token is included in the JSON body — the frontend
    // needs it for supabase.auth.setSession(). See app/api/auth/login/route.ts.
    const response = NextResponse.json({ success: true, ...sessionResult }, { status: 201 });
    response.cookies.set("hms_session", sessionResult.access_token, {
      ...getSessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS),
    });
    response.cookies.set("hms_refresh_token", sessionResult.refresh_token, {
      ...getSessionCookieOptions(60 * 60 * 24 * TENANT_REFRESH_DAYS),
    });
    setCsrfCookie(response, 60 * 60 * 24 * TENANT_REFRESH_DAYS);

    return response;
  } catch (error: any) {
    console.error("Detailed API Error [auth.tenant-signup]:", error);
    const message = error?.message || "Signup failed";

    if (message.startsWith("ALREADY_EXISTS")) {
      return apiError(message.split(": ")[1] || "Already registered", "ALREADY_EXISTS", 409);
    }
    if (message.startsWith("VALIDATION_ERROR")) {
      return apiError(message.split(": ")[1] || "Validation failed", "VALIDATION_ERROR", 400);
    }
    return apiError("Signup failed", "INTERNAL_ERROR", 500);
  }
}
