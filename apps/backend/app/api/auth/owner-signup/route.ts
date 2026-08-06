export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { OwnerSignupSchema } from "@/lib/validators";
import { rateLimitService } from "@/lib/services/rate-limit-service";
import { getClientIp } from "@/lib/security/api-guard";
import { ACCESS_TOKEN_MAX_AGE_SECONDS, getSessionCookieOptions, TENANT_REFRESH_DAYS } from "@/lib/services/session-lifecycle-service";
import { setCsrfCookie } from "@/lib/security/csrf";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { resolveSignupPhoneVerification } from "@/lib/services/auth/signup-phone-verification-gate";
import { leadInvitationService } from "@/src/services/platform-leads/lead-invitation-service";
import { platformLeadNotificationService } from "@/src/services/platform-leads/platform-lead-notification-service";

const OTP_PURPOSE = "PHONE_VERIFICATION";

/**
 * Real StayO owner self-signup. Public route — creates the owner profile
 * directly (see authService.selfSignUpOwner's doc comment for why this is a
 * separate, ungated method from the legacy registerOwner) and logs the new
 * owner in immediately, mirroring /api/auth/login's response + cookie shape.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req) ?? undefined;

  try {
    const body = await req.json().catch(() => ({}));
    const validated = OwnerSignupSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }
    const { email, password, name, phone, lead_token } = validated.data;

    const rlResult = await rateLimitService.checkRateLimit(email, "REGULAR", ip);
    if (!rlResult.allowed) {
      return apiError(
        `Too many attempts. Please wait ${Math.ceil((rlResult.retryAfterSeconds ?? 900) / 60)} minutes.`,
        "RATE_LIMITED",
        429,
      );
    }

    const normalizedPhone = normalizeWhatsAppPhone(phone);
    const verification = await resolveSignupPhoneVerification(normalizedPhone, OTP_PURPOSE);
    if (!verification.ok) {
      return apiError("Phone verification is required before signing up", "PHONE_NOT_VERIFIED", 400);
    }

    let profile;
    try {
      profile = await authService.selfSignUpOwner({
        email,
        password,
        name,
        phone: normalizedPhone,
        phoneVerified: verification.phoneVerified,
      });
    } catch (signupErr: any) {
      await rateLimitService.recordAttempt(email, "REGULAR", false, ip, req.headers.get("user-agent") ?? undefined, signupErr?.message);
      throw signupErr;
    }
    await rateLimitService.recordAttempt(email, "REGULAR", true, ip);

    // Owner-acquisition funnel phase 2: if this signup came from a lead
    // activation link, mark the lead OWNER_ACTIVATED. Never blocks the
    // real signup — the account is already legitimately created above
    // regardless of whether this side effect succeeds.
    if (lead_token) {
      try {
        await leadInvitationService.activateInvitationForOwner(lead_token, profile.id);
      } catch (err) {
        console.error("[auth.owner-signup] lead activation side effect failed (non-fatal)", err);
      }

      // stayo_owner_welcome is superseded by stayo_owner_account_activated
      // (design doc D4). The old handler and its approved template are left
      // in place but no longer called — see Changelog.
      if (profile.phone) {
        void platformLeadNotificationService
          .sendAccountActivated(profile.id, profile.name, profile.phone)
          .catch((err) => {
            console.error("[owner-signup] account-activated notify failed", err);
          });
      } else {
        console.warn("[auth.owner-signup] skipping account-activated notify: profile has no phone", {
          profileId: profile.id,
        });
      }
    }

    const sessionResult = await authService.createSessionAndTokens(profile, null, null, {
      ipAddress: ip,
      userAgent: req.headers.get("user-agent"),
    }, password);

    // ADR-031: refresh_token is included in the JSON body — the frontend
    // needs it for supabase.auth.setSession(). See the identical note in
    // app/api/auth/login/route.ts.
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
    console.error("Detailed API Error [auth.owner-signup]:", error);
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
