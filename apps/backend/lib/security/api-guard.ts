/**
 * Centralized API security guards.
 *
 * Provides reusable, composable primitives for:
 *  - Pagination safety (unbounded query prevention)
 *  - Request body size enforcement
 *  - IP extraction
 *
 * All route handlers MUST use safePagination() for any findMany() endpoint.
 */

export const PAGINATION_DEFAULTS = {
  DEFAULT_LIMIT: 50,
  MAX_LIMIT: 100,
  DEFAULT_OFFSET: 0,
} as const;

/**
 * Returns a safe, capped { limit, offset } for any list endpoint.
 *
 * Prevents:
 *  - limit=999999 causing unbounded DB scans
 *  - Negative offsets
 *  - NaN from malformed query params
 */
export function safePagination(
  rawLimit: string | number | null | undefined,
  rawOffset: string | number | null | undefined,
  maxLimit = PAGINATION_DEFAULTS.MAX_LIMIT,
): { limit: number; offset: number } {
  const parsed = {
    limit: typeof rawLimit === "number" ? rawLimit : parseInt(String(rawLimit ?? ""), 10),
    offset: typeof rawOffset === "number" ? rawOffset : parseInt(String(rawOffset ?? ""), 10),
  };
  return {
    limit: Number.isNaN(parsed.limit) || parsed.limit < 1
      ? PAGINATION_DEFAULTS.DEFAULT_LIMIT
      : Math.min(parsed.limit, maxLimit),
    offset: Number.isNaN(parsed.offset) || parsed.offset < 0
      ? PAGINATION_DEFAULTS.DEFAULT_OFFSET
      : parsed.offset,
  };
}

/**
 * Validates the Content-Length header against a max byte limit.
 * Call this before reading req.json() or req.text() on write endpoints.
 *
 * Returns null if OK, or a 413 Response if the body is too large.
 *
 * Default: 512 KB (sufficient for any API request; uploads go through multipart)
 */
export function assertBodySize(
  req: Request,
  maxBytes = 512 * 1024,
): Response | null {
  const contentLength = req.headers.get("content-length");
  if (contentLength) {
    const size = parseInt(contentLength, 10);
    if (!isNaN(size) && size > maxBytes) {
      return new Response(
        JSON.stringify({ success: false, error: { message: "Request body too large", code: "PAYLOAD_TOO_LARGE" } }),
        { status: 413, headers: { "Content-Type": "application/json" } },
      );
    }
  }
  return null;
}

/**
 * Extract real client IP from forwarded headers.
 * Always takes the first IP (leftmost = real client in standard proxy configs).
 */
export function getClientIp(req: Request): string | null {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    null
  );
}

/**
 * Validates that a string is a well-formed UUID v4.
 * Use this before trusting any ID coming from the request body or query params.
 */
export function isValidUuid(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Validates and normalises a list of IDs from a request body.
 *
 * Returns: { ids, error }
 *  - ids: validated UUID strings (max capped)
 *  - error: Response to return immediately if invalid, otherwise null
 */
export function parseObligationIds(
  raw: unknown,
  maxCount = 20,
): { ids: string[]; error: Response | null } {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ids: [],
      error: new Response(
        JSON.stringify({ success: false, error: { message: "obligation_ids must be a non-empty array", code: "VALIDATION_ERROR" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  if (raw.length > maxCount) {
    return {
      ids: [],
      error: new Response(
        JSON.stringify({ success: false, error: { message: `Cannot process more than ${maxCount} obligations at once`, code: "VALIDATION_ERROR" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  const ids = raw.map((id) => String(id).trim()).filter(Boolean);
  const invalid = ids.find((id) => !isValidUuid(id));
  if (invalid) {
    return {
      ids: [],
      error: new Response(
        JSON.stringify({ success: false, error: { message: "All obligation_ids must be valid UUIDs", code: "VALIDATION_ERROR" } }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      ),
    };
  }
  return { ids, error: null };
}
