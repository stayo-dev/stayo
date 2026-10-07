/**
 * 💸 Invite Settlement — money already handed over, recorded at invite time.
 *
 * Runs inside the invite transaction, after `initializeOnboardingFinancials`
 * has created what is owed today (deposit, onboarding maintenance, one RENT
 * row per month from joining through the current month).
 *
 * A tenant may have paid ahead — a year's rent at ₹8,200 is ₹98,400, against
 * perhaps ₹41,000 owed today. That money is rent for real future periods, so
 * before settling, this creates the agreement's next RENT periods, oldest
 * first and only as many as the money needs (`planAdvanceRentMonths`, the same
 * planner the invite preview shows the owner). The ordinary settlement engine
 * then allocates across them, so prepaid months are real PAID obligations:
 * the monthly cron and the agreement schedule both find them and do not bill
 * those months again. See ADR-236, which extends ADR-036 to the invite.
 *
 * Money beyond the agreement's last month has nowhere to land — StayO holds no
 * credit balance (ADR-036) — so it is refused with the exact recordable
 * figure, never silently trimmed.
 *
 * Atomic with the invite: every write goes through `tx`. Idempotent: the
 * settlement carries `invite-settle:<invitationId>`, and a future period that
 * already exists is reused rather than duplicated.
 */

import crypto from "crypto";
import { resolvePreferences } from "@/lib/preferences";
import { financialPaymentFacade, type ReceivePaymentResult } from "./financial-payment-facade";
import { financialService } from "./financial-service";
import { fromLegacyStatus } from "./financial-obligation.types";
import { planAdvanceRentMonths } from "./advance-rent-coverage";

export interface InviteSettlementInput {
  tenantId: string;
  ownerId: string;
  hostelId: string;
  invitationId: string;
  joiningDate: Date;
  agreementDurationMonths: number;
  monthlyRent: number;
  paidAmount: number;
  paymentMethod: string | null | undefined;
  paymentReference?: string | null;
  /** When the tenant actually paid — "YYYY-MM-DD" or a Date. Defaults to now. Never affects which months are covered. */
  paymentDate?: string | Date | null;
  /** The owner's answer to "does this include the deposit?" — false keeps the deposit owed. */
  includesDeposit: boolean;
  today?: Date;
}

export interface InviteSettlementResult extends ReceivePaymentResult {
  /** Future RENT periods this invite created so the payment could cover them. */
  advanceObligationIds: string[];
}

const toPaise = (rupees: number) => Math.round(Number(rupees || 0) * 100);
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const monthName = (d: Date) => d.toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export class InviteSettlementService {
  async settleInTx(tx: any, input: InviteSettlementInput): Promise<InviteSettlementResult | null> {
    const paidAmount = Number(input.paidAmount || 0);
    if (!(paidAmount > 0)) return null;
    if (!input.paymentMethod) {
      throw new Error("VALIDATION_ERROR: A payment method is required to record an amount already paid");
    }

    // Read through `tx`: the obligations this is measured against were created
    // moments ago in this same transaction and are not committed yet. On the
    // global client this returned nothing and refused every amount.
    const owed = await financialService.getTenantDues(input.tenantId, input.ownerId, input.hostelId, tx);

    // "Paid includes deposit = No" means this money is rent and maintenance
    // only; the deposit stays owed. Without a filter the planner settles
    // across everything, including the deposit obligation.
    let obligationIdFilter: string[] | undefined;
    let duePaise = toPaise(Number(owed?.total_due || 0));
    if (!input.includesDeposit) {
      const settleable = await tx.rent_obligations.findMany({
        where: {
          tenant_id: input.tenantId,
          hostel_id: input.hostelId,
          is_superseded: false,
          obligation_type: { not: "SECURITY_DEPOSIT" },
        },
        select: { id: true, total_amount: true, amount: true },
      });
      obligationIdFilter = settleable.map((row: any) => row.id);
      duePaise = settleable.reduce(
        (sum: number, row: any) => sum + toPaise(Number(row.total_amount ?? row.amount ?? 0)),
        0
      );
    }

    const paymentDate = this.resolvePaymentDate(input.paymentDate, input.today ?? new Date());

    const paidPaise = toPaise(paidAmount);
    const advanceObligationIds: string[] = [];

    if (paidPaise > duePaise) {
      const created = await this.createAdvanceRentInTx(tx, input, (paidPaise - duePaise) / 100, duePaise);
      advanceObligationIds.push(...created);
      if (obligationIdFilter) obligationIdFilter.push(...created);
    }

    const settlement = await financialPaymentFacade.receivePayment(
      tx,
      {
        tenantId: input.tenantId,
        hostelId: input.hostelId,
        amountPaid: paidAmount,
        ...(obligationIdFilter ? { obligationIdFilter } : {}),
        paymentMethod: String(input.paymentMethod),
        referenceNumber: input.paymentReference || undefined,
        paymentDate,
        ownerId: input.ownerId,
        // One settlement per invitation: a double-submitted form must not
        // record the money twice.
        idempotencyKey: `invite-settle:${input.invitationId}`,
        offlineRecordedBy: input.ownerId,
        offlineRecordedAt: new Date(),
        offlineNote:
          advanceObligationIds.length > 0
            ? `Recorded while inviting — already paid, incl. ${advanceObligationIds.length} month(s) of advance rent`
            : "Recorded while inviting — already paid",
      },
      crypto.randomUUID()
    );

    return { ...settlement, advanceObligationIds };
  }

  /**
   * The date the money changed hands. A tenant who paid a year in January and
   * is entered in June keeps January on the record; refused in the future,
   * since money not yet received cannot be recorded as received.
   */
  private resolvePaymentDate(value: string | Date | null | undefined, now: Date): Date {
    if (value === null || value === undefined || value === "") return now;
    const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00.000Z`);
    if (Number.isNaN(date.getTime())) {
      throw new Error("VALIDATION_ERROR: The payment date is not a valid date");
    }
    // Compared as calendar days so a date of "today" is never refused by the
    // clock's time of day (or a UTC/IST offset).
    const day = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    const latestAllowed = day(now) + 24 * 60 * 60 * 1000;
    if (day(date) > latestAllowed) {
      throw new Error("VALIDATION_ERROR: The payment date cannot be in the future");
    }
    return date;
  }

  /**
   * Creates the agreement's next RENT periods for `amountNeeded` rupees and
   * returns their ids. Refuses (throws) when the agreement ends first.
   */
  private async createAdvanceRentInTx(
    tx: any,
    input: InviteSettlementInput,
    amountNeeded: number,
    duePaise: number
  ): Promise<string[]> {
    const today = input.today ?? new Date();
    const existingRent = await tx.rent_obligations.findMany({
      where: { tenant_id: input.tenantId, obligation_type: "RENT", is_superseded: false },
      select: { rent_month: true },
    });
    const hostel = await tx.hostels.findUnique({
      where: { id: input.hostelId },
      select: { preferences_config: true },
    });
    const dueDay = Math.trunc(Number(resolvePreferences(hostel ?? {}).due_day || 5)) || 5;

    const plan = planAdvanceRentMonths({
      joiningDate: input.joiningDate,
      durationMonths: input.agreementDurationMonths,
      monthlyRent: input.monthlyRent,
      dueDay,
      existingRentMonths: existingRent.map((r: any) => new Date(r.rent_month)).filter((d: Date) => !Number.isNaN(d.getTime())),
      amountNeeded,
      today,
    });

    if (plan.exhausted) {
      const maxPaise = duePaise + toPaise(plan.coveredAmount);
      const paidPaise = duePaise + toPaise(amountNeeded);
      const through = plan.lastAgreementMonth ? ` through ${monthName(plan.lastAgreementMonth)}` : "";
      throw new Error(
        `VALIDATION_ERROR: ${rupees(paidPaise)} is ${rupees(paidPaise - maxPaise)} more than this ` +
          `${input.agreementDurationMonths}-month agreement can take${through}. ` +
          `Record ${rupees(maxPaise)} or less, or lengthen the agreement — Stayo doesn't hold extra money as credit.`
      );
    }

    const ids: string[] = [];
    for (const month of plan.months) {
      // A period that already exists — the cron or another writer got there
      // first — is the same month; settle against it, never duplicate it.
      const existing = await tx.rent_obligations.findFirst({
        where: { tenant_id: input.tenantId, rent_month: month.rent_month, obligation_type: "RENT", is_superseded: false },
        select: { id: true },
      });
      if (existing) {
        ids.push(existing.id);
        continue;
      }
      const { lifecycle_status, settlement_status } = fromLegacyStatus(month.status);
      const row = await tx.rent_obligations.create({
        data: {
          tenant_id: input.tenantId,
          allocation_id: null,
          owner_id: input.ownerId,
          hostel_id: input.hostelId,
          rent_month: month.rent_month,
          amount: month.amount,
          total_amount: month.amount,
          due_date: month.due_date,
          status: month.status,
          lifecycle_status,
          settlement_status,
          obligation_type: "RENT",
          billing_period_start: month.period_start,
          billing_period_end: month.period_end,
          installment_label: month.label,
        },
      });
      ids.push(row.id);
    }
    return ids;
  }
}

export const inviteSettlementService = new InviteSettlementService();
