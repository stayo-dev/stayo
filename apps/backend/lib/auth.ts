/**
 * Full auth utilities (Node.js runtime only).
 * Re-exports everything from auth-edge + adds getSession() (needs Prisma, so
 * it can't live in the Edge-safe module). No password functions: Clerk holds
 * every credential (ADR-204).
 * API route handlers should import from here.
 */
import crypto from "crypto";
import type { NextRequest } from "next/server";
import type { AuthPayload } from "./auth-edge";
import { resolveSupabaseSession } from "./auth/supabase-session";
import { resolveClerkSession, profileHasClerkLogin } from "./auth/clerk-session-resolver";

// Re-export all Edge-compatible utilities
export {
  verifyToken,
  generateToken,
  generateShortToken,
  apiResponse,
  apiError,
  generateResetToken,
  verifyResetToken,
} from "./auth-edge";

export type { AuthPayload } from "./auth-edge";

/**
 * Session helper — reads the identity middleware.ts already verified and
 * injected as headers. `x-auth-mode: clerk` is the session authority
 * (ADR-204) and resolves the profile by Clerk user id. `supabase` and
 * `legacy` survive only for the transition, and only for profiles that have
 * not moved onto Clerk. Every mode returns the same shape, so no route
 * handler needs to know which one it got.
 */
export async function getSession(req: NextRequest): Promise<AuthPayload | null> {
  const authMode = req.headers.get("x-auth-mode");

  // Clerk (ADR-204) — the session authority. Resolved by Clerk user id only.
  if (authMode === "clerk") {
    const clerkUserId = req.headers.get("x-auth-user-id");
    if (!clerkUserId) return null;
    const result = await resolveClerkSession({
      clerkUserId,
      sessionId: req.headers.get("x-auth-session-id"),
    });
    return result.ok ? result.payload : null;
  }

  // ── Transition only: pre-Clerk tokens. Deleted in Phase 4. ──────────────
  // Either kind is refused for a profile that has moved onto Clerk. That
  // refusal is what ends a Supabase session after a reset or change on the
  // Clerk side — no call into Supabase Auth, no touching auth.* tables.
  if (authMode === "legacy") {
    const userId = req.headers.get("x-user-id");
    const userRole = req.headers.get("x-user-role");
    if (!userId || !userRole) return null;
    if (await profileHasClerkLogin(userId)) return null;
    return {
      sub: userId,
      role: userRole,
      email: req.headers.get("x-user-email") || "",
      owner_id: req.headers.get("x-owner-id"),
      tenant_id: req.headers.get("x-tenant-id"),
      sid: req.headers.get("x-session-id"),
    };
  }

  if (authMode === "supabase") {
    const authUserId = req.headers.get("x-auth-user-id");
    if (!authUserId) return null;
    const result = await resolveSupabaseSession({
      authUserId,
      email: req.headers.get("x-auth-email") || "",
      emailVerified: true, // already-established session, not the initial OAuth handshake
      sessionId: req.headers.get("x-auth-session-id"),
      provider: req.headers.get("x-auth-provider"),
    });
    if (!result.ok) return null;
    if (await profileHasClerkLogin(result.payload.sub)) return null;
    return result.payload;
  }

  return null;
}

// `hashPassword` / `verifyPassword` were removed with ADR-204: this app no
// longer stores passwords. Clerk holds every credential; see
// src/services/auth/credential-service.ts, the only module that checks one.
