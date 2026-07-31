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
