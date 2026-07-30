import { safeRedis } from "./client";
import { redisKeys } from "./keys";
import { incrementRedisMetric } from "./metrics";

export interface FixedWindowLimit {
  scope: string;
  identifier: string;
  maxAttempts: number;
  windowSeconds: number;
}

export interface FixedWindowResult {
  available: boolean;
  allowed: boolean;
  attempts: number;
  attemptsRemaining: number;
  retryAfterSeconds: number;
}

export async function checkFixedWindowLimit(config: FixedWindowLimit): Promise<FixedWindowResult> {
  const key = redisKeys.rateLimit(config.scope, config.identifier);

  const result = await safeRedis<FixedWindowResult | null>("rateLimit.fixedWindow", async (redis) => {
    const attempts = await redis.incr(key);
    if (attempts === 1) await redis.expire(key, config.windowSeconds);
    const ttl = await redis.ttl(key);
    const allowed = attempts <= config.maxAttempts;
    if (!allowed) incrementRedisMetric("rate_limit_blocked");
    return {
      available: true,
      allowed,
      attempts,
      attemptsRemaining: Math.max(0, config.maxAttempts - attempts),
      retryAfterSeconds: ttl > 0 ? ttl : config.windowSeconds,
    };
  }, null);

  return result ?? {
    available: false,
    allowed: true,
    attempts: 0,
    attemptsRemaining: config.maxAttempts,
    retryAfterSeconds: config.windowSeconds,
  };
}

export async function setOneTimeLock(key: string, ttlSeconds: number) {
  return safeRedis("rateLimit.oneTimeLock", async (redis) => {
    const result = await redis.set(key, "1", { nx: true, ex: ttlSeconds });
    return result === "OK";
  }, true);
}

export async function releaseOneTimeLock(key: string) {
  return safeRedis("rateLimit.releaseOneTimeLock", async (redis) => {
    await redis.del(key);
    return true;
  }, true);
}
