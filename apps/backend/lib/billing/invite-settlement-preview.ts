/**
 * 🏗️ Invite Settlement Preview — Pure Domain Module
 *
 * Answers: "If the owner records a payment while inviting this tenant, where
 * does the money land?" — before any tenant, agreement, or obligation row
 * exists in the database.
 *
 * Two real situations this exists for:
 *   1. Deposit paid face-to-face at the moment of joining.
 *   2. A hostel adopting a tenant who is already months into their stay —
 *      the owner enters the start date and what's been paid so far, and
 *      needs to see it settle before sending the invitation.
 *
 * Properties:
 * - Pure function — no Prisma, no I/O, no side effects, no clock reads
 *   (the caller supplies `today`).
 * - Does not reimplement allocation logic — it synthesises the obligation
 *   snapshots that *would* exist and hands them to the existing, tested
 *   `buildSettlementPlan`. The priority order, chronology rules, and paisa
 *   rounding all come from settlement-planner.ts, unchanged.
 * - The RENT month sequence and due-date rule mirror
 *   `onboarding-financials-service.ts` exactly (same first-month exception,
 *   same use of `dueDateForMonth` for every month after it) — a preview that
 *   disagrees with what the system actually creates is worse than no
 *   preview. See the "Settle at Invite" plan.
 */

import {
  addUtcMonths,
  dueDateForMonth,
  firstOfUtcMonth,
} from "@/src/services/payments/rent-schedule-dates";
import {
  buildSettlementPlan,
  type ObligationSnapshot,
  type PaymentPolicy,
  type SettlementPlan,
} from "@/src/services/payments/settlement-planner";

export interface InviteSettlementPreviewInput {
  monthlyRent: number;
  securityDeposit: number;
  maintenanceCharge: number;
  /** "NONE" excludes maintenance from the preview, matching onboarding-financials-service. */
  maintenanceType: string;
  agreementStartDate: Date;
  /** The agreement's total duration — caps how many RENT months can ever exist, even if elapsed months would exceed it. */
  durationMonths: number;
  /** Hostel's configured due day (1-28), used for every RENT month after the first. */
  dueDay: number;
  amountPaid: number;
  /** false excludes the deposit snapshot from the allocation set entirely — the money goes to rent/maintenance only. */
  amountIncludesDeposit: boolean;
  today: Date;
}

export interface InviteSettlementPreview extends SettlementPlan {
  /** The rent_month values (first-of-UTC-month) synthesised for this preview, oldest first. Empty if no rent month has elapsed yet. */
  rent_months: Date[];
}

const PREVIEW_OWNER_ID = "preview";

function money(value: unknown): number {
  const number = Number(value || 0);
  return Math.round((Number.isFinite(number) ? number : 0) * 100) / 100;
}

/**
 * Permissive settlement policy for the preview: the owner is recording an
 * amount they already know was paid, not being gated by the hostel's
 * accept-partial-payment configuration (which would require a DB fetch this
 * module deliberately does not make). Any positive amount is accepted;
 * `buildSettlementPlan` still decides exactly where it lands.
 */
const PREVIEW_POLICY: PaymentPolicy = {
  allow_partial: true,
  minimum_amount: 0,
  minimum_percentage: 0,
};

/**
 * How many whole calendar months have elapsed from `startMonth` through
 * `currentMonth`, inclusive of both. 0 if `startMonth` is after `currentMonth`
 * (a future start date) — never negative.
 */
function elapsedMonthCount(startMonth: Date, currentMonth: Date): number {
  const diff =
    (currentMonth.getUTCFullYear() - startMonth.getUTCFullYear()) * 12 +
    (currentMonth.getUTCMonth() - startMonth.getUTCMonth());
  return Math.max(0, diff + 1);
}

export function buildInviteSettlementPreview(input: InviteSettlementPreviewInput): InviteSettlementPreview {
  const monthlyRent = money(input.monthlyRent);
  const securityDeposit = money(input.securityDeposit);
  const maintenanceCharge = money(input.maintenanceCharge);
  const maintenanceType = String(input.maintenanceType || "MONTHLY").toUpperCase();
  const durationMonths = Math.max(0, Math.trunc(Number(input.durationMonths || 0)));
  const dueDay = Math.trunc(Number(input.dueDay || 5));
  const amountPaid = money(input.amountPaid);
  const amountIncludesDeposit = input.amountIncludesDeposit !== false;
  const today = input.today instanceof Date ? input.today : new Date(input.today);
  const agreementStartDate =
    input.agreementStartDate instanceof Date ? input.agreementStartDate : new Date(input.agreementStartDate);

  const startMonth = firstOfUtcMonth(agreementStartDate);
  const currentMonth = firstOfUtcMonth(today);

  const rawElapsedMonths = elapsedMonthCount(startMonth, currentMonth);
  const elapsedMonths = durationMonths > 0 ? Math.min(rawElapsedMonths, durationMonths) : rawElapsedMonths;

  const snapshots: ObligationSnapshot[] = [];
  const rentMonths: Date[] = [];

  const hasDeposit = securityDeposit > 0 && amountIncludesDeposit;
  if (hasDeposit) {
    snapshots.push({
      id: "preview-security-deposit",
      obligation_type: "SECURITY_DEPOSIT",
      amount: securityDeposit,
      paid: 0,
      due_date: agreementStartDate,
      rent_month: null,
      owner_id: PREVIEW_OWNER_ID,
      status: "PENDING",
    });
  }

  const hasMaintenance = maintenanceType !== "NONE" && maintenanceCharge > 0;
  if (hasMaintenance) {
    snapshots.push({
      id: "preview-maintenance",
      obligation_type: "MAINTENANCE",
      amount: maintenanceCharge,
      paid: 0,
      due_date: agreementStartDate,
      rent_month: null,
      owner_id: PREVIEW_OWNER_ID,
      status: "PENDING",
    });
  }

  if (monthlyRent > 0) {
    for (let i = 0; i < elapsedMonths; i++) {
      const rentMonth = addUtcMonths(startMonth, i);
      rentMonths.push(rentMonth);
      // First elapsed month mirrors onboarding-financials-service's exact
      // rule: due_date = the actual start date, not the hostel's due-day
      // preference (the tenant's first month is due the day they join).
      // Every month after that uses dueDateForMonth, exactly like the
      // multi-month generator in agreement-rent-schedule-service.
      const dueDate = i === 0 ? agreementStartDate : dueDateForMonth(rentMonth, dueDay);
      snapshots.push({
        id: `preview-rent-${rentMonth.toISOString().slice(0, 7)}`,
        obligation_type: "RENT",
        amount: monthlyRent,
        paid: 0,
        due_date: dueDate,
        rent_month: rentMonth,
        owner_id: PREVIEW_OWNER_ID,
        status: "PENDING",
      });
    }
  }

  const plan = buildSettlementPlan(snapshots, amountPaid, PREVIEW_POLICY);

  return { ...plan, rent_months: rentMonths };
}
