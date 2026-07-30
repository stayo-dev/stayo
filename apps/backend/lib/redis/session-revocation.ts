import { safeRedis } from "./client";
import { redisKeys } from "./keys";

const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
export const SESSION_ACTIVITY_THROTTLE_SECONDS = 5 * 60;

const localActivityTouchMs = new Map<string, number>();

export type SessionActivityTouchResult = {
  available: boolean;
  touched: boolean;
};

export async function markSessionRevoked(
  sessionId: string | null | undefined,
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
) {
  if (!sessionId) return false;
  return safeRedis(
    "session.markRevoked",
    (redis) => redis.set(redisKeys.session.revoked(sessionId), Date.now(), { ex: ttlSeconds }).then(() => true),
    false,
  );
}

export async function markUserSessionsRevokedAfter(
  userId: string | null | undefined,
  revokedAfterMs = Date.now(),
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
) {
  if (!userId) return false;
  return safeRedis(
    "session.markUserRevokedAfter",
    (redis) =>
      redis
        .set(redisKeys.session.userRevokedAfter(userId), revokedAfterMs, { ex: ttlSeconds })
        .then(() => true),
    false,
  );
}

export async function touchSessionActivity(
  sessionId: string | null | undefined,
  ttlSeconds = DEFAULT_SESSION_TTL_SECONDS,
  throttleSeconds = SESSION_ACTIVITY_THROTTLE_SECONDS,
): Promise<SessionActivityTouchResult> {
  if (!sessionId) return { available: false, touched: false };
  const now = Date.now();
  const lastLocalTouch = localActivityTouchMs.get(sessionId) || 0;
  if (now - lastLocalTouch < throttleSeconds * 1000) {
    return { available: true, touched: false };
  }

  return safeRedis(
    "session.touchActivity",
    async (redis) => {
      const throttle = await redis.set(redisKeys.session.activityThrottle(sessionId), "1", {
        nx: true,
        ex: throttleSeconds,
      });
      if (throttle !== "OK") {
        localActivityTouchMs.set(sessionId, now);
        return { available: true, touched: false };
      }
      await redis.set(redisKeys.session.activity(sessionId), now, { ex: ttlSeconds });
      localActivityTouchMs.set(sessionId, now);
      return { available: true, touched: true };
    },
    { available: false, touched: false },
  );
}

export async function getSessionActivity(sessionId: string | null | undefined) {
  if (!sessionId) return null;
  return safeRedis<number | null>(
    "session.getActivity",
    (redis) => redis.get<number>(redisKeys.session.activity(sessionId)),
    null,
  );
}
