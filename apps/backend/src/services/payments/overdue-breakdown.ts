import { isOverdue } from "./settlement-planner";

/**
 * How far behind a tenant is, from obligation rows the caller already fetched
 * (the same rows `financialService.getTenantPaymentSummary()` takes, so list
 * views stay one query). Uses the canonical `isOverdue` rule — this module
 * only counts, it never decides what "overdue" means.
 *
 * `overdue_rent_count` is the number of distinct rent periods (`rent_month`)
 * with an unpaid balance past their due date. For a monthly tenant that is
 * months of rent unpaid; a quarterly obligation counts as one period.
 */
export interface OverdueBreakdownRow {
  amount: number | string;
  total_amount?: number | string;
  status: string;
  obligation_type?: string | null;
  rent_month?: Date | string | null;
  due_date?: Date | string | null;
  payments: Array<{ amount_paid: number | string }>;
}

export interface OverdueBreakdown {
  overdue_amount: number;
  overdue_rent_count: number;
}

export function computeOverdueBreakdown(rows: OverdueBreakdownRow[], now: Date = new Date()): OverdueBreakdown {
  let overdueAmount = 0;
  const rentPeriods = new Set<string>();

  rows.forEach((ob, index) => {
    if (ob.status === "WAIVED" || ob.status === "PAID" || !ob.due_date) return;
    const total = Number(ob.total_amount || ob.amount);
    const paid = ob.payments.reduce((sum, p) => sum + Number(p.amount_paid), 0);
    const remaining = Math.max(0, total - paid);
    if (remaining <= 0) return;
    if (!isOverdue({ status: ob.status, due_date: new Date(ob.due_date) }, now)) return;

    overdueAmount += remaining;
    if (ob.obligation_type === "RENT") {
      rentPeriods.add(ob.rent_month ? new Date(ob.rent_month).toISOString().slice(0, 7) : `row-${index}`);
    }
  });

  return { overdue_amount: overdueAmount, overdue_rent_count: rentPeriods.size };
}
