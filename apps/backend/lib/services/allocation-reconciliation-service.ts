import { prisma } from "../db";
import { eventLog } from "./event-log-service";
import { getLogger } from "../logger";
import { invalidateHostelDashboardCache } from "../cache/dashboard-cache";
import { roomCapacityService } from "./room-capacity-service";
import { obligationEngine } from "../../src/services/payments/obligation-engine";

const logger = getLogger("allocation-reconcile");

type ReconcileResult = {
  allocation_id: string;
  tenant_id: string;
  room_id: string;
  checks: string[];
  repairs: string[];
};

/**
 * AllocationReconciliationService
 *
 * Integrity-first reconciliation between:
 * - room_allocations state
 * - tenant lifecycle state
 * - obligation state
 *
 * This service performs conservative automatic repairs only.
 * Unsafe cases are surfaced via logs for manual action.
 */
export class AllocationReconciliationService {
  async reconcileAllocation(allocationId: string): Promise<ReconcileResult> {
    const allocation = await prisma.roomAllocation.findUnique({
      where: { id: allocationId },
      include: {
        tenant: { select: { id: true, status: true, owner_id: true } },
        room: { select: { id: true, capacity: true } },
      },
    });

    if (!allocation) {
      throw new Error("NOT_FOUND: Allocation not found");
    }

    const checks: string[] = [];
    const repairs: string[] = [];
    const now = new Date();

    // 1) Room capacity integrity — occupied tenants plus active invitation
    //    reservations consume room capacity.
    const capacity = await roomCapacityService.getRoomCapacitySnapshot(allocation.room_id);
    checks.push("capacity_checked");

    if (capacity.used > capacity.capacity) {
      const msg = `Room ${allocation.room_id} over capacity: ${capacity.occupied} occupied + ${capacity.reserved} reserved/${capacity.capacity}`;
      logger.error("allocation.capacity_violation", {
        allocation_id: allocationId,
        room_id: allocation.room_id,
        occupants: capacity.occupied,
        reserved: capacity.reserved,
        capacity: capacity.capacity,
      });
      await eventLog.log("ALLOCATION_CAPACITY_VIOLATION", allocation.tenant.owner_id || null, {
        allocation_id: allocationId,
        room_id: allocation.room_id,
        occupants: capacity.occupied,
        reserved: capacity.reserved,
        capacity: capacity.capacity,
      }, allocation.tenant_id);
      // Conservative: we do not auto-evict.
      throw new Error(`CONFLICT: ${msg}`);
    }

    // 2) Tenant lifecycle vs allocation integrity
    //    CANCELLED and EXPIRED must not hold open allocations.
    if (allocation.tenant.status !== 'ACTIVE' && allocation.is_active) {
      await prisma.roomAllocation.update({
        where: { id: allocationId },
        data: { is_active: false, end_date: now },
      });
      repairs.push("closed_allocation_for_inactive_tenant");
      await eventLog.log("ALLOCATION_AUTO_CLOSED", allocation.tenant.owner_id || null, {
        allocation_id: allocationId,
        reason: `tenant_status_${allocation.tenant.status}`,
      }, allocation.tenant_id);
    }
    checks.push("tenant_state_checked");

    // 3) Obligation consistency for ended allocations:
    //    waive future unpaid obligations linked to allocations that have ended.
    const fresh = await prisma.roomAllocation.findUnique({
      where: { id: allocationId },
      select: { end_date: true, is_active: true },
    });

    if (fresh?.end_date) {
      const endMonth = new Date(Date.UTC(
        fresh.end_date.getUTCFullYear(),
        fresh.end_date.getUTCMonth(),
        1
      ));

      const dangling = await prisma.rent_obligations.findMany({
        where: {
          allocation_id: allocationId,
          rent_month: { gt: endMonth },
          status: { in: ["PENDING", "PARTIAL"] },
        },
        include: {
          payments: { select: { id: true } },
        },
      });

      const zeroPaymentDangling = dangling.filter((ob: any) => (ob.payments || []).length === 0);
      if (zeroPaymentDangling.length > 0) {
        // Routed through ObligationEngine.cancelObligationInTx (no ledger
        // correction — these obligations were never actually owed, since the
        // allocation ended before their rent_month). Wrapped in a real
        // transaction, closing a pre-existing atomicity gap (the previous
        // per-row updates ran outside any transaction).
        await prisma.$transaction(async (tx: any) => {
          for (const ob of zeroPaymentDangling) {
            await obligationEngine.cancelObligationInTx(tx, {
              obligationId: ob.id,
              reason: "Allocation ended before this obligation's rent month",
              actorId: allocation.tenant.owner_id || "",
            });
            repairs.push(`cancelled_future_obligation:${ob.id}`);
          }
        });
      }
    }
    checks.push("obligation_state_checked");

    // 4) Duplicate obligation detection (do not auto-delete financial rows)
    const obligations = await prisma.rent_obligations.findMany({
      where: { allocation_id: allocationId },
      select: { id: true, allocation_id: true, rent_month: true, obligation_type: true },
    });
    const dupes = new Map<string, number>();
    for (const ob of obligations) {
      const key = `${ob.allocation_id}|${ob.rent_month.toISOString()}|${ob.obligation_type}`;
      dupes.set(key, (dupes.get(key) || 0) + 1);
    }
    const dupeGroups = Array.from(dupes.entries())
      .filter(([, count]) => count > 1)
      .map(([key, count]) => ({ key, count }));

    if (dupeGroups.length > 0) {
      logger.error("allocation.duplicate_obligations_detected", {
        allocation_id: allocationId,
        duplicate_groups: dupeGroups.length,
      });
      await eventLog.log("ALLOCATION_DUPLICATE_OBLIGATIONS_DETECTED", allocation.tenant.owner_id || null, {
        allocation_id: allocationId,
        groups: dupeGroups,
      }, allocation.tenant_id);
    }
    checks.push("duplicate_scan_done");

    return {
      allocation_id: allocationId,
      tenant_id: allocation.tenant_id,
      room_id: allocation.room_id,
      checks,
      repairs,
    };
  }

  async reconcileTenant(tenantId: string) {
    const allocations = await prisma.roomAllocation.findMany({
      where: { tenant_id: tenantId, is_active: true, end_date: null },
      select: { id: true },
      orderBy: { start_date: "desc" },
    });

    const results: ReconcileResult[] = [];
    for (const a of allocations) {
      const res = await this.reconcileAllocation(a.id);
      results.push(res);
    }
    return { tenant_id: tenantId, reconciled_allocations: results.length, results };
  }

  async reconcileRoom(roomId: string) {
    const allocations = await prisma.roomAllocation.findMany({
      where: { room_id: roomId, is_active: true, end_date: null },
      select: { id: true },
    });

    const results: ReconcileResult[] = [];
    for (const a of allocations) {
      const res = await this.reconcileAllocation(a.id);
      results.push(res);
    }
    return { room_id: roomId, reconciled_allocations: results.length, results };
  }

  /**
   * Expire stale invitations and release room reservations.
   * Rule: tenant INVITED + invitation expired => status EXPIRED (not FORMER_TENANT).
   *
   * IMPORTANT: FORMER_TENANT is reserved for previously-ACTIVE tenants who departed.
   * A tenant who was never activated goes to EXPIRED, not FORMER_TENANT.
   */
  async expireStaleInvitations(now: Date = new Date()) {
    const staleInvitations = await prisma.tenant_invitations.findMany({
      where: {
        status: { in: ["PENDING", "OPENED"] },
        expires_at: { lt: now },
      },
      include: {
        tenant: true,
        reservations: {
          where: { status: "ACTIVE" },
          select: { id: true, room_id: true },
        },
      },
    });

    let expired = 0;
    for (const invitation of staleInvitations) {
      await prisma.$transaction(async (tx: any) => {
        await tx.tenant_invitations.update({
          where: { id: invitation.id },
          data: { status: "EXPIRED", updated_at: now },
        });
        await tx.tenants.update({
          where: { id: invitation.tenant_id },
          data: { status: "EXPIRED" as any },
        });
        await tx.tenant_invitation_reservations.updateMany({
          where: { invitation_id: invitation.id, status: "ACTIVE" },
          data: {
            status: "RELEASED",
            released_by: invitation.owner_id,
            released_at: now,
            release_reason: "EXPIRED",
            updated_at: now,
          },
        });
        // Legacy cleanup only. New invitations do not create allocations or obligations.
        await tx.roomAllocation.updateMany({
          where: { tenant_id: invitation.tenant_id, is_active: true, end_date: null },
          data: { is_active: false, end_date: now },
        });
        // Waive any future unpaid obligations — never activated tenants
        // should not accumulate financial obligations. Routed through
        // ObligationEngine so any PARTIAL obligation gets a proper ledger
        // correction instead of a silent status flip.
        const toWaive = await tx.rent_obligations.findMany({
          where: {
            tenant_id: invitation.tenant_id,
            status: { in: ["PENDING", "PARTIAL"] },
          },
          select: { id: true },
        });
        if (toWaive.length > 0) {
          await obligationEngine.bulkWaiveInTx(tx, {
            obligationIds: toWaive.map((o: any) => o.id),
            reason: "Invitation expired — tenant never moved in",
            actorId: invitation.owner_id,
          });
        }
      });

      expired++;
      await eventLog.log("INVITATION_EXPIRED_AUTO_RELEASE", invitation.owner_id || null, {
        tenant_id: invitation.tenant_id,
        invitation_id: invitation.id,
        new_status: "EXPIRED",
        released_rooms: invitation.reservations.map((r: any) => r.room_id),
        released_reservations: invitation.reservations.map((r: any) => r.id),
      }, invitation.tenant_id);
      if (invitation.hostel_id) invalidateHostelDashboardCache(invitation.hostel_id);
    }

    return { expired_count: expired };
  }
}

export const allocationReconciliationService = new AllocationReconciliationService();
