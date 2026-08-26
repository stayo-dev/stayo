import { Redis } from "@upstash/redis";

let edgeRedisClient: Redis | null | undefined;
const SESSION_ACTIVITY_THROTTLE_SECONDS = 5 * 60;
const localActivityTouchMs = new Map<string, number>();

function clean(value: string | number | null | undefined) {
  return encodeURIComponent(String(value ?? "none"));
}

function edgeRedisKey(...parts: Array<string | number | null | undefined>) {
  const prefix = process.env.REDIS_KEY_PREFIX || "hms";
  return [prefix, "v1", ...parts.map(clean)].join(":");
}

/**
 * Exported solely so `tests/redis-key-parity.test.ts` can assert these keys
 * are byte-identical to `lib/redis/keys.ts`'s `redisKeys.session.*`. Node
 * writes those keys and this Edge module reads them, and divergence fails
 * open and silent — a logged-out token would keep working. Not for use by
 * application code: everything outside the Edge runtime should go through
 * `redisKeys` instead.
 */
export const edgeSessionKeys = {
  revoked: (sessionId: string) => edgeRedisKey("session", "revoked", sessionId),
  userRevokedAfter: (userId: string) => edgeRedisKey("session", "user-revoked-after", userId),
  activity: (sessionId: string) => edgeRedisKey("session", "activity", sessionId),
  activityThrottle: (sessionId: string) => edgeRedisKey("session", "activity-throttle", sessionId),
};

/**
 * Exported for `app/api/health/redis-edge` only, so the diagnostic exercises
 * the *same* client this module uses rather than an equivalent copy — that is
 * the whole point of the check. Application code must not reach for a raw
 * client; use the exported check functions below.
 */
export function getEdgeRedisClientForDiagnostics() {
  return getEdgeRedisClient();
}

function getEdgeRedisClient() {
  if (process.env.REDIS_ENABLED === "false") return null;
  if (edgeRedisClient !== undefined) return edgeRedisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  edgeRedisClient = url && token ? new Redis({
    url,
    token,
    signal: () => AbortSignal.timeout(1000), // Fail fast after 1 second
  }) : null;
  return edgeRedisClient;
}

export type SessionRevocationCheck =
  | { ok: true }
  | { ok: false; reason: "missing_session" | "session_revoked" | "user_revoked" };

export function evaluateSessionRevocation(
  payload: { sid?: string | null; sub: string; iat?: number },
  sessionRevoked: number | string | null,
  userRevokedAfter: number | string | null,
): SessionRevocationCheck {
  if (!payload.sid) return { ok: false, reason: "missing_session" };
  if (sessionRevoked !== null) return { ok: false, reason: "session_revoked" };

  const issuedAtMs = payload.iat ? payload.iat * 1000 : 0;
  if (userRevokedAfter !== null && issuedAtMs <= Number(userRevokedAfter)) {
    return { ok: false, reason: "user_revoked" };
  }

  return { ok: true };
}

export async function checkSessionRevocationEdge(payload: {
  sid?: string | null;
  sub: string;
  iat?: number;
}): Promise<SessionRevocationCheck> {
  if (!payload.sid) return { ok: false, reason: "missing_session" };

  const redis = getEdgeRedisClient();
  if (!redis) return { ok: true };

  const [sessionRevoked, userRevokedAfter] = await Promise.all([
    redis.get<number>(edgeSessionKeys.revoked(payload.sid)),
    redis.get<number>(edgeSessionKeys.userRevokedAfter(payload.sub)),
  ]);

  return evaluateSessionRevocation(payload, sessionRevoked, userRevokedAfter);
}

// Duplicated from session-lifecycle-service.ts's INACTIVITY_TIMEOUT_MS
// rather than imported — that file is Node-only (Prisma), this one must
// stay Edge-bundleable. Keep the two values in sync.
const IDLE_TIMEOUT_MS = 7 * 24 * 60 * 60 * 1000;

export type IdleTimeoutCheck = { ok: true } | { ok: false; reason: "inactive" };

/**
 * Supabase access tokens are stateless and valid until `exp` — they carry
 * no knowledge of this app's 30-minute idle-timeout business rule. This
 * re-derives it from the same Redis activity key `touchSessionActivityEdge`
 * already writes (throttled to once per 5 minutes), so idle enforcement for
 * Supabase-authenticated requests happens here in middleware instead of the
 * legacy path's Node-side `sessionLifecycleService.touchSession()`.
 */
export async function checkIdleTimeoutEdge(sessionId: string | null | undefined): Promise<IdleTimeoutCheck> {
  if (!sessionId) return { ok: true };
  const redis = getEdgeRedisClient();
  if (!redis) return { ok: true }; // fail open, matching the existing revocation-check posture on Redis outage

  const lastActivity = await redis.get<number>(edgeSessionKeys.activity(sessionId));
  if (lastActivity === null) return { ok: true }; // no activity recorded yet this session — don't block the first request

  if (Date.now() - Number(lastActivity) > IDLE_TIMEOUT_MS) {
    return { ok: false, reason: "inactive" };
  }
  return { ok: true };
}

export async function touchSessionActivityEdge(sessionId: string | null | undefined) {
  if (!sessionId) return;
  const now = Date.now();
  const lastLocalTouch = localActivityTouchMs.get(sessionId) || 0;
  if (now - lastLocalTouch < SESSION_ACTIVITY_THROTTLE_SECONDS * 1000) return;

  const redis = getEdgeRedisClient();
  if (!redis) return;
  const throttle = await redis.set(edgeSessionKeys.activityThrottle(sessionId), "1", {
    nx: true,
    ex: SESSION_ACTIVITY_THROTTLE_SECONDS,
  });
  if (throttle !== "OK") {
    localActivityTouchMs.set(sessionId, now);
    return;
  }
  await redis.set(edgeSessionKeys.activity(sessionId), now, { ex: 60 * 60 * 24 * 30 });
  localActivityTouchMs.set(sessionId, now);
}
