export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { apiError, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";


/**
 * 🩺 HEALTH CHECK
 * Public endpoint for deployment and database verification.
 */
export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return apiResponse({
      status: "ok",
      database: "connected",
    });
  } catch (error: any) {
    return apiError(
      error?.message || "Database connection failed",
      "DATABASE_UNAVAILABLE",
      500
    );
  }
}
