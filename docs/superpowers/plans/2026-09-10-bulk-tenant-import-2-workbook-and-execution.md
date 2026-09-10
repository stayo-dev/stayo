# Bulk Tenant Import — Plan 2: The Workbook and Safe Execution

> **For agentic workers:** Execute inline with superpowers:executing-plans (the user's standing preference — do not dispatch per-task subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a per-hostel Excel workbook with their rooms already filled in and a room dropdown that makes a typo impossible, import the rooms it defines, and make execution finish safely on a large batch with visible progress.

**Architecture:** Phases C and E of the spec. The template stops being a static CSV and becomes a workbook built per hostel with ExcelJS; the parser learns to read named sheets; confirm becomes chunked and resumable so it cannot time out. No frontend work — Plan 3 builds the screens.

**Tech Stack:** TypeScript, Next.js 14 App Router, Prisma, Vitest (pure config), `exceljs` 4.4.0 (writing), `xlsx` (reading).

**Spec:** `docs/superpowers/specs/2026-09-10-bulk-tenant-import-design.md`

**Depends on:** Plan 1, merged to `main` in PR #78 (`b80569e`). All of `lib/services/bulk-import/` exists.

## Global Constraints

- **Branch:** cut a new branch from `main` — `feat/bulk-tenant-import-workbook` — in its own worktree. Do not reuse `feat/bulk-tenant-import` (merged), and never `git checkout` in `/home/sp/Desktop/stayo`, a shared tree holding other people's uncommitted work.
- **`apps/backend/vitest.pure.config.ts`'s `include` is an allowlist.** A test file not listed there silently never runs. Add every new test file in the same commit.
- **Pure tests import no I/O.** Mock `@/lib/db` with `vi.hoisted` + `vi.mock`; copy the shape in `tests/bulk-import-row-validation.test.ts`.
- Run tests: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/<file>.test.ts`
- **Baseline:** `npm run test:pure` fails 3 tests in `tests/agreement-requirement.test.ts` and `tests/whatsapp-guardian-reminders.test.ts`. Pre-existing; never "fix" them.
- `npx tsc --noEmit` has ~640 pre-existing errors — filter to your own files: `npx tsc --noEmit 2>&1 | grep bulk-import`.
- **Indian formats in every owner-facing string.** Dates DD/MM/YYYY with a self-disambiguating example (`05/01/2026 for 5 January 2026`); money via `toLocaleString("en-IN")` (lakh grouping). Never lead with ISO.
- **Money is rupees as `number`.** `rooms.base_rent` is `Int?`. No paise.
- **`prisma` is exported as `any`** — a mistyped delegate compiles and fails only at runtime. Verify names against the generated client.
- Every owner-facing failure goes through the `RowIssue` catalogue (`lib/services/bulk-import/issues.ts`), never a bare string. **Invariant already under test: any row with a blocking `errors` entry carries at least one `BLOCKER` issue** — keep it true for the new room and stamp errors.
- Commit after every task, conventional prefixes.

## Verified facts this plan is built on

Confirmed by reading the code and by a runnable spike, not assumed:

| Fact | Where |
|---|---|
| `exceljs@4.4.0` is already a dependency; a spike wrote a 3-sheet workbook with a protected cover, a cross-sheet dropdown via `workbook.definedNames.add("Rooms!$A$2:$A$200", "RoomList")`, and an inline list dropdown — and `xlsx` read all three sheets back | spike, 2026-09-10 |
| `parseTenantWorkbook` reads `workbook.SheetNames[0]` | `lib/services/bulk-import/workbook-parser.ts` |
| Bulk room creation already exists and is **idempotent** — re-posting a floor updates it | `propertyService.saveRoomsForFloor(floorId, ownerId, rooms)`, used by `POST /api/floors/[id]/rooms` |
| Floors are first-class rows; `propertyService.createFloor(ownerId, hostelId, {name, sort_order})` | `lib/services/property-service.ts:607` |
| `RoomBulkCreateSchema` caps a floor at 40 rooms; `room_no` ≤ 40 chars, `capacity` 1–20 | `src/validators/rooms/index.ts` |
| `rooms` columns: `room_no`, `floor` (Int?), `floor_id`, `capacity`, `room_type`, `base_rent` (Int?), `is_active`, `sort_order` | `prisma/schema.prisma` |
| Execution reads `bulk_import_rows` by primary key and skips rows already `SUCCESS` — resumability exists, unused | `app/api/bulk-import/[batch_id]/confirm/route.ts` |
| `bulk_import_batches` already has `imported_rows`, `failed_rows`, `status`, `import_summary` | `prisma/schema.prisma` |

---

### Task 1: Read the sheet by name, so a cover sheet cannot be parsed as tenants

`parseTenantWorkbook` takes `SheetNames[0]`. The moment the template gains a cover sheet, the parser reads *that* — every row invalid, for a reason no message would explain. This must land before the template changes.

**Files:**
- Modify: `apps/backend/lib/services/bulk-import/workbook-parser.ts`
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-workbook-sheets.test.ts`

**Interfaces:**
- Produces: `parseTenantWorkbook(buffer, filename)` unchanged in signature, now selecting the sheet named `Tenants` (case-insensitive) and falling back to the first sheet that looks like tenant data. Also `TENANTS_SHEET = "Tenants"`, `ROOMS_SHEET = "Rooms"`, `COVER_SHEET = "Read me"` exported for the template builder (Task 2) to use the same names.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/bulk-import-workbook-sheets.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseTenantWorkbook, TENANTS_SHEET } from "@/lib/services/bulk-import/workbook-parser";

function book(sheets: Array<{ name: string; rows: Record<string, unknown>[] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const TENANT_ROWS = [{ Name: "Ravi Kumar", Phone: "9876500001", Email: "r@example.com", Room: "101" }];

describe("choosing the sheet to read", () => {
  it("reads the Tenants sheet even when a cover sheet comes first", () => {
    const buf = book([
      { name: "Read me", rows: [{ Hostel: "Sri Adithya Boys Hostel" }] },
      { name: "Rooms", rows: [{ Room: "101", Capacity: 3 }] },
      { name: TENANTS_SHEET, rows: TENANT_ROWS },
    ]);

    const rows = parseTenantWorkbook(buf, "t.xlsx");
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Ravi Kumar");
  });

  it("matches the sheet name case-insensitively", () => {
    const buf = book([
      { name: "Read me", rows: [{ Hostel: "X" }] },
      { name: "TENANTS", rows: TENANT_ROWS },
    ]);
    expect(parseTenantWorkbook(buf, "t.xlsx")[0].name).toBe("Ravi Kumar");
  });

  it("still reads a plain single-sheet file the owner made themselves", () => {
    const buf = book([{ name: "Sheet1", rows: TENANT_ROWS }]);
    expect(parseTenantWorkbook(buf, "t.xlsx")[0].name).toBe("Ravi Kumar");
  });

  it("does not mistake the Rooms sheet for tenants", () => {
    const buf = book([
      { name: "Rooms", rows: [{ Room: "101", Capacity: 3 }] },
      { name: TENANTS_SHEET, rows: TENANT_ROWS },
    ]);
    expect(parseTenantWorkbook(buf, "t.xlsx")[0].name).toBe("Ravi Kumar");
  });

  it("says which sheet it wanted when there is no tenant data anywhere", () => {
    const buf = book([{ name: "Read me", rows: [{ Hostel: "X" }] }]);
    expect(() => parseTenantWorkbook(buf, "t.xlsx")).toThrow(/Tenants/);
  });
});
```

- [ ] **Step 2: Register the test**

Add to `apps/backend/vitest.pure.config.ts`'s `include`, next to the other bulk-import entries:

```ts
      // A cover sheet must not be parsed as the tenant list.
      'tests/bulk-import-workbook-sheets.test.ts',
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-workbook-sheets.test.ts`
Expected: the cover-sheet cases FAIL — the parser reads "Read me" and reports no data rows, or produces rows of empty strings.

- [ ] **Step 4: Select the sheet by name**

In `workbook-parser.ts`, add the exported names and replace the sheet selection:

```ts
export const COVER_SHEET = "Read me";
export const ROOMS_SHEET = "Rooms";
export const TENANTS_SHEET = "Tenants";

/**
 * Which sheet holds the tenants.
 *
 * The generated template puts a locked cover sheet first, so taking
 * `SheetNames[0]` would parse the instructions as tenant rows — every row
 * invalid, for a reason no error message could explain. Owners also upload
 * their own single-sheet files, so fall back to the first sheet that carries
 * a recognisable tenant header.
 */
function pickTenantSheet(workbook: XLSX.WorkBook): string {
  const byName = workbook.SheetNames.find((n) => n.trim().toLowerCase() === TENANTS_SHEET.toLowerCase());
  if (byName) return byName;

  const skip = new Set([COVER_SHEET.toLowerCase(), ROOMS_SHEET.toLowerCase()]);
  const candidate = workbook.SheetNames.filter((n) => !skip.has(n.trim().toLowerCase()))
    .find((n) => {
      const head = XLSX.utils.sheet_to_json<any>(workbook.Sheets[n], { header: 1, range: 0 })[0] as string[] | undefined;
      if (!head) return false;
      const headers = head.map((h) => String(h || "").trim().toLowerCase());
      return headers.some((h) => ["name", "full name"].includes(h))
        && headers.some((h) => ["phone", "phone number", "mobile"].includes(h));
    });
  if (candidate) return candidate;

  throw new Error(
    `VALIDATION_ERROR: We couldn't find a "${TENANTS_SHEET}" sheet in this file. Download a fresh template and fill in the ${TENANTS_SHEET} sheet.`
  );
}
```

Then in `parseTenantWorkbook`, replace the `const sheetName = workbook.SheetNames[0]` block (and its "empty or has no sheets" check) with:

```ts
    if (!workbook.SheetNames.length) {
      throw new Error("VALIDATION_ERROR: Excel file is empty or has no sheets");
    }
    const sheetName = pickTenantSheet(workbook);
```

- [ ] **Step 5: Run tests, confirm green**

Run the new file plus the existing parser tests:
```bash
cd apps/backend && npx vitest run --config vitest.pure.config.ts \
  tests/bulk-import-workbook-sheets.test.ts tests/bulk-import-parse-errors.test.ts tests/bulk-import-row-validation.test.ts
```
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/lib/services/bulk-import/workbook-parser.ts \
        apps/backend/tests/bulk-import-workbook-sheets.test.ts \
        apps/backend/vitest.pure.config.ts
git commit -m "fix(bulk-import): read the Tenants sheet by name, not the first sheet

The generated template puts a locked cover sheet first. Taking
SheetNames[0] would parse the instructions as tenant rows — every row
invalid, for a reason no message could explain. Falls back to the first
sheet with a tenant-looking header, so an owner's own file still works.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Parse the Rooms sheet

The Rooms sheet defines the rooms a tenant row can reference. Parsing is separate from creating them (Task 4 validates, Task 5 writes).

**Files:**
- Create: `apps/backend/lib/services/bulk-import/rooms-sheet.ts`
- Modify: `apps/backend/lib/services/bulk-import/index.ts` (barrel)
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-rooms-sheet.test.ts`

**Interfaces:**
- Produces:
  - `type RoomImportRow = { room_no: string; floor?: number; capacity?: number; sharing_type?: string; base_rent?: number; raw_values?: Partial<Record<"capacity" | "base_rent" | "floor", string>> }`
  - `parseRoomsSheet(buffer: Buffer): RoomImportRow[]` — returns `[]` when the workbook has no Rooms sheet.
- Consumes: `parseImportNumber` and the sheet-name constants from `workbook-parser.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/bulk-import-rooms-sheet.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseRoomsSheet } from "@/lib/services/bulk-import/rooms-sheet";
import { ROOMS_SHEET, TENANTS_SHEET } from "@/lib/services/bulk-import/workbook-parser";

function book(sheets: Array<{ name: string; rows: Record<string, unknown>[] }>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name);
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseRoomsSheet", () => {
  it("reads the columns the template writes", () => {
    const buf = book([
      { name: ROOMS_SHEET, rows: [
        { "Room No": "101", Floor: 1, Capacity: 3, "Sharing Type": "Triple", "Base Rent": "₹8,500" },
        { "Room No": "G1", Floor: 0, Capacity: 2, "Sharing Type": "Double", "Base Rent": 7000 },
      ] },
      { name: TENANTS_SHEET, rows: [{ Name: "Ravi Kumar", Phone: "9876500001" }] },
    ]);

    const rooms = parseRoomsSheet(buf);
    expect(rooms).toHaveLength(2);
    expect(rooms[0]).toMatchObject({ room_no: "101", floor: 1, capacity: 3, sharing_type: "Triple", base_rent: 8500 });
    expect(rooms[1]).toMatchObject({ room_no: "G1", floor: 0, capacity: 2, base_rent: 7000 });
  });

  it("returns nothing when the workbook has no Rooms sheet", () => {
    const buf = book([{ name: TENANTS_SHEET, rows: [{ Name: "Ravi Kumar" }] }]);
    expect(parseRoomsSheet(buf)).toEqual([]);
  });

  it("skips blank rows left under the pre-filled ones", () => {
    const buf = book([{ name: ROOMS_SHEET, rows: [
      { "Room No": "101", Capacity: 3 },
      { "Room No": "", Capacity: "" },
      { "Room No": "   ", Capacity: null },
    ] }]);
    expect(parseRoomsSheet(buf)).toHaveLength(1);
  });

  it("keeps the owner's text for numbers it cannot read", () => {
    const buf = book([{ name: ROOMS_SHEET, rows: [{ "Room No": "101", Capacity: "two", "Base Rent": "TBD" }] }]);
    const [r] = parseRoomsSheet(buf);
    expect(Number.isNaN(r.capacity)).toBe(true);
    expect(r.raw_values?.capacity).toBe("two");
    expect(r.raw_values?.base_rent).toBe("TBD");
  });
});
```

- [ ] **Step 2: Register the test**

```ts
      'tests/bulk-import-rooms-sheet.test.ts',
```

- [ ] **Step 3: Run it, confirm it fails** — cannot resolve `rooms-sheet`.

- [ ] **Step 4: Implement**

Create `apps/backend/lib/services/bulk-import/rooms-sheet.ts`:

```ts
import * as XLSX from "xlsx";
import { parseImportNumber, ROOMS_SHEET } from "./workbook-parser";

export type RoomImportRow = {
  room_no: string;
  floor?: number;
  capacity?: number;
  sharing_type?: string;
  base_rent?: number;
  /** The owner's own text, so an unreadable cell is quoted back as typed. */
  raw_values?: Partial<Record<"capacity" | "base_rent" | "floor", string>>;
};

function cell(row: Record<string, any>, keys: string[]): string {
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "") {
      return String(row[key]).trim();
    }
  }
  return "";
}

/**
 * The Rooms sheet of a generated template: the rooms this hostel has, plus any
 * the owner added underneath. Blank rows are skipped — the template leaves
 * empty rows below the pre-filled ones for exactly that.
 */
export function parseRoomsSheet(fileBuffer: Buffer): RoomImportRow[] {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: true });
  const name = workbook.SheetNames.find((n) => n.trim().toLowerCase() === ROOMS_SHEET.toLowerCase());
  if (!name) return [];

  const rows = XLSX.utils.sheet_to_json<any>(workbook.Sheets[name], { raw: true, defval: "" });

  return rows
    .map((row) => {
      const capacityText = cell(row, ["Capacity", "capacity", "Beds", "beds"]);
      const rentText = cell(row, ["Base Rent", "base_rent", "Rent", "rent"]);
      const floorText = cell(row, ["Floor", "floor"]);
      return {
        room_no: cell(row, ["Room No", "Room", "room_no", "room", "Room Number"]),
        floor: parseImportNumber(floorText),
        capacity: parseImportNumber(capacityText),
        sharing_type: cell(row, ["Sharing Type", "sharing_type", "Room Type", "room_type", "Type"]) || undefined,
        base_rent: parseImportNumber(rentText),
        raw_values: {
          capacity: capacityText || undefined,
          base_rent: rentText || undefined,
          floor: floorText || undefined,
        },
      };
    })
    .filter((r) => r.room_no !== "");
}
```

- [ ] **Step 5: Export from the barrel** — add `export * from "./rooms-sheet";` to `lib/services/bulk-import/index.ts`.

- [ ] **Step 6: Run tests, confirm green.**

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(bulk-import): parse the workbook's Rooms sheet

Rooms the hostel already has, plus any the owner adds underneath. Blank
rows are skipped, and an unreadable capacity or rent keeps the owner's
own text so it can be quoted back to them.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Validate the rooms, and plan what to create

Deciding what to create is separate from creating it, so the owner can see it before confirming — and so this is testable without a database.

**Files:**
- Create: `apps/backend/lib/services/bulk-import/room-plan.ts`
- Modify: `apps/backend/lib/services/bulk-import/issues.ts` (three room-sheet codes)
- Modify: `apps/backend/lib/services/bulk-import/index.ts`
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-room-plan.test.ts`

**Interfaces:**
- Produces:
  - `type ExistingRoom = { id: string; room_no: string; capacity: number; base_rent: number | null; is_active: boolean; occupied_count: number; reserved_count: number; floor: number | null }`
  - `type RoomPlan = { create: RoomImportRow[]; update: Array<{ id: string; room_no: string; from: { capacity: number; base_rent: number | null }; to: { capacity?: number; base_rent?: number } }>; unchanged: string[]; issues: RowIssue[] }`
  - `buildRoomPlan(sheet: RoomImportRow[], existing: ExistingRoom[]): RoomPlan`
- New issue codes: `ROOM_SHEET_DUPLICATE`, `ROOM_CAPACITY_BELOW_OCCUPANCY`, `ROOM_SHEET_NUMBER_INVALID` — all `BLOCKER`.

- [ ] **Step 1: Add the three issue codes**

In `issues.ts`, add to `ISSUE_CODES`, `SEVERITY` (all `"BLOCKER"`), `COPY` and `GROUP_TITLE`:

```ts
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
    title: `"${c.value ?? ""}" isn't a valid ${c.fieldLabel ?? "number"} for room ${c.roomNo ?? "—"}.`,
    detail: c.hint ?? `Enter digits only.`,
    fix: { kind: "EDIT_FIELD" },
  }),
```

with group titles:

```ts
  ROOM_SHEET_DUPLICATE: (n) => `${n} rooms are listed more than once.`,
  ROOM_CAPACITY_BELOW_OCCUPANCY: (n) => `${n} rooms have fewer beds than the people already living in them.`,
  ROOM_SHEET_NUMBER_INVALID: (n) => `${n} rooms have a number we can't read.`,
```

- [ ] **Step 2: Write the failing test**

Create `apps/backend/tests/bulk-import-room-plan.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRoomPlan, type ExistingRoom } from "@/lib/services/bulk-import/room-plan";
import type { RoomImportRow } from "@/lib/services/bulk-import/rooms-sheet";

function existing(over: Partial<ExistingRoom> = {}): ExistingRoom {
  return {
    id: "r-101", room_no: "101", capacity: 3, base_rent: 8500, is_active: true,
    occupied_count: 0, reserved_count: 0, floor: 1, ...over,
  };
}
function sheet(over: Partial<RoomImportRow> = {}): RoomImportRow {
  return { room_no: "101", capacity: 3, base_rent: 8500, floor: 1, ...over };
}

describe("buildRoomPlan", () => {
  it("creates a room the hostel does not have", () => {
    const plan = buildRoomPlan([sheet({ room_no: "205", capacity: 2, base_rent: 7000, floor: 2 })], []);
    expect(plan.create.map((r) => r.room_no)).toEqual(["205"]);
    expect(plan.update).toEqual([]);
    expect(plan.issues).toEqual([]);
  });

  it("leaves an unchanged room alone", () => {
    const plan = buildRoomPlan([sheet()], [existing()]);
    expect(plan.create).toEqual([]);
    expect(plan.update).toEqual([]);
    expect(plan.unchanged).toEqual(["101"]);
  });

  it("updates a room whose rent or capacity the owner edited", () => {
    const plan = buildRoomPlan([sheet({ base_rent: 9000 })], [existing()]);
    expect(plan.update).toHaveLength(1);
    expect(plan.update[0]).toMatchObject({ id: "r-101", room_no: "101", to: { base_rent: 9000 } });
    expect(plan.update[0].from).toMatchObject({ base_rent: 8500 });
  });

  it("matches an existing room case- and space-insensitively", () => {
    const plan = buildRoomPlan([sheet({ room_no: " 101 " })], [existing()]);
    expect(plan.create).toEqual([]);
    expect(plan.unchanged).toEqual(["101"]);
  });

  it("blocks a room listed twice, naming the other row", () => {
    const plan = buildRoomPlan([sheet(), sheet()], []);
    const issue = plan.issues.find((i) => i.code === "ROOM_SHEET_DUPLICATE");
    expect(issue).toBeDefined();
    expect(issue!.severity).toBe("BLOCKER");
    expect(plan.create).toHaveLength(1);
  });

  it("blocks shrinking a room below the people already in it", () => {
    const plan = buildRoomPlan(
      [sheet({ capacity: 1 })],
      [existing({ occupied_count: 2, reserved_count: 1 })]
    );
    const issue = plan.issues.find((i) => i.code === "ROOM_CAPACITY_BELOW_OCCUPANCY")!;
    expect(issue.detail).toContain("3");
    expect(plan.update).toEqual([]);
  });

  it("blocks an unreadable capacity, quoting what the owner typed", () => {
    const plan = buildRoomPlan(
      [{ room_no: "301", capacity: NaN, raw_values: { capacity: "two" } }],
      []
    );
    const issue = plan.issues.find((i) => i.code === "ROOM_SHEET_NUMBER_INVALID")!;
    expect(issue.title).toContain('"two"');
    expect(issue.title).not.toContain("NaN");
    expect(plan.create).toEqual([]);
  });

  it("requires a capacity for a room it has to create", () => {
    const plan = buildRoomPlan([{ room_no: "301" }], []);
    expect(plan.create).toEqual([]);
    expect(plan.issues.some((i) => i.severity === "BLOCKER")).toBe(true);
  });

  it("does not require capacity for a room that already exists", () => {
    const plan = buildRoomPlan([{ room_no: "101" }], [existing()]);
    expect(plan.issues).toEqual([]);
    expect(plan.unchanged).toEqual(["101"]);
  });
});
```

- [ ] **Step 3: Register the test, run it, confirm it fails** (module missing).

- [ ] **Step 4: Implement `room-plan.ts`**

```ts
import { buildIssue, type RowIssue } from "./issues";
import type { RoomImportRow } from "./rooms-sheet";

export type ExistingRoom = {
  id: string;
  room_no: string;
  capacity: number;
  base_rent: number | null;
  is_active: boolean;
  occupied_count: number;
  reserved_count: number;
  floor: number | null;
};

export type RoomPlan = {
  create: RoomImportRow[];
  update: Array<{
    id: string;
    room_no: string;
    from: { capacity: number; base_rent: number | null };
    to: { capacity?: number; base_rent?: number };
  }>;
  unchanged: string[];
  issues: RowIssue[];
};

/** Rooms sheet rows start at 2, under the header. */
const FIRST_DATA_ROW = 2;

const key = (roomNo: string) => roomNo.trim().toUpperCase();

/**
 * What the Rooms sheet means for this hostel: which rooms to create, which to
 * update, and what the owner must fix first.
 *
 * Pure — it takes the existing rooms as an argument so it can be tested
 * without a database, and so the owner can be shown the plan before anything
 * is written.
 */
export function buildRoomPlan(sheet: RoomImportRow[], existing: ExistingRoom[]): RoomPlan {
  const plan: RoomPlan = { create: [], update: [], unchanged: [], issues: [] };
  const byKey = new Map(existing.map((r) => [key(r.room_no), r]));
  const seen = new Map<string, number>();

  sheet.forEach((row, index) => {
    const rowNumber = index + FIRST_DATA_ROW;
    const k = key(row.room_no);

    if (seen.has(k)) {
      plan.issues.push(buildIssue("ROOM_SHEET_DUPLICATE", rowNumber, {
        roomNo: row.room_no,
        otherRows: [seen.get(k)!],
      }));
      return;
    }
    seen.set(k, rowNumber);

    const numbers: Array<{ field: "capacity" | "base_rent" | "floor"; label: string; value: number | undefined; hint: string }> = [
      { field: "capacity", label: "number of beds", value: row.capacity, hint: "Enter the number of beds as a whole number, like 3." },
      { field: "base_rent", label: "rent", value: row.base_rent, hint: "Enter the rent in rupees using digits, like 8500. A ₹ sign and commas are fine." },
      { field: "floor", label: "floor", value: row.floor, hint: "Enter the floor as a number — 0 for ground floor." },
    ];
    let unreadable = false;
    for (const n of numbers) {
      if (n.value !== undefined && Number.isNaN(n.value)) {
        unreadable = true;
        plan.issues.push(buildIssue("ROOM_SHEET_NUMBER_INVALID", rowNumber, {
          roomNo: row.room_no,
          value: row.raw_values?.[n.field] ?? "",
          fieldLabel: n.label,
          hint: n.hint,
        }));
      }
    }
    if (unreadable) return;

    if (row.capacity !== undefined && (!Number.isInteger(row.capacity) || row.capacity < 1 || row.capacity > 20)) {
      plan.issues.push(buildIssue("ROOM_SHEET_NUMBER_INVALID", rowNumber, {
        roomNo: row.room_no,
        value: row.raw_values?.capacity ?? String(row.capacity),
        fieldLabel: "number of beds",
        hint: "Enter a whole number of beds between 1 and 20.",
      }));
      return;
    }

    const match = byKey.get(k);

    if (!match) {
      if (row.capacity === undefined) {
        plan.issues.push(buildIssue("ROOM_SHEET_NUMBER_INVALID", rowNumber, {
          roomNo: row.room_no,
          value: "",
          fieldLabel: "number of beds",
          hint: "This is a new room, so we need to know how many beds it has.",
        }));
        return;
      }
      plan.create.push(row);
      return;
    }

    const inUse = match.occupied_count + match.reserved_count;
    if (row.capacity !== undefined && row.capacity < inUse) {
      plan.issues.push(buildIssue("ROOM_CAPACITY_BELOW_OCCUPANCY", rowNumber, {
        roomNo: row.room_no,
        capacity: row.capacity,
        occupied: inUse,
      }));
      return;
    }

    const to: { capacity?: number; base_rent?: number } = {};
    if (row.capacity !== undefined && row.capacity !== match.capacity) to.capacity = row.capacity;
    if (row.base_rent !== undefined && row.base_rent !== (match.base_rent ?? undefined)) to.base_rent = row.base_rent;

    if (Object.keys(to).length === 0) {
      plan.unchanged.push(match.room_no);
    } else {
      plan.update.push({
        id: match.id,
        room_no: match.room_no,
        from: { capacity: match.capacity, base_rent: match.base_rent },
        to,
      });
    }
  });

  return plan;
}
```

- [ ] **Step 5: Export from the barrel, run tests, confirm green.**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(bulk-import): plan room creation from the Rooms sheet

Decides what to create, update and leave alone, and what the owner must
fix first — a room listed twice, a room shrunk below the people already
in it, or a bed count we cannot read. Pure, so the plan can be shown
before anything is written.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Build the workbook

The template becomes a per-hostel workbook: a locked cover sheet stamped with the hostel, the hostel's rooms pre-filled, and a Room dropdown on the Tenants sheet bound to them.

**Files:**
- Create: `apps/backend/lib/services/bulk-import/template-builder.ts`
- Rewrite: `apps/backend/app/api/bulk-import/template/route.ts`
- Modify: `apps/backend/lib/services/bulk-import/index.ts`
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-template-builder.test.ts`

**Interfaces:**
- Produces: `buildImportWorkbook(input: TemplateInput): Promise<Buffer>` where
  ```ts
  type TemplateInput = {
    hostel: { id: string; name: string };
    dueDay: number;
    rooms: Array<{ room_no: string; floor: number | null; capacity: number; room_type: string | null; base_rent: number | null; occupied_count: number }>;
    tenantCount: number;
  };
  ```
  and `HOSTEL_ID_CELL = "B2"` (the cover cell Task 5 reads the stamp from).

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/bulk-import-template-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { buildImportWorkbook, HOSTEL_ID_CELL } from "@/lib/services/bulk-import/template-builder";
import { parseRoomsSheet } from "@/lib/services/bulk-import/rooms-sheet";
import { COVER_SHEET, ROOMS_SHEET, TENANTS_SHEET } from "@/lib/services/bulk-import/workbook-parser";

const INPUT = {
  hostel: { id: "11111111-1111-1111-1111-111111111111", name: "Sri Adithya Boys Hostel" },
  dueDay: 5,
  rooms: [
    { room_no: "101", floor: 1, capacity: 3, room_type: "Triple", base_rent: 8500, occupied_count: 1 },
    { room_no: "G1", floor: 0, capacity: 2, room_type: "Double", base_rent: 7000, occupied_count: 0 },
  ],
  tenantCount: 5,
};

async function build() {
  const buf = await buildImportWorkbook(INPUT);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  return { buf, wb };
}

describe("the generated workbook", () => {
  it("has the three sheets, cover first", async () => {
    const { wb } = await build();
    expect(wb.worksheets.map((w) => w.name)).toEqual([COVER_SHEET, ROOMS_SHEET, TENANTS_SHEET]);
  });

  it("stamps the hostel id where upload can read it", async () => {
    const { wb } = await build();
    expect(String(wb.getWorksheet(COVER_SHEET)!.getCell(HOSTEL_ID_CELL).value)).toBe(INPUT.hostel.id);
  });

  it("names the hostel and its due day for the owner", async () => {
    const { wb } = await build();
    const text = wb.getWorksheet(COVER_SHEET)!.getSheetValues().flat().map(String).join(" ");
    expect(text).toContain("Sri Adithya Boys Hostel");
    // Not a bare "5" — that matches the date example too.
    expect(text).toMatch(/due .*\b5\b/i);
  });

  it("asks for dates in Indian format and never leads with ISO", async () => {
    const { wb } = await build();
    const text = wb.getWorksheet(COVER_SHEET)!.getSheetValues().flat().map(String).join(" ");
    expect(text).toContain("DD/MM/YYYY");
    expect(text).toContain("5 January 2026");
    expect(text).not.toContain("YYYY-MM-DD");
  });

  it("pre-fills the hostel's existing rooms", async () => {
    const { buf } = await build();
    const rooms = parseRoomsSheet(buf as Buffer);
    expect(rooms.map((r) => r.room_no)).toEqual(["101", "G1"]);
    expect(rooms[0]).toMatchObject({ capacity: 3, base_rent: 8500, floor: 1 });
  });

  it("leaves blank rows under the pre-filled rooms to add more", async () => {
    const { wb } = await build();
    expect(wb.getWorksheet(ROOMS_SHEET)!.rowCount).toBeGreaterThan(INPUT.rooms.length + 1);
  });

  it("binds the Tenants room column to a dropdown of the rooms", async () => {
    const { wb } = await build();
    const cell = wb.getWorksheet(TENANTS_SHEET)!.getCell("D2");
    expect(cell.dataValidation?.type).toBe("list");
    expect(wb.definedNames.getRanges("RoomList").ranges.length).toBeGreaterThan(0);
  });

  it("offers maintenance type, paid-includes-deposit and payment method as dropdowns", async () => {
    const { wb } = await build();
    const sheet = wb.getWorksheet(TENANTS_SHEET)!;
    const at = (ref: string) => sheet.getCell(ref).dataValidation?.formulae?.[0] ?? "";
    expect(at("I2")).toContain("MONTHLY");
    expect(at("L2")).toContain("YES");
    expect(at("M2")).toContain("CASH");
  });

  it("puts each dropdown on the column its header names", async () => {
    const { wb } = await build();
    const header = (wb.getWorksheet(TENANTS_SHEET)!.getRow(1).values as any[]).map((v) => String(v ?? ""));
    // values is 1-based, so index N is column N.
    expect(header[4]).toBe("Room");
    expect(header[9]).toBe("Maintenance Type");
    expect(header[12]).toBe("Paid Includes Deposit");
    expect(header[13]).toBe("Payment Method");
  });

  it("round-trips through our own parser", async () => {
    const { buf } = await build();
    const wb = XLSX.read(buf as Buffer, { type: "buffer", raw: true });
    expect(wb.SheetNames).toContain(TENANTS_SHEET);
  });

  it("works for a hostel with no rooms yet", async () => {
    const buf = await buildImportWorkbook({ ...INPUT, rooms: [], tenantCount: 0 });
    expect(parseRoomsSheet(buf as Buffer)).toEqual([]);
  });
});
```

- [ ] **Step 2: Register the test, run it, confirm it fails.**

- [ ] **Step 3: Implement `template-builder.ts`**

Write the module so that:

- Sheets are added in the order `COVER_SHEET`, `ROOMS_SHEET`, `TENANTS_SHEET`.
- The cover sheet carries, one per row: `Hostel` + name; `Hostel ID` + id **in `B2`**; `Rent due day` + `dueDay`; a line stating there are already N rooms and M tenants in Stayo for this hostel; and instructions including the exact strings `DD/MM/YYYY` and `05/01/2026 for 5 January 2026`, plus "amounts in ₹" and "paste values, not formulas". It is protected with `await sheet.protect("stayo-import", { selectLockedCells: true, selectUnlockedCells: true })`.
- The Rooms sheet header is exactly `Room No, Floor, Capacity, Sharing Type, Base Rent, Currently Occupied`, existing rooms are written in order and greyed (`font: { color: { argb: "FF888888" } }`), `Currently Occupied` is informational, and at least 30 blank rows follow.
- The Tenants sheet header is exactly, in this order: `Name, Phone, Email, Room, Monthly Rent, Joining Date, Security Deposit, Maintenance Charge, Maintenance Type, Agreement Months, Amount Already Paid, Paid Includes Deposit, Payment Method, Payment Reference, Notes` — so `Room` is column D, `Maintenance Type` is column I, and `Payment Method` is column M, which the test asserts.
- A defined name is registered for the room list and used by the dropdown:
  ```ts
  const lastRoomRow = 1 + Math.max(input.rooms.length, 1) + BLANK_ROOM_ROWS;
  workbook.definedNames.add(`'${ROOMS_SHEET}'!$A$2:$A$${lastRoomRow}`, "RoomList");
  ```
  and for each tenant row `2..DATA_ROWS+1`:
  ```ts
  tenants.getCell(`D${r}`).dataValidation = {
    type: "list", allowBlank: false, formulae: ["RoomList"], showErrorMessage: true,
    errorTitle: "Pick a room",
    error: `Choose a room from the ${ROOMS_SHEET} sheet. If the room isn't there yet, add it on that sheet first.`,
  };
  tenants.getCell(`I${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"MONTHLY,ONE_TIME,NONE"'] };
  tenants.getCell(`L${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"YES,NO"'] };
  tenants.getCell(`M${r}`).dataValidation = { type: "list", allowBlank: true, formulae: ['"CASH,UPI,BANK_TRANSFER,CARD,CHEQUE"'] };
  ```
- Export `export const HOSTEL_ID_CELL = "B2";` and `buildImportWorkbook(input: TemplateInput): Promise<Buffer>` returning `(await workbook.xlsx.writeBuffer()) as Buffer`.
- One worked example row is written in row 2 of the Tenants sheet in a grey font, and the header row is frozen (`tenants.views = [{ state: "frozen", ySplit: 1 }]`).

**Note for the implementer:** the spike proved `definedNames.add(range, name)` takes the **range first**. Getting the argument order wrong produces a workbook Excel opens with a broken dropdown and no error — the test asserting `getRanges("RoomList")` is what catches it.

- [ ] **Step 4: Run tests, confirm green.**

- [ ] **Step 5: Rewrite the template route**

`app/api/bulk-import/template/route.ts` becomes: owner/admin gate as now; read `hostel_id` from `req.nextUrl.searchParams`; 400 with a clear message when missing; load the hostel scoped by `owner_id: session.sub` (404 otherwise); read its rooms with occupancy using the same `_count` shape as `validation-service.getHostelRooms`; read `resolvePreferences(hostel).due_day` (default 5); count the hostel's tenants; call `buildImportWorkbook`; respond with the buffer and:

```ts
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${slug}-tenant-import.xlsx"`,
    },
```

where `slug` is the hostel name lowercased, non-alphanumerics collapsed to `-`.

- [ ] **Step 6: Verify the route by hand**

```bash
cd apps/backend && npx tsc --noEmit 2>&1 | grep bulk-import || echo "clean"
```
Then commit.

- [ ] **Step 7: Commit**

```bash
git commit -m "feat(bulk-import): generate a per-hostel Excel workbook

Replaces the static 8-column CSV. A locked cover sheet stamped with the
hostel and its due day, the hostel's rooms pre-filled with blank rows to
add more, and a Room dropdown on the Tenants sheet bound to them — so a
mistyped room number, the single largest error class, cannot be entered.
Maintenance type, paid-includes-deposit and payment method are dropdowns
too. Dates are asked for as DD/MM/YYYY with a disambiguating example.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Refuse a workbook built for another hostel

Room numbers repeat across hostels, so importing Sri Adithya's file into Sri Balaji would put tenants in the wrong rooms with no error at all. The cover stamp makes that impossible.

**Files:**
- Create: `apps/backend/lib/services/bulk-import/hostel-stamp.ts`
- Modify: `apps/backend/app/api/bulk-import/upload/route.ts`
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-hostel-stamp.test.ts`

**Interfaces:**
- Produces: `readHostelStamp(buffer: Buffer): string | null` — the hostel id from the cover sheet, or `null` for a workbook without one (an owner's own file).

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { readHostelStamp } from "@/lib/services/bulk-import/hostel-stamp";
import { buildImportWorkbook } from "@/lib/services/bulk-import/template-builder";

const HOSTEL = { id: "11111111-1111-1111-1111-111111111111", name: "Sri Adithya Boys Hostel" };

describe("readHostelStamp", () => {
  it("reads the id a generated workbook was stamped with", async () => {
    const buf = await buildImportWorkbook({ hostel: HOSTEL, dueDay: 5, rooms: [], tenantCount: 0 });
    expect(readHostelStamp(buf as Buffer)).toBe(HOSTEL.id);
  });

  it("returns null for a file with no cover sheet", async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([{ Name: "Ravi" }]), "Tenants");
    expect(readHostelStamp(XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer)).toBeNull();
  });
});
```

- [ ] **Step 2: Register, run, confirm failure. Then implement**

```ts
import * as XLSX from "xlsx";
import { COVER_SHEET } from "./workbook-parser";
import { HOSTEL_ID_CELL } from "./template-builder";

/**
 * The hostel a generated workbook was built for.
 *
 * Room numbers repeat across hostels — every hostel has a 101 — so importing
 * one hostel's workbook into another would place tenants in the wrong rooms
 * and report nothing wrong. Returns null for a file the owner made
 * themselves, which has no cover sheet and is allowed.
 */
export function readHostelStamp(fileBuffer: Buffer): string | null {
  const workbook = XLSX.read(fileBuffer, { type: "buffer", raw: true });
  const name = workbook.SheetNames.find((n) => n.trim().toLowerCase() === COVER_SHEET.toLowerCase());
  if (!name) return null;
  const cell = workbook.Sheets[name][HOSTEL_ID_CELL];
  const value = String(cell?.v ?? "").trim();
  return value || null;
}
```

- [ ] **Step 3: Enforce it in the upload route**

After the hostel ownership check and before parsing, in `app/api/bulk-import/upload/route.ts`:

```ts
    const stamp = readHostelStamp(fileBuffer);
    if (stamp && stamp !== hostelId) {
      const stamped = await prisma.hostels.findFirst({
        where: { id: stamp, owner_id: session.sub },
        select: { name: true },
      });
      return apiError(
        `This file was made for ${stamped?.name ?? "a different hostel"}. Room numbers repeat across hostels, so importing it here could put tenants in the wrong rooms. Switch to that hostel, or download a fresh template for ${hostel.name}.`,
        "VALIDATION_ERROR",
        400
      );
    }
```

- [ ] **Step 4: Run the bulk-import tests, confirm green, commit**

```bash
git commit -m "feat(bulk-import): refuse a workbook built for another hostel

Every hostel has a room 101, so importing the wrong hostel's file would
place tenants in the wrong rooms and report nothing wrong. The generated
workbook carries the hostel id on its locked cover sheet; upload refuses
a mismatch by name. A file the owner made themselves has no stamp and is
still accepted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Create the rooms on confirm, before the tenants

**Files:**
- Create: `apps/backend/src/services/bulk-import/room-import-service.ts`
- Modify: `apps/backend/app/api/bulk-import/upload/route.ts` (persist the room plan on the batch)
- Modify: `apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts`
- Test: `apps/backend/tests/bulk-import-room-execution.test.ts`

**Interfaces:**
- Produces: `applyRoomPlan(plan: RoomPlan, ownerId: string, hostelId: string): Promise<{ created: number; updated: number; errors: Array<{ room_no: string; error: string }> }>`
- Consumes: `propertyService.createFloor`, `propertyService.saveRoomsForFloor`, `buildRoomPlan`.

- [ ] **Step 1: Write the failing test** — mock `@/lib/db` and `@/lib/services/property-service`, and assert:
  - rooms are grouped by floor and each floor's rooms are saved in **one** `saveRoomsForFloor` call, not one call per room;
  - a floor named for the sheet's `Floor` value is created only when the hostel has no floor with that name, and the existing floor's id is reused otherwise;
  - rooms with no `Floor` value go to a floor named `Ground floor` when none exists;
  - `saveRoomsForFloor` is called with at most 40 rooms per call (`RoomBulkCreateSchema`'s cap), splitting a larger floor across calls;
  - a failure on one floor is recorded in `errors` and does not stop the others.

```ts
it("saves a floor's rooms in one call, not one call per room", async () => {
  mockProperty.saveRoomsForFloor.mockResolvedValue([]);
  mockProperty.createFloor.mockResolvedValue({ id: "f-1" });
  mockPrisma.floors.findMany.mockResolvedValue([]);

  await applyRoomPlan(
    { create: [
        { room_no: "101", floor: 1, capacity: 3, base_rent: 8500 },
        { room_no: "102", floor: 1, capacity: 2, base_rent: 7000 },
      ], update: [], unchanged: [], issues: [] },
    "owner-1",
    "hostel-1"
  );

  expect(mockProperty.saveRoomsForFloor).toHaveBeenCalledTimes(1);
  const [, , rooms] = mockProperty.saveRoomsForFloor.mock.calls[0];
  expect(rooms).toHaveLength(2);
});
```

- [ ] **Step 2: Implement `applyRoomPlan`**, reusing `propertyService` — never `prisma.rooms.create` directly, so sort order, capacity bookkeeping and the event emit stay correct. Chunk each floor's rooms into batches of 40.

- [ ] **Step 3: Persist the room plan** in `upload`/`revalidate`, on `bulk_import_batches.validation_errors.room_plan`, so confirm executes the plan the owner saw rather than re-deriving it from a file that is no longer held.

- [ ] **Step 4: Call it from confirm, before the tenant loop**, and record `rooms_created` / `rooms_updated` in `import_summary`. Room failures must not abort the tenant import; they are reported alongside.

- [ ] **Step 5: Run tests, confirm green, commit.**

---

### Task 7: Chunked, resumable confirm with real progress

Today's confirm runs every row in one request under `maxDuration = 60`, with each row a transaction that may take seconds plus a notification dispatch. It cannot finish a large batch. The resumability already exists — rows already `SUCCESS` are skipped — it is simply never used.

**Files:**
- Modify: `apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts`
- Test: `apps/backend/tests/bulk-import-chunked-confirm.test.ts`

**Interfaces:**
- `POST …/confirm` accepts `{ confirm_historical_join_dates?: boolean, chunk_size?: number }` and returns
  ```ts
  {
    batch_id, hostel,
    progress: { total: number; processed: number; remaining: number; succeeded: number; failed: number; stage: "ROOMS" | "TENANTS" | "DONE" },
    rooms: { created: number; updated: number },
    result: { /* unchanged shape */ }
  }
  ```
  The client re-POSTs while `progress.remaining > 0`.

- [ ] **Step 1: Write the failing test**

Assert, with 60 pending rows mocked and `chunk_size: 25`:
- one POST calls `createInvitation` exactly 25 times and returns `processed: 25, remaining: 35`;
- a second POST processes the next 25 and skips the first 25 (they are `SUCCESS`), calling `createInvitation` 25 more times, never re-invoking it for a completed row;
- a third POST finishes and returns `remaining: 0, stage: "DONE"`, and only then does the batch become `COMPLETED`;
- with rows remaining, the batch status stays `PROCESSING` — it must not be marked `COMPLETED` or `PARTIAL` mid-run;
- rooms are created on the **first** chunk only.

- [ ] **Step 2: Implement**

- Read only pending rows for this chunk: `findMany({ where: { batch_id, execution_status: { in: ["PENDING", "FAILED"] } }, orderBy: { row_number: "asc" }, take: chunkSize })`.
- Count totals with `count()` rather than loading every row.
- Set `status: "PROCESSING"` at the start; compute the terminal status (`COMPLETED` / `PARTIAL` / `FAILED`) only when `remaining === 0`.
- Clamp `chunk_size` to 1–25, default 25.
- Raise `export const maxDuration = 300;` (Vercel's current default ceiling) while keeping chunks small — the chunk is the real protection, the duration is headroom.
- A `FAILED` row is retried on a later chunk; guard against an endless loop by tracking `attempt_count`. **Add the column in this task's migration if it does not exist** — or, to avoid a schema change, stop retrying a row whose `error_message` is already set and whose `executed_at` is within this run. Prefer the latter; a schema change here is not worth it.

- [ ] **Step 3: Run tests, confirm green, commit.**

---

### Task 8: Input hardening, and stop leaking PII on every edit

**Files:**
- Modify: `apps/backend/lib/services/bulk-import/workbook-parser.ts`
- Modify: `apps/backend/app/api/bulk-import/revalidate/route.ts`
- Test: `apps/backend/tests/bulk-import-hardening.test.ts`

- [ ] **Step 1: Write failing tests** for each guard:
  - a workbook with 200 sheets is refused with an owner-readable message (a zip-bomb shape);
  - a sheet with 500 columns is refused;
  - a cell of 100,000 characters is refused;
  - the existing 150-row and formula guards still hold.

- [ ] **Step 2: Implement the guards** in `parseTenantWorkbook`, each throwing `VALIDATION_ERROR:` with a message naming the real limit and what to do.

- [ ] **Step 3: Fix the revalidate PII leak.**

`revalidate` currently creates a **new** batch on every edit, orphaning the previous one with a full copy of tenant names, phones and emails in `validation_errors`. Change it to update the batch in place: take `batch_id` in the body, verify `owner_id: session.sub`, replace `validation_errors` and delete-then-recreate that batch's `bulk_import_rows` inside one transaction. Keep creating a new batch only when no `batch_id` is supplied.

- [ ] **Step 4: Write the test** asserting a revalidate with a `batch_id` creates no second batch and leaves exactly one row set.

- [ ] **Step 5: Run tests, confirm green, commit.**

---

### Task 9: Documentation

- [ ] **Step 1: `docs/obsidian/APIs.md`** — `GET /api/bulk-import/template` now requires `hostel_id` and returns an `.xlsx` workbook; document the three sheets, the cover stamp and the dropdowns; document the chunked `POST …/confirm` contract and its `progress` payload; note the stamp-mismatch 400 and that `revalidate` now updates in place.
- [ ] **Step 2: `docs/obsidian/Business-Rules.md`** — the Rooms sheet is authoritative for room creation and updates; a room is never shrunk below its current occupancy; rooms are created before tenants and a room failure does not abort the tenant import.
- [ ] **Step 3: `docs/obsidian/Features.md`** — bulk import gains a real template; still no `apps/frontend` screen until Plan 3.
- [ ] **Step 4: `docs/obsidian/Changelog.md`** and **`Bugs.md`** (the sheet-order defect from Task 1, if it had shipped).
- [ ] **Step 5: Add an ADR to `docs/obsidian/Decisions.md`** for the workbook contract — one workbook per hostel, stamped; the Rooms sheet as the room source of truth; chunked confirm as the execution model. **Check the next free ADR number against `git show origin/main:docs/obsidian/Decisions.md | grep -oE '^### ADR-[0-9]+'`, not the local file** — numbers have collided across concurrent branches before.
- [ ] **Step 6: Commit.**

---

### Task 10: Verify the whole plan

- [ ] **Step 1:** `npm run test:pure` — compare against the 3-failure baseline.
- [ ] **Step 2:** `npm run check:invariants`, `check:financial-safety`, `check:activation-invariants` — compare against the known pre-existing failures; none of the flagged files should be ones this plan touches.
- [ ] **Step 3:** `npx tsc --noEmit 2>&1 | grep bulk-import` — expect clean.
- [ ] **Step 4: Generate a real workbook and open it.** Write it to a scratch file with a small script, then confirm by reading it back that the dropdown, the pre-filled rooms and the stamp survive a round trip through `xlsx`. This is the one thing the unit tests cannot fully prove — Excel's own rendering.
- [ ] **Step 5:** `/code-review high` over the branch. Report findings, then fix them.

---

## What this plan does not do

- No frontend. The stage stepper, review queue and progress bar are Plan 3.
- No deferred invitation dispatch (`QUEUED`) — Plan 3.
- Does not honour "Paid Includes Deposit = No", and does not add per-row maintenance. Both are recorded as open in `docs/obsidian/Business-Rules.md`; **decide them before Plan 3 builds UI that implies they work.**
- Does not resolve the duplicate-scope question (a former tenant currently can never be re-imported) — that is a product decision awaiting the user.
