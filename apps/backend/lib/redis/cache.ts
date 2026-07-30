import { safeRedis } from "./client";
import { incrementRedisMetric } from "./metrics";

type CacheTag = string;

export async function getJson<T>(key: string): Promise<T | null> {
  const value = await safeRedis<T | null>("cache.get", (redis) => redis.get<T>(key), null);
  incrementRedisMetric(value === null ? "miss" : "hit");
  return value;
}

export async function setJson<T>(
  key: string,
  value: T,
  ttlSeconds: number,
  tags: CacheTag[] = [],
) {
  const ok = await safeRedis("cache.set", async (redis) => {
    await redis.set(key, value, { ex: ttlSeconds });
    if (tags.length > 0) {
      await Promise.all(tags.map((tag) => redis.sadd(tag, key)));
      await Promise.all(tags.map((tag) => redis.expire(tag, Math.max(ttlSeconds, 300))));
    }
    return true;
  }, false);
  if (ok) incrementRedisMetric("set");
  return ok;
}

export async function getOrSetJson<T>(
  key: string,
  ttlSeconds: number,
  loader: () => Promise<T>,
  tags: CacheTag[] = [],
) {
  const cached = await getJson<T>(key);
  if (cached !== null) return cached;
  const value = await loader();
  await setJson(key, value, ttlSeconds, tags);
  return value;
}

export async function del(...keys: string[]) {
  const filtered = keys.filter(Boolean);
  if (filtered.length === 0) return 0;
  const count = await safeRedis("cache.del", (redis) => redis.del(...filtered), 0);
  if (count > 0) incrementRedisMetric("delete");
  return count;
}

export async function delByPattern(pattern: string) {
  return safeRedis("cache.delByPattern", async (redis) => {
    let cursor = 0;
    let deleted = 0;
    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: pattern, count: 100 });
      cursor = Number(nextCursor);
      if (keys.length > 0) deleted += await redis.del(...keys);
    } while (cursor !== 0);
    if (deleted > 0) incrementRedisMetric("delete");
    return deleted;
  }, 0);
}

export async function invalidateTag(tag: string) {
  return safeRedis("cache.invalidateTag", async (redis) => {
    const keys = await redis.smembers<string[]>(tag);
    if (!keys || keys.length === 0) return 0;
    const deleted = await redis.del(...keys, tag);
    if (deleted > 0) incrementRedisMetric("delete");
    return deleted;
  }, 0);
}

export async function addTags(key: string, tags: CacheTag[], ttlSeconds: number) {
  if (tags.length === 0) return;
  await safeRedis("cache.addTags", async (redis) => {
    await Promise.all(tags.map((tag) => redis.sadd(tag, key)));
    await Promise.all(tags.map((tag) => redis.expire(tag, Math.max(ttlSeconds, 300))));
    return true;
  }, false);
}

