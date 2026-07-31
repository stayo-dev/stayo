import { describe, expect, it, beforeEach, vi } from "vitest";
import {
  isOtpBreakerOpen,
  recordOtpSendFailure,
  recordOtpSendSuccess,
  __resetOtpBreakerForTests,
} from "@/lib/services/auth/otp-provider-breaker";

// No Redis in tests — safeRedis returns the fallback, exercising the
// in-process path, which is the same logic Redis-backed state runs.
vi.mock("@/lib/redis/client", () => ({
  safeRedis: vi.fn(async (_op: string, _fn: unknown, fallback: unknown) => fallback),
  getRedisClient: () => null,
  isRedisConfigured: () => false,
}));

const MINUTE = 60 * 1000;

describe("whatsapp otp circuit breaker", () => {
  beforeEach(() => {
    __resetOtpBreakerForTests();
  });

  it("starts closed", async () => {
    expect(await isOtpBreakerOpen()).toBe(false);
  });

  it("stays closed below the failure threshold", async () => {
    const t0 = Date.now();
    await recordOtpSendFailure("boom", t0);
    await recordOtpSendFailure("boom", t0 + 1000);
    expect(await isOtpBreakerOpen(t0 + 2000)).toBe(false);
  });

  it("opens after three failures inside the window", async () => {
    const t0 = Date.now();
    await recordOtpSendFailure("boom", t0);
    await recordOtpSendFailure("boom", t0 + 1000);
    await recordOtpSendFailure("boom", t0 + 2000);
    expect(await isOtpBreakerOpen(t0 + 3000)).toBe(true);
  });

  it("does not open on failures spread beyond the failure window", async () => {
    const t0 = Date.now();
    await recordOtpSendFailure("boom", t0);
    await recordOtpSendFailure("boom", t0 + 11 * MINUTE);
    await recordOtpSendFailure("boom", t0 + 22 * MINUTE);
    expect(await isOtpBreakerOpen(t0 + 22 * MINUTE + 1000)).toBe(false);
  });

  it("half-opens once the cooldown elapses", async () => {
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) await recordOtpSendFailure("boom", t0 + i);
    expect(await isOtpBreakerOpen(t0 + 14 * MINUTE)).toBe(true);
    expect(await isOtpBreakerOpen(t0 + 16 * MINUTE)).toBe(false);
  });

  it("re-opens immediately when the half-open trial fails", async () => {
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) await recordOtpSendFailure("boom", t0 + i);
    expect(await isOtpBreakerOpen(t0 + 16 * MINUTE)).toBe(false);

    await recordOtpSendFailure("boom again", t0 + 16 * MINUTE);
    expect(await isOtpBreakerOpen(t0 + 17 * MINUTE)).toBe(true);
  });

  it("closes and forgets failures on success", async () => {
    const t0 = Date.now();
    for (let i = 0; i < 3; i++) await recordOtpSendFailure("boom", t0 + i);
    expect(await isOtpBreakerOpen(t0 + 1000)).toBe(true);

    await recordOtpSendSuccess();
    expect(await isOtpBreakerOpen(t0 + 2000)).toBe(false);

    await recordOtpSendFailure("boom", t0 + 3000);
    expect(await isOtpBreakerOpen(t0 + 4000)).toBe(false);
  });
});
