import ExcelJS from "exceljs";
import { COVER_SHEET, EXAMPLE_ROW_NAME, ROOMS_SHEET, TENANTS_SHEET } from "./workbook-parser";

/**
 * The import workbook, built for one hostel.
 *
 * Three things make this worth generating rather than shipping a static file:
 *
 *  1. The owner's rooms are already in it, so they retype nothing we know.
 *  2. The Room column is a dropdown bound to those rooms, so the single
 *     largest error class — a mistyped room number — cannot be entered.
 *  3. The cover sheet carries the hostel's id, so a workbook built for one
 *     hostel cannot be imported into another. Every hostel has a room 101;
 *     without the stamp that mistake would place tenants in the wrong rooms
 *     and report nothing wrong.
 */

/** Where `readHostelStamp` looks for the hostel id. */
export const HOSTEL_ID_CELL = "B2";

/** Blank rows left under the pre-filled rooms for the owner to add more. */
const BLANK_ROOM_ROWS = 40;

/** Tenant rows the dropdowns are applied to. */
const TENANT_ROWS = 160;

const GREY = { color: { argb: "FF8A8A8A" } } as const;
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2EDE7" },
};

/** A tenant row written back into the sheet, in the header's order. */
export type RowProblem = {
  /** Which column it belongs to, by field name. */
  field?: string;
  severity: "BLOCKER" | "NEEDS_CHOICE" | "NOTICE";
  title: string;
  detail: string;
};

export type TenantRowValues = {
  /** Problems still outstanding on this row, marked in the sheet. */
  problems?: RowProblem[];
  name?: string;
  phone?: string;
  email?: string;
  room_no?: string;
  monthly_rent?: number;
  joining_date?: string;
  security_deposit?: number;
  maintenance_charge?: number;
  maintenance_type?: string;
  agreement_duration_months?: number;
  amount_paid?: number;
  amount_includes_deposit?: boolean;
  payment_method?: string;
  payment_reference?: string;
  notes?: string;
};

export type TemplateInput = {
  hostel: { id: string; name: string };
  /** The hostel's own rent due day, 1–28. */
  dueDay: number;
  rooms: Array<{
    room_no: string;
    floor: number | null;
    capacity: number;
    room_type: string | null;
    base_rent: number | null;
    occupied_count: number;
  }>;
  tenantCount: number;
  /**
   * Rows to write into the Tenants sheet instead of the worked example.
   *
   * This is how the owner gets their own file back with the fixes they made
   * on screen already in it — so the spreadsheet they keep matches what Stayo
   * has, and re-uploading it does not undo their corrections.
   */
  tenants?: TenantRowValues[];
};

const ROOM_HEADERS = ["Room No", "Floor", "Capacity", "Sharing Type", "Base Rent", "Currently Occupied"];

/**
 * Which column a problem belongs to.
 *
 * The backend names the field on every issue, so a marked cell is always the
 * one the message is about — the owner never has to work out which column
 * "isn't a 10-digit mobile number" refers to.
 */
const FIELD_COLUMN: Record<string, number> = {
  name: 1,
  phone: 2,
  email: 3,
  room_no: 4,
  monthly_rent: 5,
  joining_date: 6,
  security_deposit: 7,
  advance_deposit: 7,
  maintenance_charge: 8,
  maintenance_type: 9,
  agreement_duration_months: 10,
  amount_paid: 11,
  amount_includes_deposit: 12,
  payment_method: 13,
  payment_reference: 14,
  notes: 15,
};

/** Red for something that stops the row, amber for something to decide. */
const BLOCKER_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFD9D6" } };
const CHOICE_FILL: ExcelJS.Fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF0CC" } };
const BLOCKER_FONT = { color: { argb: "FF9B1C1C" }, bold: true } as const;

const TENANT_HEADERS = [
  "Name",
  "Phone",
  "Email",
  "Room",
  "Monthly Rent",
  "Joining Date",
  "Security Deposit",
  "Maintenance Charge",
  "Maintenance Type",
  "Agreement Months",
  "Amount Already Paid",
  "Paid Includes Deposit",
  "Payment Method",
  "Payment Reference",
  "Notes",
];

/** Appended only when something is wrong, so a clean sheet keeps its shape. */
const PROBLEM_COLUMN = "What to fix";

function styleHeader(row: ExcelJS.Row) {
  row.font = { bold: true };
  row.eachCell((cell) => {
    cell.fill = HEADER_FILL;
  });
}

function buildCover(sheet: ExcelJS.Worksheet, input: TemplateInput) {
  sheet.columns = [{ width: 24 }, { width: 70 }];

  sheet.getCell("A1").value = "Stayo — import your tenants";
  sheet.getCell("A1").font = { bold: true, size: 14 };

  // B2 is the stamp. Keep it here: `readHostelStamp` reads this exact cell.
  sheet.getCell("A2").value = "Hostel ID";
  sheet.getCell(HOSTEL_ID_CELL).value = input.hostel.id;
  sheet.getCell("A3").value = "Hostel";
  sheet.getCell("B3").value = input.hostel.name;
  sheet.getCell("A4").value = "Rent due day";
  sheet.getCell("B4").value = `Rent is due on day ${input.dueDay} of each month`;

  sheet.getCell("A5").value = "Already in Stayo";
  sheet.getCell("B5").value =
    `${input.rooms.length} ${input.rooms.length === 1 ? "room" : "rooms"} and ` +
    `${input.tenantCount} ${input.tenantCount === 1 ? "tenant" : "tenants"} for this hostel`;

  const lines = [
    "",
    "How to fill this in",
    `1. Open the "${ROOMS_SHEET}" sheet. Your existing rooms are already there, in grey. Add any that are missing in the empty rows below them.`,
    `2. Open the "${TENANTS_SHEET}" sheet and add one row per tenant. The Room column is a dropdown — pick from your rooms.`,
    "3. Save the file and upload it back to Stayo. Nothing is created until you confirm.",
    "",
    "Filling in the columns",
    "• Dates are DD/MM/YYYY — 05/01/2026 means 5 January 2026, not 1 May.",
    "• Amounts are in ₹. Digits only, like 8500 — a ₹ sign and commas are fine.",
    "• Email is optional. We invite tenants on WhatsApp, so a mobile number is what we need.",
    "• Leave Monthly Rent blank to use the room's own rent.",
    "• Already living here? Put their real joining date, and what they have already paid in Amount Already Paid. We will work out what is still owed.",
    "• Paste values, not formulas — we cannot read a formula, only the value it produces.",
    "",
    "Do not edit this sheet. It tells Stayo which hostel this file belongs to.",
  ];

  if ((input.tenants ?? []).some((t) => (t.problems ?? []).length > 0)) {
    lines.splice(
      lines.indexOf("Filling in the columns"),
      0,
      "What the colours mean",
      "• Red — this has to be fixed before the row can be imported.",
      `• Amber — have a look, but the row will import either way.`,
      `• The "${PROBLEM_COLUMN}" column at the end says what is wrong with each row. Hover a coloured cell to read it there too.`,
      "• Fix them here, save, and upload this same file again.",
      ""
    );
  }
  lines.forEach((line, i) => {
    const cell = sheet.getCell(`A${7 + i}`);
    cell.value = line;
    if (line === "How to fill this in" || line === "Filling in the columns") cell.font = { bold: true };
  });
}

function buildRooms(sheet: ExcelJS.Worksheet, input: TemplateInput) {
  sheet.columns = [
    { key: "room_no", width: 14 },
    { key: "floor", width: 10 },
    { key: "capacity", width: 12 },
    { key: "sharing", width: 18 },
    { key: "rent", width: 14 },
    { key: "occupied", width: 20 },
  ];
  sheet.addRow(ROOM_HEADERS);
  styleHeader(sheet.getRow(1));

  for (const room of input.rooms) {
    const row = sheet.addRow([
      room.room_no,
      room.floor ?? undefined,
      room.capacity,
      room.room_type ?? undefined,
      room.base_rent ?? undefined,
      room.occupied_count,
    ]);
    // Grey: already in Stayo. The owner only edits these to change something.
    row.font = GREY;
  }

  // Empty rows to add rooms into. They are given a border so the sheet shows
  // where to type — and so ExcelJS counts them, which keeps the dropdown's
  // range covering rooms the owner has not typed yet.
  const firstBlank = sheet.rowCount + 1;
  for (let r = firstBlank; r < firstBlank + BLANK_ROOM_ROWS; r++) {
    for (let c = 1; c <= ROOM_HEADERS.length; c++) {
      sheet.getRow(r).getCell(c).border = {
        bottom: { style: "hair", color: { argb: "FFDDDDDD" } },
      };
    }
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

function buildTenants(sheet: ExcelJS.Worksheet, workbook: ExcelJS.Workbook, input: TemplateInput) {
  sheet.columns = [...TENANT_HEADERS, PROBLEM_COLUMN].map((h) => ({
    width: h === PROBLEM_COLUMN ? 52 : h === "Name" ? 22 : h === "Notes" ? 28 : Math.max(12, h.length + 3),
  }));
  const anyProblems = (input.tenants ?? []).some((t) => (t.problems ?? []).length > 0);
  sheet.addRow(anyProblems ? [...TENANT_HEADERS, PROBLEM_COLUMN] : TENANT_HEADERS);
  styleHeader(sheet.getRow(1));

  // Real rows when we have them: this is the owner's corrected file, not a
  // blank template, so the example would be noise.
  if (input.tenants?.length) {
    for (const tenant of input.tenants) {
      const problems = tenant.problems ?? [];
      const written = sheet.addRow([
        tenant.name ?? "",
        tenant.phone ?? "",
        tenant.email ?? "",
        tenant.room_no ?? "",
        tenant.monthly_rent ?? "",
        tenant.joining_date ?? "",
        tenant.security_deposit ?? "",
        tenant.maintenance_charge ?? "",
        tenant.maintenance_type ?? "",
        tenant.agreement_duration_months ?? "",
        tenant.amount_paid ?? "",
        tenant.amount_includes_deposit === undefined ? "" : tenant.amount_includes_deposit ? "YES" : "NO",
        tenant.payment_method ?? "",
        tenant.payment_reference ?? "",
        tenant.notes ?? "",
        ...(anyProblems
          ? [problems.map((problem) => problem.title).join(" · ")]
          : []),
      ]);

      // Mark the exact cell each problem is about, in its own colour, with the
      // full sentence as a note. An owner scanning a hundred rows should see
      // where the trouble is without reading any of them.
      for (const problem of problems) {
        const column = problem.field ? FIELD_COLUMN[problem.field] : undefined;
        const blocking = problem.severity === "BLOCKER";
        if (column) {
          const cell = written.getCell(column);
          cell.fill = blocking ? BLOCKER_FILL : CHOICE_FILL;
          if (blocking) cell.font = BLOCKER_FONT;
          cell.note = `${problem.title}\n\n${problem.detail}`;
        }
      }
      if (problems.length) {
        const summary = written.getCell(TENANT_HEADERS.length + 1);
        summary.fill = problems.some((p) => p.severity === "BLOCKER") ? BLOCKER_FILL : CHOICE_FILL;
        summary.alignment = { wrapText: true, vertical: "top" };
      }
    }
  }

  const exampleRoom = input.rooms[0]?.room_no ?? "101";
  const example = input.tenants?.length
    ? null
    : sheet.addRow([
    EXAMPLE_ROW_NAME,
    "9876543210",
    "student@example.com",
    exampleRoom,
    8500,
    "05/01/2026",
    25500,
    500,
    "MONTHLY",
    11,
    76500,
    "YES",
    "CASH",
    "",
    "Already living here since January",
  ]);
  if (example) example.font = GREY;

  // The dropdown's source. The range runs past the rooms that exist today so
  // a room the owner adds on the Rooms sheet appears here too.
  const lastRoomRow = 1 + Math.max(input.rooms.length, 1) + BLANK_ROOM_ROWS;
  workbook.definedNames.add(`'${ROOMS_SHEET}'!$A$2:$A$${lastRoomRow}`, "RoomList");

  for (let r = 2; r <= TENANT_ROWS + 1; r++) {
    sheet.getCell(`D${r}`).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ["RoomList"],
      showErrorMessage: true,
      errorTitle: "Pick a room",
      error: `Choose a room from the ${ROOMS_SHEET} sheet. If the room isn't there yet, add it on that sheet first.`,
    };
    sheet.getCell(`I${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"MONTHLY,ONE_TIME,NONE"'],
    };
    sheet.getCell(`L${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"YES,NO"'],
    };
    sheet.getCell(`M${r}`).dataValidation = {
      type: "list",
      allowBlank: true,
      formulae: ['"CASH,UPI,BANK_TRANSFER,CARD,CHEQUE"'],
    };
  }

  sheet.views = [{ state: "frozen", ySplit: 1 }];
}

export async function buildImportWorkbook(input: TemplateInput): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Stayo";
  workbook.created = new Date();

  // Order matters: the cover is what the owner opens on. The parser picks the
  // Tenants sheet by name, so being third is safe.
  const cover = workbook.addWorksheet(COVER_SHEET);
  const rooms = workbook.addWorksheet(ROOMS_SHEET);
  const tenants = workbook.addWorksheet(TENANTS_SHEET);

  buildCover(cover, input);
  buildRooms(rooms, input);
  buildTenants(tenants, workbook, input);

  // Locked so the hostel stamp cannot be edited by accident. Not a security
  // boundary — upload verifies the stamp against the selected hostel anyway.
  await cover.protect("stayo-import", {
    selectLockedCells: true,
    selectUnlockedCells: true,
  });

  // ExcelJS returns its own Buffer-ish type; normalise to a Node Buffer.
  return Buffer.from((await workbook.xlsx.writeBuffer()) as ArrayBuffer);
}
