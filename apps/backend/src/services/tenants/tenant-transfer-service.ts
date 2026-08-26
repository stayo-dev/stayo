/**
 * 🔄 Tenant Transfer Service — Phase 3: Hostel Transfer Engine
 *
 * Supports operationally safe tenant hostel transfers with:
 * - Atomic allocation close + create in a single transaction
 * - Immutable financial record preservation (all old obligations/payments stay on old hostel)
 * - Mutable Tenant.hostel_id update to new operational hostel
 * - Full audit trail via TenantTransferLog
 *
 * TRANSFER RULES:
 * 1. Old allocation is closed (end_date set, is_active = false)
 * 2. New allocation is created with denormalized hostel_id from target room
 * 3. Tenant.hostel_id is updated to new hostel (mutable, current context)
 * 4. All historical financial records remain attached to old hostel FOREVER
 * 5. Only FUTURE obligations use the new hostel
 *
 * BLOCKERS:
 * - Target room must have capacity
 * - Both hostels must belong to the same owner
 * - Tenant must have an active allocation (otherwise use normal allocateRoom)
 * - No corrupted allocation state
 */

import { prisma } from "../../../lib/db";
import { eventSystem } from "../../../lib/events";
import { eventLog } from "../../../lib/services/event-log-service";
import { getLogger } from "../../../lib/logger";
import { assertCapability } from "../../../lib/services/move-out-service";
import { roomCapacityService } from "../../../lib/services/room-capacity-service";
import { assertTransferActorOwnsTenant } from "./tenant-transfer-authorization";
import crypto from "crypto";

const logger = getLogger("tenant-transfer-service");

export interface TransferRequest {
  tenantId: string;
  targetRoomId: string;
  transferredBy: string; // owner/admin who authorized the transfer
  /**
   * The caller's resolved owner scope, or undefined for a platform admin.
   * Required to stop one owner moving another owner's tenant — the
   * same-owner check below compares the room to the tenant, not to the caller.
   */
  actorOwnerId?: string;
  reason?: string;
  notes?: string;
  transferDate?: Date;
}

export interface TransferResult {
  success: boolean;
  transfer_id: string;
  tenant_id: string;
  from_hostel_id: string;
  to_hostel_id: string;
  old_allocation_id: string;
  new_allocation_id: string;
}

export class TenantTransferService {

  /**
   * Execute a tenant hostel transfer atomically.
   *
   * This is the ONLY sanctioned way to move a tenant between hostels.
   * Direct allocation manipulation will not update Tenant.hostel_id
   * or create the audit trail.
   */
  async transferTenant(request: TransferRequest): Promise<TransferResult> {
    const { tenantId, targetRoomId, transferredBy, actorOwnerId, reason, notes } = request;
    const transferDate = request.transferDate || new Date();

    await assertCapability(tenantId, "TRANSFER_ROOM");

    // ── Pre-flight validation (outside transaction for fast-fail) ────────────

    // 1. Verify tenant exists and has an active allocation
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      include: {
        room_allocations: {
          where: { is_active: true, end_date: null },
          include: { room: { select: { id: true, hostel_id: true } } },
          orderBy: { start_date: "desc" },
          take: 1,
        },
      },
    });

    if (!tenant) {
      throw new Error("NOT_FOUND: Tenant not found");
    }
    if (!(tenant as any).room_allocations[0]) {
      throw new Error("VALIDATION_ERROR: Tenant has no active allocation. Use normal room allocation instead.");
    }
    if (tenant.status !== "ACTIVE") {
      throw new Error("VALIDATION_ERROR: Only active tenants can be transferred");
    }

    // The caller must own this tenant. Rule 3 below only proves the room and
    // the tenant share an owner — it says nothing about who is asking.
    assertTransferActorOwnsTenant(actorOwnerId, tenant.owner_id);

    const currentAllocation = (tenant as any).room_allocations[0];
    const fromHostelId = currentAllocation.room.hostel_id;

    const activeMoveOut = await prisma.move_out_requests.findFirst({
      where: {
        tenant_id: tenantId,
        status: { notIn: ["COMPLETED", "REJECTED"] },
      },
      include: {
        settlement: true,
        disputes: { where: { status: "OPEN" }, select: { id: true } },
      },
    });
    if (activeMoveOut) {
      throw new Error("VALIDATION_ERROR: Transfer is blocked by an active move-out workflow");
    }

    const unresolvedSettlement = await prisma.exit_settlement_transactions.findFirst({
      where: {
        tenant_id: tenantId,
        payment_status: { notIn: ["PAID", "SETTLED", "WAIVED", "CANCELLED"] },
      },
      select: { id: true },
    });
    if (unresolvedSettlement) {
      throw new Error("VALIDATION_ERROR: Transfer is blocked by an unresolved settlement");
    }

    const openDispute = await prisma.exit_disputes.findFirst({
      where: {
        status: "OPEN",
        request: { tenant_id: tenantId },
      },
      select: { id: true },
    });
    if (openDispute) {
      throw new Error("VALIDATION_ERROR: Transfer is blocked by an active dispute");
    }

    // 2. Verify target room exists and belongs to the same owner
    const targetRoom = await prisma.rooms.findUnique({
      where: { id: targetRoomId },
      include: {
        hostel: { select: { id: true, owner_id: true, name: true, status: true } },
        room_allocations: { where: { is_active: true, end_date: null, tenant: { status: "ACTIVE" } } },
      },
    });

    if (!targetRoom) {
      throw new Error("NOT_FOUND: Target room not found");
    }
    if (targetRoom.hostel.status === "ARCHIVED") {
      throw new Error("VALIDATION_ERROR: Target hostel is archived");
    }
    if (targetRoom.hostel.status === "INACTIVE") {
      throw new Error("VALIDATION_ERROR: Target hostel is inactive");
    }

    const toHostelId = targetRoom.hostel_id;

    // 3. Ownership validation — both hostels must belong to the same owner.
    //    (Whether the *caller* is that owner is asserted above.)
    if (targetRoom.hostel.owner_id !== tenant.owner_id) {
      throw new Error("FORBIDDEN: Target room belongs to a different owner");
    }

    // 4. Same-hostel check — this is a room shift, not a transfer
    if (fromHostelId === toHostelId) {
      throw new Error(
        "VALIDATION_ERROR: Source and target are in the same hostel. Use room shift instead of hostel transfer."
      );
    }

    // 5. Capacity check
    const capacity = await roomCapacityService.getRoomCapacitySnapshot(targetRoomId, { ownerId: tenant.owner_id });
    if (capacity.available <= 0) {
      throw new Error("VALIDATION_ERROR: Target room is at maximum capacity");
    }

    // ── Atomic transfer transaction ─────────────────────────────────────────

    const result = await prisma.$transaction(async (tx: any) => {
      // A. Close old allocation
      await tx.roomAllocation.update({
        where: { id: currentAllocation.id },
        data: {
          end_date: transferDate,
          is_active: false,
        },
      });

      // B. Create new allocation with denormalized hostel_id
      const newAllocation = await tx.roomAllocation.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenantId,
          room_id: targetRoomId,
          start_date: transferDate,
          hostel_id: toHostelId, // Phase 2: immutable hostel snapshot
        },
      });

      // C. Update Tenant.hostel_id to new operational hostel (mutable field)
      await tx.tenants.update({
        where: { id: tenantId },
        data: { hostel_id: toHostelId },
      });

      // D. Create immutable audit trail
      const transferLog = await tx.tenant_transfer_logs.create({
        data: {
          tenant_id: tenantId,
          from_hostel_id: fromHostelId,
          to_hostel_id: toHostelId,
          old_allocation_id: currentAllocation.id,
          new_allocation_id: newAllocation.id,
          transferred_by: transferredBy,
          transferred_at: transferDate,
          reason: reason || null,
          notes: notes || null,
        },
      });

      return {
        transfer_id: transferLog.id,
        new_allocation_id: newAllocation.id,
      };
    });

    // ── Post-transaction side effects (non-blocking) ────────────────────────

    // Structured audit event
    await eventLog.log("TENANT_TRANSFERRED", transferredBy, {
      tenant_id: tenantId,
      from_hostel_id: fromHostelId,
      to_hostel_id: toHostelId,
      old_allocation_id: currentAllocation.id,
      new_allocation_id: result.new_allocation_id,
      reason,
    }).catch((e: any) => logger.error("transfer_audit_failed", { err: e.message }));

    // SSE event for dashboard refresh
    await eventSystem.trigger("tenant_transferred", {
      tenant_id: tenantId,
      from_hostel_id: fromHostelId,
      to_hostel_id: toHostelId,
      owner_id: tenant.owner_id,
    }).catch((e: any) => logger.error("transfer_event_failed", { err: e.message }));

    logger.info("tenant_transfer_complete", {
      transfer_id: result.transfer_id,
      tenant_id: tenantId,
      from: fromHostelId,
      to: toHostelId,
    });

    return {
      success: true,
      transfer_id: result.transfer_id,
      tenant_id: tenantId,
      from_hostel_id: fromHostelId,
      to_hostel_id: toHostelId,
      old_allocation_id: currentAllocation.id,
      new_allocation_id: result.new_allocation_id,
    };
  }

  /**
   * Get transfer history for a tenant.
   * Used by tenant detail view to show hostel movement history.
   */
  /**
   * `actorOwnerId` is the caller's owner scope, or undefined for an admin.
   * Without it this returned any tenant's movement history to any owner.
   */
  async getTransferHistory(tenantId: string, actorOwnerId?: string) {
    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: { owner_id: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    assertTransferActorOwnsTenant(actorOwnerId, tenant.owner_id);

    return prisma.tenant_transfer_logs.findMany({
      where: { tenant_id: tenantId },
      orderBy: { transferred_at: "desc" },
    });
  }

  /**
   * Get all transfers for a hostel (incoming and outgoing).
   * Used by hostel analytics to understand tenant churn patterns.
   */
  async getHostelTransfers(hostelId: string, direction: "in" | "out" | "all" = "all") {
    const where: any = {};
    if (direction === "in") {
      where.to_hostel_id = hostelId;
    } else if (direction === "out") {
      where.from_hostel_id = hostelId;
    } else {
      where.OR = [
        { from_hostel_id: hostelId },
        { to_hostel_id: hostelId },
      ];
    }

    return prisma.tenant_transfer_logs.findMany({
      where,
      orderBy: { transferred_at: "desc" },
    });
  }
}

export const tenantTransferService = new TenantTransferService();
