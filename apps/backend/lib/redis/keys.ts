import crypto from "crypto";

const DEFAULT_PREFIX = "hms";
const VERSION = "v1";

function clean(value: string | number | null | undefined) {
  return encodeURIComponent(String(value ?? "none"));
}

export function redisKey(...parts: Array<string | number | null | undefined>) {
  const prefix = process.env.REDIS_KEY_PREFIX || DEFAULT_PREFIX;
  return [prefix, VERSION, ...parts.map(clean)].join(":");
}

export function hashKey(input: unknown) {
  return crypto.createHash("sha256").update(JSON.stringify(input ?? {})).digest("hex").slice(0, 16);
}

export const redisKeys = {
  tag: {
    ownerDashboard: (ownerId: string) => redisKey("tag", "owner", ownerId, "dashboard"),
    hostelDashboard: (hostelId: string) => redisKey("tag", "hostel", hostelId, "dashboard"),
    tenantDashboard: (tenantId: string) => redisKey("tag", "tenant", tenantId, "dashboard"),
  },
  dashboard: {
    owner: (ownerId: string, hostelId: string, months: number) =>
      redisKey("dashboard", "owner", ownerId, "hostel", hostelId, "months", months),
    stats: (ownerId: string, hostelId: string) =>
      redisKey("dashboard", "stats", ownerId, hostelId),
    statsShell: (ownerId: string, hostelId: string) =>
      redisKey("dashboard", "stats-shell", ownerId, hostelId),
    statsActivity: (ownerId: string, hostelId: string) =>
      redisKey("dashboard", "stats-activity", ownerId, hostelId),
    statsAnalytics: (ownerId: string, hostelId: string) =>
      redisKey("dashboard", "stats-analytics", ownerId, hostelId),
    monthly: (ownerId: string, hostelId: string, months: number) =>
      redisKey("dashboard", "monthly", ownerId, hostelId, months),
    tenantStats: (profileId: string) => redisKey("tenant", "dashboard", profileId),
  },
  portfolio: {
    shell: (ownerId: string, months: number) => redisKey("portfolio", "shell", ownerId, "months", months),
    performance: (ownerId: string, months: number) => redisKey("portfolio", "performance", ownerId, "months", months),
  },
  analytics: {
    cashflow: (ownerId: string, hostelId: string, rangeHash: string) =>
      redisKey("analytics", "cashflow", ownerId, hostelId, rangeHash),
    funnel: (ownerId: string, hostelId: string, rangeHash: string) =>
      redisKey("analytics", "funnel", ownerId, hostelId, rangeHash),
    operations: (ownerId: string, hostelId: string, rangeHash: string) =>
      redisKey("analytics", "operations", ownerId, hostelId, rangeHash),
  },
  admissions: {
    publicHostel: (slug: string) => redisKey("admissions", "public-hostel", slug),
    publicHostelTag: (slug: string) => redisKey("tag", "admissions", "public-hostel", slug),
    owner: (ownerId: string) => redisKey("tag", "owner", ownerId, "admissions"),
    analytics: (ownerId: string, hostelId: string) =>
      redisKey("admissions", "analytics", ownerId, "hostel", hostelId),
  },
  rateLimit: (scope: string, identifier: string) => redisKey("rate-limit", scope, identifier),
  session: {
    revoked: (sessionId: string) => redisKey("session", "revoked", sessionId),
    userRevokedAfter: (userId: string) => redisKey("session", "user-revoked-after", userId),
    activity: (sessionId: string) => redisKey("session", "activity", sessionId),
    activityThrottle: (sessionId: string) => redisKey("session", "activity-throttle", sessionId),
  },
  otpVerifyLock: (phone: string, purpose: string) => redisKey("otp", "verify-lock", phone, purpose),
  otpProviderBreaker: () => redisKey("otp", "provider-breaker"),
  passwordReset: {
    usedToken: (fingerprint: string) => redisKey("password-reset", "used", fingerprint),
  },
  queue: {
    pending: (name: string) => redisKey("queue", name, "pending"),
    processing: (name: string) => redisKey("queue", name, "processing"),
    dead: (name: string) => redisKey("queue", name, "dead"),
    job: (name: string, jobId: string) => redisKey("queue", name, "job", jobId),
    idempotency: (name: string, idempotencyKey: string) => redisKey("queue", name, "idem", idempotencyKey),
    lock: (name: string) => redisKey("queue", name, "lock"),
  },
};
