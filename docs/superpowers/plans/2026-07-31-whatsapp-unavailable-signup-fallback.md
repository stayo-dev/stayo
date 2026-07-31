# Signup Phone-Verification Fallback Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When WhatsApp cannot deliver an OTP, the owner-signup path proceeds without a verification step and records the phone as unverified — and enforces verification again, with no code change, once WhatsApp is configured.

**Architecture:** A pure env-derived mode resolver plus a Redis-backed (in-process fallback) circuit breaker decide, per request, whether phone verification is possible. `AuthOtpService.sendPhoneOtp` consults them and — for the two signup purposes only — writes a `SKIPPED` row instead of sending a code, returning `verification_required: false`. The two signup gates (`/leads/self-serve`, `/auth/owner-signup`) share one helper that accepts `VERIFIED` or `SKIPPED` rows within the existing 30-minute window and reports which. The frontend branches on `verification_required` and never renders the OTP screen when it is false.

**Tech Stack:** Next.js 14 App Router, Prisma 5, Postgres (Supabase), Upstash Redis (optional), Vitest, Vite + React 19, TanStack Query.

**Design spec:** `docs/superpowers/specs/2026-07-31-whatsapp-unavailable-signup-fallback-design.md`

## Global Constraints

- **Scope is the signup path only.** Do not add login-time prompts, dashboard banners, or step-up gates for unverified users. Do not touch the tenant portal, reminders, or `verify-phone-otp`.
- **Degradation applies to exactly two OTP purposes:** `PHONE_VERIFICATION` and `LEAD_CAPTURE`. Every other purpose keeps today's hard `OtpServiceError("Failed to send OTP", "OTP_SEND_FAILED", 502)`.
- **Rate limiting runs before the skip path.** The skip path must never become an unthrottled way to insert rows keyed by an arbitrary phone number.
- **Redis is an accelerator, never a correctness dependency.** Every Redis read/write goes through `safeRedis` from `@/lib/redis/client` and falls back to in-process state.
- **`phone_verification_otps.status` and `provider_status` are plain string columns, not Prisma enums.** New values `SKIPPED` and `UNAVAILABLE` need no schema change.
- **Backend tests:** `cd apps/backend && npx vitest run tests/<file>.test.ts`. Vitest runs single-worker (`fileParallelism: false`); do not add parallel-unsafe tests.
- **Frontend has no test suite.** Verify frontend tasks with `cd apps/frontend && npm run build` (runs `check:architecture` and the branding check).
- **All frontend HTTP goes through `@lib/api-client`** — enforced by `scripts/check-architecture.mjs`.
- **Documentation is part of the change, not a follow-up** (Task 8). `docs/obsidian/` must be updated in the same branch.

---

### Task 1: Phone-verification mode resolver

**Files:**
- Create: `apps/backend/lib/services/auth/phone-verification-mode.ts`
- Test: `apps/backend/tests/phone-verification-mode.test.ts`

**Interfaces:**
- Consumes: `getLogger` from `@/lib/logger`.
- Produces:
  - `type PhoneVerificationMode = "on" | "off"`
  - `resolvePhoneVerificationMode(): PhoneVerificationMode`
  - `hasWhatsAppOtpCredentials(): boolean`
  - `isSkippableOtpPurpose(purpose: string): boolean`
  - `const SKIPPABLE_OTP_PURPOSES: readonly ["PHONE_VERIFICATION", "LEAD_CAPTURE"]`

**Note on the credential set:** the check uses the four variables that are actually required to *send* an OTP — `OTP_PROVIDER`, an access token, a phone-number ID, and `WHATSAPP_OTP_TEMPLATE`. `WHATSAPP_BUSINESS_ACCOUNT_ID` is checked by `validateWhatsAppConfiguration()` but is not used by `configFromEnv()` for sending, so it is deliberately not part of this gate.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/phone-verification-mode.test.ts`:

```ts
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  resolvePhoneVerificationMode,
  hasWhatsAppOtpCredentials,
  isSkippableOtpPurpose,
} from "@/lib/services/auth/phone-verification-mode";

const VARS = [
  "PHONE_VERIFICATION_MODE",
  "OTP_PROVIDER",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "PHONE_NUMBER_ID",
  "WHATSAPP_OTP_TEMPLATE",
];

let saved: Record<string, string | undefined> = {};

function fullyConfigured() {
  process.env.OTP_PROVIDER = "whatsapp";
  process.env.WHATSAPP_ACCESS_TOKEN = "token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";
}

describe("phone verification mode resolver", () => {
  beforeEach(() => {
    saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
    for (const v of VARS) delete process.env[v];
  });

  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("is off when nothing is configured", () => {
    expect(hasWhatsAppOtpCredentials()).toBe(false);
    expect(resolvePhoneVerificationMode()).toBe("off");
  });

  it("is on when the provider and all send-critical credentials are present", () => {
    fullyConfigured();
    expect(resolvePhoneVerificationMode()).toBe("on");
  });

  it("accepts the legacy WHATSAPP_TOKEN and PHONE_NUMBER_ID aliases", () => {
    process.env.OTP_PROVIDER = "whatsapp";
    process.env.WHATSAPP_TOKEN = "token";
    process.env.PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";
    expect(resolvePhoneVerificationMode()).toBe("on");
  });

  it.each([
    ["OTP_PROVIDER"],
    ["WHATSAPP_ACCESS_TOKEN"],
    ["WHATSAPP_PHONE_NUMBER_ID"],
    ["WHATSAPP_OTP_TEMPLATE"],
  ])("is off when %s is missing", (missing) => {
    fullyConfigured();
    delete process.env[missing];
    expect(resolvePhoneVerificationMode()).toBe("off");
  });

  it("lets PHONE_VERIFICATION_MODE force verification off despite full credentials", () => {
    fullyConfigured();
    process.env.PHONE_VERIFICATION_MODE = "off";
    expect(resolvePhoneVerificationMode()).toBe("off");
  });

  it("lets PHONE_VERIFICATION_MODE force verification on despite no credentials", () => {
    process.env.PHONE_VERIFICATION_MODE = "ON";
    expect(resolvePhoneVerificationMode()).toBe("on");
  });

  it("ignores an unrecognised override and falls back to derivation", () => {
    process.env.PHONE_VERIFICATION_MODE = "maybe";
    expect(resolvePhoneVerificationMode()).toBe("off");
    fullyConfigured();
    expect(resolvePhoneVerificationMode()).toBe("on");
  });

  it("treats only the two signup purposes as skippable", () => {
    expect(isSkippableOtpPurpose("PHONE_VERIFICATION")).toBe(true);
    expect(isSkippableOtpPurpose("LEAD_CAPTURE")).toBe(true);
    expect(isSkippableOtpPurpose("Login")).toBe(false);
    expect(isSkippableOtpPurpose("")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run tests/phone-verification-mode.test.ts`
Expected: FAIL — cannot resolve `@/lib/services/auth/phone-verification-mode`.

- [ ] **Step 3: Write the implementation**

Create `apps/backend/lib/services/auth/phone-verification-mode.ts`:

```ts
import { getLogger } from "@/lib/logger";

const logger = getLogger("auth.phone-verification-mode");

/**
 * Whether phone verification can actually happen right now.
 *
 * StayO's WhatsApp Business setup is an external dependency (Meta template
 * approval) that can be absent, half-configured, or temporarily broken. Rather
 * than blocking owner signup behind a code nobody can receive, the signup path
 * degrades: see `AuthOtpService.sendPhoneOtp` and the design spec at
 * docs/superpowers/specs/2026-07-31-whatsapp-unavailable-signup-fallback-design.md
 */
export type PhoneVerificationMode = "on" | "off";

/**
 * Only the owner-signup purposes degrade. Every other OTP purpose keeps its
 * hard failure — silently skipping verification elsewhere would weaken a
 * security control nobody asked to relax.
 */
export const SKIPPABLE_OTP_PURPOSES = ["PHONE_VERIFICATION", "LEAD_CAPTURE"] as const;

export function isSkippableOtpPurpose(purpose: string): boolean {
  return (SKIPPABLE_OTP_PURPOSES as readonly string[]).includes(purpose);
}

/**
 * The four variables genuinely required to *send* an OTP template.
 * WHATSAPP_BUSINESS_ACCOUNT_ID is intentionally excluded — validateWhatsApp-
 * Configuration() checks it, but configFromEnv() never uses it to send.
 */
export function hasWhatsAppOtpCredentials(): boolean {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;
  const otpTemplate = process.env.WHATSAPP_OTP_TEMPLATE;

  return Boolean(
    process.env.OTP_PROVIDER === "whatsapp" && accessToken && phoneNumberId && otpTemplate,
  );
}

export function resolvePhoneVerificationMode(): PhoneVerificationMode {
  const override = String(process.env.PHONE_VERIFICATION_MODE || "").trim().toLowerCase();
  if (override === "on" || override === "off") return override;
  if (override) {
    logger.warn("phone_verification.invalid_mode_override", { value: override });
  }

  return hasWhatsAppOtpCredentials() ? "on" : "off";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run tests/phone-verification-mode.test.ts`
Expected: PASS — 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/lib/services/auth/phone-verification-mode.ts apps/backend/tests/phone-verification-mode.test.ts
git commit -m "feat(auth): add phone-verification mode resolver"
```

---

### Task 2: WhatsApp OTP circuit breaker

**Files:**
- Create: `apps/backend/lib/services/auth/otp-provider-breaker.ts`
- Modify: `apps/backend/lib/redis/keys.ts` (add one key next to the existing `otpVerifyLock` on line 66)
- Test: `apps/backend/tests/otp-provider-breaker.test.ts`

**Interfaces:**
- Consumes: `safeRedis` from `@/lib/redis/client`, `redisKey` from `@/lib/redis/keys`, `getLogger`.
- Produces:
  - `isOtpBreakerOpen(now?: number): Promise<boolean>`
  - `recordOtpSendFailure(reason: string, now?: number): Promise<void>`
  - `recordOtpSendSuccess(): Promise<void>`
  - `__resetOtpBreakerForTests(): void`
  - `redisKeys.otpProviderBreaker()`

**State model.** One JSON value `{ failures, firstFailureAt, openedAt }`, stored in Redis with a 1-hour TTL and mirrored in a module-level variable when Redis is unavailable. Time comparisons happen in code, so Redis and in-process behave identically.

- Open when `openedAt !== null && now - openedAt < 15 min`.
- A failure recorded while `openedAt !== null` but the cooldown has elapsed is a **half-open trial failure** → re-open immediately.
- Otherwise a failure increments `failures` (resetting first if the 10-minute window has lapsed); reaching 3 opens the breaker.
- Any success clears the state entirely.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/otp-provider-breaker.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run tests/otp-provider-breaker.test.ts`
Expected: FAIL — cannot resolve `@/lib/services/auth/otp-provider-breaker`.

- [ ] **Step 3: Add the Redis key**

In `apps/backend/lib/redis/keys.ts`, directly below the existing `otpVerifyLock` entry (line 66), add:

```ts
  otpProviderBreaker: () => redisKey("otp", "provider-breaker"),
```

- [ ] **Step 4: Write the implementation**

Create `apps/backend/lib/services/auth/otp-provider-breaker.ts`:

```ts
import { getLogger } from "@/lib/logger";
import { safeRedis } from "@/lib/redis/client";
import { redisKeys } from "@/lib/redis/keys";

const logger = getLogger("auth.otp-provider-breaker");

const FAILURE_THRESHOLD = 3;
const FAILURE_WINDOW_MS = 10 * 60 * 1000;
const OPEN_COOLDOWN_MS = 15 * 60 * 1000;
const STATE_TTL_SECONDS = 60 * 60;

/**
 * Guards the WhatsApp OTP send path. A configured-but-broken provider (expired
 * token, Meta outage) fails only after DEFAULT_TIMEOUT_MS, so every signup
 * would sit for ten seconds before degrading. Once enough sends fail, stop
 * calling out entirely for a cooldown, then let a single request try again.
 *
 * State lives in Redis when available and in-process otherwise — a breaker is
 * advisory, so a per-instance view is an acceptable degradation and read-
 * modify-write races do not need locking.
 */
type BreakerState = {
  failures: number;
  firstFailureAt: number | null;
  openedAt: number | null;
};

const EMPTY_STATE: BreakerState = { failures: 0, firstFailureAt: null, openedAt: null };

let memoryState: BreakerState = { ...EMPTY_STATE };

const UNAVAILABLE = "unavailable" as const;

async function readState(): Promise<BreakerState> {
  const stored = await safeRedis<string | null | typeof UNAVAILABLE>(
    "otp.breaker.read",
    async (redis) => (await redis.get<string>(redisKeys.otpProviderBreaker())) ?? null,
    UNAVAILABLE,
  );

  if (stored === UNAVAILABLE) return { ...memoryState };
  if (!stored) return { ...EMPTY_STATE };

  try {
    const parsed = typeof stored === "string" ? JSON.parse(stored) : stored;
    return {
      failures: Number(parsed?.failures) || 0,
      firstFailureAt: parsed?.firstFailureAt ?? null,
      openedAt: parsed?.openedAt ?? null,
    };
  } catch {
    return { ...EMPTY_STATE };
  }
}

async function writeState(state: BreakerState): Promise<void> {
  memoryState = { ...state };
  await safeRedis(
    "otp.breaker.write",
    async (redis) => {
      await redis.set(redisKeys.otpProviderBreaker(), JSON.stringify(state), {
        ex: STATE_TTL_SECONDS,
      });
      return true;
    },
    false,
  );
}

export async function isOtpBreakerOpen(now = Date.now()): Promise<boolean> {
  const state = await readState();
  if (state.openedAt === null) return false;
  return now - state.openedAt < OPEN_COOLDOWN_MS;
}

export async function recordOtpSendFailure(reason: string, now = Date.now()): Promise<void> {
  const state = await readState();

  // openedAt set but cooldown elapsed => this was the half-open trial.
  const wasHalfOpenTrial = state.openedAt !== null && now - state.openedAt >= OPEN_COOLDOWN_MS;
  if (wasHalfOpenTrial) {
    await writeState({ failures: 0, firstFailureAt: null, openedAt: now });
    logger.warn("otp.breaker.reopened", { reason });
    return;
  }

  const windowLapsed =
    state.firstFailureAt !== null && now - state.firstFailureAt > FAILURE_WINDOW_MS;
  const failures = (windowLapsed ? 0 : state.failures) + 1;
  const firstFailureAt = windowLapsed || state.firstFailureAt === null ? now : state.firstFailureAt;

  if (failures >= FAILURE_THRESHOLD) {
    await writeState({ failures: 0, firstFailureAt: null, openedAt: now });
    logger.warn("otp.breaker.opened", { reason, cooldown_ms: OPEN_COOLDOWN_MS });
    return;
  }

  await writeState({ failures, firstFailureAt, openedAt: state.openedAt });
}

export async function recordOtpSendSuccess(): Promise<void> {
  const state = await readState();
  if (state.failures === 0 && state.openedAt === null) return;
  await writeState({ ...EMPTY_STATE });
  logger.info("otp.breaker.closed", {});
}

/** Test seam — resets the in-process mirror between cases. */
export function __resetOtpBreakerForTests(): void {
  memoryState = { ...EMPTY_STATE };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run tests/otp-provider-breaker.test.ts`
Expected: PASS — 7 tests.

If `logger.info` does not exist on the logger returned by `getLogger`, check the available methods in `apps/backend/lib/logger.ts` and use the nearest equivalent (`logger.metrics` or `logger.warn`); do not add a logger method.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/lib/services/auth/otp-provider-breaker.ts apps/backend/lib/redis/keys.ts apps/backend/tests/otp-provider-breaker.test.ts
git commit -m "feat(auth): add circuit breaker for the WhatsApp OTP provider"
```

---

### Task 3: Degrade `sendPhoneOtp` instead of failing

**Files:**
- Modify: `apps/backend/lib/services/auth/auth-otp-service.ts` (lines 51-147 — `sendPhoneOtp`)
- Modify: `apps/backend/app/api/auth/send-phone-otp/route.ts:26-29` (pass the new fields through)
- Test: `apps/backend/tests/otp-degraded-signup.test.ts`

**Interfaces:**
- Consumes: `resolvePhoneVerificationMode`, `isSkippableOtpPurpose` (Task 1); `isOtpBreakerOpen`, `recordOtpSendFailure`, `recordOtpSendSuccess` (Task 2).
- Produces: `sendPhoneOtp` now resolves to
  `{ success: true; verification_required: boolean; expires_in_seconds?: number; reason?: string }`.
  `reason` is one of `"PROVIDER_NOT_CONFIGURED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_SEND_FAILED"` and is present only when `verification_required` is `false`.
  Row states written on skip: `status: "SKIPPED"`, `provider_status: "UNAVAILABLE"`, `verified_at: <now>`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/otp-degraded-signup.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { authOtpService, OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { prisma } from "@/lib/db";
import { notificationService } from "@/lib/services/notification-service";
import { __resetOtpBreakerForTests } from "@/lib/services/auth/otp-provider-breaker";

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    phoneVerificationOtp: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    profile: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma, supabase: {} };
});

vi.mock("@/lib/services/notification-service", () => ({
  notificationService: { sendOtp: vi.fn() },
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("mock_hash"), compare: vi.fn() },
}));

vi.mock("@/lib/redis/rate-limit", () => ({
  checkFixedWindowLimit: vi.fn().mockResolvedValue({
    available: true,
    allowed: true,
    attempts: 0,
    attemptsRemaining: 3,
    retryAfterSeconds: 60,
  }),
  setOneTimeLock: vi.fn().mockResolvedValue(true),
  releaseOneTimeLock: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/redis/client", () => ({
  safeRedis: vi.fn(async (_op: string, _fn: unknown, fallback: unknown) => fallback),
  getRedisClient: () => null,
  isRedisConfigured: () => false,
}));

const CREDENTIAL_VARS = [
  "OTP_PROVIDER",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "PHONE_NUMBER_ID",
  "WHATSAPP_OTP_TEMPLATE",
  "PHONE_VERIFICATION_MODE",
];

function configureWhatsApp() {
  process.env.OTP_PROVIDER = "whatsapp";
  process.env.WHATSAPP_ACCESS_TOKEN = "token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";
}

describe("signup OTP degradation when WhatsApp is unavailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetOtpBreakerForTests();
    for (const v of CREDENTIAL_VARS) delete process.env[v];
    (prisma as any).phoneVerificationOtp.create.mockResolvedValue({ id: "otp_1" });
    (prisma as any).phoneVerificationOtp.update.mockResolvedValue({ id: "otp_1" });
    (prisma as any).phoneVerificationOtp.updateMany.mockResolvedValue({ count: 0 });
    (prisma as any).phoneVerificationOtp.count.mockResolvedValue(0);
  });

  it("skips verification for LEAD_CAPTURE when WhatsApp is not configured", async () => {
    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "LEAD_CAPTURE",
      requestIp: "127.0.0.1",
    });

    expect(result).toMatchObject({ success: true, verification_required: false, reason: "PROVIDER_NOT_CONFIGURED" });
    expect(notificationService.sendOtp).not.toHaveBeenCalled();

    const created = (prisma as any).phoneVerificationOtp.create.mock.calls[0][0].data;
    expect(created.status).toBe("SKIPPED");
    expect(created.provider_status).toBe("UNAVAILABLE");
    expect(created.verified_at).toBeInstanceOf(Date);
  });

  it("skips verification for PHONE_VERIFICATION when WhatsApp is not configured", async () => {
    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "PHONE_VERIFICATION",
      requestIp: "127.0.0.1",
    });
    expect(result.verification_required).toBe(false);
    expect(notificationService.sendOtp).not.toHaveBeenCalled();
  });

  it("still enforces rate limits on the skip path", async () => {
    const { checkFixedWindowLimit } = await import("@/lib/redis/rate-limit");
    vi.mocked(checkFixedWindowLimit).mockResolvedValueOnce({
      available: true,
      allowed: false,
      attempts: 3,
      attemptsRemaining: 0,
      retryAfterSeconds: 120,
    } as any);

    await expect(
      authOtpService.sendPhoneOtp({ phone: "8008046952", purpose: "LEAD_CAPTURE", requestIp: "127.0.0.1" }),
    ).rejects.toBeInstanceOf(OtpServiceError);
    expect((prisma as any).phoneVerificationOtp.create).not.toHaveBeenCalled();
  });

  it("degrades the same request whose send fails, rather than throwing", async () => {
    configureWhatsApp();
    vi.mocked(notificationService.sendOtp).mockRejectedValueOnce(new Error("token expired"));

    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "LEAD_CAPTURE",
      requestIp: "127.0.0.1",
    });

    expect(result).toMatchObject({ success: true, verification_required: false, reason: "PROVIDER_SEND_FAILED" });
    const update = (prisma as any).phoneVerificationOtp.update.mock.calls.at(-1)[0];
    expect(update.data.status).toBe("SKIPPED");
    expect(update.data.provider_status).toBe("UNAVAILABLE");
    expect(update.data.verified_at).toBeInstanceOf(Date);
  });

  it("stops calling the provider once the breaker opens", async () => {
    configureWhatsApp();
    vi.mocked(notificationService.sendOtp).mockRejectedValue(new Error("token expired"));

    for (let i = 0; i < 3; i++) {
      await authOtpService.sendPhoneOtp({ phone: "8008046952", purpose: "LEAD_CAPTURE", requestIp: "127.0.0.1" });
    }
    expect(notificationService.sendOtp).toHaveBeenCalledTimes(3);

    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "LEAD_CAPTURE",
      requestIp: "127.0.0.1",
    });
    expect(result).toMatchObject({ verification_required: false, reason: "PROVIDER_UNAVAILABLE" });
    expect(notificationService.sendOtp).toHaveBeenCalledTimes(3);
  });

  it("sends normally and requires verification when WhatsApp works", async () => {
    configureWhatsApp();
    vi.mocked(notificationService.sendOtp).mockResolvedValueOnce({
      success: true,
      providerMessageId: "wamid.1",
      attempts: 1,
    } as any);

    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "LEAD_CAPTURE",
      requestIp: "127.0.0.1",
    });

    expect(result).toMatchObject({ success: true, verification_required: true, expires_in_seconds: 300 });
    const created = (prisma as any).phoneVerificationOtp.create.mock.calls[0][0].data;
    expect(created.status).toBe("PENDING");
  });

  it("still throws for non-signup purposes when the send fails", async () => {
    configureWhatsApp();
    vi.mocked(notificationService.sendOtp).mockRejectedValueOnce(new Error("token expired"));

    await expect(
      authOtpService.sendPhoneOtp({ phone: "8008046952", purpose: "Login", requestIp: "127.0.0.1" }),
    ).rejects.toThrowError(new OtpServiceError("Failed to send OTP", "OTP_SEND_FAILED", 502));
  });

  it("still throws for non-signup purposes when WhatsApp is not configured", async () => {
    vi.mocked(notificationService.sendOtp).mockRejectedValueOnce(new Error("not configured"));

    await expect(
      authOtpService.sendPhoneOtp({ phone: "8008046952", purpose: "Login", requestIp: "127.0.0.1" }),
    ).rejects.toThrowError(new OtpServiceError("Failed to send OTP", "OTP_SEND_FAILED", 502));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run tests/otp-degraded-signup.test.ts`
Expected: FAIL — several cases; notably the "not configured" cases currently return `{ success: true, expires_in_seconds }` with no `verification_required`, and the non-signup cases currently pass only because of the `NODE_ENV` bypass being removed in Step 3.

- [ ] **Step 3: Rewrite `sendPhoneOtp`**

In `apps/backend/lib/services/auth/auth-otp-service.ts`:

Add to the imports at the top:

```ts
import { isSkippableOtpPurpose, resolvePhoneVerificationMode } from "@/lib/services/auth/phone-verification-mode";
import {
  isOtpBreakerOpen,
  recordOtpSendFailure,
  recordOtpSendSuccess,
} from "@/lib/services/auth/otp-provider-breaker";
```

Add next to the other module constants (after line 22):

```ts
const SKIPPED_STATUS = "SKIPPED";
const SKIPPED_PROVIDER_STATUS = "UNAVAILABLE";

export type SkipReason = "PROVIDER_NOT_CONFIGURED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_SEND_FAILED";
```

Replace the whole body of `sendPhoneOtp` (lines 51-147) with:

```ts
  async sendPhoneOtp(input: SendOtpInput) {
    const phone = normalizeWhatsAppPhone(input.phone);
    const purpose = input.purpose;
    const requestIp = input.requestIp || null;
    const now = new Date();

    // Rate limits first, always — the skip path below must not become an
    // unthrottled way to write rows keyed by an arbitrary phone number.
    await this.enforceSendRateLimits(phone, requestIp, now);
    await (prisma as any).phoneVerificationOtp.updateMany({
      where: { phone, purpose, status: "PENDING" },
      data: { status: "EXPIRED", failure_reason: "superseded by new OTP request" },
    });

    const skipReason = await this.resolveSkipReason(purpose);
    if (skipReason) {
      return this.recordSkippedVerification({ phone, purpose, requestIp, reason: skipReason, now });
    }

    const otp = String(crypto.randomInt(OTP_LENGTH_MIN, OTP_LENGTH_MAX_EXCLUSIVE));
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    const record = await (prisma as any).phoneVerificationOtp.create({
      data: {
        phone,
        otp_hash: otpHash,
        purpose,
        status: "PENDING",
        max_attempts: MAX_ATTEMPTS,
        expires_at: expiresAt,
        provider_status: "PENDING",
        request_ip: requestIp,
      },
    });

    incrementOtpMetric("requests_total");

    try {
      const sendResult = await this.provider.sendOtp({ phone, otp, purpose });
      await (prisma as any).phoneVerificationOtp.update({
        where: { id: record.id },
        data: {
          meta_message_id: sendResult.providerMessageId,
          provider_status: "SENT",
          failure_reason: null,
        },
      });
      await recordOtpSendSuccess();

      logger.metrics("otp.request.sent", {
        phone: maskWhatsAppPhone(phone),
        purpose,
        otp_id: record.id,
        meta_message_id: sendResult.providerMessageId,
      });

      return {
        success: true,
        verification_required: true,
        expires_in_seconds: Math.floor(OTP_TTL_MS / 1000),
      };
    } catch (error: any) {
      const message = String(error?.message || error);
      incrementOtpMetric("send_failures");

      if (isSkippableOtpPurpose(purpose)) {
        // The signup flow degrades rather than dead-ends. The user whose
        // request trips the breaker must not be the one who eats the error.
        await recordOtpSendFailure(message);
        const skippedAt = new Date();
        await (prisma as any).phoneVerificationOtp.update({
          where: { id: record.id },
          data: {
            status: SKIPPED_STATUS,
            provider_status: SKIPPED_PROVIDER_STATUS,
            verified_at: skippedAt,
            failure_reason: `whatsapp_unavailable:PROVIDER_SEND_FAILED: ${message}`.slice(0, 500),
          },
        });

        logger.warn("otp.request.skipped", {
          phone: maskWhatsAppPhone(phone),
          purpose,
          otp_id: record.id,
          reason: "PROVIDER_SEND_FAILED",
          error: message,
        });

        return { success: true, verification_required: false, reason: "PROVIDER_SEND_FAILED" as SkipReason };
      }

      await (prisma as any).phoneVerificationOtp.update({
        where: { id: record.id },
        data: {
          status: "FAILED",
          provider_status: "FAILED",
          failure_reason: message.slice(0, 500),
        },
      });

      logger.warn("otp.request.send_failed", {
        phone: maskWhatsAppPhone(phone),
        purpose,
        otp_id: record.id,
        error_code: error?.providerCode || error?.code || "OTP_SEND_FAILED",
        error: message,
      });

      throw new OtpServiceError("Failed to send OTP", "OTP_SEND_FAILED", 502);
    }
  }

  /**
   * Why this request cannot be verified — or null when it can. Only the
   * signup purposes degrade; see phone-verification-mode.ts.
   */
  private async resolveSkipReason(purpose: string): Promise<SkipReason | null> {
    if (!isSkippableOtpPurpose(purpose)) return null;
    if (resolvePhoneVerificationMode() === "off") return "PROVIDER_NOT_CONFIGURED";
    if (await isOtpBreakerOpen()) return "PROVIDER_UNAVAILABLE";
    return null;
  }

  /**
   * Records that signup proceeded without verification. The row is written
   * (rather than omitted) so the downstream signup gates still require the
   * caller to have gone through this endpoint for this exact number, and so
   * the audit trail shows why the number is unverified. `otp_hash` holds a
   * hash of a value that is never sent, and `verifyPhoneOtp` only ever looks
   * at PENDING rows — this row can never be verified.
   */
  private async recordSkippedVerification(params: {
    phone: string;
    purpose: string;
    requestIp: string | null;
    reason: SkipReason;
    now: Date;
  }) {
    const { phone, purpose, requestIp, reason, now } = params;
    const unusableHash = await bcrypt.hash(crypto.randomUUID(), 10);

    const record = await (prisma as any).phoneVerificationOtp.create({
      data: {
        phone,
        otp_hash: unusableHash,
        purpose,
        status: SKIPPED_STATUS,
        max_attempts: MAX_ATTEMPTS,
        expires_at: new Date(now.getTime() + OTP_TTL_MS),
        verified_at: now,
        provider_status: SKIPPED_PROVIDER_STATUS,
        failure_reason: `whatsapp_unavailable:${reason}`,
        request_ip: requestIp,
      },
    });

    incrementOtpMetric("requests_total");
    logger.metrics("otp.request.skipped", {
      phone: maskWhatsAppPhone(phone),
      purpose,
      otp_id: record.id,
      reason,
    });

    return { success: true, verification_required: false, reason };
  }
```

This deletes both existing workarounds: the `latest-otp.txt` write (old lines 63-70) and the `NODE_ENV !== "production"` send-error bypass (old lines 112-125). Skip-mode makes dev-without-credentials honest by default, and `/api/debug/send-test-otp` still exercises the real provider.

- [ ] **Step 4: Pass the new fields through the route**

In `apps/backend/app/api/auth/send-phone-otp/route.ts`, replace the `apiResponse` block (lines 26-29) with:

```ts
    return apiResponse({
      success: true,
      verification_required: result.verification_required,
      ...(result.expires_in_seconds !== undefined ? { expires_in_seconds: result.expires_in_seconds } : {}),
      ...(result.reason ? { reason: result.reason } : {}),
    });
```

- [ ] **Step 5: Run the new test and the existing OTP suite**

Run: `cd apps/backend && npx vitest run tests/otp-degraded-signup.test.ts tests/otp-pipeline.test.ts tests/whatsapp-provider.test.ts`
Expected: PASS — all files. `otp-pipeline.test.ts` uses purpose `"Login"`, which is not skippable, so its expectations are unchanged.

If a pre-existing test asserted on the removed `NODE_ENV` bypass or on `latest-otp.txt`, update that test to the new behaviour rather than restoring the bypass, and note it in the commit message.

- [ ] **Step 6: Delete the stale dev artifact if present**

```bash
git rm --cached --ignore-unmatch apps/backend/latest-otp.txt
rm -f apps/backend/latest-otp.txt
```

- [ ] **Step 7: Commit**

```bash
git add apps/backend/lib/services/auth/auth-otp-service.ts apps/backend/app/api/auth/send-phone-otp/route.ts apps/backend/tests/otp-degraded-signup.test.ts
git commit -m "feat(auth): degrade signup OTP to unverified instead of failing when WhatsApp is down"
```

---

### Task 4: Shared signup verification gate

**Files:**
- Create: `apps/backend/lib/services/auth/signup-phone-verification-gate.ts`
- Modify: `apps/backend/app/api/auth/owner-signup/route.ts:16-17, 44-56`
- Modify: `apps/backend/app/api/leads/self-serve/route.ts:11-12, 30-41`
- Modify: `apps/backend/lib/services/auth-service.ts:485, 508-524` (`selfSignUpOwner`)
- Test: `apps/backend/tests/signup-phone-verification-gate.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/db`.
- Produces:
  - `const SIGNUP_OTP_FRESHNESS_MS = 30 * 60 * 1000`
  - `type SignupPhoneVerification = { ok: true; phoneVerified: boolean } | { ok: false }`
  - `resolveSignupPhoneVerification(normalizedPhone: string, purpose: string, now?: number): Promise<SignupPhoneVerification>`
  - `authService.selfSignUpOwner(data: { email; password; name; phone; phoneVerified: boolean })`

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/signup-phone-verification-gate.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resolveSignupPhoneVerification } from "@/lib/services/auth/signup-phone-verification-gate";

vi.mock("@/lib/db", () => ({
  prisma: { phoneVerificationOtp: { findFirst: vi.fn() } },
  supabase: {},
}));

const NOW = Date.now();
const findFirst = () => (prisma as any).phoneVerificationOtp.findFirst;

describe("signup phone verification gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when no row exists for the phone", async () => {
    findFirst().mockResolvedValueOnce(null);
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({ ok: false });
  });

  it("accepts a fresh VERIFIED row as verified", async () => {
    findFirst().mockResolvedValueOnce({ status: "VERIFIED", verified_at: new Date(NOW - 60_000) });
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({
      ok: true,
      phoneVerified: true,
    });
  });

  it("accepts a fresh SKIPPED row as unverified", async () => {
    findFirst().mockResolvedValueOnce({ status: "SKIPPED", verified_at: new Date(NOW - 60_000) });
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({
      ok: true,
      phoneVerified: false,
    });
  });

  it("rejects a row older than the 30 minute freshness window", async () => {
    findFirst().mockResolvedValueOnce({ status: "VERIFIED", verified_at: new Date(NOW - 31 * 60_000) });
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({ ok: false });
  });

  it("rejects a row with no verified_at", async () => {
    findFirst().mockResolvedValueOnce({ status: "SKIPPED", verified_at: null });
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({ ok: false });
  });

  it("queries only VERIFIED and SKIPPED rows for that phone and purpose, newest first", async () => {
    findFirst().mockResolvedValueOnce(null);
    await resolveSignupPhoneVerification("918008046952", "PHONE_VERIFICATION", NOW);
    expect(findFirst()).toHaveBeenCalledWith({
      where: {
        phone: "918008046952",
        purpose: "PHONE_VERIFICATION",
        status: { in: ["VERIFIED", "SKIPPED"] },
      },
      orderBy: { created_at: "desc" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run tests/signup-phone-verification-gate.test.ts`
Expected: FAIL — cannot resolve `@/lib/services/auth/signup-phone-verification-gate`.

- [ ] **Step 3: Write the gate**

Create `apps/backend/lib/services/auth/signup-phone-verification-gate.ts`:

```ts
import { prisma } from "@/lib/db";

/**
 * Both signup entry points (POST /api/leads/self-serve and
 * POST /api/auth/owner-signup) require the caller to have just gone through
 * POST /api/auth/send-phone-otp for this exact number. That endpoint writes
 * either a VERIFIED row (a real code was entered) or a SKIPPED row (WhatsApp
 * could not deliver — see phone-verification-mode.ts). Both are accepted; the
 * difference is recorded, not enforced.
 */
export const SIGNUP_OTP_FRESHNESS_MS = 30 * 60 * 1000;

const ACCEPTED_STATUSES = ["VERIFIED", "SKIPPED"];

export type SignupPhoneVerification = { ok: true; phoneVerified: boolean } | { ok: false };

export async function resolveSignupPhoneVerification(
  normalizedPhone: string,
  purpose: string,
  now = Date.now(),
): Promise<SignupPhoneVerification> {
  const record = await (prisma as any).phoneVerificationOtp.findFirst({
    where: {
      phone: normalizedPhone,
      purpose,
      status: { in: ACCEPTED_STATUSES },
    },
    orderBy: { created_at: "desc" },
  });

  const verifiedAt = record?.verified_at ? new Date(record.verified_at).getTime() : null;
  if (!verifiedAt || now - verifiedAt >= SIGNUP_OTP_FRESHNESS_MS) return { ok: false };

  return { ok: true, phoneVerified: record.status === "VERIFIED" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run tests/signup-phone-verification-gate.test.ts`
Expected: PASS — 6 tests.

- [ ] **Step 5: Wire it into `/api/auth/owner-signup`**

In `apps/backend/app/api/auth/owner-signup/route.ts`:

Replace the `OTP_PURPOSE`/`OTP_FRESHNESS_MS` constants (lines 16-17) with:

```ts
const OTP_PURPOSE = "PHONE_VERIFICATION";
```

Add to the imports:

```ts
import { resolveSignupPhoneVerification } from "@/lib/services/auth/signup-phone-verification-gate";
```

Replace the verification block (lines 44-53) with:

```ts
    const normalizedPhone = normalizeWhatsAppPhone(phone);
    const verification = await resolveSignupPhoneVerification(normalizedPhone, OTP_PURPOSE);
    if (!verification.ok) {
      return apiError("Phone verification is required before signing up", "PHONE_NOT_VERIFIED", 400);
    }
```

And pass the result into signup (line 56):

```ts
      profile = await authService.selfSignUpOwner({
        email,
        password,
        name,
        phone: normalizedPhone,
        phoneVerified: verification.phoneVerified,
      });
```

The now-unused `prisma` import may be removed if nothing else in the file uses it — check before deleting.

- [ ] **Step 6: Make `selfSignUpOwner` record the truth**

In `apps/backend/lib/services/auth-service.ts`, change the signature (line 485) to:

```ts
  async selfSignUpOwner(data: {
    email: string;
    password: string;
    name: string;
    phone: string;
    phoneVerified: boolean;
  }) {
```

and the two hardcoded flags (lines 519-520) to:

```ts
          phone_verified: data.phoneVerified,
          mobile_verified: data.phoneVerified,
```

Update the last sentence of its doc comment (lines 481-483) to:

```
   * Requires a fresh `phone_verification_otps` row for the phone — VERIFIED
   * when a code was really entered, SKIPPED when WhatsApp could not deliver
   * (checked by the route via resolveSignupPhoneVerification). `phoneVerified`
   * carries which of the two happened onto the profile.
```

- [ ] **Step 7: Run the auth suites**

Run: `cd apps/backend && npx vitest run tests/auth-hardening-security.test.ts tests/signup-phone-verification-gate.test.ts`
Expected: PASS. If any test constructs `selfSignUpOwner` input, add `phoneVerified: true` to it.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/lib/services/auth/signup-phone-verification-gate.ts apps/backend/app/api/auth/owner-signup/route.ts apps/backend/lib/services/auth-service.ts apps/backend/tests/signup-phone-verification-gate.test.ts
git commit -m "feat(auth): accept skipped phone verification at owner signup and record it on the profile"
```

---

### Task 5: `platform_leads.phone_verified`

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (the `platform_leads` model)
- Create: `apps/backend/prisma/migrations/20260731000000_platform_leads_phone_verified/migration.sql`
- Modify: `apps/backend/app/api/leads/self-serve/route.ts:11-12, 30-41, 43-55`

**Interfaces:**
- Consumes: `resolveSignupPhoneVerification` (Task 4).
- Produces: `platform_leads.phone_verified: boolean` on every lead row returned by `GET /api/platform-admin/leads` (that route returns full Prisma rows, so no change is needed there).

- [ ] **Step 1: Add the column to the Prisma schema**

In `apps/backend/prisma/schema.prisma`, in `model platform_leads`, add below `google_email`:

```prisma
  phone_verified     Boolean             @default(false)
```

- [ ] **Step 2: Write the SQL migration**

Create `apps/backend/prisma/migrations/20260731000000_platform_leads_phone_verified/migration.sql`:

```sql
-- Signup phone-verification fallback: records whether a lead's phone was
-- really OTP-verified, or accepted unverified because WhatsApp could not
-- deliver. Idempotent — safe to re-run.

ALTER TABLE "platform_leads" ADD COLUMN IF NOT EXISTS "phone_verified" BOOLEAN NOT NULL DEFAULT FALSE;
```

- [ ] **Step 3: Regenerate the Prisma client**

Run: `cd apps/backend && npm run prisma:generate`
Expected: "Generated Prisma Client" with no errors.

- [ ] **Step 4: Wire the value into the lead route**

In `apps/backend/app/api/leads/self-serve/route.ts`:

Replace the constants (lines 11-12) with:

```ts
const OTP_PURPOSE = "LEAD_CAPTURE";
```

Add to the imports:

```ts
import { resolveSignupPhoneVerification } from "@/lib/services/auth/signup-phone-verification-gate";
```

Replace the verification block (lines 30-41) with:

```ts
    const normalizedPhone = normalizeWhatsAppPhone(phone);
    const verification = await resolveSignupPhoneVerification(normalizedPhone, OTP_PURPOSE);
    if (!verification.ok) {
      return apiError("Phone verification is required before submitting", "PHONE_NOT_VERIFIED", 400);
    }
```

Add the field to the created row (inside `prisma.platform_leads.create`, after `google_email`):

```ts
        phone_verified: verification.phoneVerified,
```

The `prisma` import stays — `platform_leads.create` still uses it.

- [ ] **Step 5: Verify the backend compiles and the suite is green**

Run: `cd apps/backend && npm run lint && npx vitest run tests/signup-phone-verification-gate.test.ts tests/otp-degraded-signup.test.ts`
Expected: lint clean, tests PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/prisma/schema.prisma apps/backend/prisma/migrations/20260731000000_platform_leads_phone_verified apps/backend/app/api/leads/self-serve/route.ts
git commit -m "feat(leads): record whether a self-serve lead's phone was verified"
```

- [ ] **Step 7: Apply the migration to the dev database**

This is a manual step — the SQL above must be run against Supabase (SQL editor or psql) before the lead flow works end-to-end. Do not run `prisma migrate deploy` blindly; this repo applies migrations by hand. Report to the user that the migration needs applying rather than assuming it has been.

---

### Task 6: Frontend — never show the OTP screen when verification is skipped

**Files:**
- Modify: `apps/frontend/src/features/hostel-leads/api/index.ts:5-9`
- Modify: `apps/frontend/src/features/owner-onboarding/api/onboardingApi.ts:20-23`
- Modify: `apps/frontend/src/features/owner-onboarding/components/HostelLeadModal.tsx:56-70, 165-179`
- Modify: `apps/frontend/src/features/owner-onboarding/hooks/useOnboardingSubmission.ts:35-79`
- Modify: `apps/frontend/src/features/owner-onboarding/pages/OwnerOnboardingWizard.tsx:224-226`

**Interfaces:**
- Consumes: the `send-phone-otp` response shape from Task 3 — `{ success: boolean; verification_required: boolean; expires_in_seconds?: number; reason?: string }`.
- Produces: no new exports; behavioural change only.

- [ ] **Step 1: Widen both API response types**

In `apps/frontend/src/features/hostel-leads/api/index.ts`, change `sendLeadOtp`:

```ts
  sendLeadOtp: async (phone: string) => {
    const response = await api.post('/auth/send-phone-otp', { phone, purpose: LEAD_OTP_PURPOSE });
    return response.data as {
      success: boolean;
      verification_required: boolean;
      expires_in_seconds?: number;
      reason?: string;
    };
  },
```

In `apps/frontend/src/features/owner-onboarding/api/onboardingApi.ts`, change `sendPhoneOtp` identically:

```ts
  sendPhoneOtp: async (phone: string) => {
    const response = await api.post('/auth/send-phone-otp', { phone });
    return response.data as {
      success: boolean;
      verification_required: boolean;
      expires_in_seconds?: number;
      reason?: string;
    };
  },
```

- [ ] **Step 2: Branch in the lead modal**

In `apps/frontend/src/features/owner-onboarding/components/HostelLeadModal.tsx`, replace `submitDetails` (lines 56-70) with:

```tsx
  const submitLead = async () =>
    hostelLeadsApi.submitLead({
      name: ownerName.trim(),
      hostel_name: hostelName.trim(),
      phone: phone.trim(),
      google_email: googleEmail,
    });

  const submitDetails = async () => {
    if (!hostelName.trim() || !ownerName.trim() || !phone.trim()) {
      setError('Please fill in all fields.');
      return;
    }
    setError('');
    setSendingOtp(true);
    try {
      const result = await hostelLeadsApi.sendLeadOtp(phone.trim());

      // WhatsApp could not deliver a code (not configured yet, or the
      // provider is failing). The backend has already recorded the number as
      // unverified — go straight to the confirmation rather than showing an
      // OTP screen for a code that will never arrive.
      if (result.verification_required === false) {
        await submitLead();
        setStep('done');
        return;
      }

      setOtp(Array(6).fill(''));
      setStep('otp');
    } catch (err: any) {
      setError(err?.response?.data?.error?.message || 'Could not submit your details. Please try again.');
    } finally {
      setSendingOtp(false);
    }
  };
```

and replace the body of `verifyOtp`'s `try` block so it reuses the helper:

```tsx
      await hostelLeadsApi.verifyLeadOtp(phone.trim(), otp.join(''));
      await submitLead();
      setStep('done');
```

- [ ] **Step 3: Fix the button label**

Still in `HostelLeadModal.tsx`, the details-step button (lines 174-177) says "Send OTP", which is untrue when no OTP is sent. Replace that fragment with:

```tsx
                    <>
                      Continue
                      <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
                    </>
```

- [ ] **Step 4: Branch in the onboarding wizard**

In `apps/frontend/src/features/owner-onboarding/hooks/useOnboardingSubmission.ts`, replace `submitAccount` and `submitOtp` (lines 35-79) with:

```ts
  const completeSignup = async () => {
    await onboardingApi.ownerSignup({
      name: s.data.name.trim(),
      email: s.data.email.trim(),
      password,
      phone: s.data.mobile.trim(),
      ...(leadToken ? { lead_token: leadToken } : {}),
    });
    await login(s.data.email.trim(), password);
    s.setOtpOpen(false);
    s.go(s.step + 1);
  };

  const submitAccount = async () => {
    if (!s.data.name.trim() || !s.data.mobile.trim() || !s.data.email.trim() || !password.trim()) {
      stayoToast.error('Fill in your name, mobile, email, and a password to continue.');
      return;
    }
    if (password.trim().length < 8) {
      stayoToast.error('Password must be at least 8 characters.');
      return;
    }
    setSendingOtp(true);
    try {
      const result = await onboardingApi.sendPhoneOtp(s.data.mobile.trim());

      // No code is coming — WhatsApp is unavailable and the backend has
      // recorded the number as unverified. Create the account directly.
      if (result.verification_required === false) {
        await completeSignup();
        return;
      }

      setOtpCode('');
      s.setOtpOpen(true);
    } catch (error) {
      stayoToast.error(getErrorMessage(error, 'Could not create your account. Please try again.'));
    } finally {
      setSendingOtp(false);
    }
  };

  const submitOtp = async () => {
    if (otpCode.trim().length !== 6) {
      stayoToast.error('Enter the 6-digit code.');
      return;
    }
    setVerifyingOtp(true);
    try {
      await onboardingApi.verifyPhoneOtp(s.data.mobile.trim(), otpCode.trim());
      await completeSignup();
    } catch (error) {
      stayoToast.error(getErrorMessage(error, 'Verification failed. Check the code and try again.'));
    } finally {
      setVerifyingOtp(false);
    }
  };
```

- [ ] **Step 5: Fix the wizard's pending label**

In `apps/frontend/src/features/owner-onboarding/pages/OwnerOnboardingWizard.tsx` (lines 224-226), replace `'Sending code…'` with `'Creating account…'` — the button no longer necessarily sends a code.

- [ ] **Step 6: Verify the frontend builds**

Run: `cd apps/frontend && npm run build`
Expected: `check:architecture` passes, `vite build` succeeds, branding check passes.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/features/hostel-leads/api/index.ts apps/frontend/src/features/owner-onboarding
git commit -m "feat(signup): skip the OTP step when the backend reports verification is unavailable"
```

---

### Task 7: Admin visibility for unverified leads

**Files:**
- Modify: `apps/frontend/src/platforms/admin/pages/AdminLeadsPage.tsx` (list row near line 167, drawer detail near line 269)

**Interfaces:**
- Consumes: `phone_verified` on each lead object from `platformAdminService.getLeads()` (typed `any[]`, so no type change is needed).
- Produces: no exports.

- [ ] **Step 1: Add the marker to the list row**

In `apps/frontend/src/platforms/admin/pages/AdminLeadsPage.tsx`, replace the list-row phone span (line 167):

```tsx
                  <span className="text-[12.5px] font-semibold tabular-nums text-[#8A7F75]">{l.phone}</span>
```

with:

```tsx
                  <span className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-semibold tabular-nums text-[#8A7F75]">{l.phone}</span>
                    {l.phone_verified === false && (
                      <span
                        title="This number was never OTP-verified — WhatsApp was unavailable when the lead came in."
                        className="rounded-full border border-[#E7DDD1] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8A7F75]"
                      >
                        Unverified
                      </span>
                    )}
                  </span>
```

- [ ] **Step 2: Add the marker to the drawer**

Replace the drawer's phone row (line 269):

```tsx
                <div className="flex justify-between"><span className="text-[12.5px] text-[#8A7F75]">Phone Number</span><span className="text-[12.5px] font-bold tabular-nums text-foreground">{openLead.phone}</span></div>
```

with:

```tsx
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-[#8A7F75]">Phone Number</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-bold tabular-nums text-foreground">{openLead.phone}</span>
                    {openLead.phone_verified === false && (
                      <span
                        title="This number was never OTP-verified — WhatsApp was unavailable when the lead came in."
                        className="rounded-full border border-[#E7DDD1] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8A7F75]"
                      >
                        Unverified
                      </span>
                    )}
                  </span>
                </div>
```

The `=== false` comparison is deliberate: leads fetched before the column existed can arrive as `undefined`, and those should show no marker rather than a false accusation.

- [ ] **Step 3: Verify the frontend builds**

Run: `cd apps/frontend && npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/platforms/admin/pages/AdminLeadsPage.tsx
git commit -m "feat(admin): flag leads whose phone was never verified"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/obsidian/Features.md`
- Modify: `docs/obsidian/APIs.md`
- Modify: `docs/obsidian/Database.md`
- Modify: `docs/obsidian/Business-Rules.md`
- Modify: `docs/obsidian/Decisions.md`
- Modify: `docs/obsidian/Changelog.md`
- Modify: `docs/data-models/schema.md`

**Interfaces:** none — documentation only. Use Obsidian wiki links (`[[Page]]`) so Graph View stays connected, and match each file's existing entry format rather than inventing one.

- [ ] **Step 1: `Features.md`**

Add a feature entry: signup phone verification degrades to "accepted unverified" when WhatsApp is unavailable. Cover the two entry points (lead modal, onboarding wizard), that the OTP screen is not rendered at all in that mode, that `PHONE_VERIFICATION_MODE` / the WhatsApp credentials control it, and that the admin leads list flags unverified numbers. Link to [[APIs]], [[Business-Rules]], and [[Decisions]].

- [ ] **Step 2: `APIs.md`**

- `POST /api/auth/send-phone-otp` — response now carries `verification_required: boolean`, with `expires_in_seconds` only when a code was sent and `reason` (`PROVIDER_NOT_CONFIGURED` | `PROVIDER_UNAVAILABLE` | `PROVIDER_SEND_FAILED`) only when it was not. Note that degradation applies solely to purposes `PHONE_VERIFICATION` and `LEAD_CAPTURE`; all other purposes still return `502 OTP_SEND_FAILED`.
- `POST /api/leads/self-serve` and `POST /api/auth/owner-signup` — the freshness gate now accepts a `VERIFIED` **or** `SKIPPED` row within 30 minutes; `PHONE_NOT_VERIFIED` still fires when neither exists.

- [ ] **Step 3: `Database.md`**

- New column `platform_leads.phone_verified BOOLEAN NOT NULL DEFAULT FALSE`.
- New string values on `phone_verification_otps`: `status = 'SKIPPED'` and `provider_status = 'UNAVAILABLE'`. State explicitly that these are plain string columns, so no enum change was involved, and that a `SKIPPED` row is written with `verified_at` set and can never be verified (`verifyPhoneOtp` only reads `PENDING` rows).

- [ ] **Step 4: `Business-Rules.md`**

Phone verification is required for signup only when the provider can actually deliver. Record the mode-resolution rule (override, else all four credentials present), the breaker thresholds (3 failures / 10 min → open 15 min → half-open trial), and that `profiles.phone_verified` / `platform_leads.phone_verified` record which path each signup took. Note the explicit non-goal: nothing retroactively verifies accounts or leads created while degraded.

- [ ] **Step 5: `Decisions.md`**

Add an ADR following the file's existing Context / Decision / Alternatives considered / Consequences format. Cover:
- Skip-and-record rather than block, and rather than an email-OTP fallback channel (rejected: `RESEND_API_KEY` is separately known-bad, and a second channel is more surface than the problem warrants).
- Degrading the *failing* request itself, not merely subsequent ones — otherwise one unlucky user per cooldown eats a 502.
- Writing a `SKIPPED` row rather than removing the gate — keeps both signup endpoints reachable only via `send-phone-otp` for that exact number, and leaves an audit trail.
- Consequence to name honestly: a real phone number nobody confirmed can now back a lead or an owner account, mitigated by human lead review plus the admin badge.

- [ ] **Step 6: `Changelog.md` and `docs/data-models/schema.md`**

Add a dated changelog entry linking [[Features]] and [[Decisions]], and add `platform_leads.phone_verified` to the schema doc alongside the [[Database]] update.

- [ ] **Step 7: Commit**

```bash
git add docs/obsidian docs/data-models/schema.md
git commit -m "docs: record the signup phone-verification fallback"
```

---

## Final verification

- [ ] Run the full backend suite: `cd apps/backend && npm test`
- [ ] Run the backend invariant checks: `cd apps/backend && npm run check:invariants`
- [ ] Run the frontend build: `cd apps/frontend && npm run build`
- [ ] Confirm with the user that `20260731000000_platform_leads_phone_verified/migration.sql` has been applied to Supabase — the lead flow returns `500` until the column exists.
- [ ] Manual smoke test with no WhatsApp credentials set: landing page → "Manage My Hostel" → Google → fill hostel details → **Continue** goes straight to "Thanks — we've got your details" with no OTP screen; the new `platform_leads` row has `phone_verified = false`; the admin leads list shows the Unverified badge.
