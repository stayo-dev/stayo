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

export const ISSUE_CODES = [
  "NAME_MISSING",
  "EMAIL_INVALID",
  "PHONE_INVALID",
  "ROOM_MISSING",
  "ROOM_NOT_FOUND",
  "ROOM_INACTIVE",
  "ROOM_CAPACITY_EXCEEDED",
  "ROOM_NO_RENT",
  "NUMBER_INVALID",
  "DUPLICATE_IN_FILE",
  "DUPLICATE_IN_SYSTEM",
  "PAYMENT_METHOD_MISSING",
  "OVERPAID",
  "BACKFILL_CAPPED",
  "FORMULA_IN_CELL",
  "DATE_UNREADABLE",
  "HOSTEL_STAMP_MISMATCH",
  "ROOM_SHEET_DUPLICATE",
  "ROOM_CAPACITY_BELOW_OCCUPANCY",
  "ROOM_SHEET_NUMBER_INVALID",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];


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
  /** Owner-facing name of the column, e.g. "monthly rent", "agreement length". */
  fieldLabel?: string;
  /** What a valid value looks like, for NUMBER_INVALID. */
  hint?: string;
  /** Rooms with a free bed, offered when the chosen one is full. */
  roomsWithSpace?: string[];
};

const SEVERITY: Record<IssueCode, IssueSeverity> = {
  NAME_MISSING: "BLOCKER",
  EMAIL_INVALID: "BLOCKER",
  ROOM_MISSING: "BLOCKER",
  ROOM_INACTIVE: "BLOCKER",
  NUMBER_INVALID: "BLOCKER",
  ROOM_SHEET_DUPLICATE: "BLOCKER",
  ROOM_CAPACITY_BELOW_OCCUPANCY: "BLOCKER",
  ROOM_SHEET_NUMBER_INVALID: "BLOCKER",
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

/** A cell the owner left empty (or filled with spaces) — say "missing", never quote `""`. */
function isBlank(value: string | undefined): boolean {
  return String(value ?? "").trim() === "";
}

type Copy = { title: string; detail: string; field?: string; fix: FixAffordance };

const COPY: Record<IssueCode, (c: IssueContext) => Copy> = {
  ROOM_SHEET_DUPLICATE: (c) => ({
    title: `Room ${c.roomNo ?? "—"} is listed more than once on the Rooms sheet.`,
    detail: c.otherRows?.length
      ? `It also appears on ${c.otherRows.length === 1 ? "row" : "rows"} ${c.otherRows.join(", ")}. Keep one and remove the rest.`
      : `Keep one and remove the rest.`,
    field: "room_no",
    fix: { kind: "SKIP_ROW" },
  }),
  ROOM_CAPACITY_BELOW_OCCUPANCY: (c) => ({
    title: `Room ${c.roomNo ?? "—"} already has more people than that.`,
    detail: `You've set ${c.capacity ?? "—"} beds, but ${c.occupied ?? "—"} people already live there. Raise the number of beds, or move someone out first.`,
    field: "capacity",
    fix: { kind: "EDIT_FIELD" },
  }),
  ROOM_SHEET_NUMBER_INVALID: (c) => ({
    title: isBlank(c.value)
      ? `Room ${c.roomNo ?? "—"} needs a ${c.fieldLabel ?? "number"}.`
      : `"${c.value}" isn't a valid ${c.fieldLabel ?? "number"} for room ${c.roomNo ?? "—"}.`,
    detail: c.hint ?? `Enter digits only.`,
    fix: { kind: "EDIT_FIELD" },
  }),
  NAME_MISSING: (c) => ({
    title: isBlank(c.value)
      ? `This tenant's name is missing.`
      : `"${c.value}" is too short to be a full name.`,
    detail: `Enter their full name as it should appear on their invitation and receipts.`,
    field: "name",
    fix: { kind: "EDIT_FIELD" },
  }),
  EMAIL_INVALID: (c) => ({
    title: isBlank(c.value)
      ? `This tenant's email address is missing.`
      : `"${c.value}" isn't a valid email address.`,
    detail: `Enter an email like name@example.com — their invitation and receipts go there.`,
    field: "email",
    fix: { kind: "EDIT_FIELD" },
  }),
  ROOM_MISSING: () => ({
    title: `This tenant has no room.`,
    detail: `Choose the room they live in.`,
    field: "room_no",
    fix: { kind: "PICK_ROOM" },
  }),
  ROOM_INACTIVE: (c) => ({
    title: `Room ${c.roomNo ?? "—"} is switched off in ${c.hostelName ?? "this hostel"}.`,
    detail: `Tenants can't be added to an inactive room. Choose another room, or turn this room back on in the hostel's rooms.`,
    field: "room_no",
    fix: { kind: "PICK_ROOM", options: c.roomsWithSpace ?? [] },
  }),
  NUMBER_INVALID: (c) => ({
    title: isBlank(c.value)
      ? `This ${c.fieldLabel ?? "amount"} isn't a number we can read.`
      : `"${c.value}" isn't a valid ${c.fieldLabel ?? "amount"}.`,
    detail: c.hint ?? `Enter digits only, like 8500. A ₹ sign and commas are fine.`,
    fix: { kind: "EDIT_FIELD" },
  }),
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
    detail: c.roomsWithSpace?.length
      ? `It holds ${c.capacity ?? "—"} and already has ${c.occupied ?? "—"}. Rooms with a free bed: ${c.roomsWithSpace.join(", ")}. Or raise this room's capacity.`
      : `It holds ${c.capacity ?? "—"} and already has ${c.occupied ?? "—"}. Move this tenant to another room, or raise the room's capacity.`,
    field: "room_no",
    fix: { kind: "PICK_ROOM", options: c.roomsWithSpace ?? [] },
  }),
  ROOM_NO_RENT: (c) => ({
    title: `Room ${c.roomNo ?? "—"} has no rent set.`,
    detail: `Enter this tenant's monthly rent, or set a base rent on the room.`,
    field: "monthly_rent",
    fix: { kind: "EDIT_FIELD" },
  }),
  PHONE_INVALID: (c) => ({
    title: isBlank(c.value)
      ? `This tenant's mobile number is missing.`
      : `"${c.value}" isn't a 10-digit mobile number.`,
    detail: `The tenant's invitation is sent to this number, so it has to be right. Enter 10 digits, with or without +91.`,
    field: "phone",
    fix: { kind: "EDIT_FIELD" },
  }),
  DUPLICATE_IN_FILE: (c) => ({
    title: `This person appears more than once in your file.`,
    detail: c.otherRows?.length
      ? `The same person is on ${c.otherRows.length === 1 ? "row" : "rows"} ${c.otherRows.join(", ")} too. Keep one and remove the rest.`
      : `The same mobile number appears on more than one row. Keep one and remove the rest.`,
    fix: { kind: "SKIP_ROW" },
  }),
  DUPLICATE_IN_SYSTEM: (c) => ({
    title: `${c.tenantName ?? "This person"} is already a tenant on Stayo.`,
    detail: `They're already set up, so importing this row again would create a second record. Skip it, or open their profile to check.`,
    fix: { kind: "OPEN_TENANT" },
  }),
  PAYMENT_METHOD_MISSING: (c) => ({
    title: c.amountPaid != null
      ? `You entered ₹${rupees(c.amountPaid)} already paid, but no payment method.`
      : `You entered an amount already paid, but no payment method.`,
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
    detail: `That's ${c.monthsElapsed ?? "—"} months. We'll bill the most recent ${c.cappedTo ?? 24} months${c.firstBilledMonth ? `, starting ${c.firstBilledMonth}` : ""}. Earlier months won't be imported.`,
    field: "joining_date",
    fix: { kind: "ACKNOWLEDGE" },
  }),
  FORMULA_IN_CELL: (c) => ({
    title: c.fieldLabel ? `The ${c.fieldLabel} cell contains a formula.` : `This cell contains a formula.`,
    detail: `We can't read formulas — only the values they produce. In Excel, copy the cell and use Paste Special → Values.`,
    fix: { kind: "EDIT_FIELD" },
  }),
  DATE_UNREADABLE: (c) => ({
    title: isBlank(c.value)
      ? `This tenant's joining date is missing.`
      : `"${c.value}" isn't a full date.`,
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
 * How a group of rows sharing one problem is headed.
 *
 * A single row's title names its own values ("Room 1O1 isn't in …"), which is
 * right for one row and wrong as the heading of twelve rows with twelve
 * different rooms. So a group of two or more gets a count-based title here;
 * a group of one keeps the row's own, more specific title.
 */
const GROUP_TITLE: Record<IssueCode, (count: number) => string> = {
  NAME_MISSING: (n) => `${n} rows have no tenant name.`,
  EMAIL_INVALID: (n) => `${n} rows have a missing or wrong email address.`,
  ROOM_MISSING: (n) => `${n} rows have no room.`,
  ROOM_INACTIVE: (n) => `${n} rows use a room that's switched off.`,
  NUMBER_INVALID: (n) => `${n} rows have an amount or number we can't read.`,
  ROOM_SHEET_DUPLICATE: (n) => `${n} rooms are listed more than once.`,
  ROOM_CAPACITY_BELOW_OCCUPANCY: (n) => `${n} rooms have fewer beds than the people already living in them.`,
  ROOM_SHEET_NUMBER_INVALID: (n) => `${n} rooms have a number we can't read.`,
  ROOM_NOT_FOUND: (n) => `${n} rows use a room that isn't in this hostel.`,
  ROOM_CAPACITY_EXCEEDED: (n) => `${n} rows put a tenant in a room that's already full.`,
  ROOM_NO_RENT: (n) => `${n} rows are for rooms with no rent set.`,
  PHONE_INVALID: (n) => `${n} rows have a missing or wrong mobile number.`,
  DUPLICATE_IN_FILE: (n) => `${n} rows repeat someone already in your file.`,
  DUPLICATE_IN_SYSTEM: (n) => `${n} people in your file are already tenants on Stayo.`,
  PAYMENT_METHOD_MISSING: (n) => `${n} rows have an amount paid but no payment method.`,
  OVERPAID: (n) => `${n} rows show more paid than the tenant owes.`,
  BACKFILL_CAPPED: (n) => `${n} tenants joined more than 2 years ago.`,
  FORMULA_IN_CELL: (n) => `${n} rows contain a spreadsheet formula.`,
  DATE_UNREADABLE: (n) => `${n} rows have a missing or unreadable joining date.`,
  HOSTEL_STAMP_MISMATCH: () => `This file was made for a different hostel.`,
};

/**
 * One decision per problem, not one per row.
 *
 * A hostel running three years hits BACKFILL_CAPPED on nearly every row.
 * Without grouping, that is thirty-two identical prompts and the owner
 * abandons the import.
 */
export function groupIssuesByCode(issues: RowIssue[]) {
  const groups = new Map<IssueCode, { code: IssueCode; severity: IssueSeverity; rows: number[]; firstTitle: string }>();

  for (const issue of issues) {
    const existing = groups.get(issue.code);
    if (existing) {
      if (!existing.rows.includes(issue.row)) existing.rows.push(issue.row);
    } else {
      groups.set(issue.code, {
        code: issue.code,
        severity: issue.severity,
        rows: [issue.row],
        firstTitle: issue.title,
      });
    }
  }

  return Array.from(groups.values()).map(({ firstTitle, ...group }) => ({
    ...group,
    rows: [...group.rows].sort((a, b) => a - b),
    title: group.rows.length === 1 ? firstTitle : GROUP_TITLE[group.code](group.rows.length),
  }));
}
