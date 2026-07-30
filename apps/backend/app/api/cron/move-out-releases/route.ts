export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { notifyMoveOutTransition } from "@/lib/services/move-out-notifications";
import { moveOutService } from "@/lib/services/move-out-service";
import { notificationService } from "@/lib/services/notification-service";
import { obligationEngine } from "@/src/services/payments/obligation-engine";

/**
 * 🕐 CRON — Daily Move-Out Room Releases
 * GET /api/cron/move-out-releases
 *
 * Runs daily at midnight. Processes COMPLETED move-outs where:
 *   - physical_exit_date, actual_exit_date, or planned_exit_date has passed
 *   - room has NOT been released yet (room_release_date is null)
 *
 * Actions:
 *   1. Deactivate room allocation
 *   2. Set tenant status to LEFT
 *   3. Record room_release_date
 *
 * Protected by CRON_SECRET.
 * Idempotent: safe to call multiple times.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;

  if (!cronSecret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const now = new Date();

    // Find COMPLETED move-outs with past exit dates that haven't released rooms.
    // Legacy completed rows may not have physical_exit_date, so fall back to
    // actual_exit_date and planned_exit_date.
    const pending = await prisma.move_out_requests.findMany({
      where: {
        status: { in: ["COMPLETED", "VACATED"] },
        room_release_date: null,
        OR: [
          { physical_exit_date: { lte: now } },
          { physical_exit_date: null, actual_exit_date: { lte: now } },
          { physical_exit_date: null, actual_exit_date: null, planned_exit_date: { lte: now } },
        ],
      },
      select: {
        id: true,
        tenant_id: true,
        physical_exit_date: true,
        actual_exit_date: true,
        planned_exit_date: true,
        reason: true,
        reason_text: true,
        tenant: {
          select: {
            profile_id: true,
            owner_id: true,
          },
        },
      },
    });

    let released = 0;
    let failed = 0;

    for (const req of pending) {
      try {
        const exitDate = req.physical_exit_date || req.actual_exit_date || req.planned_exit_date || now;

        await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
          await tx.move_out_requests.update({
            where: { id: req.id },
            data: {
              physical_exit_date: req.physical_exit_date || exitDate,
              actual_exit_date: req.actual_exit_date || exitDate,
              room_release_date: exitDate,
              updated_at: now,
            },
          });
          await tx.roomAllocation.updateMany({
            where: { tenant_id: req.tenant_id, is_active: true, end_date: null },
            data: { is_active: false, end_date: exitDate },
          });
          await tx.tenants.update({
            where: { id: req.tenant_id },
            data: {
              status: "FORMER_TENANT",
              exit_date: exitDate,
              exit_reason: req.reason,
              exit_notes: req.reason_text,
              updated_at: now,
            },
          });
          // Routed through ObligationEngine so any PARTIAL obligation (real
          // payments on record) gets a proper ledger correction.
          const toWaive = await tx.rent_obligations.findMany({
            where: { tenant_id: req.tenant_id, status: { in: ["PENDING", "PARTIAL"] } },
            select: { id: true },
          });
          if (toWaive.length > 0 && req.tenant?.owner_id) {
            await obligationEngine.bulkWaiveInTx(tx, {
              obligationIds: toWaive.map((o: any) => o.id),
              reason: "Move-out completed — outstanding rent waived on room release",
              actorId: req.tenant.owner_id,
            });
          }
        });

        // Send final farewell notification
        if (req.tenant?.profile_id) {
          await notificationService.createNotification(
            req.tenant.profile_id,
            "Thank you for staying",
            "Your move-out is complete. Thank you for staying with us — we wish you all the best!",
            "move_out"
          ).catch((e: any) => {
            console.error(`[CRON] Notification failed for tenant profile ${req.tenant?.profile_id}:`, e.message);
          });
        }

        released++;
      } catch (err: any) {
        console.error(`[CRON] Room release failed for ${req.id}:`, err.message);
        failed++;
      }
    }

    console.log(`[CRON] Move-out room releases: ${released} released, ${failed} failed, ${pending.length} total`);

    return NextResponse.json({
      success: true,
      processed: pending.length,
      released,
      failed,
    });
  } catch (error: any) {
    console.error("[CRON] Move-out releases failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
