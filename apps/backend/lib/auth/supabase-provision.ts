/**
 * Google auto-provisioning for brand-new Stayo accounts (2026-08-16).
 *
 * `resolveSupabaseSession` (supabase-session.ts) is — and stays — hard-tested
 * to never auto-provision (tests/auth-hardening-security.test.ts, "No
 * Auto-Provisioning"). This file does not touch it or weaken that invariant;
 * it adds a separate, narrowly-scoped path that only ever fires from the new
 * `POST /api/auth/google/provision` endpoint, never from the normal login
 * path (`getSession()`/`/auth/me`).
 *
 * The account shape mirrors `authService.selfSignUpTenant()` — role TENANT,
 * no owner_id, no `tenants` row, `is_profile_completed: true` (that flag
 * gates the *invited*-tenant onboarding wizard, not a marketplace account,
 * which has no hostel to complete a profile for). It differs in two ways
 * `selfSignUpTenant` doesn't need to: no `password_hash` (Google already
 * authenticated them, no password exists) and `phone: null` (Google doesn't
 * collect one — verified separately at enquiry time, see
 * `app/api/profile/route.ts` + the existing `send-phone-otp`/
 * `verify-phone-otp` routes).
 */
import { prisma } from "../db";
import { eventLog } from "../services/event-log-service";
import { checkFixedWindowLimit } from "../redis/rate-limit";
import { resolveSupabaseSession, type SupabaseSessionContext, type ResolveResult } from "./supabase-session";

const REJECT_NO_ACCOUNT =
  "No account found for this email. Please sign in with email and password, or contact your hostel administrator.";
const REJECT_RATE_LIMITED = "Too many account attempts. Please try again in a few minutes.";

export async function provisionMarketplaceTenantFromSupabase(ctx: SupabaseSessionContext): Promise<ResolveResult> {
  // If a profile already exists for this email (any role), this is not a
  // provisioning case at all — delegate to the normal, unmodified resolver,
  // which already has the correct link/disabled/tenancy-gate logic. This is
  // also what keeps this function from ever being usable to silently take
  // over an existing account: provisioning below only runs in the `null`
  // branch of the exact same lookup `resolveSupabaseSession` itself does.
  const existing = await prisma.profile.findUnique({ where: { email: ctx.email.toLowerCase() } });
  if (existing) {
    return resolveSupabaseSession(ctx);
  }

  // Reuse the abuse-prevention primitive already used for OTP sending
  // (lib/redis/rate-limit.ts) rather than building a second one. Keyed on
  // email + IP separately, same pattern as auth-otp-service.ts.
  const emailLimit = await checkFixedWindowLimit({
    scope: "google-provision:email",
    identifier: ctx.email.toLowerCase(),
    maxAttempts: 5,
    windowSeconds: 60 * 60,
  });
  if (emailLimit.available && !emailLimit.allowed) {
    return { ok: false, code: "NO_STAYO_ACCOUNT", message: REJECT_RATE_LIMITED };
  }
  if (ctx.ipAddress) {
    const ipLimit = await checkFixedWindowLimit({
      scope: "google-provision:ip",
      identifier: ctx.ipAddress,
      maxAttempts: 15,
      windowSeconds: 60 * 60,
    });
    if (ipLimit.available && !ipLimit.allowed) {
      return { ok: false, code: "NO_STAYO_ACCOUNT", message: REJECT_RATE_LIMITED };
    }
  }

  // Only ever provision from a verified Google identity — an unverified
  // email or a non-Google provider gets the normal rejection instead of a
  // new account nobody can prove they own.
  if (ctx.provider !== "google" || !ctx.emailVerified) {
    await eventLog.log("AUTH_GOOGLE_REJECTED", null, {
      email: ctx.email,
      reason: "PROVISION_REQUIRES_VERIFIED_GOOGLE",
      ip_address: ctx.ipAddress || null,
      user_agent: ctx.userAgent || null,
    });
    return { ok: false, code: "NO_STAYO_ACCOUNT", message: REJECT_NO_ACCOUNT };
  }

  const profile = await prisma.profile.create({
    data: {
      id: ctx.authUserId,
      email: ctx.email.toLowerCase(),
      name: ctx.name?.trim() || ctx.email.split("@")[0],
      role: "TENANT",
      is_active: true,
      // No owner_id: belongs to no hostel until an owner invites them.
      is_profile_completed: true,
      phone: null,
      phone_verified: false,
      auth_user_id: ctx.authUserId,
      auth_linked_at: new Date(),
    },
  });

  await eventLog.log("AUTH_GOOGLE_PROVISIONED", null, {
    email: ctx.email,
    profile_id: profile.id,
    ip_address: ctx.ipAddress || null,
    user_agent: ctx.userAgent || null,
  });

  // Delegate to the normal resolver, which now finds this profile by
  // `auth_user_id` (the same lookup every other Supabase-authenticated
  // request goes through) and builds the session payload the usual way —
  // no second payload-building implementation to keep in sync.
  return resolveSupabaseSession(ctx);
}
