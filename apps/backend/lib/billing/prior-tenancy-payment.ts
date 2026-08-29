/**
 * Turns "what has this tenant already paid me?" into an amount.
 *
 * An owner adding somebody who has lived in the hostel for months answers in
 * their own terms — *rent paid up to July, deposit yes, maintenance no*. Both
 * the preview the owner is shown and the payment actually recorded at invite
 * must start from the same number, so this is the single place that conversion
 * happens; `buildInviteSettlementPreview` and the invitation write path both
 * call it rather than each doing their own arithmetic.
 *
 * Pure — no Prisma, no clock reads. The month sequence deliberately mirrors
 * `onboarding-financials-service.ts`, which is what actually creates the
 * obligations: first-of-UTC-month anchors from the joining month through the
 * current one, the joining month due on the literal joining date and every
 * month after it on the hostel's configured due day. A preview that disagrees
 * with what the system creates is worse than no preview. See ADR-141.
 */

import {
  addUtcMonths,
  dueDateForMonth,
  firstOfUtcMonth,
} from "@/src/services/payments/rent-schedule-dates";

/** Mirrors `RENT_BACKFILL_CAP_MONTHS` in onboarding-financials-service. */
export const PRIOR_HISTORY_CAP_MONTHS = 24;

export interface PriorTenancyPaymentInput {
  joiningDate: Date;
  today: Date;
  monthlyRent: number;
  securityDeposit: number;
  maintenanceCharge: number;
  /** "NONE" excludes maintenance entirely, matching onboarding-financials-service. */
  maintenanceType: string;
  /** Hostel's configured due day (1-28), for every month after the joining one. */
  dueDay: number;
  /** `YYYY-MM` of the last fully paid month, or null when nothing is paid. */
  rentPaidThrough?: string | null;
  depositPaid: boolean;
  maintenancePaid: boolean;
}

export interface PriorRentMonth {
  /** `YYYY-MM`, for the owner-facing picker. */
  key: string;
  /** First of the month, UTC — the anchor the obligation rows use. */
  rentMonth: Date;
  dueDate: Date;
  amount: number;
  settled: boolean;
}

export interface PriorTenancyPaymentPlan {
  months: PriorRentMonth[];
  /** Total the owner says is already in hand — what gets settled at invite. */
  amountPaid: number;
  /** Whether the deposit is part of that amount. Drives the preview's allocation set. */
  amountIncludesDeposit: boolean;
  /** The stay is longer than the backfill cap; the oldest months are not reconstructed. */
  truncated: boolean;
}

function money(value: unknown): number {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function resolvePriorTenancyPayment(input: PriorTenancyPaymentInput): PriorTenancyPaymentPlan {
  const rent = money(input.monthlyRent);
  const deposit = money(input.securityDeposit);
  const maintenance =
    String(input.maintenanceType || "").toUpperCase() === "NONE" ? 0 : money(input.maintenanceCharge);

  const joiningMonth = firstOfUtcMonth(input.joiningDate);
  const currentMonth = firstOfUtcMonth(input.today);

  const all: Date[] = [];
  for (let cursor = joiningMonth; cursor.getTime() <= currentMonth.getTime(); cursor = addUtcMonths(cursor, 1)) {
    all.push(cursor);
  }

  // Same cap, and the same "keep the most recent" choice, as the writer: the
  // live month's rent is what matters most, and a mistyped year must not
  // generate hundreds of rows.
  const truncated = all.length > PRIOR_HISTORY_CAP_MONTHS;
  const kept = truncated ? all.slice(all.length - PRIOR_HISTORY_CAP_MONTHS) : all;

  const paidThrough = /^\d{4}-\d{2}$/.test(String(input.rentPaidThrough ?? ""))
    ? String(input.rentPaidThrough)
    : null;

  const months: PriorRentMonth[] = rent > 0
    ? kept.map((anchor) => {
        const key = monthKey(anchor);
        const isJoiningMonth = anchor.getTime() === joiningMonth.getTime();
        return {
          key,
          rentMonth: anchor,
          // The joining month keeps the literal joining date, exactly as
          // onboarding-financials-service does; every month after it uses the
          // hostel's due day through the shared helper.
          dueDate: isJoiningMonth ? input.joiningDate : dueDateForMonth(anchor, input.dueDay),
          amount: rent,
          settled: paidThrough !== null && key <= paidThrough,
        };
      })
    : [];

  const settledRent = months.filter((m) => m.settled).reduce((sum, m) => sum + m.amount, 0);
  const depositPart = input.depositPaid && deposit > 0 ? deposit : 0;
  const maintenancePart = input.maintenancePaid && maintenance > 0 ? maintenance : 0;

  return {
    months,
    amountPaid: money(settledRent + depositPart + maintenancePart),
    amountIncludesDeposit: depositPart > 0,
    truncated,
  };
}
