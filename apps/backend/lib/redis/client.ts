import { Redis } from "@upstash/redis";
import { getLogger } from "@/lib/logger";
import { incrementRedisMetric } from "./metrics";

const logger = getLogger("redis");

let redisClient: Redis | null | undefined;

function redisEnabled() {
  return process.env.REDIS_ENABLED !== "false";
}

export function getRedisClient() {
  if (!redisEnabled()) return null;
  if (redisClient !== undefined) return redisClient;

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    redisClient = null;
    logger.warn("redis.config_missing", {
      has_url: Boolean(url),
      has_token: Boolean(token),
    });
    return null;
  }

  redisClient = new Redis({
    url,
    token,
    signal: () => AbortSignal.timeout(1000), // Fail fast after 1 second
  });
  return redisClient;
}

export async function safeRedis<T>(
  operation: string,
  fn: (redis: Redis) => Promise<T>,
  fallback: T,
): Promise<T> {
  const redis = getRedisClient();
  if (!redis) {
    incrementRedisMetric("fallback");
    return fallback;
  }

  try {
    return await fn(redis);
  } catch (error) {
    incrementRedisMetric("error");
    incrementRedisMetric("fallback");
    logger.warn("redis.operation_failed", {
      operation,
      error: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

export function isRedisConfigured() {
  return Boolean(getRedisClient());
}

