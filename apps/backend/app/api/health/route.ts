export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { apiError, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { describeSupabaseAuthConfig } from "@/lib/config/supabase-auth-config";


/**
 * 🩺 HEALTH CHECK
 * Public endpoint for deployment and database verification. Includes git
 * commit/branch from Vercel's auto-injected build-time env vars (not set
 * outside Vercel) — added after a live debugging session where a deployed
 * backend was silently running code from an untraceable source, and there
 * was no fast way to confirm what commit was actually live short of
 * inferring it from Postgres error messages one at a time.
 *
 * The `auth` block exists for the same reason, added 2026-08-08 after a
 * production outage where the backend verified tokens against a different
 * Supabase project than the frontend minted them with. Every login and
 * every Google sign-in failed with a flat "Invalid session", and the only
 * way to find it was downloading the deployed frontend bundle to read its
 * project ref. Compare `auth.supabase.project_ref` here against the
 * frontend's `VITE_SUPABASE_URL` and the mismatch is immediate. The ref is
 * public (it ships in the bundle) and no key material is exposed.
 */
async function checkJwksReachable(issuer: string | null): Promise<boolean | null> {
  if (!issuer) return null;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2500);
    const response = await fetch(`${issuer}/.well-known/jwks.json`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!response.ok) return false;
    const body = (await response.json()) as { keys?: unknown[] };
    return Array.isArray(body.keys) && body.keys.length > 0;
  } catch {
    return false;
  }
}

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    const supabaseAuth = describeSupabaseAuthConfig(process.env.SUPABASE_URL);

    return apiResponse({
      status: "ok",
      database: "connected",
      build: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        branch: process.env.VERCEL_GIT_COMMIT_REF || null,
        vercel_env: process.env.VERCEL_ENV || null,
      },
      auth: {
        supabase: {
          ...supabaseAuth,
          jwks_reachable: await checkJwksReachable(supabaseAuth.expected_issuer),
        },
      },
    });
  } catch (error: any) {
    return apiError(
      error?.message || "Database connection failed",
      "DATABASE_UNAVAILABLE",
      500
    );
  }
}
