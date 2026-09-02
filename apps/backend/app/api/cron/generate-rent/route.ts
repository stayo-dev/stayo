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

/**
 * Optional single-owner filter. `?ownerId` (or the legacy env vars) narrows the
 * run to one owner for manual/debug purposes. When absent, the cron processes
 * EVERY operational owner's active hostels — this is the normal path. It used to
 * hard-require a single operational owner and 409 otherwise, which silently
 * stopped all rent generation the moment a second owner onboarded a tenant.
 */
function configuredOwnerId(searchParams: URLSearchParams) {
  return (
    searchParams.get("ownerId") ||
    process.env.RENT_CRON_OWNER_ID ||
    process.env.PRIMARY_OWNER_ID ||
    process.env.PRODUCTION_OWNER_ID ||
    null
  );
}

/**
 * 🕐 CRON — Monthly Rent Generation
 * GET /api/cron/generate-rent
 *
 * Called by Vercel Cron daily; idempotent and catch-up safe — it always targets
 * the current calendar month and re-running creates nothing new (per-hostel
 * `system_locks` lock + `rent_generation_ledgers` + the DB unique constraints on
 * `rent_obligations`).
 *
 * Scope: all ACTIVE hostels that have at least one active allocation to an ACTIVE
 * tenant, across every owner. Paginated by hostel `id` (stable cursor). A single
 * invocation drains as many batches as fit inside SOFT_TIMEOUT_MS; if it runs out
 * of budget it returns `has_more: true` + `next_cursor` for a follow-up call.
 */
export async function GET(req: NextRequest) {
  const startedAt = Date.now();
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
    const includeEmptyHostels = searchParams.get("includeEmptyHostels") === "true";
    const explicitOwnerId = configuredOwnerId(searchParams);

    const operationalFilter = includeEmptyHostels
      ? {}
      : {
          room_allocations: {
            some: {
              is_active: true,
              tenant: { status: "ACTIVE" as const },
            },
          },
        };

    const baseWhere: any = {
      status: "ACTIVE",
      ...(explicitOwnerId ? { owner_id: explicitOwnerId } : {}),
      ...operationalFilter,
    };

    const results: any[] = [];
    const ownersTouched = new Set<string>();
    let cursor = searchParams.get("cursor");
    let stoppedForTimeBudget = false;
    let hasMore = false;

    // Drain batches within the time budget. Each batch pages by hostel `id`.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const hostels = await prisma.hostels.findMany({
        where: {
          ...baseWhere,
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        select: { id: true, owner_id: true, name: true },
        orderBy: { id: "asc" },
        take: limit + 1,
      });

      if (hostels.length === 0) break;

      const hasMoreByLimit = hostels.length > limit;
      const batch = hasMoreByLimit ? hostels.slice(0, limit) : hostels;

      console.log("[CRON] Monthly rent generation batch start:", {
        hostels_in_batch: batch.length,
        limit,
        cursor,
        explicit_owner_id: explicitOwnerId,
        include_empty_hostels: includeEmptyHostels,
      });

      for (const hostel of batch) {
        if (Date.now() - startedAt > SOFT_TIMEOUT_MS) {
          stoppedForTimeBudget = true;
          console.warn("[CRON] Rent generation soft timeout reached; stopping before Vercel timeout", {
            processed: results.length,
          });
          break;
        }

        try {
          const result = await rentGenerationService.generateMonthlyRent(
            undefined,
            hostel.owner_id,
            "cron",
            hostel.id
          );
          results.push({ hostel_id: hostel.id, hostel_name: hostel.name, owner_id: hostel.owner_id, ...result });
        } catch (hostelError: any) {
          console.error("[CRON] Rent generation failed for hostel:", {
            hostel_id: hostel.id,
            hostel_name: hostel.name,
            owner_id: hostel.owner_id,
            error: hostelError?.message || String(hostelError),
          });
          results.push({
            hostel_id: hostel.id,
            hostel_name: hostel.name,
            owner_id: hostel.owner_id,
            created: 0,
            skipped: 0,
            failed: 1,
            error: hostelError?.message || "Rent generation failed for hostel",
          });
        }
        if (hostel.owner_id) ownersTouched.add(hostel.owner_id);
        cursor = hostel.id;
      }

      if (stoppedForTimeBudget) {
        hasMore = true;
        break;
      }
      if (!hasMoreByLimit) {
        hasMore = false;
        break;
      }
      // more hostels remain and we still have time — continue draining
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

    console.log("[CRON] Monthly rent generation run complete:", {
      ...summary,
      owners_touched: ownersTouched.size,
      hostels_processed: results.length,
      has_more: hasMore,
      next_cursor: hasMore ? cursor : null,
      duration_ms: Date.now() - startedAt,
    });

    return NextResponse.json({
      success: true,
      ...summary,
      owners_touched: Array.from(ownersTouched),
      hostels_processed: results.length,
      batch_limit: limit,
      has_more: hasMore,
      next_cursor: hasMore ? cursor : null,
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
