import { prisma } from "../db";

/**
 * Occupancy is a question about beds, not about money. An `ACTIVE` tenant with an
 * active allocation occupies their bed whether or not they have paid their deposit
 * — that used to be conditional on a `PAYMENT_PENDING` check, which meant an
 * unpaid joiner left their room looking vacant and invitable.
 */
type DbClient = typeof prisma | any;
const ACTIVE_INVITE_STATUSES = ["PENDING", "OPENED", "ACTIVATION_STARTED"];

export type RoomCapacitySnapshot = {
  room: any;
  room_id: string;
  capacity: number;
  occupied: number;
  reserved: number;
  used: number;
  available: number;
  state: "vacant" | "reserved" | "partial" | "full";
};

export class RoomCapacityService {
  async getRoomCapacitySnapshot(
    roomId: string,
    options: { tx?: DbClient; ownerId?: string } = {},
  ): Promise<RoomCapacitySnapshot> {
    const db = options.tx || prisma;
    const room = await db.rooms.findUnique({
      where: {
        id: roomId,
      },
      include: { hostels: true },
    });

    if (!room || !room.hostels || !room.is_active) {
      throw new Error("NOT_FOUND: Room not found");
    }
    if (options.ownerId && room.hostels.owner_id !== options.ownerId) {
      throw new Error("FORBIDDEN: Room belongs to a different owner");
    }

    const activeAllocations = await db.roomAllocation.findMany({
      where: {
        room_id: roomId,
        is_active: true,
        end_date: null,
        tenant: { status: "ACTIVE" },
      },
      select: {
        tenant_id: true,
      },
    });

    const [reservedReservations, activeInvitations] = await Promise.all([
      db.tenant_invitation_reservations.count({
        where: {
          room_id: roomId,
          status: "ACTIVE",
        },
      }),
      db.tenant_invitations.count({
        where: {
          room_id: roomId,
          status: { in: ACTIVE_INVITE_STATUSES },
        },
      }),
    ]);

    const reserved = Math.max(reservedReservations, activeInvitations);
    return this.toSnapshot(room, activeAllocations.length, reserved);
  }

  async getHostelCapacityMap(
    hostelId: string,
    options: { ownerId?: string; tx?: DbClient } = {},
  ): Promise<Map<string, RoomCapacitySnapshot>> {
    const db = options.tx || prisma;
    const rooms = await db.rooms.findMany({
      where: {
        hostel_id: hostelId,
        is_active: true,
        ...(options.ownerId ? { hostels: { owner_id: options.ownerId } } : {}),
      },
      include: {
        hostels: true,
        _count: {
          select: {
            tenant_invitation_reservations: {
              where: {
                status: "ACTIVE",
              },
            },
            tenant_invitations: {
              where: {
                status: { in: ACTIVE_INVITE_STATUSES },
              },
            },
          },
        },
      },
    });

    const activeAllocations = await db.roomAllocation.findMany({
      where: {
        hostel_id: hostelId,
        is_active: true,
        end_date: null,
        tenant: { status: "ACTIVE" },
      },
      select: {
        room_id: true,
        tenant_id: true,
      },
    });

    // Every active allocation of an ACTIVE tenant occupies a bed. This used to
    // reproduce the whole deposit/maintenance calculation inline to decide whether
    // a tenant "really" counted; with the payment gate gone there is nothing left
    // to decide, which also removes a large per-hostel query fan-out.
    const occupiedCountByRoom = new Map<string, number>();
    for (const alloc of activeAllocations) {
      occupiedCountByRoom.set(alloc.room_id, (occupiedCountByRoom.get(alloc.room_id) || 0) + 1);
    }

    return new Map(
      rooms.map((room: any) => [
        room.id,
        this.toSnapshot(
          room,
          occupiedCountByRoom.get(room.id) || 0,
          Math.max(
            Number(room._count?.tenant_invitation_reservations || 0),
            Number(room._count?.tenant_invitations || 0)
          ),
        ),
      ]),
    );
  }

  private toSnapshot(room: any, occupied: number, reserved: number): RoomCapacitySnapshot {
    const capacity = Number(room.capacity || 0);
    const used = occupied + reserved;
    const available = Math.max(0, capacity - used);
    const state = used >= capacity ? "full" : occupied > 0 ? "partial" : reserved > 0 ? "reserved" : "vacant";

    return {
      room,
      room_id: room.id,
      capacity,
      occupied,
      reserved,
      used,
      available,
      state,
    };
  }
}

export const roomCapacityService = new RoomCapacityService();
