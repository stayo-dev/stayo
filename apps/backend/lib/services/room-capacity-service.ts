import { prisma } from "../db";
import { reservationStatusService } from "../../src/services/tenants/reservation-status-service";

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

    const [resolvedOccupiedCount, reservedReservations, activeInvitations] = await Promise.all([
      (async () => {
        let count = 0;
        for (const alloc of activeAllocations) {
          const resStatus = await reservationStatusService.getReservationStatus(alloc.tenant_id, db);
          if (resStatus.status !== "PAYMENT_PENDING") {
            count++;
          }
        }
        return count;
      })(),
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
    return this.toSnapshot(room, resolvedOccupiedCount, reserved);
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

    const tenantIds = activeAllocations.map((a: any) => a.tenant_id);

    const tenants = await db.tenants.findMany({
      where: { id: { in: tenantIds } },
      select: {
        id: true,
        security_deposit: true,
        maintenance_charge: true,
        maintenance_type: true,
        reservation_policy: true,
        minimum_reservation_deposit: true,
      },
    });

    const tenantMap = new Map<string, any>(tenants.map((t: any) => [t.id, t]));

    const [depositCredits, paidAdvanceObligations, ledgerDepositPayments] = await Promise.all([
      db.tenant_financial_ledger.groupBy({
        by: ["tenant_id"],
        where: {
          tenant_id: { in: tenantIds },
          type: "CREDIT",
          reason: "SECURITY_DEPOSIT_COLLECTED",
        },
        _sum: { amount: true },
      }),
      db.payments.groupBy({
        by: ["tenant_id"],
        where: {
          tenant_id: { in: tenantIds },
          obligation: {
            obligation_type: { in: ["SECURITY_DEPOSIT", "ADVANCE"] },
          },
        },
        _sum: { amount_paid: true },
      }),
      db.tenant_financial_ledger.groupBy({
        by: ["tenant_id"],
        where: {
          tenant_id: { in: tenantIds },
          type: "CREDIT",
          reason: "SECURITY_DEPOSIT_COLLECTED",
          reference_type: "PAYMENT",
        },
        _sum: { amount: true },
      }),
    ]);

    const depositCreditsMap = new Map<string, number>(depositCredits.map((d: any) => [d.tenant_id, Number(d._sum.amount || 0)]));
    const paidAdvanceMap = new Map<string, number>(paidAdvanceObligations.map((p: any) => [p.tenant_id, Number(p._sum.amount_paid || 0)]));
    const ledgerDepositPaymentsMap = new Map<string, number>(ledgerDepositPayments.map((l: any) => [l.tenant_id, Number(l._sum.amount || 0)]));

    const maintenanceObligations = await db.rent_obligations.findMany({
      where: {
        tenant_id: { in: tenantIds },
        obligation_type: "MAINTENANCE",
        is_superseded: false,
      },
      select: {
        tenant_id: true,
        payments: {
          select: { amount_paid: true },
        },
      },
    });

    const maintenancePaidMap = new Map<string, number>();
    for (const ob of maintenanceObligations) {
      const payments = ob.payments || [];
      const paid = payments.reduce((sum: number, p: any) => sum + Number(p.amount_paid || 0), 0);
      maintenancePaidMap.set(ob.tenant_id, (maintenancePaidMap.get(ob.tenant_id) || 0) + paid);
    }

    const isPaymentPending = (tenantId: string) => {
      const tenant = tenantMap.get(tenantId);
      if (!tenant) return true;

      const requiredDeposit = Number(tenant.security_deposit || 0);
      
      const rawDepositCredits = depositCreditsMap.get(tenantId) || 0;
      const paidAdvance = paidAdvanceMap.get(tenantId) || 0;
      const ledgerDepositPaymentsVal = ledgerDepositPaymentsMap.get(tenantId) || 0;
      const paidAdvanceOutsideLedger = Math.max(0, paidAdvance - ledgerDepositPaymentsVal);
      const paidDeposit = rawDepositCredits + paidAdvanceOutsideLedger;

      const maintenanceType = String(tenant.maintenance_type || "MONTHLY").toUpperCase();
      const requiredMaintenance = maintenanceType === "NONE" ? 0 : Number(tenant.maintenance_charge || 0);
      const paidMaintenance = maintenancePaidMap.get(tenantId) || 0;

      const reservationPolicy = tenant.reservation_policy || "FULL_DEPOSIT";
      const minimumReservationDeposit = Number(tenant.minimum_reservation_deposit || 0);

      const threshold =
        reservationPolicy === "PARTIAL_DEPOSIT"
          ? Math.min(requiredDeposit, minimumReservationDeposit)
          : requiredDeposit;

      if (
        paidDeposit >= threshold &&
        paidMaintenance >= requiredMaintenance
      ) {
        return false;
      }

      return true;
    };

    const occupiedCountByRoom = new Map<string, number>();
    for (const alloc of activeAllocations) {
      if (!isPaymentPending(alloc.tenant_id)) {
        occupiedCountByRoom.set(alloc.room_id, (occupiedCountByRoom.get(alloc.room_id) || 0) + 1);
      }
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
