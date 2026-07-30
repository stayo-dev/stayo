export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { resolvePreferences } from "@/lib/preferences";

/**
 * 🗑️ DATA RETENTION CRON
 * GET /api/cron/data-retention
 * 
 * FROZEN: Do not schedule this route.
 *
 * Current implementation permanently deletes records and has no archive path.
 * Scheduling requires a written retention policy, backup policy, archive
 * strategy, and auth review in docs/operations/cron-registry.md.
 *
 * Cleanup is based on each hostel's data_retention_months preference.
 * - If data_retention_months > 0: delete records older than the cutoff
 * - If data_retention_months = 0: retain forever (no action)
 * 
 * Protected by CRON_SECRET to prevent unauthorized invocation.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const hostels = await prisma.hostels.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
      select: {
        id: true,
        owner_id: true,
        name: true,
        preferences_config: true,
      },
    });

    let totalArchived = 0;
    const results: any[] = [];

    for (const hostel of hostels) {
      const prefs = resolvePreferences(hostel);
      const retentionMonths = prefs.data_retention_months;

      if (retentionMonths <= 0) continue; // Retain forever

      const cutoffDate = new Date();
      cutoffDate.setMonth(cutoffDate.getMonth() - retentionMonths);

      // Archive old activity logs
      const deletedLogs = await prisma.activity_logs.deleteMany({
        where: {
          owner_id: hostel.owner_id,
          timestamp: { lt: cutoffDate },
        },
      });

      // Archive old system event logs
      const deletedEvents = await prisma.systemEventLog.deleteMany({
        where: {
          owner_id: hostel.owner_id,
          created_at: { lt: cutoffDate },
        },
      });

      // Archive old reminder logs (via obligations owned by this owner)
      const oldObligations = await prisma.rent_obligations.findMany({
        where: {
          owner_id: hostel.owner_id,
          rent_month: { lt: cutoffDate },
          status: { in: ["PAID", "WAIVED"] },
        },
        select: { id: true },
      });

      const oldObligationIds = oldObligations.map((o) => o.id);
      let deletedReminders = 0;
      if (oldObligationIds.length > 0) {
        const result = await prisma.reminder_logs.deleteMany({
          where: {
            obligation_id: { in: oldObligationIds },
          },
        });
        deletedReminders = result.count;
      }

      const hostelTotal = deletedLogs.count + deletedEvents.count + deletedReminders;
      totalArchived += hostelTotal;

      if (hostelTotal > 0) {
        results.push({
          hostel: hostel.name,
          retention_months: retentionMonths,
          cutoff: cutoffDate.toISOString().slice(0, 10),
          activity_logs_deleted: deletedLogs.count,
          event_logs_deleted: deletedEvents.count,
          reminder_logs_deleted: deletedReminders,
        });

        await eventLog.log("DATA_RETENTION_CLEANUP", hostel.owner_id, {
          hostel_id: hostel.id,
          retention_months: retentionMonths,
          records_deleted: hostelTotal,
          cutoff_date: cutoffDate.toISOString(),
        });
      }
    }

    console.info("[cron.data-retention] completed", {
      hostels_checked: hostels.length,
      total_archived: totalArchived,
    });

    return NextResponse.json({
      success: true,
      hostels_checked: hostels.length,
      total_archived: totalArchived,
      details: results,
    });
  } catch (error: any) {
    console.error("[cron.data-retention] error:", error);
    return NextResponse.json(
      { error: error.message || "Data retention cleanup failed" },
      { status: 500 }
    );
  }
}
