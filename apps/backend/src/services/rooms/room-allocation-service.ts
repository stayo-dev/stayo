import { prisma, supabase } from "../../../lib/db";
import { eventSystem } from "../../../lib/events";
import { allocationReconciliationService } from "../../../lib/services/allocation-reconciliation-service";
import { roomCapacityService } from "../../../lib/services/room-capacity-service";
import { getLogger } from "../../../lib/logger";
import { allocationRepository } from "../../repositories/allocationRepository";
import { assertCapability } from "../../../lib/services/move-out-service";
import crypto from "crypto";

const logger = getLogger("room-allocation-service");

function mapAllocationConstraintError(err: any): Error {
  const msg = String(err?.message || err || "");
  if (err?.code === "P2002" || msg.includes("idx_room_allocations_active_tenant_unique")) {
    return new Error("VALIDATION_ERROR: Tenant already has an active allocation");
  }
  return err instanceof Error ? err : new Error(msg);
}

export class RoomAllocationService {

  // ✅ FIXED: Added missing method
  async getActiveAllocations(userId: string) {
    return await allocationRepository.findMany({
      where: {
        tenant: {
          owner_id: userId
        },
        is_active: true,
        end_date: null // active allocations
      },
      include: {
        room: true,
        tenant: true
      },
      orderBy: {
        start_date: "desc"
      }
    });
  }

  async getTenantHistory(tenantId: string) {
    return await allocationRepository.findMany({
      where: {
        tenant_id: tenantId
      },
      include: {
        room: true,
        hostel: true
      },
      orderBy: {
        start_date: "desc"
      }
    });
  }

  // ✅ Allocate Room (Prisma Transaction based)
  async allocateRoom(data: { tenantId: string; roomId: string; startDate: string; ownerId: string }) {
    const { tenantId, roomId, startDate, ownerId } = data;

    let allocationData: any;
    try {
      allocationData = await prisma.$transaction(async (tx: any) => {
        // 1. Only ACTIVE tenants owned by this owner can be manually assigned.
        const tenant = await tx.tenants.findFirst({
          where: {
            id: tenantId,
            owner_id: ownerId,
          },
          select: {
            id: true,
            status: true,
          },
        });

        if (!tenant) {
          throw new Error("NOT_FOUND: Tenant not found");
        }
        if (tenant.status !== "ACTIVE") {
          throw new Error("VALIDATION_ERROR: Only active tenants can be assigned to rooms");
        }

        // 2. Check if tenant already has an active allocation
        const existing = await tx.roomAllocation.findFirst({
          where: { tenant_id: tenantId, is_active: true, end_date: null }
        });
        
        if (existing) {
          throw new Error("VALIDATION_ERROR: Tenant is already allocated to a room and checking out is required first");
        }

        // 3. Check room capacity, including active invitation reservations.
        const capacity = await roomCapacityService.getRoomCapacitySnapshot(roomId, { tx, ownerId });
        const room = capacity.room;
        if (capacity.available <= 0) {
          throw new Error("VALIDATION_ERROR: Room is at maximum capacity");
        }

        // 4. Create allocation with denormalized hostel_id (immutable snapshot)
        const allocation = await tx.roomAllocation.create({
          data: {
            id: crypto.randomUUID(),
            tenant_id: tenantId,
            room_id: roomId,
            start_date: new Date(startDate),
            hostel_id: room.hostel_id, // Phase 2: immutable hostel context at creation
          }
        });

        // 5. Update Tenant.hostel_id to reflect current operational hostel
        await tx.tenants.update({
          where: { id: tenantId },
          data: { hostel_id: room.hostel_id },
        });

        return allocation;
      });
    } catch (err: any) {
      throw mapAllocationConstraintError(err);
    }

    // ✅ Trigger Events
    await eventSystem.trigger("tenant_allocated_room", {
      tenant_id: tenantId,
      room_id: roomId,
      allocation_id: allocationData.id,
      owner_id: ownerId
    });
    await allocationReconciliationService.reconcileAllocation(allocationData.id).catch((err: any) => {
      logger.error("reconcile_after_allocate_failed", {
        allocation_id: allocationData.id,
        error: String(err?.message || err),
      });
    });

    return allocationData;
  }

  // ✅ End Allocation
  async endAllocation(allocationId: string, endDate: string) {
    const updated = await allocationRepository.update({
      where: { id: allocationId },
      data: { 
        end_date: new Date(endDate),
        is_active: false
      }
    });
    await allocationReconciliationService.reconcileAllocation(allocationId).catch((err: any) => {
      logger.error("reconcile_after_end_failed", {
        allocation_id: allocationId,
        error: String(err?.message || err),
      });
    });
    return updated;
  }

  // ✅ Shift Room
  async shiftRoom(tenantId: string, newRoomId: string, shiftDate: string, ownerId: string) {
    await assertCapability(tenantId, "TRANSFER_ROOM");

    let shiftData: any;
    try {
      shiftData = await prisma.$transaction(async (tx: any) => {
        // 1. Find active allocation
        const active = await tx.roomAllocation.findFirst({
          where: {
            tenant_id: tenantId,
            is_active: true,
            end_date: null,
            tenant: { owner_id: ownerId },
          },
          orderBy: { start_date: "desc" }
        });

        if (!active) {
          throw new Error("NOT_FOUND: No active allocation found for tenant");
        }
        if (active.room_id === newRoomId) {
          throw new Error("VALIDATION_ERROR: Tenant is already assigned to this room");
        }

        // 2. Check new room ownership and capacity before closing the old allocation.
        const capacity = await roomCapacityService.getRoomCapacitySnapshot(newRoomId, { tx, ownerId });
        const room = capacity.room;
        if (capacity.available <= 0) {
          throw new Error("VALIDATION_ERROR: Target room is at maximum capacity");
        }

        // 3. End old allocation only after the target room is validated.
        await tx.roomAllocation.update({
          where: { id: active.id },
          data: { 
            end_date: new Date(shiftDate),
            is_active: false
          }
        });

        // 4. Create new allocation with denormalized hostel_id (immutable snapshot)
        const newAllocation = await tx.roomAllocation.create({
          data: {
            id: crypto.randomUUID(),
            tenant_id: tenantId,
            room_id: newRoomId,
            start_date: new Date(shiftDate),
            hostel_id: room.hostel_id, // Phase 2: immutable hostel context
          }
        });

        // 5. Update Tenant.hostel_id to new operational hostel
        await tx.tenants.update({
          where: { id: tenantId },
          data: { hostel_id: room.hostel_id },
        });

        return newAllocation;
      });
    } catch (err: any) {
      throw mapAllocationConstraintError(err);
    }

    // ✅ Trigger Events
    await eventSystem.trigger("tenant_allocated_room", {
      tenant_id: tenantId,
      room_id: newRoomId,
      allocation_id: shiftData.id,
      owner_id: ownerId
    });
    await allocationReconciliationService.reconcileAllocation(shiftData.id).catch((err: any) => {
      logger.error("reconcile_after_shift_failed", {
        allocation_id: shiftData.id,
        error: String(err?.message || err),
      });
    });

    return { success: true, new_allocation: shiftData };
  }
}

// ✅ Singleton export
export const roomAllocationService = new RoomAllocationService();
