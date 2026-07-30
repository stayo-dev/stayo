/**
 * Full auth utilities (Node.js runtime only).
 * Re-exports everything from auth-edge + adds bcrypt password functions +
 * getSession() (needs Prisma, so it can't live in the Edge-safe module).
 * API route handlers should import from here.
 */
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { NextRequest } from "next/server";
import type { AuthPayload } from "./auth-edge";
import { resolveSupabaseSession } from "./auth/supabase-session";

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
 * injected as headers. Dual-mode (ADR-031): `x-auth-mode: legacy` is the
 * pre-migration header shape (a straight read, no DB); `x-auth-mode:
 * supabase` resolves the profile via `resolveSupabaseSession()` (one
 * indexed DB lookup). Either way the returned shape is identical to what
 * every route handler has always received — no caller needs to change.
 */
export async function getSession(req: NextRequest): Promise<AuthPayload | null> {
  const authMode = req.headers.get("x-auth-mode");

  if (authMode === "legacy") {
    const userId = req.headers.get("x-user-id");
    const userRole = req.headers.get("x-user-role");
    if (!userId || !userRole) return null;
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
    return result.ok ? result.payload : null;
  }

  return null;
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}
