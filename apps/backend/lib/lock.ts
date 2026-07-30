import { prisma } from "./db";

export async function acquireSystemLock(key: string, ttlSeconds = 20): Promise<boolean> {
  const result = await prisma.$executeRaw`
    INSERT INTO system_locks (key, locked_at, expires_at)
    VALUES (${key}, NOW(), NOW() + cast(${ttlSeconds || 20} || ' seconds' as interval))
    ON CONFLICT (key) DO UPDATE
    SET locked_at = NOW(), expires_at = NOW() + cast(${ttlSeconds || 20} || ' seconds' as interval)
    WHERE system_locks.expires_at < NOW()
  `;
  return result > 0;
}

export async function releaseSystemLock(key: string) {
  await prisma.$executeRaw`DELETE FROM system_locks WHERE key = ${key}`.catch(() => {});
}

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
