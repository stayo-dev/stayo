export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { provisionMarketplaceTenantFromSupabase } from "@/lib/auth/supabase-provision";
import { getClientIp } from "@/lib/security/api-guard";

/**
 * Creates a new Stayo marketplace account (role TENANT, no tenancy) for a
 * Google identity Supabase has already authenticated but that has no
 * matching `profiles` row yet.
 *
 * Only reachable right after the OAuth redirect lands — it reads the same
 * `x-auth-*` headers `middleware.ts` injects for any Supabase-mode request
 * (see `/api/auth/me`'s `supabaseRejection()` for the identical pattern) and
 * requires `x-auth-mode: supabase`, i.e. a real, currently-valid Supabase
 * session. It does not mint any new session itself (ADR-031's single
 * session-minting authority stays Supabase) — on success the caller just
 * re-fetches `/auth/me`, which now resolves normally via the profile this
 * route created.
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("x-auth-mode") !== "supabase") {
    return apiError("Sign in with Google first", "UNAUTHORIZED", 401);
  }
  const authUserId = req.headers.get("x-auth-user-id");
  const email = req.headers.get("x-auth-email");
  if (!authUserId || !email) {
    return apiError("Sign in with Google first", "UNAUTHORIZED", 401);
  }

  const result = await provisionMarketplaceTenantFromSupabase({
    authUserId,
    email,
    emailVerified: true,
    sessionId: req.headers.get("x-auth-session-id"),
    provider: req.headers.get("x-auth-provider"),
    name: req.headers.get("x-auth-name") || undefined,
    ipAddress: getClientIp(req) ?? undefined,
    userAgent: req.headers.get("user-agent") || undefined,
  });

  if (!result.ok) {
    return apiError(result.message, result.code, 403);
  }
  return apiResponse({ success: true });
}
