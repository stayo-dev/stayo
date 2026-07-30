import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { getRedisClient, isRedisConfigured } from "@/lib/redis/client";
import { del } from "@/lib/redis/cache";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { redisKeys } from "@/lib/redis/keys";
import { getRedisMetrics, resetRedisMetrics } from "@/lib/redis/metrics";
import { getCachedDashboard, setDashboardCache } from "@/lib/cache/dashboard-cache";
import {
  getSessionActivity,
  markSessionRevoked,
  touchSessionActivity,
} from "@/lib/redis/session-revocation";
import { checkSessionRevocationEdge } from "@/lib/redis/session-revocation-edge";

const originalPrefix = process.env.REDIS_KEY_PREFIX || "hms";
process.env.REDIS_KEY_PREFIX = `${originalPrefix}:audit:${Date.now()}`;

async function main() {
  if (!isRedisConfigured()) {
    throw new Error("Redis is not configured. Set REDIS_ENABLED, UPSTASH_REDIS_REST_URL, and UPSTASH_REDIS_REST_TOKEN.");
  }

  const redis = getRedisClient();
  assert(redis, "Redis client is available");
  await redis.ping();

  const sessionId = "session-audit";
  const userId = "user-audit";
  const dashboardKey = redisKeys.dashboard.stats("owner-audit", "hostel-audit");
  const rateLimitKey = redisKeys.rateLimit("audit:login", "user@example.com");

  resetRedisMetrics();

  await setDashboardCache(dashboardKey, { ok: true }, 30, []);
  const firstDashboard = await getCachedDashboard(dashboardKey);
  const secondDashboard = await getCachedDashboard(dashboardKey);
  assert.deepEqual(firstDashboard, { ok: true });
  assert.deepEqual(secondDashboard, { ok: true });

  const firstLimit = await checkFixedWindowLimit({
    scope: "audit:login",
    identifier: "user@example.com",
    maxAttempts: 1,
    windowSeconds: 60,
  });
  const secondLimit = await checkFixedWindowLimit({
    scope: "audit:login",
    identifier: "user@example.com",
    maxAttempts: 1,
    windowSeconds: 60,
  });
  assert.equal(firstLimit.allowed, true, "first rate-limit attempt is allowed");
  assert.equal(secondLimit.allowed, false, "second rate-limit attempt is blocked");

  await markSessionRevoked(sessionId, 60);
  const revocation = await checkSessionRevocationEdge({ sid: sessionId, sub: userId, iat: Math.floor(Date.now() / 1000) });
  assert.deepEqual(revocation, { ok: false, reason: "session_revoked" });

  const firstTouch = await touchSessionActivity("session-throttle-audit", 60, 300);
  const firstActivity = await getSessionActivity("session-throttle-audit");
  const secondTouch = await touchSessionActivity("session-throttle-audit", 60, 300);
  const secondActivity = await getSessionActivity("session-throttle-audit");
  assert.equal(firstTouch.touched, true, "first activity touch writes");
  assert.equal(secondTouch.touched, false, "second activity touch is throttled");
  assert.equal(firstActivity, secondActivity, "throttled touch does not update activity value");

  const metrics = getRedisMetrics();
  const cacheRequests = metrics.hit + metrics.miss;
  const cacheHitRate = cacheRequests > 0 ? Math.round((metrics.hit / cacheRequests) * 1000) / 10 : 0;

  await del(
    dashboardKey,
    rateLimitKey,
    redisKeys.session.revoked(sessionId),
    redisKeys.session.activity("session-throttle-audit"),
    redisKeys.session.activityThrottle("session-throttle-audit"),
  );

  console.log(JSON.stringify({
    redis_ping: "ok",
    dashboard_cache_hit_rate_pct: cacheHitRate,
    redis_metrics: metrics,
    login_rate_limit_blocked: !secondLimit.allowed,
    logout_revocation_enforced: !revocation.ok && revocation.reason === "session_revoked",
    session_activity_throttled: firstTouch.touched && !secondTouch.touched && firstActivity === secondActivity,
  }, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
