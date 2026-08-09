/**
 * Node-side profile resolution for Supabase-authenticated requests
 * (ADR-031). Deliberately NOT resolved via Supabase JWT custom claims (a
 * Custom Access Token Hook) — see the ADR for why: tenant_id doesn't exist
 * until activation, is_active must revoke access immediately, and owner_id
 * is already known to go stale. A DB lookup per request is the tradeoff
 * made instead; it costs one indexed query, same as /api/auth/me already
 * does on every heartbeat.
 *
 * Used by both `getSession()` (lib/auth.ts, every route, generic 401 on
 * failure) and `/api/auth/me` (needs the specific rejection reason to show
 * the right message — e.g. "no account for this Google email").
 */
import { prisma } from "../db";
import type { AuthPayload } from "../auth-edge";
import { eventLog } from "../services/event-log-service";
import { getActiveTenancy } from "@/lib/tenancy/active-tenancy";

export interface SupabaseSessionContext {
  authUserId: string;
  email: string;
  emailVerified: boolean;
  sessionId: string | null;
  provider: string | null;
  ipAddress?: string;
  userAgent?: string;
}

export type ResolveResult =
  | { ok: true; payload: AuthPayload }
  | { ok: false; code: "NO_STAYO_ACCOUNT" | "ACCOUNT_DISABLED" | "TENANCY_NOT_ACTIVATED"; message: string };

const REJECT_NO_ACCOUNT =
  "No account found for this email. Please sign in with email and password, or contact your hostel administrator.";
const REJECT_DISABLED = "Account is disabled";
/**
 * Mirrors the gate `authService.login()` applies to an INVITED tenancy. Google
 * sign-in must not become a way around it: ADR-054 opened Google to tenants,
 * and an invited-but-not-activated tenant reaching a dashboard would skip
 * activation entirely.
 */
const REJECT_NOT_ACTIVATED =
  "Your account isn't activated yet. Please use the activation link sent to you, then sign in.";

export async function resolveSupabaseSession(ctx: SupabaseSessionContext): Promise<ResolveResult> {
  let profile = await prisma.profile.findUnique({
    where: { auth_user_id: ctx.authUserId },
  });

  if (!profile) {
    // Not yet linked — fall back to matching by email (same trust model
    // googleLogin() used before this migration: Supabase has already
    // verified the identity provider handshake, we just look up our own
    // record). Google sign-in specifically must never auto-provision an
    // account — see tests/auth-hardening-security.test.ts.
    const byEmail = await prisma.profile.findUnique({
      where: { email: ctx.email.toLowerCase() },
    });

    if (!byEmail) {
      await eventLog.log("AUTH_GOOGLE_REJECTED", null, {
        email: ctx.email,
        reason: "NO_EXISTING_ACCOUNT",
        ip_address: ctx.ipAddress || null,
        user_agent: ctx.userAgent || null,
      });
      return { ok: false, code: "NO_STAYO_ACCOUNT", message: REJECT_NO_ACCOUNT };
    }

    if (!byEmail.is_active) {
      await eventLog.log("AUTH_GOOGLE_REJECTED", byEmail.owner_id, {
        email: ctx.email,
        profile_id: byEmail.id,
        reason: "ACCOUNT_DISABLED",
        ip_address: ctx.ipAddress || null,
        user_agent: ctx.userAgent || null,
      });
      return { ok: false, code: "ACCOUNT_DISABLED", message: REJECT_DISABLED };
    }

    // Link — but only on a verified email, strictly more verification than
    // the raw OAuth2 flow this replaces (which discarded email_verified
    // entirely).
    if (ctx.provider !== "google" || ctx.emailVerified) {
      await prisma.profile.update({
        where: { id: byEmail.id },
        data: { auth_user_id: ctx.authUserId, auth_linked_at: new Date() },
      });
      await eventLog.log("AUTH_SUPABASE_IDENTITY_LINKED", byEmail.owner_id, {
        email: ctx.email,
        profile_id: byEmail.id,
        provider: ctx.provider,
      });
      profile = byEmail;
    } else {
      return { ok: false, code: "NO_STAYO_ACCOUNT", message: REJECT_NO_ACCOUNT };
    }
  }

  if (!profile.is_active) {
    return { ok: false, code: "ACCOUNT_DISABLED", message: REJECT_DISABLED };
  }

  // Tenants may sign in with Google (ADR-047), but the activation gate that
  // `authService.login()` enforces has to hold on this path too.
  const liveTenancy = await getActiveTenancy(profile.id);
  if (profile.role === "TENANT" && liveTenancy?.status === "INVITED") {
    await eventLog.log("AUTH_GOOGLE_REJECTED", profile.owner_id, {
      email: ctx.email,
      profile_id: profile.id,
      reason: "TENANCY_NOT_ACTIVATED",
      ip_address: ctx.ipAddress || null,
      user_agent: ctx.userAgent || null,
    });
    return { ok: false, code: "TENANCY_NOT_ACTIVATED", message: REJECT_NOT_ACTIVATED };
  }

  // Same owner_id self-heal createSessionAndTokens() has always done.
  let effectiveOwnerId = profile.owner_id;
  if (profile.role === "OWNER" && (!effectiveOwnerId || effectiveOwnerId.trim() === "")) {
    const updated = await prisma.profile.update({
      where: { id: profile.id },
      data: { owner_id: profile.id },
      select: { owner_id: true },
    });
    effectiveOwnerId = updated.owner_id;
  }

  const payload: AuthPayload = {
    sub: profile.id,
    role: profile.role,
    email: profile.email,
    owner_id: effectiveOwnerId || null,
    tenant_id: liveTenancy?.id || null,
    sid: ctx.sessionId,
  };

  return { ok: true, payload };
}
