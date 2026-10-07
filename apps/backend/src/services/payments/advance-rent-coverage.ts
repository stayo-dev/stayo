/**
 * 🏗️ Advance Rent Coverage — Pure Module
 *
 * "The tenant has paid ₹98,400 at ₹8,200 a month — which months does that
 * cover?" Answered from the agreement's own term, never from the calendar
 * alone.
 *
 * Two jobs, both pure (no Prisma, no clock reads — callers pass `today`):
 *
 *   1. `planAdvanceRentMonths` — which FUTURE rent periods must exist for a
 *      payment to land on real installments. ADR-036 says every rupee lands on
 *      an installment and StayO holds no credit balance, so a payment larger
 *      than what is due today is absorbed by creating the next periods of the
 *      agreement, oldest first, and *only as many as the money needs*. It never
 *      plans a period past the agreement's last month: money beyond the term
 *      is reported as `exhausted`, and the caller refuses it out loud rather
 *      than inventing a period no rule allows.
 *
 *   2. `summarizeRentCoverage` — turns a settlement plan's allocations into
 *      what an owner needs to read: months fully covered, the month rent is
 *      paid through, the partly-covered next month, what is due today and
 *      what is merely prepaid.
 *
 * Shared by the invite settlement preview (lib/billing/invite-settlement-
 * preview.ts) and the real invite transaction (invite-settlement-service.ts),
 * so what the owner is shown and what the system writes cannot disagree.
 *
 * Period rules mirror onboarding-financials-service.ts exactly: the joining
 * month is due on the joining date and starts on it; every later month is due
 * on `dueDateForMonth(month, dueDay)` and runs first-to-last of the month.
 * Money is compared in integer paise.
 */

import { addUtcMonths, dueDateForMonth, firstOfUtcMonth, lastDayOfUtcMonth } from "./rent-schedule-dates";

export interface AdvanceRentMonth {
  rent_month: Date;
  due_date: Date;
  period_start: Date;
  period_end: Date;
  amount: number;
  /** `UPCOMING` for a month after the current one, `PENDING` otherwise — the same split agreement-rent-schedule-service writes. */
  status: "UPCOMING" | "PENDING";
  label: string;
}

export interface AdvanceRentPlan {
  months: AdvanceRentMonth[];
  /** Rupees the planned months add to what can be settled. */
  coveredAmount: number;
  /** True when the agreement ran out of months before `amountNeeded` was covered. */
  exhausted: boolean;
  /** The agreement's final rent month (first of month), or null without a term. */
  lastAgreementMonth: Date | null;
}

const toPaise = (rupees: number) => Math.round(Number(rupees || 0) * 100);

/** Same label shape onboarding-financials-service writes: "Rent – Aug 2026". */
export function rentMonthLabel(month: Date): string {
  return `Rent – ${month.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" })}`;
}

/** Every rent month of an agreement, first-of-UTC-month, oldest first. */
export function agreementRentMonths(agreementStart: Date, durationMonths: number): Date[] {
  const count = Math.max(0, Math.trunc(Number(durationMonths || 0)));
  const start = firstOfUtcMonth(agreementStart);
  return Array.from({ length: count }, (_, i) => addUtcMonths(start, i));
}

export function planAdvanceRentMonths(input: {
  /** The tenancy's joining date — anchors the agreement's first month. */
  joiningDate: Date;
  durationMonths: number;
  monthlyRent: number;
  dueDay: number;
  /** RENT months that already exist (or are already synthesised) for this tenant. */
  existingRentMonths: Date[];
  /** Rupees still unplaced after every existing obligation is covered. */
  amountNeeded: number;
  today: Date;
}): AdvanceRentPlan {
  const monthlyRentPaise = toPaise(input.monthlyRent);
  const neededPaise = toPaise(input.amountNeeded);
  const allMonths = agreementRentMonths(input.joiningDate, input.durationMonths);
  const lastAgreementMonth = allMonths.length > 0 ? allMonths[allMonths.length - 1] : null;

  if (neededPaise <= 0) {
    return { months: [], coveredAmount: 0, exhausted: false, lastAgreementMonth };
  }
  if (monthlyRentPaise <= 0 || allMonths.length === 0) {
    return { months: [], coveredAmount: 0, exhausted: true, lastAgreementMonth };
  }

  // Only months AFTER the latest existing one: advance rent extends the
  // schedule forward and never back-fills a gap behind an existing period,
  // which would break the oldest-first rule the planner relies on.
  const existing = new Set(input.existingRentMonths.map((m) => firstOfUtcMonth(m).getTime()));
  const latestExisting = input.existingRentMonths.reduce(
    (max, m) => Math.max(max, firstOfUtcMonth(m).getTime()),
    Number.NEGATIVE_INFINITY,
  );
  const joiningMonth = firstOfUtcMonth(input.joiningDate).getTime();
  const currentMonth = firstOfUtcMonth(input.today).getTime();

  const months: AdvanceRentMonth[] = [];
  let coveredPaise = 0;

  for (const month of allMonths) {
    if (coveredPaise >= neededPaise) break;
    const t = month.getTime();
    if (t <= latestExisting || existing.has(t)) continue;

    const isJoiningMonth = t === joiningMonth;
    months.push({
      rent_month: month,
      due_date: isJoiningMonth ? input.joiningDate : dueDateForMonth(month, input.dueDay),
      period_start: isJoiningMonth ? input.joiningDate : month,
      period_end: lastDayOfUtcMonth(month),
      amount: monthlyRentPaise / 100,
      status: t > currentMonth ? "UPCOMING" : "PENDING",
      label: rentMonthLabel(month),
    });
    coveredPaise += monthlyRentPaise;
  }

  return {
    months,
    coveredAmount: coveredPaise / 100,
    exhausted: coveredPaise < neededPaise,
    lastAgreementMonth,
  };
}

/** The subset of a settlement-plan allocation this summary needs. */
export interface CoverageAllocation {
  type: string;
  rent_month: Date | null;
  outstanding: number;
  allocated: number;
  result: "PAID" | "PARTIAL" | "UNCHANGED";
}

export interface RentCoverage {
  /** Rent months this payment leaves fully paid. */
  months_covered: number;
  /** Last month of the unbroken run of paid rent from the first one; null if the first month is not paid. */
  paid_through_month: Date | null;
  /** The month left partly paid, if any. */
  partial: { rent_month: Date; allocated: number; remaining: number } | null;
  /** First rent month still owing anything, or the month after `paid_through_month`. */
  next_due_month: Date | null;
  /** Rupees allocated to rent in total. */
  rent_allocated: number;
  /** Rupees allocated to rent months after the current month — prepaid, not arrears. */
  future_rent_covered: number;
  /** What is still owed for today and earlier once this payment lands. Excludes the unpaid part of future months. */
  current_due: number;
}

export function summarizeRentCoverage(allocations: CoverageAllocation[], today: Date): RentCoverage {
  const currentMonth = firstOfUtcMonth(today).getTime();
  const rent = allocations
    .filter((a) => a.type === "RENT" && a.rent_month)
    .sort((a, b) => (a.rent_month as Date).getTime() - (b.rent_month as Date).getTime());

  let monthsCovered = 0;
  let rentAllocatedPaise = 0;
  let futurePaise = 0;
  let currentDuePaise = 0;
  let paidThrough: Date | null = null;
  let runBroken = false;
  let partial: RentCoverage["partial"] = null;
  let nextDue: Date | null = null;

  for (const a of allocations) {
    const isFuture = a.type === "RENT" && a.rent_month && firstOfUtcMonth(a.rent_month).getTime() > currentMonth;
    const remainingPaise = Math.max(toPaise(a.outstanding) - toPaise(a.allocated), 0);
    if (!isFuture) currentDuePaise += remainingPaise;
  }

  for (const a of rent) {
    const month = firstOfUtcMonth(a.rent_month as Date);
    const allocatedPaise = toPaise(a.allocated);
    rentAllocatedPaise += allocatedPaise;
    if (month.getTime() > currentMonth) futurePaise += allocatedPaise;

    if (a.result === "PAID") {
      monthsCovered++;
      if (!runBroken) paidThrough = month;
    } else {
      runBroken = true;
      if (!nextDue) nextDue = month;
      if (a.result === "PARTIAL" && !partial) {
        partial = {
          rent_month: month,
          allocated: allocatedPaise / 100,
          remaining: Math.max(toPaise(a.outstanding) - allocatedPaise, 0) / 100,
        };
      }
    }
  }

  if (!nextDue && paidThrough) nextDue = addUtcMonths(paidThrough, 1);

  return {
    months_covered: monthsCovered,
    paid_through_month: paidThrough,
    partial,
    next_due_month: nextDue,
    rent_allocated: rentAllocatedPaise / 100,
    future_rent_covered: futurePaise / 100,
    current_due: currentDuePaise / 100,
  };
}
