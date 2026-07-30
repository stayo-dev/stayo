import { prisma } from "@/lib/db";

export type ActivationFinancialStatus = {
  requiredDeposit: number;
  paidDeposit: number;
  depositOutstanding: number;
  depositActivationThreshold: number;
  depositThresholdOutstanding: number;
  isDepositFullyPaid: boolean;
  requiredMaintenance: number;
  paidMaintenance: number;
  maintenanceOutstanding: number;
  isDepositCleared: boolean;
  isMaintenanceCleared: boolean;
  isFinanciallyReady: boolean;
};

function money(value: unknown) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function outstanding(required: number, paid: number) {
  return money(Math.max(0, required - paid));
}

export class ActivationFinancialStatusService {
  async getActivationFinancialStatus(tenantId: string, tx?: any): Promise<ActivationFinancialStatus> {
    const id = String(tenantId || "").trim();
    if (!id) throw new Error("VALIDATION_ERROR: tenantId is required");

    const db = tx || prisma;
    const tenant = await db.tenants.findUnique({
      where: { id },
      select: {
        id: true,
        security_deposit: true,
        reservation_policy: true,
        minimum_reservation_deposit: true,
        maintenance_charge: true,
        maintenance_type: true,
      },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");

    const [depositCredits, maintenanceObligations, paidAdvanceObligations, ledgerDepositPayments] = await Promise.all([
      db.tenant_financial_ledger.aggregate({
        where: {
          tenant_id: id,
          type: "CREDIT",
          reason: "SECURITY_DEPOSIT_COLLECTED",
        },
        _sum: { amount: true },
      }),
      db.rent_obligations.findMany({
        where: {
          tenant_id: id,
          obligation_type: "MAINTENANCE",
          is_superseded: false,
        },
        select: {
          payments: {
            select: { amount_paid: true },
          },
        },
      }),
      db.payments.aggregate({
        where: {
          tenant_id: id,
          obligation: {
            obligation_type: { in: ["SECURITY_DEPOSIT", "ADVANCE"] },
          },
        },
        _sum: {
          amount_paid: true,
        },
      }),
      db.tenant_financial_ledger.aggregate({
        where: {
          tenant_id: id,
          type: "CREDIT",
          reason: "SECURITY_DEPOSIT_COLLECTED",
          reference_type: "PAYMENT",
        },
        _sum: {
          amount: true,
        },
      }),
    ]);

    const requiredDeposit = money(tenant.security_deposit);
    const paidAdvanceObligationSum = Number(paidAdvanceObligations?._sum?.amount_paid || 0);
    const ledgerDepositPaymentsSum = Number(ledgerDepositPayments?._sum?.amount || 0);
    const paidAdvanceObligationSumOutsideLedger = Math.max(0, paidAdvanceObligationSum - ledgerDepositPaymentsSum);

    const paidDeposit = money(Number(depositCredits._sum.amount || 0) + paidAdvanceObligationSumOutsideLedger);
    const depositOutstanding = outstanding(requiredDeposit, paidDeposit);
    const reservationPolicy = String((tenant as any).reservation_policy || "FULL_DEPOSIT");
    const minimumReservationDeposit = money((tenant as any).minimum_reservation_deposit);
    const depositActivationThreshold = reservationPolicy === "PARTIAL_DEPOSIT"
      ? money(Math.min(requiredDeposit, Math.max(0, minimumReservationDeposit)))
      : requiredDeposit;
    const depositThresholdOutstanding = outstanding(depositActivationThreshold, paidDeposit);

    const maintenanceType = String(tenant.maintenance_type || "MONTHLY").toUpperCase();
    const requiredMaintenance = maintenanceType === "NONE" ? 0 : money(tenant.maintenance_charge);
    const paidMaintenance = money(
      maintenanceObligations.reduce((sum: number, obligation: any) => {
        const payments = Array.isArray(obligation.payments) ? obligation.payments : [];
        return sum + payments.reduce((paid: number, payment: any) => paid + Number(payment.amount_paid || 0), 0);
      }, 0)
    );
    const maintenanceOutstanding = outstanding(requiredMaintenance, paidMaintenance);

    const isDepositCleared = depositThresholdOutstanding <= 0;
    const isDepositFullyPaid = depositOutstanding <= 0;
    const isMaintenanceCleared = maintenanceOutstanding <= 0;

    return {
      requiredDeposit,
      paidDeposit,
      depositOutstanding,
      depositActivationThreshold,
      depositThresholdOutstanding,
      requiredMaintenance,
      paidMaintenance,
      maintenanceOutstanding,
      isDepositCleared,
      isDepositFullyPaid,
      isMaintenanceCleared,
      isFinanciallyReady: isDepositCleared && isMaintenanceCleared,
    };
  }
}

export const activationFinancialStatusService = new ActivationFinancialStatusService();

export function getActivationFinancialStatus(tenantId: string, tx?: any) {
  return activationFinancialStatusService.getActivationFinancialStatus(tenantId, tx);
}
