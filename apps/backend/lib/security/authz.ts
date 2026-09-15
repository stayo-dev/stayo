/**
 * Centralized authorization guards for route handlers.
 *
 * Why this exists (C2, 2026-09-14 security audit): `/api/admin/**` and
 * `/api/platform-admin/**` each re-implemented their own role check inline, and
 * three reconciliation routes gated on `role === "OWNER"` instead of "ADMIN" —
 * so any owner (owner signup is public) reached platform-wide financial
 * tooling. A single blessed helper means a new admin route has one obvious,
 * correct thing to call, and the enumerating test in
 * tests/admin-routes-guarded.test.ts can assert every admin route uses it.
 *
 * These return a ready 403/401 `Response` (or null when the caller may proceed)
 * rather than throwing, matching the dominant route style in this codebase:
 *
 *   const denied = requireAdmin(session);
 *   if (denied) return denied;
 *   // ...session is a platform admin from here on
 */
import type { AuthPayload } from "../auth-edge";
import { apiError } from "../auth-edge";

type SessionLike = Pick<AuthPayload, "sub" | "role"> | null | undefined;

/**
 * Platform-admin only. Returns a 401 when unauthenticated, a 403 when the
 * caller is not an ADMIN, or null when the caller is a platform admin.
 */
export function requireAdmin(session: SessionLike): Response | null {
  if (!session) {
    return apiError("Authentication required", "UNAUTHORIZED", 401);
  }
  if (session.role !== "ADMIN") {
    return apiError("Admin access required", "FORBIDDEN", 403);
  }
  return null;
}

/** True when the session belongs to a platform admin. For inline branching. */
export function isAdmin(session: SessionLike): boolean {
  return !!session && session.role === "ADMIN";
}
