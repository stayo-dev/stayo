import { prisma } from "../db";

/**
 * Occupancy is a question about beds, not about money. An `ACTIVE` tenant with an
 * active allocation occupies their bed whether or not they have paid their deposit
 * — that used to be conditional on a `PAYMENT_PENDING` check, which meant an
 * unpaid joiner left their room looking vacant and invitable.
 *
 * It is also a question about *people*, not rows. A bed is held by somebody on
 * their way in, so holds and occupancy are both counted as sets of tenancies,
 * and a tenancy already occupying a bed cannot also be holding one. Counting
 * rows instead was a real defect: under ADR-165 `createInvitation` stands the
 * tenancy up immediately — ACTIVE tenant, real allocation, bed occupied — and
 * deliberately leaves the invitation live until the tenant personally accepts.
 * The same person was therefore counted twice, so every owner-added tenant ate
 * two beds of their room until they accepted: a 4-bed room with two of them
 * read "4/4 beds taken · 2 held for invites" and refused the third tenant the
 * owner tried to put in it.
 */
type DbClient = typeof prisma | any;
/**
 * An invitation that is live and holds a bed.
 *
 * QUEUED belongs here: a bulk-imported invitation is created but not yet sent,
 * and it still reserves a room, still blocks a competing invite, and must
 * still be cancelled with its tenancy. Leaving it out let "send all" message
 * someone whose tenancy had been cancelled.
 */
const ACTIVE_INVITE_STATUSES = ["PENDING", "OPENED", "ACTIVATION_STARTED", "QUEUED"];

type TenancyRef = { tenant_id?: string | null };

/**
 * How many beds are held by tenancies that are not already sitting in one.
 *
 * A reservation is the bed-level record and an invitation the person-level one.
 * Either alone holds a bed — an invitation that outlived its reservation is
 * still somebody on their way in, which is what the old `Math.max` of the two
 * counts was reaching for — and both together still hold just the one.
 */
function heldBedCount(occupants: Set<string>, ...holders: TenancyRef[][]): number {
  const held = new Set<string>();
  let unattributed = 0;
  for (const list of holders) {
    for (const holder of list ?? []) {
      const tenantId = holder?.tenant_id;
      // Both tables declare `tenant_id` NOT NULL; a hold that somehow arrives
      // without one keeps its bed rather than being silently dropped.
      if (!tenantId) { unattributed++; continue; }
      if (occupants.has(tenantId)) continue;
      held.add(tenantId);
    }
  }
  return held.size + unattributed;
}

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

/**
 * "This allocation occupies a bed" — the one predicate for who lives in a room.
 * Stay Status counts residents with exactly this, so its here-tonight + away
 * always equals `occupied` here. Change it here or nowhere. (ADR-194)
 */
export const OCCUPYING_ALLOCATION_WHERE = {
  is_active: true,
  end_date: null,
  tenant: { status: "ACTIVE" },
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
        ...OCCUPYING_ALLOCATION_WHERE,
      },
      select: {
        tenant_id: true,
      },
    });

    const [reservations, invitations] = await Promise.all([
      db.tenant_invitation_reservations.findMany({
        where: {
          room_id: roomId,
          status: "ACTIVE",
        },
        select: { tenant_id: true },
      }),
      db.tenant_invitations.findMany({
        where: {
          room_id: roomId,
          status: { in: ACTIVE_INVITE_STATUSES },
        },
        select: { tenant_id: true },
      }),
    ]);

    const occupants = new Set<string>(
      activeAllocations.map((a: TenancyRef) => a.tenant_id).filter(Boolean) as string[],
    );
    return this.toSnapshot(room, occupants.size, heldBedCount(occupants, reservations, invitations));
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
        // The holders themselves rather than `_count`: which tenancy holds a
        // bed is what tells a hold apart from the occupancy it already became.
        tenant_invitation_reservations: {
          where: {
            status: "ACTIVE",
          },
          select: { tenant_id: true },
        },
        tenant_invitations: {
          where: {
            status: { in: ACTIVE_INVITE_STATUSES },
          },
          select: { tenant_id: true },
        },
      },
    });

    const activeAllocations = await db.roomAllocation.findMany({
      where: {
        hostel_id: hostelId,
        ...OCCUPYING_ALLOCATION_WHERE,
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
    const occupantsByRoom = new Map<string, Set<string>>();
    for (const alloc of activeAllocations) {
      if (!alloc.tenant_id) continue;
      const occupants = occupantsByRoom.get(alloc.room_id) ?? new Set<string>();
      occupants.add(alloc.tenant_id);
      occupantsByRoom.set(alloc.room_id, occupants);
    }

    return new Map(
      rooms.map((room: any) => {
        const occupants = occupantsByRoom.get(room.id) ?? new Set<string>();
        return [
          room.id,
          this.toSnapshot(
            room,
            occupants.size,
            heldBedCount(occupants, room.tenant_invitation_reservations, room.tenant_invitations),
          ),
        ];
      }),
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
