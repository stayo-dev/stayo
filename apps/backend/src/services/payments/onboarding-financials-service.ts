import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { resolvePreferences } from "@/lib/preferences";
import { addUtcMonths, dueDateForMonth, lastDayOfUtcMonth } from "./rent-schedule-dates";

const logger = getLogger("onboarding-financials");

// Sane horizon for how many months of back-rent a single onboarding call
// will generate. Without this, a mistyped joining year (e.g. 2015 instead of
// 2025) would silently create hundreds of RENT obligations. See the
// "Settle at Invite" plan.
const RENT_BACKFILL_CAP_MONTHS = 24;

export type OnboardingFinancialInitResult = {
  createdObligations: string[];
  createdObligationIds: string[];
  skipped: boolean;
  reason?: string;
  /** Present (and > 1) only when joiningDate is in the past and more than one month of rent was generated — the ordinary same-month case never sets this. */
  rentMonthsElapsed?: number;
  /** True when the elapsed-month count exceeded RENT_BACKFILL_CAP_MONTHS and the backfill was capped to the most recent months. */
  rentBackfillTruncated?: boolean;
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
      /** Hostel's configured due day (1-28), applied to every backdated rent month after the joining month. When omitted it is read from the hostel's `preferences_config` (falling back to 5). */
      dueDay?: number;
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
    // Generate rent as soon as the joining MONTH has started (not the exact
    // joining date). A tenant who joins on the 20th of the current month still
    // owes this month's rent — gating on `joiningDate <= today` left that
    // obligation uncreated until the next monthly cron run, so the profile
    // showed "Nothing due" for weeks. A joining date in a *future* month still
    // creates nothing here (the elapsed-months loop below is empty in that case).
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const currentMonthAnchor = rentMonthFor(today);
    const joiningMonthAnchor = rentMonthFor(joiningDate);
    const shouldCreateRent = rentAmount > 0 && joiningMonthAnchor.getTime() <= currentMonthAnchor.getTime();

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

    // ── RENT obligations: one per elapsed month ──────────────────────────
    // P0 Revenue Protection: if joining_date <= today, create rent for
    // every month that has elapsed since joining, through the current
    // month, instead of only the joining month and waiting for the monthly
    // cron job. This is what makes a mid-year hostel adoption (a tenant
    // already 5-6 months in, having already paid 5-6 months of rent) real —
    // without it, the settle-at-invite preview (lib/billing/invite-
    // settlement-preview.ts) promises months this service never creates.
    //
    // The joining month keeps the exact original single-month rule
    // (due_date = the literal joining date) so an ordinary, same-month
    // invite is byte-for-byte unchanged. Every month after that uses
    // dueDateForMonth — the same per-month due-date rule
    // agreement-rent-schedule-service uses — via the shared pure helpers in
    // rent-schedule-dates.ts, so this never invents its own date maths.
    let rentMonthsElapsed = 0;
    let rentBackfillTruncated = false;

    if (shouldCreateRent) {
      // Due day is a per-hostel setting; only needed for backdated months
      // after the joining month (the joining month uses the literal joining
      // date). Read the hostel's configured value when the caller didn't pass
      // one, instead of assuming the default 5.
      let dueDay = Math.trunc(Number(params.dueDay || 0));
      if (!dueDay) {
        const hostel = await tx.hostels.findUnique({
          where: { id: hostelId },
          select: { preferences_config: true },
        });
        dueDay = Math.trunc(Number(resolvePreferences(hostel ?? {}).due_day || 5));
      }
      if (!Number.isFinite(dueDay) || dueDay < 1) dueDay = 5;

      const currentMonth = currentMonthAnchor;
      const elapsedMonths: Date[] = [];
      for (let cursor = rentMonth; cursor.getTime() <= currentMonth.getTime(); cursor = addUtcMonths(cursor, 1)) {
        elapsedMonths.push(cursor);
      }
      rentMonthsElapsed = elapsedMonths.length;

      let monthsToCreate = elapsedMonths;
      if (elapsedMonths.length > RENT_BACKFILL_CAP_MONTHS) {
        // Cap the backfill rather than generating hundreds of rows from a
        // mistyped joining year — keep the most recent months, since the
        // current (live) month's rent matters most.
        rentBackfillTruncated = true;
        monthsToCreate = elapsedMonths.slice(elapsedMonths.length - RENT_BACKFILL_CAP_MONTHS);
        logger.warn("onboarding.rent_backfill_truncated", {
          tenant_id: tenantId,
          hostel_id: hostelId,
          joining_date: joiningDate.toISOString(),
          elapsed_months: elapsedMonths.length,
          cap: RENT_BACKFILL_CAP_MONTHS,
        });
      }

      for (const monthAnchor of monthsToCreate) {
        const isJoiningMonth = monthAnchor.getTime() === rentMonth.getTime();

        const existingRent = await tx.rent_obligations.findFirst({
          where: {
            tenant_id: tenantId,
            rent_month: monthAnchor,
            obligation_type: "RENT",
            is_superseded: false,
          },
          select: { id: true },
        });
        if (existingRent) continue;

        const dueDate = isJoiningMonth ? joiningDate : dueDateForMonth(monthAnchor, dueDay);
        const billingPeriodStart = isJoiningMonth ? joiningDate : monthAnchor;
        const billingPeriodEnd = isJoiningMonth
          ? new Date(Date.UTC(joiningDate.getFullYear(), joiningDate.getMonth() + 1, 0))
          : lastDayOfUtcMonth(monthAnchor);
        const monthLabel = isJoiningMonth
          ? joiningDate.toLocaleDateString("en-IN", { month: "short", year: "numeric" })
          : monthAnchor.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

        const createdRow = await tx.rent_obligations.create({
          data: {
            tenant_id: tenantId,
            allocation_id: null,
            owner_id: ownerId,
            hostel_id: hostelId,
            rent_month: monthAnchor,
            amount: rentAmount,
            total_amount: rentAmount,
            due_date: dueDate,
            status: "PENDING",
            obligation_type: "RENT",
            billing_period_start: billingPeriodStart,
            billing_period_end: billingPeriodEnd,
            installment_label: `Rent – ${monthLabel}`,
          },
        });
        createdObligations.push("RENT");
        createdObligationIds.push(createdRow.id);
        logger.info(
          isJoiningMonth ? "onboarding.current_month_rent_created" : "onboarding.backdated_rent_created",
          {
            tenant_id: tenantId,
            hostel_id: hostelId,
            amount: rentAmount,
            rent_month: monthAnchor.toISOString(),
          }
        );
      }
    }

    const skipped = createdObligations.length === 0;
    return {
      createdObligations,
      createdObligationIds,
      skipped,
      ...(skipped ? { reason: "OBLIGATIONS_EXIST" } : {}),
      ...(rentMonthsElapsed > 1 ? { rentMonthsElapsed } : {}),
      ...(rentBackfillTruncated ? { rentBackfillTruncated: true } : {}),
    };
  }
}

export const onboardingFinancialsService = new OnboardingFinancialsService();
