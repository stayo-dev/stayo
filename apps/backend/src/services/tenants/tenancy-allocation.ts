import crypto from "crypto";
import { roomCapacityService } from "../../../lib/services/room-capacity-service";

export interface EnsureAllocationParams {
  tenantId: string;
  roomId: string;
  hostelId: string;
  startDate: Date;
}

/**
 * Give a tenancy a live room allocation, idempotently.
 *
 * Extracted from `completeActivation` so owner adoption reaches the same code
 * path the tenant's own activation does — including the overbooking guard.
 * Two ways into one allocation, never two implementations of it.
 *
 * Caller must already hold the row locks (`SELECT ... FOR UPDATE` on the room)
 * — capacity is only meaningful under a lock.
 */
export async function ensureActiveAllocation(
  tx: any,
  params: EnsureAllocationParams,
): Promise<{ created: boolean }> {
  const existing = await tx.roomAllocation.findFirst({
    where: { tenant_id: params.tenantId, is_active: true, end_date: null },
  });
  if (existing) return { created: false };

  const capacity = await roomCapacityService.getRoomCapacitySnapshot(params.roomId, { tx });
  if (capacity.occupied >= Number(capacity.room.capacity || 0)) {
    throw new Error("CAPACITY_EXCEEDED: Reserved room no longer has available capacity");
  }

  await tx.roomAllocation.create({
    data: {
      id: crypto.randomUUID(),
      tenant_id: params.tenantId,
      room_id: params.roomId,
      hostel_id: params.hostelId,
      start_date: params.startDate,
      is_active: true,
    },
  });

  return { created: true };
}
