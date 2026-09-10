/**
 * What went wrong with one imported row, said the way an owner would say it.
 *
 * Two rules hold everywhere in this file:
 *   1. Copy names the real value — the actual room number, hostel, rupee
 *      amount. "Room not found" helps nobody; "Room 1O1 isn't in Sri Adithya
 *      Boys Hostel" does.
 *   2. Severity decides the flow. Only BLOCKER stops a row. A hostel that has
 *      been running three years hits BACKFILL_CAPPED on nearly every row, so
 *      it must be a choice the owner makes once, not a wall.
 */

export type IssueSeverity = "BLOCKER" | "NEEDS_CHOICE" | "NOTICE";

export type IssueCode =
  | "ROOM_NOT_FOUND"
  | "ROOM_CAPACITY_EXCEEDED"
  | "ROOM_NO_RENT"
  | "PHONE_INVALID"
  | "DUPLICATE_IN_FILE"
  | "DUPLICATE_IN_SYSTEM"
  | "PAYMENT_METHOD_MISSING"
  | "OVERPAID"
  | "BACKFILL_CAPPED"
  | "FORMULA_IN_CELL"
  | "DATE_UNREADABLE"
  | "HOSTEL_STAMP_MISMATCH";

export type FixAffordance = {
  kind:
    | "EDIT_FIELD"
    | "PICK_ROOM"
    | "PICK_OPTION"
    | "PICK_DATE"
    | "ACKNOWLEDGE"
    | "SKIP_ROW"
    | "OPEN_TENANT";
  options?: string[];
};

export type RowIssue = {
  code: IssueCode;
  severity: IssueSeverity;
  field?: string;
  row: number;
  title: string;
  detail: string;
  fix: FixAffordance;
};

export type IssueContext = {
  roomNo?: string;
  hostelName?: string;
  nearestRooms?: string[];
  capacity?: number;
  occupied?: number;
  value?: string;
  otherRows?: number[];
  tenantName?: string;
  amountPaid?: number;
  amountOwed?: number;
  joiningDate?: string;
  monthsElapsed?: number;
  cappedTo?: number;
  firstBilledMonth?: string;
  expectedHostelName?: string;
};

const SEVERITY: Record<IssueCode, IssueSeverity> = {
  ROOM_NOT_FOUND: "BLOCKER",
  ROOM_CAPACITY_EXCEEDED: "BLOCKER",
  ROOM_NO_RENT: "BLOCKER",
  PHONE_INVALID: "BLOCKER",
  PAYMENT_METHOD_MISSING: "BLOCKER",
  FORMULA_IN_CELL: "BLOCKER",
  DATE_UNREADABLE: "BLOCKER",
  HOSTEL_STAMP_MISMATCH: "BLOCKER",
  DUPLICATE_IN_FILE: "NEEDS_CHOICE",
  DUPLICATE_IN_SYSTEM: "NEEDS_CHOICE",
  OVERPAID: "NEEDS_CHOICE",
  BACKFILL_CAPPED: "NEEDS_CHOICE",
};

export function severityOf(code: IssueCode): IssueSeverity {
  return SEVERITY[code];
}

/** Indian digit grouping, no decimals — "90,000" not "90000.00". */
function rupees(value: number | undefined): string {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

type Copy = { title: string; detail: string; field?: string; fix: FixAffordance };

const COPY: Record<IssueCode, (c: IssueContext) => Copy> = {
  ROOM_NOT_FOUND: (c) => ({
    title: `Room ${c.roomNo ?? "—"} isn't in ${c.hostelName ?? "this hostel"}.`,
    detail: c.nearestRooms?.length
      ? `Closest matches: ${c.nearestRooms.join(", ")}. Pick one, or add this room to the hostel.`
      : `Pick a room from the list, or add this room to the hostel.`,
    field: "room_no",
    fix: { kind: "PICK_ROOM", options: c.nearestRooms ?? [] },
  }),
  ROOM_CAPACITY_EXCEEDED: (c) => ({
    title: `Room ${c.roomNo ?? "—"} is already full.`,
    detail: `It holds ${c.capacity ?? "—"} and already has ${c.occupied ?? "—"}. Move this tenant to another room, or raise the room's capacity.`,
    field: "room_no",
    fix: { kind: "PICK_ROOM", options: c.nearestRooms ?? [] },
  }),
  ROOM_NO_RENT: (c) => ({
    title: `Room ${c.roomNo ?? "—"} has no rent set.`,
    detail: `Enter this tenant's monthly rent, or set a base rent on the room.`,
    field: "monthly_rent",
    fix: { kind: "EDIT_FIELD" },
  }),
  PHONE_INVALID: (c) => ({
    title: `"${c.value ?? ""}" isn't a 10-digit mobile number.`,
    detail: `The tenant's invitation is sent to this number, so it has to be right. Enter 10 digits, with or without +91.`,
    field: "phone",
    fix: { kind: "EDIT_FIELD" },
  }),
  DUPLICATE_IN_FILE: (c) => ({
    title: `This person appears more than once in your file.`,
    detail: c.otherRows?.length
      ? `The same mobile number is on rows ${c.otherRows.join(", ")}. Keep one and remove the rest.`
      : `The same mobile number appears on more than one row. Keep one and remove the rest.`,
    fix: { kind: "SKIP_ROW" },
  }),
  DUPLICATE_IN_SYSTEM: (c) => ({
    title: `${c.tenantName ?? "This person"} is already a tenant on Stayo.`,
    detail: `They're already set up, so importing this row again would create a second record. Skip it, or open their profile to check.`,
    fix: { kind: "OPEN_TENANT" },
  }),
  PAYMENT_METHOD_MISSING: (c) => ({
    title: `You entered ₹${rupees(c.amountPaid)} already paid, but no payment method.`,
    detail: `Tell us how they paid so it's recorded correctly against their dues.`,
    field: "payment_method",
    fix: { kind: "PICK_OPTION", options: ["CASH", "UPI", "BANK_TRANSFER", "CARD", "CHEQUE"] },
  }),
  OVERPAID: (c) => ({
    title: `That's more than this tenant owes.`,
    detail: `You entered ₹${rupees(c.amountPaid)} paid, but only ₹${rupees(c.amountOwed)} is owed from ${c.joiningDate ?? "their joining date"} — ₹${rupees((c.amountPaid ?? 0) - (c.amountOwed ?? 0))} extra. Reduce the amount, or check the joining date.`,
    field: "amount_paid",
    fix: { kind: "EDIT_FIELD" },
  }),
  BACKFILL_CAPPED: (c) => ({
    title: `This tenant joined more than 2 years ago.`,
    detail: `That's ${c.monthsElapsed ?? "—"} months. We'll bill the most recent ${c.cappedTo ?? 24}${c.firstBilledMonth ? `, starting ${c.firstBilledMonth}` : ""}. Earlier months won't be imported.`,
    field: "joining_date",
    fix: { kind: "ACKNOWLEDGE" },
  }),
  FORMULA_IN_CELL: () => ({
    title: `This cell contains a formula.`,
    detail: `We can't read formulas — only the values they produce. In Excel, copy the cell and use Paste Special → Values.`,
    fix: { kind: "EDIT_FIELD" },
  }),
  DATE_UNREADABLE: (c) => ({
    title: `"${c.value ?? ""}" isn't a full date.`,
    detail: `Use DD/MM/YYYY — 05/01/2026 means 5 January 2026. The joining date decides how much rent is owed, so a guess would be wrong money.`,
    field: "joining_date",
    fix: { kind: "PICK_DATE" },
  }),
  HOSTEL_STAMP_MISMATCH: (c) => ({
    title: `This file was made for ${c.expectedHostelName ?? "a different hostel"}.`,
    detail: `Room numbers repeat across hostels, so importing it here could put tenants in the wrong rooms. Switch to that hostel, or download a fresh template for ${c.hostelName ?? "this one"}.`,
    fix: { kind: "ACKNOWLEDGE" },
  }),
};

export function buildIssue(
  code: IssueCode,
  row: number,
  context: IssueContext = {}
): RowIssue {
  const copy = COPY[code](context);
  return {
    code,
    severity: SEVERITY[code],
    field: copy.field,
    row,
    title: copy.title,
    detail: copy.detail,
    fix: copy.fix,
  };
}

/**
 * One decision per problem, not one per row.
 *
 * A hostel running three years hits BACKFILL_CAPPED on nearly every row.
 * Without grouping, that is thirty-two identical prompts and the owner
 * abandons the import.
 */
export function groupIssuesByCode(issues: RowIssue[]) {
  const groups = new Map<IssueCode, { code: IssueCode; severity: IssueSeverity; rows: number[]; title: string }>();

  for (const issue of issues) {
    const existing = groups.get(issue.code);
    if (existing) {
      if (!existing.rows.includes(issue.row)) existing.rows.push(issue.row);
    } else {
      groups.set(issue.code, {
        code: issue.code,
        severity: issue.severity,
        rows: [issue.row],
        title: issue.title,
      });
    }
  }

  return [...groups.values()].map((group) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => a - b),
  }));
}
