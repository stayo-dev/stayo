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
  /** Google's display name, if any — only read by supabase-provision.ts. */
  name?: string;
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
  const profile = await prisma.profile.findUnique({
    where: { auth_user_id: ctx.authUserId },
  });

  if (!profile) {
    // A token no profile is linked to is refused — never matched by email.
    // An email match used to link the token here (overwriting any existing
    // link), so anyone who could get a Supabase session for an email — a
    // self-signup with the public anon key, or an address they had just
    // written onto someone else's profile — became that profile. A profile
    // gains a Supabase identity only where the backend has proved the
    // password first (`ensureSupabaseIdentity`) or at signup, born linked.
    await eventLog.log("AUTH_SUPABASE_UNLINKED_REJECTED", null, {
      auth_user_id: ctx.authUserId,
      email: ctx.email,
      provider: ctx.provider,
      ip_address: ctx.ipAddress || null,
      user_agent: ctx.userAgent || null,
    });
    return { ok: false, code: "NO_STAYO_ACCOUNT", message: REJECT_NO_ACCOUNT };
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
