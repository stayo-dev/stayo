export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { apiError, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";


/**
 * 🩺 HEALTH CHECK
 * Public endpoint for deployment and database verification. Includes git
 * commit/branch from Vercel's auto-injected build-time env vars (not set
 * outside Vercel) — added after a live debugging session where a deployed
 * backend was silently running code from an untraceable source, and there
 * was no fast way to confirm what commit was actually live short of
 * inferring it from Postgres error messages one at a time.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return apiResponse({
      status: "ok",
      database: "connected",
      build: {
        commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        branch: process.env.VERCEL_GIT_COMMIT_REF || null,
        vercel_env: process.env.VERCEL_ENV || null,
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
