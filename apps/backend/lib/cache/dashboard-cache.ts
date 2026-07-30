import { dashboardSnapshotService } from "../services/dashboard-snapshot-service";
import { getJson, invalidateTag, setJson } from "@/lib/redis/cache";
import { redisKeys } from "@/lib/redis/keys";

const dashboardCache = new Map<string, { data: any, timestamp: number, ttlMs: number }>();

function setMemoryCache(key: string, data: any, ttlSeconds: number) {
  dashboardCache.set(key, {
    data,
    timestamp: Date.now(),
    ttlMs: ttlSeconds * 1000,
  });
}

function getMemoryCache(key: string) {
  const entry = dashboardCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttlMs) {
    dashboardCache.delete(key);
    return null;
  }
  return entry.data;
}

export function invalidateDashboardCache(ownerId: string) {
  for (const key of Array.from(dashboardCache.keys())) {
    if (key.startsWith(`${ownerId}_`) || key.includes(ownerId)) {
      dashboardCache.delete(key);
    }
  }
  invalidateTag(redisKeys.tag.ownerDashboard(ownerId)).catch(() => {});
  dashboardSnapshotService.markOwnerStale(ownerId).catch(() => {});
}

export const invalidateOwnerDashboardCache = invalidateDashboardCache;

export function invalidateHostelDashboardCache(hostelId: string) {
  for (const key of Array.from(dashboardCache.keys())) {
    if (key.includes(`_${hostelId}`) || key.includes(hostelId) || key === hostelId) dashboardCache.delete(key);
  }
  invalidateTag(redisKeys.tag.hostelDashboard(hostelId)).catch(() => {});
}

export function invalidatePortfolioCache(ownerId: string) {
  for (const key of Array.from(dashboardCache.keys())) {
    if (key.startsWith(`portfolio_${ownerId}`) || key.includes(ownerId)) dashboardCache.delete(key);
  }
  invalidateTag(redisKeys.tag.ownerDashboard(ownerId)).catch(() => {});
}

export function invalidateTenantDashboardCache(tenantOrProfileId: string) {
  for (const key of Array.from(dashboardCache.keys())) {
    if (key.includes(tenantOrProfileId)) dashboardCache.delete(key);
  }
  invalidateTag(redisKeys.tag.tenantDashboard(tenantOrProfileId)).catch(() => {});
}

export async function getCachedDashboard<T = any>(key: string): Promise<T | null> {
  const redisValue = await getJson<T>(key);
  if (redisValue !== null) {
    setMemoryCache(key, redisValue, 15);
    return redisValue;
  }
  return getMemoryCache(key);
}

export async function setDashboardCache(key: string, data: any, ttlSeconds = 60, tags: string[] = []) {
  setMemoryCache(key, data, ttlSeconds);
  await setJson(key, data, ttlSeconds, tags);
}
