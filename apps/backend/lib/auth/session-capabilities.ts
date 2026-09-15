/**
 * How a sign-in response reaches the browser during the Clerk cutover (ADR-204).
 *
 * A browser running the current SPA sends `X-Auth-Capabilities: clerk-ticket`
 * on every API request (apps/frontend/src/lib/api-client.ts). For it, every
 * sign-in ends in a single-use Clerk ticket and no cookie is set: Clerk owns
 * the session, on Clerk's own domain.
 *
 * A browser still running a pre-Clerk build — a tab left open across the
 * deploy — does not send the header. It keeps getting the legacy session
 * shape until it reloads. That branch, and `setLegacySessionCookies`, are
 * removed in Phase 4.
 */
import type { NextResponse } from "next/server";
import {
  ACCESS_TOKEN_MAX_AGE_SECONDS,
  getSessionCookieOptions,
  TENANT_REFRESH_DAYS,
} from "@/lib/services/session-lifecycle-service";

export const AUTH_CAPABILITIES_HEADER = "x-auth-capabilities";
export const CLERK_TICKET_CAPABILITY = "clerk-ticket";

/** Pure: does this header value advertise ticket redemption? */
export function parseAcceptsClerkTicket(headerValue: string | null | undefined): boolean {
  return String(headerValue ?? "")
    .split(",")
    .map((part) => part.trim().toLowerCase())
    .includes(CLERK_TICKET_CAPABILITY);
}

export function clientAcceptsClerkTicket(req: { headers: Headers }): boolean {
  return parseAcceptsClerkTicket(req.headers.get(AUTH_CAPABILITIES_HEADER));
}

/**
 * Set the legacy `hms_session` / `hms_refresh_token` cookies — only when the
 * result actually is a legacy session. A Clerk-ticket result carries no token
 * to put in a cookie, and writing `"null"` into one would be worse than none.
 */
export function setLegacySessionCookies(
  response: NextResponse,
  result: { access_token?: string | null; refresh_token?: string | null },
) {
  if (!result.access_token || !result.refresh_token) return;
  response.cookies.set("hms_session", result.access_token, {
    ...getSessionCookieOptions(ACCESS_TOKEN_MAX_AGE_SECONDS),
  });
  response.cookies.set("hms_refresh_token", result.refresh_token, {
    ...getSessionCookieOptions(60 * 60 * 24 * TENANT_REFRESH_DAYS),
  });
}
