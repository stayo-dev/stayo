import crypto from "crypto";
import { safeRedis } from "./client";
import { redisKeys } from "./keys";
import { incrementRedisMetric } from "./metrics";

export type RedisQueueName =
  | "whatsapp-reminders"
  | "email-notifications"
  | "receipt-generation"
  | "rent-generation"
  | "late-fee-processing";

export interface RedisQueueJob<T = unknown> {
  jobId: string;
  type: string;
  payload: T;
  idempotencyKey: string;
  attempts: number;
  maxAttempts: number;
  runAfter: number;
  createdAt: number;
  lastError?: string;
}

export async function enqueueJob<T>(
  queueName: RedisQueueName,
  input: Omit<RedisQueueJob<T>, "jobId" | "attempts" | "createdAt"> & { jobId?: string },
) {
  const job: RedisQueueJob<T> = {
    ...input,
    jobId: input.jobId || crypto.randomUUID(),
    attempts: 0,
    createdAt: Date.now(),
  };

  return safeRedis<RedisQueueJob<T> | null>("queue.enqueue", async (redis) => {
    const idemKey = redisKeys.queue.idempotency(queueName, job.idempotencyKey);
    const claimed = await redis.set(idemKey, job.jobId, { nx: true, ex: 7 * 24 * 60 * 60 });
    if (claimed !== "OK") return null;
    await redis.set(redisKeys.queue.job(queueName, job.jobId), job, { ex: 7 * 24 * 60 * 60 });
    await redis.zadd(redisKeys.queue.pending(queueName), { score: job.runAfter, member: job.jobId });
    return job;
  }, null);
}

export async function claimDueJobs(queueName: RedisQueueName, limit = 10, lockMs = 5 * 60 * 1000) {
  return safeRedis<RedisQueueJob[]>("queue.claim", async (redis) => {
    const now = Date.now();
    const ids = await redis.zrange<string[]>(redisKeys.queue.pending(queueName), 0, now, {
      byScore: true,
      offset: 0,
      count: limit,
    });
    if (!ids || ids.length === 0) return [];
    await redis.zrem(redisKeys.queue.pending(queueName), ...ids);
    await Promise.all(
      ids.map((id) =>
        redis.zadd(redisKeys.queue.processing(queueName), { score: now + lockMs, member: id }),
      ),
    );
    const jobs = await Promise.all(ids.map((id) => redis.get<RedisQueueJob>(redisKeys.queue.job(queueName, id))));
    const found = jobs.filter(Boolean) as RedisQueueJob[];
    if (found.length > 0) incrementRedisMetric("queue_claimed");
    return found;
  }, []);
}

export async function completeJob(queueName: RedisQueueName, job: RedisQueueJob) {
  return safeRedis("queue.complete", async (redis) => {
    await redis.zrem(redisKeys.queue.processing(queueName), job.jobId);
    await redis.del(redisKeys.queue.job(queueName, job.jobId));
    return true;
  }, false);
}

export async function retryJob(queueName: RedisQueueName, job: RedisQueueJob, error: unknown) {
  const attempts = job.attempts + 1;
  const lastError = error instanceof Error ? error.message : String(error);
  if (attempts >= job.maxAttempts) return failJob(queueName, { ...job, attempts, lastError });

  const retryDelayMs = Math.min(15 * 60 * 1000, 2 ** attempts * 1000);
  const nextJob = { ...job, attempts, lastError, runAfter: Date.now() + retryDelayMs };
  return safeRedis("queue.retry", async (redis) => {
    await redis.zrem(redisKeys.queue.processing(queueName), job.jobId);
    await redis.set(redisKeys.queue.job(queueName, job.jobId), nextJob, { ex: 7 * 24 * 60 * 60 });
    await redis.zadd(redisKeys.queue.pending(queueName), { score: nextJob.runAfter, member: nextJob.jobId });
    return true;
  }, false);
}

export async function failJob(queueName: RedisQueueName, job: RedisQueueJob) {
  incrementRedisMetric("queue_failed");
  return safeRedis("queue.fail", async (redis) => {
    await redis.zrem(redisKeys.queue.processing(queueName), job.jobId);
    await redis.set(redisKeys.queue.job(queueName, job.jobId), job, { ex: 7 * 24 * 60 * 60 });
    await redis.zadd(redisKeys.queue.dead(queueName), { score: Date.now(), member: job.jobId });
    return true;
  }, false);
}

export async function drainQueue<T = unknown>(
  queueName: RedisQueueName,
  handler: (job: RedisQueueJob<T>) => Promise<void>,
  limit = 10,
) {
  const jobs = await claimDueJobs(queueName, limit);
  let completed = 0;
  let retried = 0;
  let failed = 0;

  for (const job of jobs as RedisQueueJob<T>[]) {
    try {
      await handler(job);
      if (await completeJob(queueName, job)) completed++;
    } catch (error) {
      const ok = await retryJob(queueName, job, error);
      if (ok && job.attempts + 1 < job.maxAttempts) retried++;
      else failed++;
    }
  }

  return {
    queue: queueName,
    claimed: jobs.length,
    completed,
    retried,
    failed,
  };
}
