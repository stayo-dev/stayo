/**
 * Shared request plumbing for the settlement routes.
 *
 * Extracted because five routes need the identical admin gate and the identical
 * error mapping, and money endpoints are the worst place for four
 * near-copies that drift — a route that forgot to map INVALID_TRANSITION would
 * return 500 for "already paid", which reads as a system fault rather than a
 * refusal.
 */
export function requireSettlementAdmin(session: any): asserts session is { sub: string; role: string } {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

export function settlementError(error: any, apiError: (m: string, c?: string, s?: number) => any) {
  const msg = String(error?.message || "Settlement request failed");
  const after = () => msg.split(": ").slice(1).join(": ") || msg;
  if (msg.startsWith("FORBIDDEN")) return apiError(after(), "FORBIDDEN", 403);
  if (msg.startsWith("NOT_FOUND")) return apiError(after(), "NOT_FOUND", 404);
  if (msg.startsWith("INVALID_TRANSITION")) return apiError(after(), "INVALID_TRANSITION", 409);
  if (msg.startsWith("VALIDATION")) return apiError(after(), "VALIDATION_ERROR", 400);
  return apiError(msg);
}
