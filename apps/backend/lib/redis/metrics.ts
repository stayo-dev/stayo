type RedisMetric =
  | "hit"
  | "miss"
  | "set"
  | "delete"
  | "error"
  | "fallback"
  | "rate_limit_blocked"
  | "queue_claimed"
  | "queue_failed";

const metrics: Record<RedisMetric, number> = {
  hit: 0,
  miss: 0,
  set: 0,
  delete: 0,
  error: 0,
  fallback: 0,
  rate_limit_blocked: 0,
  queue_claimed: 0,
  queue_failed: 0,
};

export function incrementRedisMetric(type: RedisMetric) {
  metrics[type] += 1;
}

export function getRedisMetrics() {
  return { ...metrics };
}

export function resetRedisMetrics() {
  for (const key of Object.keys(metrics) as RedisMetric[]) {
    metrics[key] = 0;
  }
}
