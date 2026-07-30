/**
 * ════════════════════════════════════════════════════════════
 * Approval Engine — Change Request Lifecycle Transitions
 * ════════════════════════════════════════════════════════════
 *
 * Manages the approve/reject/expire lifecycle for change requests
 * that require tenant approval (Level 2 and Level 3).
 *
 * Level 2: Owner + Tenant → applies profile changes
 * Level 3: Owner + Tenant + Financial Engine → creates agreement amendment
 */

import { prisma } from "../../../lib/db";
import { getLogger } from "../../../lib/logger";
import type { ChangeRequestStatus } from "@prisma/client";
import { changeManagementFacade } from "./change-management-facade";

const logger = getLogger("approval-engine");

// ─── Approval Engine ─────────────────────────────────────────

class ApprovalEngine {

  /**
   * Tenant approves a pending change request.
   * Delegates execution to ChangeManagementFacade.
   */
  async approve(
    changeRequestId: string,
    actorId: string,
    options?: { notes?: string; ipAddress?: string; userAgent?: string }
  ) {
    const result = await changeManagementFacade.approve(changeRequestId, actorId, options);
    return result.cr;
  }

  /**
   * Tenant rejects a pending change request.
   * Delegates execution to ChangeManagementFacade.
   */
  async reject(
    changeRequestId: string,
    actorId: string,
    options?: { reason?: string; ipAddress?: string; userAgent?: string }
  ) {
    return await changeManagementFacade.reject(changeRequestId, actorId, options);
  }

  /**
   * Expire stale pending requests.
   * Called by the cron job (change-request-cron.ts).
   */
  async expireStalePending(): Promise<number> {
    const now = new Date();

    const stale = await prisma.change_requests.findMany({
      where: {
        status: "PENDING",
        expires_at: { lte: now },
      },
      select: { id: true, tenant_id: true, owner_id: true },
    });

    if (stale.length === 0) return 0;

    await prisma.change_requests.updateMany({
      where: {
        id: { in: stale.map(s => s.id) },
      },
      data: {
        status: "EXPIRED",
        updated_at: now,
      },
    });

    // Record expiration events
    for (const cr of stale) {
      await this.recordEvent(cr.id, "expired", null, "system", {
        expired_at: now.toISOString(),
      });
    }

    logger.info("change_requests_expired", { count: stale.length });

    return stale.length;
  }

  /**
   * Send reminders for pending requests approaching expiration.
   * Day 7 → first reminder, Day 14 → second reminder.
   */
  async sendReminders(): Promise<number> {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const pendingNeedingReminder = await prisma.change_requests.findMany({
      where: {
        status: "PENDING",
        created_at: { lte: sevenDaysAgo },
        reminder_count: { lt: 2 },
        // Only remind if last reminder was at least 7 days ago (or never sent)
        OR: [
          { last_reminded_at: null },
          { last_reminded_at: { lte: sevenDaysAgo } },
        ],
      },
      select: { id: true, tenant_id: true, owner_id: true, reminder_count: true },
    });

    for (const cr of pendingNeedingReminder) {
      await prisma.change_requests.update({
        where: { id: cr.id },
        data: {
          reminder_count: cr.reminder_count + 1,
          last_reminded_at: now,
          updated_at: now,
        },
      });

      await this.recordEvent(cr.id, "reminded", null, "system", {
        reminder_number: cr.reminder_count + 1,
      });

      // TODO (Phase 5): Trigger WhatsApp/push notification to tenant
    }

    if (pendingNeedingReminder.length > 0) {
      logger.info("change_request_reminders_sent", {
        count: pendingNeedingReminder.length,
      });
    }

    return pendingNeedingReminder.length;
  }

  // ─── Internal Methods ──────────────────────────────────

  /**
   * Record an immutable audit event.
   */
  private async recordEvent(
    changeRequestId: string,
    action: string,
    actorId: string | null,
    actorRole: string,
    snapshot?: Record<string, unknown> | null,
    notes?: string | null,
    ipAddress?: string | null,
    userAgent?: string | null
  ) {
    try {
      await prisma.change_request_events.create({
        data: {
          change_request_id: changeRequestId,
          action,
          actor_id: actorId ?? null,
          actor_role: actorRole,
          snapshot: snapshot as any ?? null,
          notes: notes ?? null,
          ip_address: ipAddress ?? null,
          user_agent: userAgent ?? null,
        },
      });
    } catch (err: any) {
      logger.error("approval_event_write_failed", {
        cr_id: changeRequestId,
        action,
        error: err?.message,
      });
    }
  }
}

export const approvalEngine = new ApprovalEngine();
