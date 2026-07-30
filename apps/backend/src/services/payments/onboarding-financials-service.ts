import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";

const logger = getLogger("onboarding-financials");

export type OnboardingFinancialInitResult = {
  createdObligations: string[];
  createdObligationIds: string[];
  skipped: boolean;
  reason?: string;
};

type Tx = typeof prisma;

function money(value: unknown) {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function rentMonthFor(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1));
}

export class OnboardingFinancialsService {
  async initializeOnboardingFinancials(
    tx: Tx,
    params: {
      tenantId: string;
      ownerId: string;
      hostelId: string;
      joiningDate: Date;
      monthlyRent?: number;
      maintenanceCharge: number;
      maintenanceType: string;
    }
  ): Promise<OnboardingFinancialInitResult> {
    const tenantId = String(params.tenantId || "").trim();
    const ownerId = String(params.ownerId || "").trim();
    const hostelId = String(params.hostelId || "").trim();
    const joiningDate = params.joiningDate instanceof Date ? params.joiningDate : new Date(params.joiningDate);
    const maintenanceType = String(params.maintenanceType || "MONTHLY").toUpperCase();
    const maintenanceCharge = money(params.maintenanceCharge);

    if (!tenantId) throw new Error("VALIDATION_ERROR: tenantId is required");
    if (!ownerId) throw new Error("VALIDATION_ERROR: ownerId is required");
    if (!hostelId) throw new Error("VALIDATION_ERROR: hostelId is required");
    if (Number.isNaN(joiningDate.getTime())) throw new Error("VALIDATION_ERROR: joiningDate is invalid");
    if (maintenanceCharge < 0) throw new Error("VALIDATION_ERROR: maintenanceCharge cannot be negative");

    const tenant = await tx.tenants.findUnique({
      where: { id: tenantId },
      select: { id: true, owner_id: true, hostel_id: true, status: true, security_deposit: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId || tenant.hostel_id !== hostelId) {
      throw new Error("FORBIDDEN: Tenant does not match onboarding financial scope");
    }
    if (tenant.status !== "INVITED") {
      return { createdObligations: [], createdObligationIds: [], skipped: true, reason: "TENANT_NOT_INVITED" };
    }

    const advanceDeposit = money(tenant.security_deposit);
    const rentAmount = money(params.monthlyRent ?? tenant.monthly_rent);
    const hasMaintenance = maintenanceType !== "NONE" && maintenanceCharge > 0;
    const hasAdvance = advanceDeposit > 0;
    // Generate current-month rent immediately if joining_date <= today
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const shouldCreateRent = rentAmount > 0 && joiningDate <= today;

    if (!hasMaintenance && !hasAdvance && !shouldCreateRent) {
      return { createdObligations: [], createdObligationIds: [], skipped: true, reason: "NO_FINANCIALS_REQUIRED" };
    }

    await tx.$queryRaw`SELECT id FROM tenants WHERE id = ${tenantId}::uuid FOR UPDATE`;

    const rentMonth = rentMonthFor(joiningDate);
    const createdObligations: string[] = [];
    const createdObligationIds: string[] = [];

    // Check & Create Maintenance Obligation
    if (hasMaintenance) {
      const existingMaintenance = await tx.rent_obligations.findFirst({
        where: {
          tenant_id: tenantId,
          rent_month: rentMonth,
          obligation_type: "MAINTENANCE",
          is_superseded: false,
        },
        select: { id: true },
      });
      if (!existingMaintenance) {
        const createdRow = await tx.rent_obligations.create({
          data: {
            tenant_id: tenantId,
            allocation_id: null,
            owner_id: ownerId,
            hostel_id: hostelId,
            rent_month: rentMonth,
            amount: maintenanceCharge,
            total_amount: maintenanceCharge,
            due_date: joiningDate,
            status: "PENDING",
            obligation_type: "MAINTENANCE",
            billing_period_start: joiningDate,
            billing_period_end: joiningDate,
            installment_label: "Onboarding maintenance",
          },
        });
        createdObligations.push("MAINTENANCE");
        createdObligationIds.push(createdRow.id);
        logger.info("onboarding.maintenance_obligation_created", {
          tenant_id: tenantId,
          hostel_id: hostelId,
          amount: maintenanceCharge,
        });
      }
    }

    // Check & Create Advance (Security Deposit) Obligation
    if (hasAdvance) {
      const existingAdvance = await tx.rent_obligations.findFirst({
        where: {
          tenant_id: tenantId,
          rent_month: rentMonth,
          obligation_type: "SECURITY_DEPOSIT",
          is_superseded: false,
        },
        select: { id: true },
      });
      if (!existingAdvance) {
        const createdRow = await tx.rent_obligations.create({
          data: {
            tenant_id: tenantId,
            allocation_id: null,
            owner_id: ownerId,
            hostel_id: hostelId,
            rent_month: rentMonth,
            amount: advanceDeposit,
            total_amount: advanceDeposit,
            due_date: joiningDate,
            status: "PENDING",
            obligation_type: "SECURITY_DEPOSIT",
            billing_period_start: joiningDate,
            billing_period_end: joiningDate,
            installment_label: "Security Deposit",
          },
        });
        createdObligations.push("SECURITY_DEPOSIT");
        createdObligationIds.push(createdRow.id);
        logger.info("onboarding.security_deposit_obligation_created", {
          tenant_id: tenantId,
          hostel_id: hostelId,
          amount: advanceDeposit,
        });
      }
    }

    // ── CURRENT-MONTH RENT obligation ────────────────────────
    // P0 Revenue Protection: If joining_date <= today, create the
    // current month's rent obligation immediately instead of
    // waiting for the monthly cron job.
    if (shouldCreateRent) {
      const existingRent = await tx.rent_obligations.findFirst({
        where: {
          tenant_id: tenantId,
          rent_month: rentMonth,
          obligation_type: "RENT",
          is_superseded: false,
        },
        select: { id: true },
      });
      if (!existingRent) {
        const createdRow = await tx.rent_obligations.create({
          data: {
            tenant_id: tenantId,
            allocation_id: null,
            owner_id: ownerId,
            hostel_id: hostelId,
            rent_month: rentMonth,
            amount: rentAmount,
            total_amount: rentAmount,
            due_date: joiningDate,
            status: "PENDING",
            obligation_type: "RENT",
            billing_period_start: joiningDate,
            billing_period_end: new Date(Date.UTC(joiningDate.getFullYear(), joiningDate.getMonth() + 1, 0)),
            installment_label: `Rent – ${joiningDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" })}`,
          },
        });
        createdObligations.push("RENT");
        createdObligationIds.push(createdRow.id);
        logger.info("onboarding.current_month_rent_created", {
          tenant_id: tenantId,
          hostel_id: hostelId,
          amount: rentAmount,
          rent_month: rentMonth.toISOString(),
        });
      }
    }

    const skipped = createdObligations.length === 0;
    return {
      createdObligations,
      createdObligationIds,
      skipped,
      ...(skipped ? { reason: "OBLIGATIONS_EXIST" } : {}),
    };
  }
}

export const onboardingFinancialsService = new OnboardingFinancialsService();
