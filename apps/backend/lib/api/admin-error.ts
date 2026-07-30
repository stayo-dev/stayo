import { apiError } from "../auth";

/**
 * Map service errors thrown as `Error("CODE: message")` into well-formed
 * NextResponse objects via apiError. Service convention:
 *
 *   BAD_REQUEST    -> 400
 *   NOT_FOUND      -> 404
 *   FORBIDDEN      -> 403
 *   UNAUTHORIZED   -> 401
 *   LEDGER_*       -> 409 (idempotency / overdraft / drift)
 *   INTERNAL/other -> 500
 */
export function mapServiceError(err: any) {
  const msg = String(err?.message ?? err ?? "");
  if (msg.startsWith("BAD_REQUEST")) return apiError(msg, "BAD_REQUEST", 400);
  if (msg.startsWith("NOT_FOUND")) return apiError(msg, "NOT_FOUND", 404);
  if (msg.startsWith("FORBIDDEN")) return apiError(msg, "FORBIDDEN", 403);
  if (msg.startsWith("UNAUTHORIZED")) return apiError(msg, "UNAUTHORIZED", 401);
  if (msg.startsWith("LEDGER_")) return apiError(msg, "BAD_REQUEST", 409);
  return apiError(msg || "internal error", "INTERNAL", 500);
}

export async function readJson<T = any>(req: Request): Promise<T> {
  try { return (await req.json()) as T; } catch { return {} as T; }
}
