import { dueDateForMonth } from "./rent-schedule-dates";

export interface ApplyDueDayChangeParams {
  hostelId: string;
  newDueDay: number;
  actorId: string;
  reason?: string;
  /** First rent_month affected. Defaults to the first of the current UTC month. */
  effectiveFromMonth?: Date;
}

export interface DueDayChangeResult {
  hostelId: string;
  newDueDay: number;
  obligationsUpdated: number;
  updatedObligationIds: string[];
}

function firstOfCurrentUtcMonth(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

function isFirstOfMonth(d: Date | null | undefined): boolean {
  if (!d) return true; // treat "unknown period start" as a normal month row
  const date = new Date(d);
  return date.getUTCDate() === 1;
}

/**
 * Re-dates a hostel's future, not-yet-paid rent/maintenance obligations after
 * its `billing.due_day` is changed.
 *
 * Mirrors `rent-change-service.applyRentChangeInTx` — same safety rule (an
 * obligation may be edited in place only while nothing has been paid against
 * it), same "future months only" scoping — but touches `due_date` only, never
 * `amount`, never `status`, and never supersedes or recreates a row.
 *
 * Deliberately left alone:
 *  - PAID / PARTIAL / WAIVED / CANCELLED obligations, and any with a recorded
 *    payment (history stays exactly as it was billed);
 *  - months before `effectiveFromMonth`;
 *  - each tenant's joining month, whose `due_date` is the literal joining date
 *    (detected by `billing_period_start` not being the 1st) rather than a
 *    policy-derived date.
 */
export async function applyDueDayChangeInTx(
  tx: any,
  params: ApplyDueDayChangeParams
): Promise<DueDayChangeResult> {
  const { hostelId, actorId } = params;
  const newDueDay = Math.trunc(Number(params.newDueDay));

  if (!hostelId) throw new Error("VALIDATION_ERROR: hostelId is required");
  if (!Number.isFinite(newDueDay) || newDueDay < 1 || newDueDay > 28) {
    throw new Error("VALIDATION_ERROR: newDueDay must be between 1 and 28");
  }
  if (!actorId) throw new Error("VALIDATION_ERROR: actorId is required");

  const effectiveFromMonth = params.effectiveFromMonth
    ? new Date(Date.UTC(
        new Date(params.effectiveFromMonth).getUTCFullYear(),
        new Date(params.effectiveFromMonth).getUTCMonth(),
        1,
      ))
    : firstOfCurrentUtcMonth();

  const candidates = await tx.rent_obligations.findMany({
    where: {
      hostel_id: hostelId,
      obligation_type: { in: ["RENT", "MAINTENANCE"] },
      is_superseded: false,
      lifecycle_status: "ACTIVE",
      settlement_status: "UNPAID",
      status: { notIn: ["PAID", "PARTIAL", "WAIVED", "CANCELLED"] },
      rent_month: { gte: effectiveFromMonth },
    },
    select: {
      id: true,
      rent_month: true,
      due_date: true,
      billing_period_start: true,
      payments: { select: { id: true } },
    },
  });

  const updatedObligationIds: string[] = [];
  for (const ob of candidates) {
    if (ob.payments && ob.payments.length > 0) continue; // never re-date a row money has moved against
    if (!isFirstOfMonth(ob.billing_period_start)) continue; // skip the joining/first month
    const nextDue = dueDateForMonth(new Date(ob.rent_month), newDueDay);
    if (new Date(ob.due_date).getTime() === nextDue.getTime()) continue; // already correct
    await tx.rent_obligations.update({
      where: { id: ob.id },
      data: { due_date: nextDue, updated_at: new Date() },
    });
    updatedObligationIds.push(ob.id);
  }

  return {
    hostelId,
    newDueDay,
    obligationsUpdated: updatedObligationIds.length,
    updatedObligationIds,
  };
}
