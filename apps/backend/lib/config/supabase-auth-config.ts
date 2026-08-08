/**
 * Supabase Auth configuration derivation (ADR-031).
 *
 * Edge-safe by construction: no imports, no I/O. `middleware.ts` reaches
 * this through lib/auth/supabase-jwt-edge.ts, and `/api/health` reaches it
 * from Node — both must agree on the issuer, because a disagreement between
 * "the issuer we verify against" and "the issuer that minted the token" is
 * invisible at runtime and rejects every session with a flat
 * "Invalid session". That is exactly what happened in production on
 * 2026-08-08, and it took reading a deployed JS bundle to find.
 */

/** Trim whitespace and any trailing slashes, so `${url}/auth/v1` can never double up. */
export function normalizeSupabaseUrl(raw?: string | null): string | null {
  const trimmed = String(raw ?? "").trim().replace(/\/+$/, "");
  return trimmed || null;
}

/** The `iss` claim a token from this project will carry. */
export function supabaseIssuer(raw?: string | null): string | null {
  const url = normalizeSupabaseUrl(raw);
  return url ? `${url}/auth/v1` : null;
}

/**
 * The project ref (e.g. `abcdefgh` in `abcdefgh.supabase.co`). Public
 * information — it ships in every frontend bundle — and the fastest way to
 * see at a glance whether backend and frontend are on the same project.
 * Null for self-hosted URLs, which carry no ref.
 */
export function supabaseProjectRef(raw?: string | null): string | null {
  const url = normalizeSupabaseUrl(raw);
  if (!url) return null;
  const match = /^https?:\/\/([a-z0-9-]+)\.supabase\.(co|in)$/i.exec(url);
  return match ? match[1] : null;
}

export interface SupabaseAuthConfigReport {
  configured: boolean;
  project_ref: string | null;
  expected_issuer: string | null;
}

/** Operator-facing summary of what this deployment will accept, for /api/health. */
export function describeSupabaseAuthConfig(raw?: string | null): SupabaseAuthConfigReport {
  const expected_issuer = supabaseIssuer(raw);
  return {
    configured: Boolean(expected_issuer),
    project_ref: supabaseProjectRef(raw),
    expected_issuer,
  };
}
