/**
 * Edge-compatible Supabase Auth token verification (ADR-031).
 * This file MUST NOT import any Node.js-only modules — it is used by
 * middleware.ts, which runs in the Edge Runtime.
 *
 * The Supabase project backing this app signs access tokens with an
 * asymmetric key (ES256), published at a JWKS endpoint — verified live
 * during migration planning. That means verification stays purely local
 * (no per-request network call to Supabase, no shared secret to manage),
 * exactly like the legacy HS256 verification it replaces.
 */
import { createRemoteJWKSet, jwtVerify } from "jose";
import { normalizeSupabaseUrl, supabaseIssuer } from "../config/supabase-auth-config";

export interface SupabaseClaims {
  /** auth.users.id — NOT profiles.id. Callers must resolve the profile separately. */
  sub: string;
  email?: string;
  email_verified?: boolean;
  session_id?: string;
  app_metadata?: { provider?: string; providers?: string[] };
  /** Google (and other OAuth providers) populate `full_name`/`name`/`avatar_url` here. */
  user_metadata?: { full_name?: string; name?: string; avatar_url?: string };
  iat?: number;
  exp?: number;
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
let jwksForUrl: string | null = null;

function getJwks(supabaseUrl: string) {
  if (!jwks || jwksForUrl !== supabaseUrl) {
    jwks = createRemoteJWKSet(new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`));
    jwksForUrl = supabaseUrl;
  }
  return jwks;
}

/**
 * Verify a Supabase-issued access token. Returns null on any failure
 * (expired, wrong issuer/audience, bad signature, SUPABASE_URL unset).
 *
 * The URL is normalized first: a trailing slash on SUPABASE_URL used to
 * produce `…supabase.co//auth/v1` and reject every token in the system with
 * an unexplained "Invalid session". `/api/health` reports the issuer this
 * derives, so a project mismatch is visible instead of inferred.
 */
export async function verifySupabaseAccessToken(token: string): Promise<SupabaseClaims | null> {
  const supabaseUrl = normalizeSupabaseUrl(process.env.SUPABASE_URL);
  const issuer = supabaseIssuer(process.env.SUPABASE_URL);
  if (!supabaseUrl || !issuer) return null;

  try {
    const { payload } = await jwtVerify(token, getJwks(supabaseUrl), {
      issuer,
      audience: "authenticated",
    });
    return payload as unknown as SupabaseClaims;
  } catch {
    return null;
  }
}
