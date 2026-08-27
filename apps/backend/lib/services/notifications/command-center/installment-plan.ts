/**
 * The `PLAN` answer — instalment progress.
 *
 * This capability did not exist. `installment_label`, `installment_sequence`
 * and `tenant_billing_plans.installment_count` have been in the schema all
 * along, and nothing on WhatsApp ever read them: a guardian could learn what
 * was due this month but never how many months were left, or how much of the
 * agreement they had already funded. For someone paying for a child's stay a
 * year at a time, that second question is the one they actually have.
 *
 * Pure — no database, no provider.
 */

import { Audience, Subject, compose, lines, rupees, shortDate, signature, subjectLine } from "./voice";

/** Where one instalment stands. Derived from obligations, never re-computed here. */
export type InstalmentState = "PAID" | "PARTIAL" | "DUE" | "OVERDUE" | "UPCOMING";

export type InstalmentRow = {
  sequence: number;
  /** "August 2026", "Instalment 3" — whatever the obligation carries. */
  label: string;
  amount: number;
  paid: number;
  outstanding: number;
  dueDate: Date | string | null;
  state: InstalmentState;
  overdueDays: number;
};

export type InstalmentPlanInput = {
  audience: Audience;
  subject: Subject;
  rows: InstalmentRow[];
  /** From `tenant_billing_plans.installment_count` when a plan exists. */
  totalInstalments: number | null;
  totalContractAmount: number | null;
  totalPaid: number;
};

/**
 * How many rows fit before the message stops being readable on a phone.
 * WhatsApp's own ceiling is 4096 characters; legibility gives out well before
 * that, so this is a design limit rather than a technical one.
 */
const MAX_ROWS = 14;

const MARKERS: Record<InstalmentState, string> = {
  PAID: "✅",
  PARTIAL: "🟡",
  OVERDUE: "🔴",
  DUE: "🔵",
  UPCOMING: "⚪",
};

function rowNote(row: InstalmentRow): string {
  switch (row.state) {
    case "PAID":
      return "Paid";
    case "PARTIAL":
      return `${rupees(row.outstanding)} still due`;
    case "OVERDUE":
      return `${rupees(row.outstanding)} due — ${row.overdueDays} ${row.overdueDays === 1 ? "day" : "days"} late`;
    case "DUE": {
      const on = shortDate(row.dueDate);
      return on ? `${rupees(row.outstanding)} due by ${on}` : `${rupees(row.outstanding)} due`;
    }
    case "UPCOMING": {
      const on = shortDate(row.dueDate);
      return on ? `Due ${on}` : "Scheduled";
    }
  }
}

function formatRow(row: InstalmentRow, total: number | null): string {
  const position = total ? `${row.sequence}/${total}` : `${row.sequence}`;
  return `${MARKERS[row.state]} *${position}* · ${row.label} · ${rupees(row.amount)} — ${rowNote(row)}`;
}

/**
 * Show the window that matters rather than the first N rows: everything still
 * owed, plus enough already-paid history to prove the record is real. A parent
 * eleven months into a twelve-month plan should open this and see their eleven
 * payments acknowledged, not truncated away in favour of the one month left.
 */
function selectRows(rows: InstalmentRow[]): { shown: InstalmentRow[]; hiddenBefore: number } {
  if (rows.length <= MAX_ROWS) return { shown: rows, hiddenBefore: 0 };

  const firstOpenIndex = rows.findIndex((row) => row.state !== "PAID");
  // Everything is paid — the tail is the interesting part.
  if (firstOpenIndex === -1) {
    return { shown: rows.slice(rows.length - MAX_ROWS), hiddenBefore: rows.length - MAX_ROWS };
  }

  // Keep two settled rows of context above the first open one, then fill forward.
  const start = Math.max(0, Math.min(firstOpenIndex - 2, rows.length - MAX_ROWS));
  return { shown: rows.slice(start, start + MAX_ROWS), hiddenBefore: start };
}

export function formatInstalmentPlan(input: InstalmentPlanInput): string {
  if (input.rows.length === 0) {
    return compose(
      subjectLine(input.audience, input.subject),
      "No instalment schedule has been raised yet. As soon as the first bill is generated it will appear here.",
      signature(input.subject)
    );
  }

  const { shown, hiddenBefore } = selectRows(input.rows);
  const remaining = input.rows.filter((row) => row.state !== "PAID").length;

  const header = input.totalInstalments
    ? `Instalment plan · ${input.totalInstalments} instalments`
    : "Instalment plan";

  const elided = hiddenBefore > 0 ? `_${hiddenBefore} earlier ${hiddenBefore === 1 ? "instalment" : "instalments"} paid and settled._` : null;

  const totals = lines(
    input.totalContractAmount && input.totalContractAmount > 0
      ? `Paid so far: *${rupees(input.totalPaid)}* of ${rupees(input.totalContractAmount)}`
      : `Paid so far: *${rupees(input.totalPaid)}*`,
    remaining > 0
      ? `Remaining: ${remaining} ${remaining === 1 ? "instalment" : "instalments"}`
      : "All instalments settled."
  );

  return compose(
    subjectLine(input.audience, input.subject),
    header,
    elided,
    shown.map((row) => formatRow(row, input.totalInstalments)).join("\n"),
    totals,
    signature(input.subject)
  );
}
