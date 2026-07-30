import { describe, expect, it, beforeEach } from "vitest";
import { getJson, setJson } from "@/lib/redis/cache";
import { redisKey, redisKeys } from "@/lib/redis/keys";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { enqueueJob } from "@/lib/redis/queue";
import { getRedisMetrics } from "@/lib/redis/metrics";

describe("redis utility layer", () => {
  beforeEach(() => {
    process.env.REDIS_ENABLED = "false";
    process.env.REDIS_KEY_PREFIX = "hms:test";
  });

  it("builds stable namespaced keys", () => {
    expect(redisKey("dashboard", "owner", "owner-1")).toBe("hms:test:v1:dashboard:owner:owner-1");
    expect(redisKeys.dashboard.owner("owner-1", "hostel-1", 6)).toBe(
      "hms:test:v1:dashboard:owner:owner-1:hostel:hostel-1:months:6",
    );
    expect(redisKeys.otpVerifyLock("919999999999", "PHONE_VERIFY")).toBe(
      "hms:test:v1:otp:verify-lock:919999999999:PHONE_VERIFY",
    );
  });

  it("falls back safely when Redis is disabled", async () => {
    await expect(getJson("missing")).resolves.toBeNull();
    await expect(setJson("key", { ok: true }, 30)).resolves.toBe(false);
    const limit = await checkFixedWindowLimit({
      scope: "login:test",
      identifier: "user@example.com",
      maxAttempts: 1,
      windowSeconds: 60,
    });
    expect(limit.available).toBe(false);
    expect(limit.allowed).toBe(true);
  });

  it("does not enqueue jobs when Redis is disabled", async () => {
    const job = await enqueueJob("email-notifications", {
      type: "EMAIL",
      payload: { id: "1" },
      idempotencyKey: "email:1",
      maxAttempts: 3,
      runAfter: Date.now(),
    });
    expect(job).toBeNull();
    expect(getRedisMetrics().fallback).toBeGreaterThan(0);
  });
});
