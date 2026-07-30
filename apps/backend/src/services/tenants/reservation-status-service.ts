import { prisma } from "@/lib/db";
import { activationFinancialStatusService } from "./activation-financial-status-service";

export type ReservationStatusInfo = {
  status: "PAYMENT_PENDING" | "RESERVED" | "MOVE_IN_READY";
  requiredDeposit: number;
  paidDeposit: number;
  depositOutstanding: number;
  requiredMaintenance: number;
  paidMaintenance: number;
  maintenanceOutstanding: number;
  reservationPolicy: string;
  minimumReservationDeposit: number;
  threshold: number;
};

export class ReservationStatusService {
  async getReservationStatus(tenantId: string, tx?: any): Promise<ReservationStatusInfo> {
    const db = tx || prisma;
    const tenant = await db.tenants.findUnique({
      where: { id: tenantId },
      select: {
        reservation_policy: true,
        minimum_reservation_deposit: true,
      },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");

    const financialStatus = await activationFinancialStatusService.getActivationFinancialStatus(tenantId, tx);

    const reservationPolicy = tenant.reservation_policy ?? "FULL_DEPOSIT";
    const minimumReservationDeposit = Number(tenant.minimum_reservation_deposit ?? 0);

    const threshold = financialStatus.depositActivationThreshold;

    let status: "PAYMENT_PENDING" | "RESERVED" | "MOVE_IN_READY" = "PAYMENT_PENDING";

    if (financialStatus.isFinanciallyReady) {
      status = "MOVE_IN_READY";
    } else if (
      financialStatus.paidDeposit >= threshold &&
      financialStatus.paidMaintenance >= financialStatus.requiredMaintenance
    ) {
      status = "RESERVED";
    }

    return {
      status,
      requiredDeposit: financialStatus.requiredDeposit,
      paidDeposit: financialStatus.paidDeposit,
      depositOutstanding: financialStatus.depositOutstanding,
      requiredMaintenance: financialStatus.requiredMaintenance,
      paidMaintenance: financialStatus.paidMaintenance,
      maintenanceOutstanding: financialStatus.maintenanceOutstanding,
      reservationPolicy,
      minimumReservationDeposit,
      threshold,
    };
  }
}

export const reservationStatusService = new ReservationStatusService();
