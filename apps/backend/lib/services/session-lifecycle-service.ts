import { prisma } from "@/lib/db";
import {
  markSessionRevoked,
  markUserSessionsRevokedAfter,
  touchSessionActivity,
} from "@/lib/redis/session-revocation";

// Session-minting/rotation (createSession, rotateRefreshToken) moved to
// Supabase Auth (ADR-031) — Supabase's own refresh-token rotation and
// reuse detection replace what this class used to do with `refresh_tokens`
// directly (that custom rotation was dead code in production anyway; only
// the non-rotating /api/auth/refresh path ever ran). What's kept here:
// the policy constants (still read by several routes/cookie-setters) and
// `touchSession`/`revokeSession`, which remain meaningful during the
// dual-accept transition window for in-flight legacy sessions, and
// `revokeSession` doubles as the Redis-side revocation write Supabase
// itself has no equivalent for (immediate kill of a stateless access
// token before its `exp`).
export const ACCESS_TOKEN_MAX_AGE_SECONDS = 12 * 60 * 60;
/**
 * How long a session may sit idle before it is ended.
 *
 * **Seven days, not thirty minutes.** Thirty minutes meant an owner signing in
 * ten to twenty times a day — they run a hostel, they are not sitting at a desk
 * — and that friction bought less than it looked like it did.
 *
 * What the idle timeout actually protects is a *walked-away screen showing
 * tenant details*. It is **not** what protects the dangerous actions: changing
 * rent, changing payment frequency, and cancelling or waiving an obligation all
 * require a fresh `confirm-identity` step-up token with a two-minute life, so a
 * live session cannot move money without re-proving who is holding it.
 *
 * The other two bounds are unchanged and are what keep this honest:
 * - the **30-day absolute cap** (Supabase session settings) still ends every
 *   session regardless of activity;
 * - **logout and password reset still revoke immediately** via the Redis
 *   deny-list, so a session a person wants gone is gone at once.
 */
export const INACTIVITY_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;
export const WARNING_AFTER_MS = 25 * 60 * 1000;
export const TENANT_REFRESH_DAYS = 30;
export const OWNER_ABSOLUTE_MS = 30 * 24 * 60 * 60 * 1000;

type SessionLifecycleDeps = {
  prismaClient?: typeof prisma;
  touchSessionActivityFn?: typeof touchSessionActivity;
  markSessionRevokedFn?: typeof markSessionRevoked;
  markUserSessionsRevokedAfterFn?: typeof markUserSessionsRevokedAfter;
};

export function getSessionCookieOptions(maxAge: number) {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    maxAge,
    path: "/",
  };
}

export class SessionLifecycleService {
  private readonly db: typeof prisma;
  private readonly touchSessionActivityValue: typeof touchSessionActivity;
  private readonly markSessionRevokedValue: typeof markSessionRevoked;
  private readonly markUserSessionsRevokedAfterValue: typeof markUserSessionsRevokedAfter;

  constructor(deps: SessionLifecycleDeps = {}) {
    this.db = deps.prismaClient || prisma;
    this.touchSessionActivityValue = deps.touchSessionActivityFn || touchSessionActivity;
    this.markSessionRevokedValue = deps.markSessionRevokedFn || markSessionRevoked;
    this.markUserSessionsRevokedAfterValue =
      deps.markUserSessionsRevokedAfterFn || markUserSessionsRevokedAfter;
  }

  /** Idle-timeout heartbeat for legacy-mode sessions (Supabase-mode idle checks live in middleware.ts, Redis-only). */
  async touchSession(sessionId: string | null | undefined, userId: string) {
    if (!sessionId) return false;
    const now = new Date();
    const activityTouch = await this.touchSessionActivityValue(sessionId);
    if (activityTouch.available && !activityTouch.touched) {
      return true;
    }
    const result = await this.db.refresh_tokens.updateMany({
      where: {
        session_id: sessionId,
        user_id: userId,
        revoked_at: null,
        expires_at: { gt: now },
      },
      data: { last_activity_at: now },
    });
    return result.count > 0;
  }

  /**
   * Revoke a session (by sessionId) or every session for a user (by
   * userId, sessionId omitted). Writes to Redis (read by middleware.ts's
   * `checkSessionRevocationEdge` for both legacy and Supabase-mode
   * requests) and, where a matching row exists, the legacy `refresh_tokens`
   * table — a no-op for Supabase-minted sessions, which never write one.
   */
  async revokeSession(sessionId: string | null | undefined, userId?: string) {
    if (!sessionId && !userId) return;
    const revokedAt = Date.now();
    await this.db.refresh_tokens.updateMany({
      where: {
        ...(sessionId ? { session_id: sessionId } : {}),
        ...(userId ? { user_id: userId } : {}),
        revoked_at: null,
      },
      data: {
        revoked_at: new Date(),
        expires_at: new Date(0),
      },
    });
    if (sessionId) await this.markSessionRevokedValue(sessionId);
    if (!sessionId && userId) await this.markUserSessionsRevokedAfterValue(userId, revokedAt);
  }
}

export const sessionLifecycleService = new SessionLifecycleService();
