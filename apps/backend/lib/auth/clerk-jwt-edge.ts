/**
 * Edge-compatible verification of Clerk session tokens (ADR-204).
 *
 * Used by `middleware.ts`, which runs in the Edge runtime — so this file must
 * not import anything Node-only. `@clerk/backend`'s `verifyToken` is
 * Web-Crypto based and safe here.
 *
 * Verification is networkless when `CLERK_JWT_KEY` (the instance's PEM public
 * key) is set; otherwise the JWKS is fetched once with `CLERK_SECRET_KEY` and
 * cached by the SDK. `CLERK_AUTHORIZED_PARTIES` (comma-separated origins, e.g.
 * `https://yourstayo.com`) pins the token's `azp` claim to our own frontend,
 * so a session token minted for some other app on the same Clerk instance is
 * not accepted here.
 *
 * This answers "which Clerk user and which Clerk session is this?" and
 * nothing more. The profile — and with it every role — is resolved from our
 * own database, by id (`lib/auth/clerk-session-resolver.ts`).
 */
import { verifyToken } from "@clerk/backend";

export interface ClerkClaims {
  /** Clerk user id (`user_…`). Maps to `users.clerk_user_id`, never to profiles.id. */
  sub: string;
  /** Clerk session id (`sess_…`) — the unit a sign-out or revocation acts on. */
  sid: string;
  iat?: number;
}

/** Pure: parse `CLERK_AUTHORIZED_PARTIES`. Unset or blank means "not pinned". */
export function parseAuthorizedParties(raw: string | undefined): string[] | undefined {
  const parties = String(raw ?? "")
    .split(",")
    .map((p) => p.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  return parties.length > 0 ? parties : undefined;
}

/** Pure: accept only claims that carry both a user and a session. */
export function toClerkClaims(payload: Record<string, unknown> | null | undefined): ClerkClaims | null {
  if (!payload) return null;
  const sub = typeof payload.sub === "string" ? payload.sub.trim() : "";
  const sid = typeof payload.sid === "string" ? payload.sid.trim() : "";
  // A session token without a session id cannot be revoked by session, and
  // the revocation check in middleware refuses it anyway. Refuse it here
  // with a reason rather than letting it fail further down.
  if (!sub || !sid) return null;
  const iat = typeof payload.iat === "number" ? payload.iat : undefined;
  return { sub, sid, iat };
}

/**
 * The `iss` claim of a JWT, read WITHOUT verifying it — used only to pick
 * which verifier to run, never to trust anything. A Supabase token and a
 * Clerk token are both well-formed JWTs; asking Clerk's verifier about a
 * Supabase token (or the reverse) is wasted work and, for Clerk, a JWKS
 * lookup on an unknown `kid`. Every token still has to pass a real verifier.
 */
export function peekIssuer(token: string): string | null {
  const segment = token.split(".")[1];
  if (!segment) return null;
  try {
    const json = atob(segment.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(segment.length / 4) * 4, "="));
    const iss = JSON.parse(json)?.iss;
    return typeof iss === "string" ? iss : null;
  } catch {
    return null;
  }
}

/** Is Clerk configured on this deployment at all? */
export function clerkVerificationConfigured(): boolean {
  return Boolean(process.env.CLERK_JWT_KEY || process.env.CLERK_SECRET_KEY);
}

/** Verify a Clerk session JWT. Null on any failure, never throws. */
export async function verifyClerkAccessToken(token: string): Promise<ClerkClaims | null> {
  if (!clerkVerificationConfigured()) return null;
  try {
    const payload = await verifyToken(token, {
      ...(process.env.CLERK_JWT_KEY ? { jwtKey: process.env.CLERK_JWT_KEY } : {}),
      ...(process.env.CLERK_SECRET_KEY ? { secretKey: process.env.CLERK_SECRET_KEY } : {}),
      authorizedParties: parseAuthorizedParties(process.env.CLERK_AUTHORIZED_PARTIES),
    });
    return toClerkClaims(payload as unknown as Record<string, unknown>);
  } catch {
    return null;
  }
}
