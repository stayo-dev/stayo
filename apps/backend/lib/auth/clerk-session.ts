/**
 * Clerk session verification for backend routes (ADR-176, Phase 2.6).
 *
 * Verifies the short-lived session JWT the SPA gets from Clerk's `getToken()`
 * and sends as `Authorization: Bearer <token>`. Bearer rather than cookies
 * because the SPA and this API are different origins.
 *
 * `verifyToken` checks the signature against Clerk's JWKS, plus expiry and
 * not-before, using `CLERK_SECRET_KEY`. That key is backend-only and must never
 * appear in any frontend bundle — see `apps/frontend/src/lib/auth/clerkConfig.ts`,
 * which rejects an `sk_` value outright for that reason.
 *
 * This does NOT decide what anyone may do. It answers "which Clerk account is
 * this?" and nothing more; roles come from `profiles` in our own database
 * (ADR-176). Keeping that split is why this module returns an id and an
 * optional email rather than anything resembling a permission.
 *
 * PURE-ish: `extractBearerToken` and `readEmailClaim` take plain arguments and
 * are unit-tested; only `verifyClerkSession` touches the network (JWKS, cached
 * by the SDK).
 */

import { verifyToken } from "@clerk/backend";

export type ClerkSessionFailure =
  | "missing_secret"
  | "missing_token"
  | "invalid_token";

export interface ClerkSessionIdentity {
  /** Clerk's stable user id — the `sub` claim. Maps to `users.clerk_user_id`. */
  clerkUserId: string;
  /**
   * Present only when the Clerk instance's JWT template includes it. Clerk's
   * default session token does not carry an email, so this is frequently
   * undefined — callers must treat it as optional, never required.
   */
  email?: string;
}

export type ClerkSessionResult =
  | { ok: true; identity: ClerkSessionIdentity }
  | { ok: false; reason: ClerkSessionFailure; detail: string };

/** `Authorization: Bearer <token>`, case-insensitively, or null. */
export function extractBearerToken(header: string | null | undefined): string | null {
  const value = String(header ?? "").trim();
  if (!value) return null;

  const match = /^Bearer\s+(.+)$/i.exec(value);
  if (!match) return null;

  const token = match[1].trim();
  return token.length > 0 ? token : null;
}

/**
 * Pull an email out of the claims if the instance's JWT template provides one.
 *
 * Clerk has used more than one claim name across templates, and a session token
 * with no email at all is the default. Returning null is a normal outcome, not
 * an error — it only means we cannot match this login to a `profiles` row by
 * email yet.
 */
export function readEmailClaim(claims: Record<string, unknown> | null | undefined): string | null {
  if (!claims) return null;

  for (const key of ["email", "email_address", "primary_email_address", "eml"]) {
    const value = claims[key];
    if (typeof value === "string" && value.trim()) return value.trim().toLowerCase();
  }
  return null;
}

export async function verifyClerkSession(req: Request): Promise<ClerkSessionResult> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    return {
      ok: false,
      reason: "missing_secret",
      detail: "CLERK_SECRET_KEY is not set",
    };
  }

  const token = extractBearerToken(req.headers.get("authorization"));
  if (!token) {
    return { ok: false, reason: "missing_token", detail: "no Bearer token" };
  }

  try {
    const claims = (await verifyToken(token, { secretKey })) as Record<string, unknown>;
    const sub = typeof claims.sub === "string" ? claims.sub.trim() : "";

    if (!sub) {
      return { ok: false, reason: "invalid_token", detail: "token has no sub claim" };
    }

    const email = readEmailClaim(claims);
    return { ok: true, identity: email ? { clerkUserId: sub, email } : { clerkUserId: sub } };
  } catch (error) {
    return {
      ok: false,
      reason: "invalid_token",
      detail: error instanceof Error ? error.message : "verification failed",
    };
  }
}
