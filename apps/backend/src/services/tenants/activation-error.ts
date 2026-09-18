/**
 * Activation errors, mapped to a status a caller can act on.
 *
 * PURE MODULE — no Prisma, no I/O.
 *
 * The activation services signal failure by throwing `"CODE: message"` rather
 * than returning a result, so a route that only try/catches turns an expired
 * link into a 500. A tenant whose invitation lapsed then sees a generic failure
 * instead of being told the link expired.
 *
 * Lifted from the duplicated mapper in `app/api/tenants/activate/context/route.ts`
 * so the agreement routes share one behaviour rather than a third copy.
 */

const STATUS_BY_CODE: Record<string, number> = {
  INVALID: 410,
  EXPIRED: 410,
  ALREADY_ACTIVE: 409,
  CANCELLED: 410,
  INVALID_TRANSITION: 409,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  INTERNAL_ERROR: 500,
};

export function mapActivationError(
  error: any,
  fallbackMessage = "Activation request failed",
): { message: string; code: string; status: number } {
  const raw = String(error?.message || fallbackMessage);
  const [maybeCode, ...rest] = raw.split(":");
  const code = rest.length ? maybeCode.trim() : "ACTIVATION_ERROR";
  const message = rest.length ? rest.join(":").trim() : raw;
  return { message, code, status: STATUS_BY_CODE[code] ?? 500 };
}
