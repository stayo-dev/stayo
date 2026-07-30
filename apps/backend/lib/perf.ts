/**
 * ⏱  Performance Instrumentation — Lightweight, production-safe.
 *
 * Usage:
 *   const result = await timed("analytics.cashflow", () => svc.getCashflow(id), { slow_ms: 1000 });
 *
 * Emits a METRIC log on every call. Emits an additional WARN log when
 * duration exceeds the `slow_ms` threshold (default 2 000 ms).
 * Records count/avg/max into the in-process timing registry (see metrics.ts).
 *
 * NO external dependencies. NO sampling overhead. Adds ~0.01 ms per call.
 */

import { getLogger } from "./logger";
import { recordTiming } from "./metrics";

const logger = getLogger("perf");

/** Default slow-query threshold in milliseconds. */
const DEFAULT_SLOW_MS = 2_000;

export interface TimedMeta {
  /** Override the slow-query warning threshold for this call. */
  slow_ms?: number;
  /** Extra fields to include in the METRIC log (owner_id, rows, etc.). */
  [key: string]: unknown;
}

/**
 * Execute `fn` and emit structured timing telemetry.
 * Returns the unwrapped result of `fn` — transparent wrapper.
 */
export async function timed<T>(
  operation: string,
  fn: () => Promise<T>,
  meta: TimedMeta = {}
): Promise<T> {
  const { slow_ms = DEFAULT_SLOW_MS, ...extraMeta } = meta;
  const t0 = Date.now();

  let error: unknown;
  let result: T;

  try {
    result = await fn();
  } catch (err) {
    error = err;
  } finally {
    const duration_ms = Date.now() - t0;
    const logPayload = { operation, duration_ms, ...extraMeta };

    if (error) {
      logger.error("operation_failed", { ...logPayload, error: (error as any)?.message });
    } else {
      logger.metrics("operation_complete", logPayload);
      recordTiming(operation, duration_ms);
      if (duration_ms > slow_ms) {
        logger.warn("slow_operation", { ...logPayload, threshold_ms: slow_ms });
      }
    }
  }

  if (error) throw error;
  return result!;
}

/**
 * Synchronous variant — for CPU-bound in-process work (e.g., PDF rendering).
 */
export function timedSync<T>(
  operation: string,
  fn: () => T,
  meta: TimedMeta = {}
): T {
  const { slow_ms = DEFAULT_SLOW_MS, ...extraMeta } = meta;
  const t0 = Date.now();

  let error: unknown;
  let result: T;

  try {
    result = fn();
  } catch (err) {
    error = err;
  } finally {
    const duration_ms = Date.now() - t0;
    const logPayload = { operation, duration_ms, ...extraMeta };
    if (!error) {
      logger.metrics("operation_complete", logPayload);
      recordTiming(operation, duration_ms);
      if (duration_ms > slow_ms) {
        logger.warn("slow_operation", { ...logPayload, threshold_ms: slow_ms });
      }
    } else {
      logger.error("operation_failed", { ...logPayload, error: (error as any)?.message });
    }
  }

  if (error) throw error;
  return result!;
}
