import { buildInviteSettlementPreview } from "@/lib/billing/invite-settlement-preview";
import type { TenantImportRow } from "./types";

/** Mirrors RENT_BACKFILL_CAP_MONTHS in onboarding-financials-service. */
const RENT_BACKFILL_CAP_MONTHS = 24;

/**
 * What one imported row's money would do, worked out before anything exists.
 *
 * Composes `buildInviteSettlementPreview` — the same pure planner behind the
 * single-tenant invite's settlement panel — rather than recalculating dues.
 * That is the rule this subsystem follows everywhere: compose, don't
 * reimplement, or the two surfaces drift and disagree about what a tenant owes.
 *
 * Without this, a row where the owner typed more than the tenant owes previews
 * as perfectly valid and then hard-fails inside `createInvitation` at confirm,
 * one row at a time, after other rows have already been created.
 */
export type RowFinancialPlan = {
  /** Everything the tenancy would owe from its joining date to today. */
  totalOwed: number;
  /** Money the planner could not place. Above zero means the owner overpaid. */
  unallocated: number;
};

export function planRowFinancials(
  row: TenantImportRow,
  options: { dueDay: number; today?: Date }
): RowFinancialPlan | null {
  const joiningDate = row.joining_date ? new Date(row.joining_date) : null;
  if (!joiningDate || Number.isNaN(joiningDate.getTime())) return null;

  const amountPaid = Number(row.amount_paid ?? 0);
  if (!Number.isFinite(amountPaid) || amountPaid <= 0) return null;

  // Billing backfills every elapsed month from the joining date, capped at
  // RENT_BACKFILL_CAP_MONTHS — it does not stop at the agreement's length.
  // Capping the preview at the agreement duration (12 when the sheet leaves
  // it blank) would call a tenant who has genuinely paid 21 months an
  // overpayer; ignoring the 24-month cap would let a 30-month arrears case
  // preview clean and then fail at execution.
  const monthsElapsed =
    (options.today ?? new Date()).getFullYear() * 12 +
    (options.today ?? new Date()).getMonth() -
    (joiningDate.getFullYear() * 12 + joiningDate.getMonth()) +
    1;
  const billedMonths = Math.min(Math.max(monthsElapsed, 1), RENT_BACKFILL_CAP_MONTHS);

  const preview = buildInviteSettlementPreview({
    monthlyRent: Number(row.monthly_rent ?? 0),
    securityDeposit: Number(row.security_deposit ?? row.advance_deposit ?? 0),
    maintenanceCharge: Number(row.maintenance_charge ?? 0),
    maintenanceType: String(row.maintenance_type ?? "MONTHLY"),
    agreementStartDate: joiningDate,
    durationMonths: billedMonths,
    dueDay: options.dueDay,
    amountPaid,
    amountIncludesDeposit: row.amount_includes_deposit !== false,
    today: options.today ?? new Date(),
  });

  return {
    totalOwed: Number(preview.total_outstanding ?? 0),
    unallocated: Number(preview.unallocated ?? 0),
  };
}
