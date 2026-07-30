/**
 * Move-Out Notifications — Fires on every status transition.
 *
 * Called by MoveOutService after each state change.
 * Sends in-app notifications to both tenant and owner.
 */

import { notificationService } from "./notification-service";
import { prisma } from "../db";
import { getLogger } from "../logger";
import { invalidateHostelDashboardCache, invalidateOwnerDashboardCache } from "../cache/dashboard-cache";

const logger = getLogger("move-out-notify");

// Human-readable status messages for tenants
const TENANT_MESSAGES: Record<string, { title: string; message: string }> = {
  REQUESTED: {
    title: "Move-out request received",
    message: "We've received your move-out request. The hostel team will review it shortly.",
  },
  SETTLEMENT_PENDING: {
    title: "Room inspection completed",
    message: "Your room inspection is done. The settlement is being calculated.",
  },
  SETTLEMENT_APPROVED: {
    title: "Settlement ready for review",
    message: "Your final settlement has been calculated. Open the Move-Out section to review it.",
  },
  PHYSICALLY_VACATED: {
    title: "Bed vacated",
    message: "You have vacated the bed. Final settlement remains tracked separately.",
  },
  SETTLEMENT_PENDING_PAYMENT: {
    title: "Settlement payment pending",
    message: "Your move-out settlement has an outstanding payment to complete.",
  },
  COMPLETED: {
    title: "Move-out complete",
    message: "Your move-out is complete. Thank you for staying with us — we wish you all the best!",
  },
  REJECTED: {
    title: "Move-out request rejected",
    message: "Your move-out request was rejected/cancelled. Your tenancy continues as normal.",
  },
};

// Owner-facing messages (operational)
const OWNER_MESSAGES: Record<string, { title: string; message: (name: string) => string }> = {
  REQUESTED: {
    title: "New move-out request",
    message: (n) => `${n} has submitted a move-out request. Schedule an inspection.`,
  },
  SETTLEMENT_PENDING: {
    title: "Inspection completed",
    message: (n) => `Room inspection for ${n} is done. Review the settlement.`,
  },
  SETTLEMENT_APPROVED: {
    title: "Settlement approved",
    message: (n) => `Settlement approved for ${n}. Ready for them to vacate.`,
  },
  PHYSICALLY_VACATED: {
    title: "Tenant vacated",
    message: (n) => `${n} has vacated the bed. Room is now available.`,
  },
  SETTLEMENT_PENDING_PAYMENT: {
    title: "Settlement payment pending",
    message: (n) => `${n}'s room is released, but settlement payment is still pending.`,
  },
  COMPLETED: {
    title: "Move-out completed",
    message: (n) => `${n}'s move-out is complete.`,
  },
  REJECTED: {
    title: "Move-out request rejected",
    message: (n) => `Move-out request for ${n} was rejected/cancelled.`,
  },
};

/**
 * Notify both tenant and owner about a move-out status change.
 * Fire-and-forget: errors are logged but never thrown.
 */
export async function notifyMoveOutTransition(
  requestId: string,
  newStatus: string,
): Promise<void> {
  try {
    const req = await prisma.move_out_requests.findUnique({
      where: { id: requestId },
      select: {
        tenant_id: true,
        owner_id: true,
        hostel_id: true,
        physical_exit_date: true,
        planned_exit_date: true,
        tenant: { select: { profile_id: true, profiles: { select: { name: true } } } },
      },
    });
    if (!req) return;

    // Invalidate dashboard caches on any status transition
    if (req.hostel_id) {
      try {
        invalidateHostelDashboardCache(req.hostel_id);
      } catch (err: any) {
        logger.error("move_out.invalidate_hostel_cache_failed", { hostel_id: req.hostel_id, error: err.message });
      }
    }
    if (req.owner_id) {
      try {
        invalidateOwnerDashboardCache(req.owner_id);
      } catch (err: any) {
        logger.error("move_out.invalidate_owner_cache_failed", { owner_id: req.owner_id, error: err.message });
      }
    }

    const tenantProfileId = req.tenant?.profile_id;
    const tenantName = req.tenant?.profiles?.name || "Tenant";

    const exitDate = req.physical_exit_date || req.planned_exit_date;
    const isFuture = exitDate && new Date(exitDate).getTime() > new Date().getTime();
    const dateStr = exitDate ? new Date(exitDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

    // Notify tenant
    let tenantTitle = "";
    let tenantMessage = "";

    if (newStatus === "PHYSICALLY_VACATED" || newStatus === "VACATED") {
      if (isFuture) {
        tenantTitle = "Move-out Approved & Vacate Registered";
        tenantMessage = `Your bed vacate has been registered. You remain an active resident until your scheduled exit date: ${dateStr}.`;
      } else {
        tenantTitle = TENANT_MESSAGES.PHYSICALLY_VACATED.title;
        tenantMessage = TENANT_MESSAGES.PHYSICALLY_VACATED.message;
      }
    } else if (newStatus === "COMPLETED") {
      if (isFuture) {
        tenantTitle = "Settlement Completed";
        tenantMessage = `Your final payment/settlement is completed. Your move-out is fully processed and scheduled for ${dateStr}.`;
      } else {
        tenantTitle = TENANT_MESSAGES.COMPLETED.title;
        tenantMessage = TENANT_MESSAGES.COMPLETED.message;
      }
    } else {
      const tenantMsg = TENANT_MESSAGES[newStatus];
      if (tenantMsg) {
        tenantTitle = tenantMsg.title;
        tenantMessage = tenantMsg.message;
      }
    }

    if (tenantTitle && tenantMessage && tenantProfileId) {
      await notificationService.createNotification(
        tenantProfileId, tenantTitle, tenantMessage, "move_out"
      );
    }

    // Notify owner
    const ownerMsg = OWNER_MESSAGES[newStatus];
    if (ownerMsg) {
      await notificationService.createNotification(
        req.owner_id, ownerMsg.title, ownerMsg.message(tenantName), "move_out"
      );
    }

    logger.info("move_out.notified", { request_id: requestId, status: newStatus });
  } catch (err: any) {
    // Never throw — notifications are best-effort
    logger.error("move_out.notify_failed", { request_id: requestId, error: err.message });
  }
}

export async function notifyMoveOutDisputeRaised(disputeId: string): Promise<void> {
  try {
    const dispute = await prisma.exit_disputes.findUnique({
      where: { id: disputeId },
      select: {
        id: true,
        dispute_type: true,
        disputed_amount: true,
        description: true,
        status: true,
        request: {
          select: {
            owner_id: true,
            hostel_id: true,
            tenant: {
              select: {
                profile_id: true,
                profiles: { select: { name: true } },
                room_allocations: {
                  where: { is_active: true },
                  take: 1,
                  include: { room: { select: { room_no: true } } },
                },
              },
            },
          },
        },
      },
    });
    if (!dispute) return;

    if (dispute.request.hostel_id) {
      try {
        invalidateHostelDashboardCache(dispute.request.hostel_id);
      } catch (err: any) {
        logger.error("move_out.dispute_invalidate_hostel_cache_failed", { hostel_id: dispute.request.hostel_id, error: err.message });
      }
    }
    if (dispute.request.owner_id) {
      try {
        invalidateOwnerDashboardCache(dispute.request.owner_id);
      } catch (err: any) {
        logger.error("move_out.dispute_invalidate_owner_cache_failed", { owner_id: dispute.request.owner_id, error: err.message });
      }
    }

    const tenantName = dispute.request.tenant?.profiles?.name || "Tenant";
    const roomNo = dispute.request.tenant?.room_allocations?.[0]?.room?.room_no || "unassigned room";
    const amount = dispute.disputed_amount != null
      ? `Rs. ${Number(dispute.disputed_amount).toLocaleString("en-IN")}`
      : "Not specified";
    const reason = String(dispute.dispute_type || "Settlement").replace(/_/g, " ");

    await notificationService.createNotification(
      dispute.request.owner_id,
      "Move-out dispute raised",
      `${tenantName} (${roomNo}) disputed ${amount}. Reason: ${reason}. Review the move-out settlement.`,
      "move_out_dispute",
    );

    if (dispute.request.tenant?.profile_id) {
      await notificationService.createNotification(
        dispute.request.tenant.profile_id,
        "Dispute submitted",
        `Reference ${dispute.id.slice(0, 8)} is ${dispute.status}. Awaiting owner review.`,
        "move_out_dispute",
      );
    }

    logger.info("move_out.dispute_notified", { dispute_id: disputeId });
  } catch (err: any) {
    logger.error("move_out.dispute_notify_failed", { dispute_id: disputeId, error: err.message });
  }
}

export async function notifyMoveOutDisputeUpdated(disputeId: string, status: string): Promise<void> {
  try {
    const dispute = await prisma.exit_disputes.findUnique({
      where: { id: disputeId },
      select: {
        id: true,
        resolution_notes: true,
        request: {
          select: {
            owner_id: true,
            hostel_id: true,
            tenant: {
              select: {
                profile_id: true,
                profiles: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    if (!dispute) return;

    if (dispute.request.hostel_id) {
      try {
        invalidateHostelDashboardCache(dispute.request.hostel_id);
      } catch (err: any) {
        logger.error("move_out.dispute_update_invalidate_hostel_cache_failed", { hostel_id: dispute.request.hostel_id, error: err.message });
      }
    }
    if (dispute.request.owner_id) {
      try {
        invalidateOwnerDashboardCache(dispute.request.owner_id);
      } catch (err: any) {
        logger.error("move_out.dispute_update_invalidate_owner_cache_failed", { owner_id: dispute.request.owner_id, error: err.message });
      }
    }

    const tenantName = dispute.request.tenant?.profiles?.name || "Tenant";
    const title = status === "REJECTED"
      ? "Move-out dispute rejected"
      : status === "RESOLVED"
        ? "Move-out dispute resolved"
        : "Move-out dispute under review";
    const tenantMessage = status === "UNDER_REVIEW"
      ? "Your move-out dispute is under owner review."
      : dispute.resolution_notes || "The owner has updated your move-out dispute.";
    const ownerMessage = `${tenantName}'s move-out dispute is now ${status.replace(/_/g, " ").toLowerCase()}.`;

    await notificationService.createNotification(dispute.request.owner_id, title, ownerMessage, "move_out_dispute");
    if (dispute.request.tenant?.profile_id) {
      await notificationService.createNotification(dispute.request.tenant.profile_id, title, tenantMessage, "move_out_dispute");
    }
  } catch (err: any) {
    logger.error("move_out.dispute_update_notify_failed", { dispute_id: disputeId, status, error: err.message });
  }
}
