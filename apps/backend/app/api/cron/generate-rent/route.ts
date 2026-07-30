export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { rentGenerationService } from "@/src/services/payments/rent-generation-service";
import { prisma } from "@/lib/db";

const DEFAULT_BATCH_SIZE = 40;
const MAX_BATCH_SIZE = 60;
const SOFT_TIMEOUT_MS = 240_000;

function clampBatchSize(value: string | null) {
  const parsed = Number(value || process.env.RENT_CRON_BATCH_SIZE || DEFAULT_BATCH_SIZE);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(Math.floor(parsed), MAX_BATCH_SIZE);
}

function configuredOwnerId(searchParams: URLSearchParams) {
  return (
    searchParams.get("ownerId") ||
    process.env.RENT_CRON_OWNER_ID ||
    process.env.PRIMARY_OWNER_ID ||
    process.env.PRODUCTION_OWNER_ID ||
    null
  );
}

async function resolveSingleOperationalOwnerId(explicitOwnerId: string | null) {
  if (explicitOwnerId) return explicitOwnerId;

  const ownerRows = await prisma.hostels.findMany({
    where: {
      status: "ACTIVE",
      room_allocations: {
        some: {
          is_active: true,
          tenant: { status: "ACTIVE" },
        },
      },
    },
    distinct: ["owner_id"],
    select: { owner_id: true },
  });

  if (ownerRows.length === 1) return ownerRows[0].owner_id;
  return null;
}

/**
 * 🕐 CRON — Monthly Rent Generation
 * GET /api/cron/generate-rent
 * 
 * Called by Vercel Cron on the 1st of every month.
 * Protected by CRON_SECRET bearer token.
 * 
 * Idempotent: safe to call multiple times.
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
  // Verify cron secret
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    console.error("CRON_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const limit = clampBatchSize(searchParams.get("limit"));
    const cursor = searchParams.get("cursor");
    const includeEmptyHostels = searchParams.get("includeEmptyHostels") === "true";
    const explicitOwnerId = configuredOwnerId(searchParams);
    const ownerId = await resolveSingleOperationalOwnerId(explicitOwnerId);

    if (!ownerId) {
      console.warn("[CRON] Rent generation owner scope is ambiguous. Configure RENT_CRON_OWNER_ID for production.");
      return NextResponse.json({
        success: false,
        error: "Rent generation owner scope is ambiguous. Configure RENT_CRON_OWNER_ID.",
      }, { status: 409 });
    }

    const hostels = await prisma.hostels.findMany({
      where: {
        status: "ACTIVE",
        owner_id: ownerId,
        ...(cursor ? { id: { gt: cursor } } : {}),
        ...(includeEmptyHostels
          ? {}
          : {
              room_allocations: {
                some: {
                  is_active: true,
                  tenant: { status: "ACTIVE" },
                },
              },
            }),
      },
      select: { id: true, owner_id: true, name: true },
      orderBy: { id: "asc" },
      take: limit + 1,
    });

    const hasMoreByLimit = hostels.length > limit;
    const batch = hasMoreByLimit ? hostels.slice(0, limit) : hostels;
    const results = [];
    let stoppedForTimeBudget = false;

    console.log("[CRON] Monthly rent generation batch start:", {
      owner_id: ownerId,
      hostels_in_batch: batch.length,
      limit,
      cursor,
      include_empty_hostels: includeEmptyHostels,
    });

    for (const hostel of batch) {
      if (Date.now() - startedAt > SOFT_TIMEOUT_MS) {
        stoppedForTimeBudget = true;
        console.warn("[CRON] Rent generation soft timeout reached; stopping batch before Vercel timeout", {
          processed: results.length,
          limit,
        });
        break;
      }

      try {
        const result = await rentGenerationService.generateMonthlyRent(undefined, hostel.owner_id, "cron", hostel.id);
        results.push({ hostel_id: hostel.id, hostel_name: hostel.name, ...result });
      } catch (hostelError: any) {
        console.error("[CRON] Rent generation failed for hostel:", {
          hostel_id: hostel.id,
          hostel_name: hostel.name,
          error: hostelError?.message || String(hostelError),
        });
        results.push({
          hostel_id: hostel.id,
          hostel_name: hostel.name,
          created: 0,
          skipped: 0,
          failed: 1,
          error: hostelError?.message || "Rent generation failed for hostel",
        });
      }
    }

    const summary = results.reduce(
      (acc, result: any) => ({
        created: acc.created + Number(result.created || 0),
        skipped: acc.skipped + Number(result.skipped || 0),
        failed: acc.failed + Number(result.failed || 0),
        locked: acc.locked + (result.locked ? 1 : 0),
      }),
      { created: 0, skipped: 0, failed: 0, locked: 0 }
    );

    const lastProcessed = results[results.length - 1]?.hostel_id || cursor || null;
    const hasMore = hasMoreByLimit || stoppedForTimeBudget;

    console.log("[CRON] Monthly rent generation batch complete:", {
      ...summary,
      owner_id: ownerId,
      hostels_processed: results.length,
      has_more: hasMore,
      next_cursor: hasMore ? lastProcessed : null,
      duration_ms: Date.now() - startedAt,
    });

    return NextResponse.json({
      success: true,
      ...summary,
      owner_id: ownerId,
      hostels_processed: results.length,
      hostels_in_scope: batch.length,
      batch_limit: limit,
      has_more: hasMore,
      next_cursor: hasMore ? lastProcessed : null,
      duration_ms: Date.now() - startedAt,
      results,
    });
  } catch (error: any) {
    console.error("[CRON] Rent generation failed:", error);
    return NextResponse.json({
      success: false,
      error: error.message || "Rent generation failed"
    }, { status: 500 });
  }
}
