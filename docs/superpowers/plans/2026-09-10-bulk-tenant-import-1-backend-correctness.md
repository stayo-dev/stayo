# Bulk Tenant Import — Plan 1: Backend Correctness and the Issue Model

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the eight correctness and error-reporting defects in the already-deployed bulk-import code, then replace its free-text errors with a structured, owner-readable issue model and split the 536-line validation service into focused modules.

**Architecture:** Phases A and B of the spec. No new user-facing surface — this plan makes the existing, unreachable backend correct and gives it the vocabulary (`RowIssue`) that the workbook, review queue and execution plans all build on. Every task is test-first against `vitest.pure.config.ts`, which reaches no database.

**Tech Stack:** TypeScript, Next.js 14 App Router, Prisma, Vitest (pure config), `xlsx` (parsing).

**Spec:** `docs/superpowers/specs/2026-09-10-bulk-tenant-import-design.md`

## Global Constraints

- **Worktree:** all work happens in `/home/sp/Desktop/stayo-bulk-import` on branch `feat/bulk-tenant-import`. Never `git checkout` in `/home/sp/Desktop/stayo` — it is a shared tree with 68 uncommitted files belonging to other work.
- **`vitest.pure.config.ts` `include` is an allowlist.** Every new test file MUST be added to that array in the same commit, or it silently never runs. Verify by checking the file count in the run output goes up.
- **Pure tests only.** Files in the pure config must import no I/O. Mock `@/lib/db` with `vi.hoisted` + `vi.mock` (see `tests/activate-documents-route.test.ts` for the established shape).
- **Run tests with:** `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/<file>.test.ts`
- **`npx tsc --noEmit` is not a usable signal in `apps/backend`** — hundreds of pre-existing errors. Filter to your own files and compare against a `git stash` baseline.
- **`prisma` is exported as `any`** (`lib/db.ts`). Accessor typos compile and fail at runtime. The model is `prisma.profile` (singular); `@@map("profiles")` names the table, not the delegate.
- **Money:** amounts in this subsystem are rupees as `number` (the existing `money()` helper rounds to 2dp). Do not convert to paise — the surrounding onboarding services use rupees.
- **Do not touch** `apps/frontend`, the workbook/template builder, chunked execution, or deferred dispatch. Those are Plans 2 and 3.
- **Commit after every task.** Conventional-commit prefixes (`fix:`, `refactor:`, `test:`).

---

### Task 1: A 200-row file is reported as corrupt

The row-limit error message has no `VALIDATION_ERROR` prefix, but its own catch block tests for that substring to decide whether to re-throw. So it is swallowed and rewritten as *"Failed to parse file. Please ensure it's a valid Excel or CSV file."* An owner whose file is perfectly valid is told it is broken.

**Files:**
- Modify: `apps/backend/lib/services/bulk-import-validation-service.ts` (the `rawData.length > MAX_IMPORT_ROWS` throw inside `parseFile`)
- Modify: `apps/backend/vitest.pure.config.ts` (add the new test to `include`)
- Test: `apps/backend/tests/bulk-import-parse-errors.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces: no new exports. Establishes `tests/bulk-import-parse-errors.test.ts`, which Tasks 2 and 4 extend.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/bulk-import-parse-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { bulkImportValidationService } from "@/lib/services/bulk-import-validation-service";

function workbookBuffer(rows: Record<string, unknown>[]): Buffer {
  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Tenants");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

function tenantRows(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    Name: `Tenant ${i + 1}`,
    Phone: `98765${String(i).padStart(5, "0")}`,
    Email: `tenant${i + 1}@example.com`,
    Room: "101",
  }));
}

describe("parseFile — too many rows", () => {
  it("tells the owner the row count, not that the file is corrupt", async () => {
    const buffer = workbookBuffer(tenantRows(151));

    await expect(
      bulkImportValidationService.parseFile(buffer, "big.xlsx")
    ).rejects.toThrow(/151 rows/);
  });

  it("does not claim a valid file failed to parse", async () => {
    const buffer = workbookBuffer(tenantRows(151));

    await expect(
      bulkImportValidationService.parseFile(buffer, "big.xlsx")
    ).rejects.not.toThrow(/valid Excel or CSV/);
  });

  it("accepts a file at exactly the limit", async () => {
    const buffer = workbookBuffer(tenantRows(150));

    const rows = await bulkImportValidationService.parseFile(buffer, "ok.xlsx");
    expect(rows).toHaveLength(150);
  });
});
```

- [ ] **Step 2: Add the test file to the pure config**

In `apps/backend/vitest.pure.config.ts`, add to the `include` array (near the other bulk/import entries, or at the end before `'tests/build-without-env.test.ts'`):

```ts
      // Bulk import: parse-stage failures must name the real cause. The
      // row-limit message used to be swallowed by parseFile's own catch.
      'tests/bulk-import-parse-errors.test.ts',
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-parse-errors.test.ts`

Expected: the first two tests FAIL — the thrown message is "Failed to parse file. Please ensure it's a valid Excel or CSV file." The third test passes.

- [ ] **Step 4: Fix the throw**

In `bulk-import-validation-service.ts`, add the prefix the catch block looks for:

```ts
      if (rawData.length > MAX_IMPORT_ROWS) {
        throw new Error(
          `VALIDATION_ERROR: This file has ${rawData.length} rows. The most we can import at once is ${MAX_IMPORT_ROWS}. Split it into smaller files and import them one after another.`
        );
      }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-parse-errors.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import-validation-service.ts \
        apps/backend/tests/bulk-import-parse-errors.test.ts \
        apps/backend/vitest.pure.config.ts
git commit -m "fix(bulk-import): report the real row-limit error, not 'file is corrupt'

parseFile's catch block re-throws only messages containing
VALIDATION_ERROR. The MAX_IMPORT_ROWS message lacked the prefix, so an
owner with 151 valid rows was told their file failed to parse."
```

---

### Task 2: Valid .xlsx uploads rejected by MIME type

`upload/route.ts` allowlists three MIME types. Browsers and OSes frequently report `.xlsx` as `application/octet-stream` (and `.csv` as `text/plain`), so genuine files are refused with "Invalid file type".

**Files:**
- Create: `apps/backend/lib/services/bulk-import/file-type.ts`
- Modify: `apps/backend/app/api/bulk-import/upload/route.ts` (the `allowedTypes` block)
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-file-type.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `isAcceptedImportFile(name: string, mimeType: string): boolean` from `@/lib/services/bulk-import/file-type`. Task 10 moves the rest of the service beside it in the same directory.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/bulk-import-file-type.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isAcceptedImportFile } from "@/lib/services/bulk-import/file-type";

describe("isAcceptedImportFile", () => {
  it("accepts a real xlsx MIME type", () => {
    expect(
      isAcceptedImportFile(
        "tenants.xlsx",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe(true);
  });

  it("accepts an xlsx the browser reported as octet-stream", () => {
    expect(isAcceptedImportFile("tenants.xlsx", "application/octet-stream")).toBe(true);
  });

  it("accepts a csv the OS reported as text/plain", () => {
    expect(isAcceptedImportFile("tenants.csv", "text/plain")).toBe(true);
  });

  it("accepts an empty MIME type when the extension is right", () => {
    expect(isAcceptedImportFile("tenants.xls", "")).toBe(true);
  });

  it("rejects a PDF whatever it claims to be", () => {
    expect(isAcceptedImportFile("tenants.pdf", "application/pdf")).toBe(false);
    expect(
      isAcceptedImportFile(
        "tenants.pdf",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      )
    ).toBe(false);
  });

  it("rejects a file with no usable extension", () => {
    expect(isAcceptedImportFile("tenants", "application/octet-stream")).toBe(false);
  });
});
```

- [ ] **Step 2: Add the test file to the pure config**

```ts
      'tests/bulk-import-file-type.test.ts',
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-file-type.test.ts`

Expected: FAIL — cannot resolve `@/lib/services/bulk-import/file-type`.

- [ ] **Step 4: Write the implementation**

Create `apps/backend/lib/services/bulk-import/file-type.ts`:

```ts
/**
 * Whether an uploaded file is plausibly a spreadsheet we can parse.
 *
 * The extension is authoritative, not the MIME type: browsers and operating
 * systems routinely report `.xlsx` as `application/octet-stream` and `.csv` as
 * `text/plain`, so a MIME-only allowlist refuses genuine files. Content is
 * validated for real by `parseFile`, which fails loudly on anything that is not
 * a workbook — this check only stops obviously wrong uploads early.
 */
const ACCEPTED_EXTENSIONS = [".xlsx", ".xls", ".csv"] as const;

export function isAcceptedImportFile(name: string, _mimeType: string): boolean {
  const lowered = String(name || "").trim().toLowerCase();
  return ACCEPTED_EXTENSIONS.some((extension) => lowered.endsWith(extension));
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-file-type.test.ts`

Expected: PASS, 6 tests.

- [ ] **Step 6: Use it in the route**

In `apps/backend/app/api/bulk-import/upload/route.ts`, add the import beside the others:

```ts
import { isAcceptedImportFile } from "@/lib/services/bulk-import/file-type";
```

Replace the whole `allowedTypes` array and its `if` block with:

```ts
    if (!isAcceptedImportFile(file.name, file.type)) {
      return apiError(
        "That file type can't be imported. Upload the Excel workbook you downloaded (.xlsx), or a .csv.",
        "VALIDATION_ERROR",
        400
      );
    }
```

- [ ] **Step 7: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import/file-type.ts \
        apps/backend/app/api/bulk-import/upload/route.ts \
        apps/backend/tests/bulk-import-file-type.test.ts \
        apps/backend/vitest.pure.config.ts
git commit -m "fix(bulk-import): accept xlsx uploads reported as octet-stream

The MIME allowlist refused genuine .xlsx and .csv files, because
browsers frequently report them as application/octet-stream and
text/plain. Decide on the extension; parseFile still validates content."
```

---

### Task 3: Duplicate and invalid rows consume room capacity

`validateRows` increments `roomAssignmentsSeen` for any row that passes the capacity check, including rows already marked `isDuplicate` and rows carrying blocking errors — none of which will ever be imported. Three duplicate rows for a 3-bed room therefore make a legitimate fourth row fail with "capacity would be exceeded".

`isDuplicate` is already known at this point: the phone and email checks run above the room block.

**Files:**
- Modify: `apps/backend/lib/services/bulk-import-validation-service.ts` (the room capacity block in `validateRows`)
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-capacity-accounting.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: no new exports.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/bulk-import-capacity-accounting.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => {
  const prisma: any = {
    profile: { findMany: vi.fn() },
    tenant_invitations: { findMany: vi.fn() },
    rooms: { findMany: vi.fn() },
  };
  return { mockPrisma: prisma };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/services/hostel-billing-preferences-service", () => ({
  hostelBillingPreferencesService: {
    getBillingDefaults: vi.fn().mockResolvedValue({
      maintenance_type: "NONE",
      maintenance_charge: 0,
      security_deposit: 0,
      advance_deposit: 0,
    }),
  },
}));

import { bulkImportValidationService } from "@/lib/services/bulk-import-validation-service";

const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
const OWNER_ID = "22222222-2222-2222-2222-222222222222";

function row(name: string, phone: string, email: string) {
  return {
    name,
    phone,
    email,
    room_no: "101",
    joining_date: "2026-09-01",
  } as any;
}

beforeEach(() => {
  mockPrisma.profile.findMany.mockResolvedValue([]);
  mockPrisma.tenant_invitations.findMany.mockResolvedValue([]);
  mockPrisma.rooms.findMany.mockResolvedValue([
    {
      id: "33333333-3333-3333-3333-333333333333",
      room_no: "101",
      is_active: true,
      capacity: 3,
      base_rent: 8500,
      _count: { room_allocations: 0, tenant_invitation_reservations: 0 },
    },
  ]);
});

describe("room capacity accounting", () => {
  it("does not let duplicate rows consume beds", async () => {
    // Rows 2 and 3 repeat row 1's phone, so only one of them can ever import.
    // Row 4 is a distinct person and must still fit in the 3-bed room.
    const result = await bulkImportValidationService.validateRows(
      [
        row("Ravi", "9876500001", "ravi@example.com"),
        row("Ravi Again", "9876500001", "ravi.dup@example.com"),
        row("Ravi Third", "9876500001", "ravi.dup2@example.com"),
        row("Priya", "9876500002", "priya@example.com"),
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    const priya = [...result.validRows, ...result.invalidRows].find(
      (r) => r.data.name === "Priya"
    );
    expect(priya).toBeDefined();
    expect(priya!.errors).toEqual([]);
    expect(result.validRows.map((r) => r.data.name)).toContain("Priya");
  });

  it("still rejects a genuine over-capacity row", async () => {
    const result = await bulkImportValidationService.validateRows(
      [
        row("A", "9876500001", "a@example.com"),
        row("B", "9876500002", "b@example.com"),
        row("C", "9876500003", "c@example.com"),
        row("D", "9876500004", "d@example.com"),
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.validRows).toHaveLength(3);
    expect(result.invalidRows).toHaveLength(1);
    expect(result.invalidRows[0].data.name).toBe("D");
    expect(result.invalidRows[0].errors[0].message).toMatch(/capacity/i);
  });
});
```

- [ ] **Step 2: Add the test file to the pure config**

```ts
      'tests/bulk-import-capacity-accounting.test.ts',
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-capacity-accounting.test.ts`

Expected: the first test FAILS — Priya is rejected for capacity, because the three duplicate Ravi rows consumed all 3 beds. The second test passes.

- [ ] **Step 4: Only count rows that can actually import**

In `validateRows`, the room block currently reads:

```ts
          const currentOccupancy = room.occupied_count + room.reserved_count;
          const assignmentsInFile = roomAssignmentsSeen.get(room.id) || 0;
          if (currentOccupancy + assignmentsInFile + 1 > room.capacity) {
```

Change it so a duplicate or already-erroring row neither claims a bed nor reports a capacity error — it is not going to be imported, so it is not competing for one:

```ts
          const currentOccupancy = room.occupied_count + room.reserved_count;
          const assignmentsInFile = roomAssignmentsSeen.get(room.id) || 0;
          // A duplicate row, or one that already failed validation, will never
          // be imported — so it must neither claim a bed nor be told the room
          // is full. Counting them made a legitimate later row fail with a
          // capacity error it did not cause.
          const rowCanImport = !isDuplicate && errors.length === 0;
          if (rowCanImport) {
            if (currentOccupancy + assignmentsInFile + 1 > room.capacity) {
              errors.push({
                row: rowNumber,
                field: "room_no",
                message: `Room ${row.room_no} capacity would be exceeded (${currentOccupancy + assignmentsInFile + 1}/${room.capacity})`,
                value: row.room_no,
              });
            } else {
              roomAssignmentsSeen.set(room.id, assignmentsInFile + 1);
            }
          }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-capacity-accounting.test.ts`

Expected: PASS, 2 tests.

- [ ] **Step 6: Run the whole pure suite for regressions**

Run: `cd apps/backend && npm run test:pure`

Expected: no new failures versus the baseline. Note `tests/agreement-requirement.test.ts` has two known pre-existing failures — confirm the count is unchanged, do not fix them here.

- [ ] **Step 7: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import-validation-service.ts \
        apps/backend/tests/bulk-import-capacity-accounting.test.ts \
        apps/backend/vitest.pure.config.ts
git commit -m "fix(bulk-import): duplicate and invalid rows no longer consume beds

roomAssignmentsSeen counted every row that passed the capacity check,
including duplicates and rows with blocking errors that can never be
imported. Three duplicate rows for a 3-bed room falsely rejected a
legitimate fourth."
```

---

### Task 4: parseDate silently accepts junk

`parseDate`'s final fallback is `new Date(trimmed)`, which turns `"May"` into a real date (the current year's May 1st in most runtimes) rather than rejecting it. A mistyped date becomes a wrong joining date, which becomes wrong back-rent, which becomes wrong money.

**Files:**
- Modify: `apps/backend/lib/services/bulk-import-validation-service.ts` (`parseDate`)
- Test: `apps/backend/tests/bulk-import-parse-errors.test.ts` (extend the file from Task 1)

**Interfaces:**
- Consumes: `tests/bulk-import-parse-errors.test.ts` from Task 1
- Produces: no new exports. `parseDate` stays private; it is exercised through `validateRows`.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/bulk-import-parse-errors.test.ts`. Add these imports and mocks at the top of the file, above the existing `describe`:

```ts
import { vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    profile: { findMany: vi.fn() },
    tenant_invitations: { findMany: vi.fn() },
    rooms: { findMany: vi.fn() },
  } as any,
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/services/hostel-billing-preferences-service", () => ({
  hostelBillingPreferencesService: {
    getBillingDefaults: vi.fn().mockResolvedValue({
      maintenance_type: "NONE",
      maintenance_charge: 0,
      security_deposit: 0,
      advance_deposit: 0,
    }),
  },
}));
```

Then append this block:

```ts
describe("joining dates that cannot be trusted", () => {
  const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
  const OWNER_ID = "22222222-2222-2222-2222-222222222222";

  beforeEach(() => {
    mockPrisma.profile.findMany.mockResolvedValue([]);
    mockPrisma.tenant_invitations.findMany.mockResolvedValue([]);
    mockPrisma.rooms.findMany.mockResolvedValue([
      {
        id: "33333333-3333-3333-3333-333333333333",
        room_no: "101",
        is_active: true,
        capacity: 5,
        base_rent: 8500,
        _count: { room_allocations: 0, tenant_invitation_reservations: 0 },
      },
    ]);
  });

  async function validateJoiningDate(joining_date: string) {
    const result = await bulkImportValidationService.validateRows(
      [
        {
          name: "Ravi",
          phone: "9876500001",
          email: "ravi@example.com",
          room_no: "101",
          joining_date,
        } as any,
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );
    return [...result.validRows, ...result.invalidRows][0];
  }

  it.each(["May", "next monday", "soon", "12", "abcd"])(
    "rejects %s rather than inventing a date",
    async (value) => {
      const row = await validateJoiningDate(value);
      expect(row.errors.some((e) => e.field === "joining_date")).toBe(true);
    }
  );

  it.each(["2026-01-05", "05/01/2026", "05-01-2026"])(
    "still accepts %s",
    async (value) => {
      const row = await validateJoiningDate(value);
      expect(row.errors.filter((e) => e.field === "joining_date")).toEqual([]);
    }
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-parse-errors.test.ts`

Expected: the `"May"`, `"next monday"` and `"abcd"` cases FAIL (no error raised — a date was invented). `"12"` may pass already via the Excel-serial branch; confirm which.

- [ ] **Step 3: Remove the permissive fallback**

In `parseDate`, delete the trailing fallback block:

```ts
    // Fallback using standard JS parsing if it looks like a date string
    const fallbackDate = new Date(trimmed);
    if (!isNaN(fallbackDate.getTime())) {
      return fallbackDate;
    }

    return null;
```

Replace it with:

```ts
    // No permissive `new Date(trimmed)` fallback. It accepts "May", "next
    // monday" and other junk, inventing a joining date — which becomes wrong
    // back-rent, which becomes wrong money. Only the explicit formats above
    // and the Excel serial branch are trusted.
    return null;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-parse-errors.test.ts`

Expected: PASS, all cases.

- [ ] **Step 5: Run the whole pure suite for regressions**

Run: `cd apps/backend && npm run test:pure`

Expected: no new failures versus baseline.

- [ ] **Step 6: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import-validation-service.ts \
        apps/backend/tests/bulk-import-parse-errors.test.ts
git commit -m "fix(bulk-import): reject unparseable joining dates instead of inventing one

parseDate fell back to new Date(trimmed), which turns \"May\" into a real
date. A mistyped joining date becomes wrong back-rent and wrong money,
so only the explicit formats and the Excel serial are trusted now."
```

---

### Task 5: Maintenance and already-paid amounts never reach the tenant

This is the defect that breaks the owner's books, and it is two drops that compound:

1. `sanitizeImportRowForStorage` (in both `upload/route.ts` and `revalidate/route.ts`) rebuilds each row from an explicit field list that omits `maintenance_charge`, `maintenance_type`, `billing_start_mode` and `rent_source`. The validated values are computed, shown in the preview, and then thrown away before being persisted.
2. `executeInvitationBatch` (in `[batch_id]/confirm/route.ts`) passes 8 fields to `createInvitation`, dropping maintenance, agreement duration and the already-paid amount.

Together: **an imported tenant gets no maintenance obligation and no settlement of what they already paid.** Import forty existing residents and all forty appear massively overdue.

`createInvitation` already accepts `maintenance_charge`, `maintenance_type`, `agreement_duration_months`, `paid_amount`, `payment_method` and `payment_reference` — the single-invite wizard uses all of them. Nothing new is needed on that side.

**Files:**
- Modify: `apps/backend/app/api/bulk-import/upload/route.ts` (`sanitizeImportRowForStorage`)
- Modify: `apps/backend/app/api/bulk-import/revalidate/route.ts` (its copy of `sanitizeImportRowForStorage`)
- Modify: `apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts` (`executeInvitationBatch`)
- Modify: `apps/backend/lib/services/bulk-import-validation-service.ts` (`TenantImportRow`: add the paid-amount fields; `normalizeRows`: read them)
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-financial-fields.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks
- Produces: `TenantImportRow` gains `amount_paid?: number`, `amount_includes_deposit?: boolean`, `payment_method?: string`, `payment_reference?: string`, `agreement_duration_months?: number`. Task 8's issue catalogue and Plan 2's workbook parser both rely on these names.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/bulk-import-financial-fields.test.ts`:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma, mockLifecycle } = vi.hoisted(() => {
  const prisma: any = {
    bulk_import_batches: { findFirst: vi.fn(), update: vi.fn() },
    // `findMany` is mocked from the start even though the current
    // implementation reads rows from the batch's JSON: Task 8 switches the
    // execution source to this table, and these tests must survive that.
    bulk_import_rows: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
  };
  return {
    mockPrisma: prisma,
    mockLifecycle: { createInvitation: vi.fn() },
  };
});

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/src/services/tenants/tenant-invitation-lifecycle-service", () => ({
  tenantInvitationLifecycleService: mockLifecycle,
}));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ sub: "owner-1", role: "OWNER" }),
  apiResponse: (data: any, status = 200) =>
    new Response(JSON.stringify({ data }), { status }),
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
}));

import { POST } from "@/app/api/bulk-import/[batch_id]/confirm/route";

const BATCH_ID = "44444444-4444-4444-4444-444444444444";

const IMPORTED_ROW = {
  row: 2,
  data: {
    name: "Ravi Kumar",
    phone: "+919876500001",
    email: "ravi@example.com",
    room_no: "101",
    room_id: "33333333-3333-3333-3333-333333333333",
    monthly_rent: 8500,
    advance_deposit: 25500,
    maintenance_charge: 500,
    maintenance_type: "MONTHLY",
    agreement_duration_months: 11,
    joining_date: "2026-01-05",
    amount_paid: 76500,
    amount_includes_deposit: true,
    payment_method: "CASH",
    notes: "",
  },
  warnings: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.bulk_import_batches.findFirst.mockResolvedValue({
    id: BATCH_ID,
    hostel_id: HOSTEL_ID_FOR_TEST(),
    owner_id: "owner-1",
    hostel: { id: HOSTEL_ID_FOR_TEST(), name: "Sri Adithya Boys Hostel" },
    validation_errors: {
      defaults: {},
      valid_rows: [IMPORTED_ROW],
      invalid: [],
      duplicates: [],
      requires_historical_join_date_confirmation: false,
    },
  });
  mockPrisma.bulk_import_batches.update.mockResolvedValue({});
  mockPrisma.bulk_import_rows.findFirst.mockResolvedValue(null);
  mockPrisma.bulk_import_rows.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.bulk_import_rows.update.mockResolvedValue({});
  mockPrisma.bulk_import_rows.findMany.mockResolvedValue([
    {
      id: "row-uuid-1",
      row_number: 2,
      mapped_data: IMPORTED_ROW.data,
      execution_status: "PENDING",
      tenant_id: null,
      invitation_id: null,
      reservation_id: null,
    },
  ]);
  mockLifecycle.createInvitation.mockResolvedValue({
    tenant_id: "t1",
    invitation_id: "i1",
    reservation_id: "r1",
    email_sent: true,
  });
});

function HOSTEL_ID_FOR_TEST() {
  return "11111111-1111-1111-1111-111111111111";
}

function confirmRequest(body: Record<string, unknown> = {}) {
  return new Request("https://api.test/api/bulk-import/x/confirm", {
    method: "POST",
    body: JSON.stringify(body),
  }) as any;
}

describe("confirm passes every financial term to createInvitation", () => {
  it("does not drop maintenance", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    expect(mockLifecycle.createInvitation).toHaveBeenCalledTimes(1);
    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload.maintenance_charge).toBe(500);
    expect(payload.maintenance_type).toBe("MONTHLY");
  });

  it("does not drop the amount already paid", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload.paid_amount).toBe(76500);
    expect(payload.amount_includes_deposit).toBe(true);
    expect(payload.payment_method).toBe("CASH");
  });

  it("does not drop the agreement duration", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload.agreement_duration_months).toBe(11);
  });

  it("still passes the terms it already handled", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload.name).toBe("Ravi Kumar");
    expect(payload.room_id).toBe("33333333-3333-3333-3333-333333333333");
    expect(payload.monthly_rent).toBe(8500);
    expect(payload.advance_deposit).toBe(25500);
    expect(payload.joining_date).toBe("2026-01-05");
  });
});
```

- [ ] **Step 2: Add the test file to the pure config**

```ts
      // The two field drops that made imported tenants look massively
      // overdue: no maintenance obligation, no already-paid settlement.
      'tests/bulk-import-financial-fields.test.ts',
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-financial-fields.test.ts`

Expected: the first three tests FAIL — `maintenance_charge`, `paid_amount` and `agreement_duration_months` are all `undefined` on the payload. The fourth passes.

- [ ] **Step 4: Widen the row type and read the new columns**

In `bulk-import-validation-service.ts`, add to the `TenantImportRow` interface:

```ts
  agreement_duration_months?: number;
  amount_paid?: number;
  amount_includes_deposit?: boolean;
  payment_method?: string;
  payment_reference?: string;
```

And in `normalizeRows`, add these entries to the returned object:

```ts
      agreement_duration_months: this.parseNumber(
        this.readCell(row, ["Agreement Months", "agreement_months", "agreement_duration_months"])
      ),
      amount_paid: this.parseNumber(
        this.readCell(row, ["Amount Already Paid", "amount_already_paid", "amount_paid", "paid_amount"])
      ),
      amount_includes_deposit: this.parseYesNo(
        this.readCell(row, ["Paid Includes Deposit", "paid_includes_deposit", "amount_includes_deposit"])
      ),
      payment_method: this.readCell(row, ["Payment Method", "payment_method"]) || undefined,
      payment_reference: this.readCell(row, ["Payment Reference", "payment_reference", "reference"]) || undefined,
```

Add the helper beside `parseNumber`:

```ts
  private parseYesNo(value: any): boolean | undefined {
    const text = String(value ?? "").trim().toUpperCase();
    if (!text) return undefined;
    if (["YES", "Y", "TRUE", "1"].includes(text)) return true;
    if (["NO", "N", "FALSE", "0"].includes(text)) return false;
    return undefined;
  }
```

Finally, in `validateRows`'s returned `data` object, carry them through (they currently fall through the `...row` spread, but be explicit so a later refactor cannot drop them again):

```ts
          agreement_duration_months: row.agreement_duration_months,
          amount_paid: row.amount_paid,
          amount_includes_deposit: row.amount_includes_deposit ?? true,
          payment_method: row.payment_method,
          payment_reference: row.payment_reference,
```

- [ ] **Step 5: Stop the storage sanitizer from dropping fields**

In **both** `app/api/bulk-import/upload/route.ts` and `app/api/bulk-import/revalidate/route.ts`, replace `sanitizeImportRowForStorage` with:

```ts
/**
 * What is persisted for a validated row.
 *
 * This is an allowlist, deliberately — nothing secret may reach the batch's
 * `validation_errors` JSON. It previously omitted every financial term beyond
 * rent and deposit, so maintenance and the already-paid amount were computed,
 * shown in the preview, and then discarded before confirm could ever see them.
 */
function sanitizeImportRowForStorage(row: TenantImportRow): Partial<TenantImportRow> {
  return {
    name: row.name,
    phone: row.phone,
    email: row.email,
    room_no: row.room_no,
    room_id: row.room_id,
    monthly_rent: row.monthly_rent,
    advance_deposit: row.advance_deposit,
    security_deposit: row.security_deposit,
    maintenance_charge: row.maintenance_charge,
    maintenance_type: row.maintenance_type,
    agreement_duration_months: row.agreement_duration_months,
    amount_paid: row.amount_paid,
    amount_includes_deposit: row.amount_includes_deposit,
    payment_method: row.payment_method,
    payment_reference: row.payment_reference,
    joining_date: row.joining_date,
    notes: row.notes,
  };
}
```

- [ ] **Step 6: Pass them to createInvitation**

In `app/api/bulk-import/[batch_id]/confirm/route.ts`, inside `executeInvitationBatch`, replace the `createInvitation` call's payload with:

```ts
      const invitationResult: any = await tenantInvitationLifecycleService.createInvitation({
        name: row.data.name,
        email: row.data.email,
        phone: row.data.phone,
        room_id: row.data.room_id,
        monthly_rent: row.data.monthly_rent,
        advance_deposit: row.data.advance_deposit,
        maintenance_charge: row.data.maintenance_charge,
        maintenance_type: row.data.maintenance_type,
        agreement_duration_months: row.data.agreement_duration_months,
        paid_amount: row.data.amount_paid,
        amount_includes_deposit: row.data.amount_includes_deposit,
        payment_method: row.data.payment_method,
        payment_reference: row.data.payment_reference,
        joining_date: row.data.joining_date,
        notes: row.data.notes,
        batch_id: batchId,
      }, ownerId);
```

- [ ] **Step 7: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-financial-fields.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 8: Run the financial safety check and the pure suite**

Run:
```bash
cd apps/backend && npm run check:financial-safety && npm run test:pure
```
Expected: check passes; no new test failures versus baseline.

- [ ] **Step 9: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import-validation-service.ts \
        apps/backend/app/api/bulk-import/upload/route.ts \
        apps/backend/app/api/bulk-import/revalidate/route.ts \
        'apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts' \
        apps/backend/tests/bulk-import-financial-fields.test.ts \
        apps/backend/vitest.pure.config.ts
git commit -m "fix(bulk-import): stop dropping maintenance and already-paid amounts

Two compounding drops: sanitizeImportRowForStorage rebuilt each row from
a field list omitting every financial term beyond rent and deposit, and
executeInvitationBatch passed only 8 fields to createInvitation. Together
an imported tenant got no maintenance obligation and no settlement of
what they had already paid, so every existing resident imported into a
running hostel appeared massively overdue.

createInvitation already accepted all of these; the single-invite wizard
has been using them all along."
```

---

### Task 6: Remove the decorative `billing_start_mode`

`billing_start_mode` (`JOINING_DATE` / `IMPORT_DATE`) is parsed from the upload form, validated, defaulted, persisted, and rendered into the confirm preview — and **no code anywhere reads it to make a billing decision**. It is a promise the UI would make and the backend would not keep. Remove it rather than carry it into the new UI.

**Files:**
- Modify: `apps/backend/lib/services/bulk-import-validation-service.ts` (`TenantImportRow`, `ImportDefaults`, `defaultBillingStartMode`, the `data` object)
- Modify: `apps/backend/app/api/bulk-import/upload/route.ts` (`parseImportDefaults`)
- Modify: `apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts` (`sanitizeImportRowForPreview`)
- Test: `apps/backend/tests/bulk-import-financial-fields.test.ts` (extend)

**Interfaces:**
- Consumes: Task 5's widened `TenantImportRow`
- Produces: `billing_start_mode` no longer exists on `TenantImportRow` or `ImportDefaults`. Plan 2's workbook must not reintroduce it.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/bulk-import-financial-fields.test.ts`:

```ts
describe("billing_start_mode is gone", () => {
  it("is not part of the payload sent to createInvitation", async () => {
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    const [payload] = mockLifecycle.createInvitation.mock.calls[0];
    expect(payload).not.toHaveProperty("billing_start_mode");
  });

  it("is not referenced anywhere in the bulk-import tree", async () => {
    const { readFileSync, readdirSync, statSync } = await import("node:fs");
    const { join } = await import("node:path");

    const roots = [
      join(process.cwd(), "app/api/bulk-import"),
      join(process.cwd(), "lib/services"),
    ];
    const offenders: string[] = [];

    function walk(dir: string) {
      for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (statSync(full).isDirectory()) {
          walk(full);
        } else if (full.endsWith(".ts")) {
          if (readFileSync(full, "utf8").includes("billing_start_mode")) {
            offenders.push(full);
          }
        }
      }
    }

    for (const root of roots) walk(root);
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-financial-fields.test.ts`

Expected: the second test FAILS, listing `bulk-import-validation-service.ts` and the upload/confirm routes.

- [ ] **Step 3: Delete every occurrence**

- In `bulk-import-validation-service.ts`: remove `billing_start_mode` from `TenantImportRow` and `ImportDefaults`, delete the `defaultBillingStartMode` const, and remove the `billing_start_mode: defaultBillingStartMode` line from the `data` object.
- In `upload/route.ts`: delete the `billing_start_mode` property from `parseImportDefaults`'s return.
- In `[batch_id]/confirm/route.ts`: delete the `billing_start_mode: row.data.billing_start_mode` line from `sanitizeImportRowForPreview`.
- In `upload/route.ts` and `revalidate/route.ts`: it is already absent from the Task 5 `sanitizeImportRowForStorage` — confirm it was not re-added.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-financial-fields.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import-validation-service.ts \
        apps/backend/app/api/bulk-import/upload/route.ts \
        'apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts' \
        apps/backend/tests/bulk-import-financial-fields.test.ts
git commit -m "refactor(bulk-import): remove the decorative billing_start_mode

Parsed, validated, defaulted, persisted and shown in the preview — and
never read by any billing decision. A promise the UI would make and the
backend would not keep. Guarded by a test so it cannot come back."
```

---

### Task 7: `rent_source` tells the truth

`validateRows` hardcodes `rent_source: "ROOM_CONFIG"` on every row, including rows where the owner typed a rent in the sheet that differs from the room's configured rent. The preview then tells the owner the rent came from the room when it came from them.

**Files:**
- Modify: `apps/backend/lib/services/bulk-import-validation-service.ts` (`TenantImportRow.rent_source`, the `data` object)
- Test: `apps/backend/tests/bulk-import-capacity-accounting.test.ts` (extend — it already has the room/prisma mocks set up)

**Interfaces:**
- Consumes: the mocks in `tests/bulk-import-capacity-accounting.test.ts` from Task 3
- Produces: `rent_source` widens from `"ROOM_CONFIG"` to `"ROOM_CONFIG" | "SHEET"`. Plan 2's review queue renders this.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/bulk-import-capacity-accounting.test.ts`:

```ts
describe("rent_source", () => {
  it("is ROOM_CONFIG when the sheet left rent blank", async () => {
    const result = await bulkImportValidationService.validateRows(
      [row("Ravi", "9876500001", "ravi@example.com")],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.validRows[0].data.rent_source).toBe("ROOM_CONFIG");
    expect(result.validRows[0].data.monthly_rent).toBe(8500);
  });

  it("is SHEET when the owner typed a rent", async () => {
    const result = await bulkImportValidationService.validateRows(
      [{ ...row("Ravi", "9876500001", "ravi@example.com"), monthly_rent: 9000 }],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.validRows[0].data.rent_source).toBe("SHEET");
    expect(result.validRows[0].data.monthly_rent).toBe(9000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-capacity-accounting.test.ts`

Expected: the second test FAILS — `rent_source` is `"ROOM_CONFIG"`.

- [ ] **Step 3: Widen the type and set it honestly**

In `TenantImportRow`, change:

```ts
  rent_source?: "ROOM_CONFIG" | "SHEET";
```

In `validateRows`'s `data` object, replace the hardcoded line with:

```ts
          rent_source: row.monthly_rent != null ? "SHEET" : "ROOM_CONFIG",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-capacity-accounting.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import-validation-service.ts \
        apps/backend/tests/bulk-import-capacity-accounting.test.ts
git commit -m "fix(bulk-import): rent_source reflects where the rent actually came from

It was hardcoded ROOM_CONFIG on every row, so the preview told the owner
the rent came from the room even when they had typed it themselves."
```

---

### Task 8: Rows are found by primary key, and the sheet is parsed once

Two robustness defects in the same area:

- `executeInvitationBatch` locates each row with `updateMany({ batch_id, normalized_email, normalized_phone })` and re-queries with `findFirst` on every iteration, instead of using the row's own `id`. It also means two rows sharing an email and phone would both be updated by one row's result.
- `parseFile` calls `XLSX.utils.sheet_to_json(worksheet)` once for the row-count check and again with options — a full double parse of every file.

**Files:**
- Modify: `apps/backend/lib/services/bulk-import-validation-service.ts` (`parseFile`)
- Modify: `apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts` (`executeInvitationBatch`, and the `GET`/`POST` payload that feeds it)
- Test: `apps/backend/tests/bulk-import-financial-fields.test.ts` (extend)

**Interfaces:**
- Consumes: Task 5's confirm-route test harness
- Produces: `executeInvitationBatch` reads rows from `bulk_import_rows` (each carrying its `id` and `mapped_data`) rather than from the batch's `validation_errors` JSON. Plan 2's chunked execution builds directly on this.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/bulk-import-financial-fields.test.ts`:

```ts
describe("row bookkeeping", () => {
  it("updates the row by its primary key, not by email+phone", async () => {
    // `findMany` is already stubbed in beforeEach with row-uuid-1.
    await POST(confirmRequest(), { params: { batch_id: BATCH_ID } });

    expect(mockPrisma.bulk_import_rows.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "row-uuid-1" } })
    );
    expect(mockPrisma.bulk_import_rows.updateMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-financial-fields.test.ts`

Expected: FAIL — `update` was never called; `updateMany` was.

- [ ] **Step 3: Read rows from the table, write by id**

In `[batch_id]/confirm/route.ts`, change `executeInvitationBatch`'s signature and body so it loads its own rows:

```ts
async function executeInvitationBatch(
  ownerId: string,
  hostelId: string,
  batchId: string
) {
  let successCount = 0;
  let failureCount = 0;
  let emailFailureCount = 0;
  const results: any[] = [];
  const errors: any[] = [];

  await prisma.bulk_import_batches.update({
    where: { id: batchId },
    data: { status: "PROCESSING" },
  });

  // `bulk_import_rows` is the authority on what to execute — one row, one
  // primary key. The batch's `validation_errors` JSON is a preview artefact,
  // and matching on email+phone would update two rows that happened to share
  // both.
  const rows = await prisma.bulk_import_rows.findMany({
    where: { batch_id: batchId },
    orderBy: { row_number: "asc" },
  });

  for (const row of rows) {
    if (row.execution_status === "SUCCESS") {
      successCount++;
      results.push({
        row: row.row_number,
        success: true,
        tenant_id: row.tenant_id,
        invitation_id: row.invitation_id,
        reservation_id: row.reservation_id,
        action: "IDEMPOTENT_RETRY",
      });
      continue;
    }

    const data = row.mapped_data as TenantImportRow;

    try {
      const invitationResult: any = await tenantInvitationLifecycleService.createInvitation({
        name: data.name,
        email: data.email,
        phone: data.phone,
        room_id: data.room_id,
        monthly_rent: data.monthly_rent,
        advance_deposit: data.advance_deposit,
        maintenance_charge: data.maintenance_charge,
        maintenance_type: data.maintenance_type,
        agreement_duration_months: data.agreement_duration_months,
        paid_amount: data.amount_paid,
        amount_includes_deposit: data.amount_includes_deposit,
        payment_method: data.payment_method,
        payment_reference: data.payment_reference,
        joining_date: data.joining_date,
        notes: data.notes,
        batch_id: batchId,
      }, ownerId);

      if (!invitationResult.email_sent) emailFailureCount++;
      successCount++;
      await prisma.bulk_import_rows.update({
        where: { id: row.id },
        data: {
          tenant_id: invitationResult.tenant_id,
          invitation_id: invitationResult.invitation_id,
          reservation_id: invitationResult.reservation_id,
          execution_status: "SUCCESS",
          email_status: invitationResult.email_sent ? "SENT" : "FAILED",
          error_message: invitationResult.email_error || null,
          executed_at: new Date(),
        },
      });
      results.push({
        row: row.row_number,
        success: true,
        tenant_id: invitationResult.tenant_id,
        invitation_id: invitationResult.invitation_id,
        reservation_id: invitationResult.reservation_id,
        email_sent: invitationResult.email_sent,
        email_error: invitationResult.email_error,
      });
    } catch (error: any) {
      failureCount++;
      const message = String(error?.message || "Invitation failed");
      await prisma.bulk_import_rows.update({
        where: { id: row.id },
        data: {
          execution_status: "FAILED",
          error_message: message,
          executed_at: new Date(),
        },
      });
      errors.push({ row: row.row_number, error: message });
      results.push({ row: row.row_number, success: false, error: message });
    }
  }

  await prisma.bulk_import_batches.update({
    where: { id: batchId },
    data: {
      status: failureCount === 0 ? "COMPLETED" : successCount > 0 ? "PARTIAL" : "FAILED",
      imported_rows: successCount,
      failed_rows: failureCount,
      import_summary: {
        total_requested: rows.length,
        success_count: successCount,
        failure_count: failureCount,
        email_failure_count: emailFailureCount,
      },
      imported_at: new Date(),
    },
  });

  return {
    totalRequested: rows.length,
    successCount,
    failureCount,
    emailFailureCount,
    results,
    errors,
  };
}
```

Update the single call site in `POST` accordingly:

```ts
    const result = await executeInvitationBatch(session.sub, batch.hostel_id, batchId);
```

The `validRowsWithData.length` guard above it stays — it still reads the preview payload to refuse an empty batch.

- [ ] **Step 4: Parse the sheet once**

In `parseFile`, delete the first bare call and hoist the options onto the single remaining one:

```ts
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<any>(worksheet, {
        raw: true,
        defval: "",
      });

      if (jsonData.length > MAX_IMPORT_ROWS) {
        throw new Error(
          `VALIDATION_ERROR: This file has ${jsonData.length} rows. The most we can import at once is ${MAX_IMPORT_ROWS}. Split it into smaller files and import them one after another.`
        );
      }

      if (!jsonData || jsonData.length === 0) {
        throw new Error("VALIDATION_ERROR: No data rows found in the file");
      }

      return this.normalizeRows(jsonData);
```

(Delete the now-unused `const rawData` and its own row-count check.)

- [ ] **Step 5: Run tests to verify they pass**

Run:
```bash
cd apps/backend && npx vitest run --config vitest.pure.config.ts \
  tests/bulk-import-financial-fields.test.ts \
  tests/bulk-import-parse-errors.test.ts
```
Expected: PASS. The Task 1 row-limit tests still pass against the single-parse version.

- [ ] **Step 6: Run the full pure suite**

Run: `cd apps/backend && npm run test:pure`

Expected: no new failures versus baseline.

- [ ] **Step 7: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import-validation-service.ts \
        'apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts' \
        apps/backend/tests/bulk-import-financial-fields.test.ts
git commit -m "fix(bulk-import): execute from bulk_import_rows by primary key

executeInvitationBatch matched rows on (batch_id, email, phone) with
updateMany and re-queried per iteration. Read the rows once, write by id.
Also drops a full duplicate parse of every uploaded sheet."
```

---

### Task 9: The issue catalogue

Replace free-text validation strings with structured, owner-readable issues carrying a severity and a fix affordance. This is the vocabulary the review queue (Plan 3) renders and the whole reason the >24-month and overpayment cases stop being walls.

**Files:**
- Create: `apps/backend/lib/services/bulk-import/issues.ts`
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-issues.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type IssueSeverity = "BLOCKER" | "NEEDS_CHOICE" | "NOTICE"`
  - `type IssueCode` — the union of the twelve codes below
  - `type RowIssue = { code: IssueCode; severity: IssueSeverity; field?: string; row: number; title: string; detail: string; fix: FixAffordance }`
  - `type FixAffordance = { kind: "EDIT_FIELD" | "PICK_ROOM" | "PICK_OPTION" | "PICK_DATE" | "ACKNOWLEDGE" | "SKIP_ROW" | "OPEN_TENANT"; options?: string[] }`
  - `buildIssue(code, row, context): RowIssue`
  - `severityOf(code): IssueSeverity`
  - `groupIssuesByCode(issues: RowIssue[]): Array<{ code: IssueCode; severity: IssueSeverity; rows: number[]; title: string }>`

  Task 10 re-exports these from `lib/services/bulk-import/index.ts`; Plan 3's `issueCopy.ts` mirrors the copy on the frontend.

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/bulk-import-issues.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  buildIssue,
  severityOf,
  groupIssuesByCode,
  type RowIssue,
} from "@/lib/services/bulk-import/issues";

describe("severity", () => {
  it("blocks rows that cannot import", () => {
    expect(severityOf("ROOM_NOT_FOUND")).toBe("BLOCKER");
    expect(severityOf("PHONE_INVALID")).toBe("BLOCKER");
    expect(severityOf("PAYMENT_METHOD_MISSING")).toBe("BLOCKER");
  });

  it("lets the owner decide on capped backfill and overpayment", () => {
    expect(severityOf("BACKFILL_CAPPED")).toBe("NEEDS_CHOICE");
    expect(severityOf("OVERPAID")).toBe("NEEDS_CHOICE");
    expect(severityOf("DUPLICATE_IN_SYSTEM")).toBe("NEEDS_CHOICE");
  });
});

describe("copy", () => {
  it("names the actual room and hostel", () => {
    const issue = buildIssue("ROOM_NOT_FOUND", 7, {
      roomNo: "1O1",
      hostelName: "Sri Adithya Boys Hostel",
      nearestRooms: ["101", "102"],
    });

    expect(issue.title).toContain("1O1");
    expect(issue.title).toContain("Sri Adithya Boys Hostel");
    expect(issue.fix.kind).toBe("PICK_ROOM");
    expect(issue.fix.options).toEqual(["101", "102"]);
    expect(issue.row).toBe(7);
  });

  it("names the actual rupee amounts for an overpayment", () => {
    const issue = buildIssue("OVERPAID", 4, {
      amountPaid: 90000,
      amountOwed: 76500,
      joiningDate: "2026-01-05",
    });

    expect(issue.detail).toContain("90,000");
    expect(issue.detail).toContain("76,500");
    expect(issue.detail).toContain("13,500");
    expect(issue.severity).toBe("NEEDS_CHOICE");
  });

  it("says how many months will be billed when backfill is capped", () => {
    const issue = buildIssue("BACKFILL_CAPPED", 9, {
      monthsElapsed: 32,
      cappedTo: 24,
      firstBilledMonth: "October 2023",
    });

    expect(issue.detail).toContain("32");
    expect(issue.detail).toContain("24");
    expect(issue.detail).toContain("October 2023");
    expect(issue.fix.kind).toBe("ACKNOWLEDGE");
  });

  it("never renders a bare code", () => {
    const codes = [
      "ROOM_NOT_FOUND", "ROOM_CAPACITY_EXCEEDED", "ROOM_NO_RENT",
      "PHONE_INVALID", "DUPLICATE_IN_FILE", "DUPLICATE_IN_SYSTEM",
      "PAYMENT_METHOD_MISSING", "OVERPAID", "BACKFILL_CAPPED",
      "FORMULA_IN_CELL", "DATE_UNREADABLE", "HOSTEL_STAMP_MISMATCH",
    ] as const;

    for (const code of codes) {
      const issue = buildIssue(code, 2, {});
      expect(issue.title.length).toBeGreaterThan(10);
      expect(issue.title).not.toContain("_");
      expect(issue.title).not.toBe(code);
    }
  });
});

describe("grouping", () => {
  it("collects repeated codes so the owner decides once", () => {
    const issues: RowIssue[] = [
      buildIssue("BACKFILL_CAPPED", 2, { monthsElapsed: 30, cappedTo: 24 }),
      buildIssue("BACKFILL_CAPPED", 3, { monthsElapsed: 31, cappedTo: 24 }),
      buildIssue("PHONE_INVALID", 4, { value: "98765" }),
    ];

    const groups = groupIssuesByCode(issues);
    const capped = groups.find((g) => g.code === "BACKFILL_CAPPED");

    expect(capped).toBeDefined();
    expect(capped!.rows).toEqual([2, 3]);
    expect(groups).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Add the test file to the pure config**

```ts
      // The owner-facing issue vocabulary: severity, copy that names real
      // values, and grouping so a 3-year-old hostel decides once, not 32 times.
      'tests/bulk-import-issues.test.ts',
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-issues.test.ts`

Expected: FAIL — cannot resolve `@/lib/services/bulk-import/issues`.

- [ ] **Step 4: Write the catalogue**

Create `apps/backend/lib/services/bulk-import/issues.ts`:

```ts
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
    detail: `Use a complete date like 05/01/2026 or 2026-01-05. The joining date decides how much rent is owed, so a guess would be wrong money.`,
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-issues.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import/issues.ts \
        apps/backend/tests/bulk-import-issues.test.ts \
        apps/backend/vitest.pure.config.ts
git commit -m "feat(bulk-import): owner-readable issue catalogue

Twelve codes, each with a severity and copy that names the real room,
hostel and rupee amount. Only BLOCKER stops a row: capped backfill,
overpayment and duplicates are choices the owner makes. groupIssuesByCode
collapses a repeated problem into one decision, so a three-year-old
hostel does not face thirty-two identical prompts."
```

---

### Task 10: Emit issues from validation

`validateRows` still produces `ValidationError` strings. Have it emit `RowIssue[]` alongside them, so the routes can serve the new shape without the old one breaking. The legacy `errors`/`warnings` arrays stay until Plan 3's UI is live.

**Files:**
- Modify: `apps/backend/lib/services/bulk-import-validation-service.ts` (`ValidatedRow`, `validateRows`)
- Test: `apps/backend/tests/bulk-import-issues.test.ts` (extend)

**Interfaces:**
- Consumes: `buildIssue`, `RowIssue` from Task 9
- Produces: `ValidatedRow` gains `issues: RowIssue[]`. `ValidationResult.summary` gains `blockers: number` and `choices: number`. Plan 2's `/upload` response and Plan 3's review queue both read `issues`.

- [ ] **Step 1: Write the failing test**

Append to `apps/backend/tests/bulk-import-issues.test.ts`. Add the prisma mocks at the top of the file (the same block as Task 3's test), then:

```ts
describe("validateRows emits issues", () => {
  const HOSTEL_ID = "11111111-1111-1111-1111-111111111111";
  const OWNER_ID = "22222222-2222-2222-2222-222222222222";

  it("reports a bad phone as a PHONE_INVALID blocker", async () => {
    const { bulkImportValidationService } = await import(
      "@/lib/services/bulk-import-validation-service"
    );

    const result = await bulkImportValidationService.validateRows(
      [{ name: "Ravi", phone: "98765", email: "ravi@example.com", room_no: "101", joining_date: "2026-09-01" } as any],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    const row = result.invalidRows[0];
    expect(row.issues.map((i) => i.code)).toContain("PHONE_INVALID");
    expect(row.issues.find((i) => i.code === "PHONE_INVALID")!.severity).toBe("BLOCKER");
    expect(row.issues.find((i) => i.code === "PHONE_INVALID")!.title).toContain("98765");
  });

  it("counts blockers and choices separately", async () => {
    const { bulkImportValidationService } = await import(
      "@/lib/services/bulk-import-validation-service"
    );

    const result = await bulkImportValidationService.validateRows(
      [
        { name: "Ravi", phone: "98765", email: "ravi@example.com", room_no: "101", joining_date: "2026-09-01" } as any,
        { name: "Priya", phone: "9876500002", email: "priya@example.com", room_no: "101", joining_date: "2022-01-05" } as any,
      ],
      HOSTEL_ID,
      OWNER_ID,
      {}
    );

    expect(result.summary.blockers).toBe(1);
    expect(result.summary.choices).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-issues.test.ts`

Expected: FAIL — `row.issues` is undefined and `summary.blockers` is undefined.

- [ ] **Step 3: Emit issues alongside the legacy errors**

In `bulk-import-validation-service.ts`, import the catalogue:

```ts
import { buildIssue, type RowIssue } from "./bulk-import/issues";
```

Add to `ValidatedRow`:

```ts
  issues: RowIssue[];
```

Add to `ValidationResult["summary"]`:

```ts
    blockers: number;
    choices: number;
```

In `validateRows`, declare `const issues: RowIssue[] = [];` beside `errors`, and push an issue everywhere an error or warning is currently pushed. The four that matter:

```ts
      // phone
      if (!normalizedPhone) {
        errors.push({ row: rowNumber, field: "phone", message: "Valid phone number is required (10 digits)", value: row.phone });
        issues.push(buildIssue("PHONE_INVALID", rowNumber, { value: row.phone }));
      }
```

```ts
      // room not found
        if (!room) {
          errors.push({ row: rowNumber, field: "room_no", message: `Room ${row.room_no} not found in hostel`, value: row.room_no });
          issues.push(buildIssue("ROOM_NOT_FOUND", rowNumber, {
            roomNo: row.room_no,
            hostelName,
            nearestRooms: nearestRoomNumbers(row.room_no, hostelRooms),
          }));
        }
```

```ts
      // historical joining date, replacing the free-text warning
      } else if (parsedJoiningDate) {
        const monthsElapsed = monthsBetween(parsedJoiningDate, new Date());
        if (monthsElapsed > 24) {
          issues.push(buildIssue("BACKFILL_CAPPED", rowNumber, { monthsElapsed, cappedTo: 24 }));
          warnings.push("Historical joining date requires owner confirmation before invitations are sent");
        } else if (parsedJoiningDate < today) {
          warnings.push("Historical joining date requires owner confirmation before invitations are sent");
        }
      }
```

```ts
      // unreadable date
      if (row.joining_date && !parsedJoiningDate) {
        errors.push({ row: rowNumber, field: "joining_date", message: "Invalid joining date (use YYYY-MM-DD or DD/MM/YYYY)", value: row.joining_date });
        issues.push(buildIssue("DATE_UNREADABLE", rowNumber, { value: row.joining_date }));
      }
```

Add the two helpers as private methods on the class:

```ts
  private nearestRoomNumbers(target: string, rooms: Array<{ room_no: string }>): string[] {
    const wanted = String(target || "").toUpperCase();
    return rooms
      .map((r) => r.room_no)
      .map((room_no) => ({ room_no, distance: this.editDistance(wanted, room_no.toUpperCase()) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 3)
      .map((r) => r.room_no);
  }

  private editDistance(a: string, b: string): number {
    const rows = Array.from({ length: a.length + 1 }, (_, i) =>
      Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) {
        rows[i][j] = Math.min(
          rows[i - 1][j] + 1,
          rows[i][j - 1] + 1,
          rows[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
        );
      }
    }
    return rows[a.length][b.length];
  }
```

Add `monthsBetween` as a private method:

```ts
  private monthsBetween(from: Date, to: Date): number {
    return (to.getFullYear() - from.getFullYear()) * 12 + (to.getMonth() - from.getMonth());
  }
```

Note: the call sites above use bare `nearestRoomNumbers(...)` and `monthsBetween(...)` for readability — write them as `this.nearestRoomNumbers(...)` and `this.monthsBetween(...)`. `hostelName` must be fetched alongside the rooms; add a `hostels.findUnique({ where: { id: hostelId }, select: { name: true } })` at the top of `validateRows` and use `hostel?.name ?? "this hostel"`.

Attach `issues` to each pushed `ValidatedRow`, and compute the new summary counts:

```ts
    const allIssues = validatedRows.flatMap((r) => r.issues);
    // ...
      summary: {
        valid: validRows.length,
        invalid: invalidRows.length,
        duplicates: duplicates.length,
        warnings: validatedRows.reduce((sum, r) => sum + r.warnings.length, 0),
        blockers: allIssues.filter((i) => i.severity === "BLOCKER").length,
        choices: allIssues.filter((i) => i.severity === "NEEDS_CHOICE").length,
      },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/bulk-import-issues.test.ts`

Expected: PASS.

- [ ] **Step 5: Run the full pure suite**

Run: `cd apps/backend && npm run test:pure`

Expected: no new failures versus baseline. Existing bulk-import tests still pass because `errors` and `warnings` are unchanged.

- [ ] **Step 6: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import-validation-service.ts \
        apps/backend/tests/bulk-import-issues.test.ts
git commit -m "feat(bulk-import): validation emits structured RowIssues

Alongside the existing errors/warnings, so nothing breaks while the new
UI is built. Adds nearest-room suggestions for a mistyped room number and
splits the summary into blockers versus choices."
```

---

### Task 11: Split the service into modules

The validation service is 536 lines covering parsing, identity, rooms and dates, and Plan 2 adds workbook building, a Rooms tab and financial planning to it. Split it now, while the tests that pin its behaviour are fresh.

**Files:**
- Create: `apps/backend/lib/services/bulk-import/workbook-parser.ts`
- Create: `apps/backend/lib/services/bulk-import/dates.ts`
- Create: `apps/backend/lib/services/bulk-import/identity.ts`
- Create: `apps/backend/lib/services/bulk-import/room-resolution.ts`
- Create: `apps/backend/lib/services/bulk-import/types.ts`
- Create: `apps/backend/lib/services/bulk-import/index.ts`
- Modify: `apps/backend/lib/services/bulk-import-validation-service.ts` → becomes a re-export shim
- Test: all existing bulk-import tests must pass unchanged

**Interfaces:**
- Consumes: everything from Tasks 1–10
- Produces:
  - `types.ts`: `TenantImportRow`, `ImportDefaults`, `ValidationError`, `ValidatedRow`, `ValidationResult`
  - `dates.ts`: `parseImportDate(value: string): Date | null`, `formatImportDate(date: Date): string`, `monthsBetween(from: Date, to: Date): number`
  - `identity.ts`: `normalizeImportPhone(phone: string): string | null`, `isValidImportEmail(email: string): boolean`, `isSpreadsheetFormula(value: unknown): boolean`
  - `room-resolution.ts`: `nearestRoomNumbers(target: string, rooms: Array<{ room_no: string }>): string[]`
  - `workbook-parser.ts`: `parseTenantWorkbook(buffer: Buffer, filename: string): TenantImportRow[]`
  - `index.ts`: re-exports the above plus `bulkImportValidationService`

  Plan 2 adds `template-builder.ts` and `financial-plan.ts` to this same directory.

- [ ] **Step 1: Confirm the current suite is green (the safety net for this refactor)**

Run:
```bash
cd apps/backend && npx vitest run --config vitest.pure.config.ts \
  tests/bulk-import-parse-errors.test.ts \
  tests/bulk-import-file-type.test.ts \
  tests/bulk-import-capacity-accounting.test.ts \
  tests/bulk-import-financial-fields.test.ts \
  tests/bulk-import-issues.test.ts
```
Expected: PASS. Record the test count — it must be identical after the split.

- [ ] **Step 2: Move the pure helpers out, one file at a time**

Create `dates.ts`, `identity.ts` and `room-resolution.ts` by moving the corresponding private methods off the class verbatim, converting each to an exported function (drop the `this.` prefixes). Create `types.ts` by moving the five exported interfaces. Have `bulk-import-validation-service.ts` import them back so its own body is unchanged apart from the deletions.

- [ ] **Step 3: Run the suite after each move**

Run the same command as Step 1 after each file is moved.
Expected: PASS with an identical test count every time. If a count changes, the move dropped something — revert that file and redo it.

- [ ] **Step 4: Move parsing into `workbook-parser.ts`**

Move `parseFile`, `normalizeRows`, `readCell`, `parseNumber`, `parseYesNo` and `normalizeMaintenanceType` into `workbook-parser.ts`, exposed as `parseTenantWorkbook(buffer, filename)`. Keep `bulkImportValidationService.parseFile` as a thin delegate so existing callers and tests are untouched.

- [ ] **Step 5: Add the barrel and the shim**

Create `index.ts` re-exporting everything, and reduce `bulk-import-validation-service.ts` to:

```ts
/**
 * Kept as a re-export shim so the API routes' import paths stay valid.
 * The implementation now lives in `lib/services/bulk-import/`.
 */
export * from "./bulk-import";
export { bulkImportValidationService } from "./bulk-import";
```

- [ ] **Step 6: Run the full pure suite**

Run: `cd apps/backend && npm run test:pure`

Expected: no new failures versus baseline, identical count to Step 1 for the bulk-import files.

- [ ] **Step 7: Confirm the routes still typecheck**

Run:
```bash
cd apps/backend && npx tsc --noEmit 2>&1 | grep -E "bulk-import" || echo "no bulk-import type errors"
```
Expected: `no bulk-import type errors`. (The repo has a large pre-existing backlog elsewhere — filter to your own files.)

- [ ] **Step 8: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add apps/backend/lib/services/bulk-import/ \
        apps/backend/lib/services/bulk-import-validation-service.ts
git commit -m "refactor(bulk-import): split the validation service into modules

536 lines covering parsing, identity, rooms and dates, about to gain
workbook building and financial planning. Split by responsibility now,
while the tests pinning its behaviour are fresh. The old path stays as a
re-export shim so no route import changes."
```

---

### Task 12: Documentation

Per CLAUDE.md, `docs/obsidian/` is updated in the same change, not as follow-up.

**Files:**
- Modify: `docs/obsidian/Bugs.md`
- Modify: `docs/obsidian/Changelog.md`
- Modify: `docs/obsidian/Backend.md`
- Modify: `docs/obsidian/APIs.md`

**Interfaces:**
- Consumes: the completed Tasks 1–11
- Produces: nothing code-facing.

- [ ] **Step 1: Add the defects to Bugs.md**

Add one entry per fixed defect (Tasks 1–8) in the file's existing entry format, each naming the symptom an owner would have seen, the cause, and the fix. Link to `[[Changelog]]` and `[[Backend]]`. Use this for the headline entry (Task 5) and follow its shape for the rest:

```markdown
### Bulk-imported tenants had no maintenance and no credit for what they had already paid

- **Symptom:** an owner importing residents of a hostel that had been running
  for months saw every one of them as massively overdue, and none of them
  billed for maintenance — even though the import preview had shown both
  correctly.
- **Cause:** two compounding drops. `sanitizeImportRowForStorage` rebuilt each
  validated row from an explicit field list that omitted `maintenance_charge`,
  `maintenance_type` and every paid-amount field, so the values were computed,
  previewed and then discarded before being persisted. `executeInvitationBatch`
  then passed only eight fields to `createInvitation`, dropping the same terms
  again. `createInvitation` had accepted all of them all along — the
  single-invite wizard has been using them since [[Decisions#ADR-165|ADR-165]].
- **Fix:** both sanitizers carry the full financial set, and confirm passes
  every term through. Pinned by `tests/bulk-import-financial-fields.test.ts`.
- **See:** [[Changelog]], [[Backend]], [[Business-Rules]]
```

- [ ] **Step 2: Add a Changelog entry**

Under `Unreleased`, a `Fixed` section for Tasks 1–8 and a `Changed` section for Tasks 9–11.

- [ ] **Step 3: Update Backend.md**

Replace the reference to `lib/services/bulk-import-validation-service.ts` with the new `lib/services/bulk-import/` directory and its module responsibilities. Note the shim.

- [ ] **Step 4: Update APIs.md**

Note that `/api/bulk-import/upload` and `/revalidate` responses now carry `issues` per row and `blockers`/`choices` in the summary, and that `billing_start_mode` is gone from the request and the preview.

- [ ] **Step 5: Commit**

```bash
cd /home/sp/Desktop/stayo-bulk-import
git add docs/obsidian/
git commit -m "docs(obsidian): bulk-import correctness fixes and the issue model"
```

---

### Task 13: Review pass

The spec requires a review of this code, not just a rewrite of it.

- [ ] **Step 1: Run every check**

```bash
cd apps/backend
npm run test:pure
npm run check:invariants
npm run check:financial-safety
npm run check:activation-invariants
```
Expected: pure suite green versus baseline; the three checks show no new failures (two pre-existing `check:invariants` FAILs are known — confirm they are unchanged, do not fix them here).

- [ ] **Step 2: Review the diff**

Run `/code-review high` against the branch. Report findings rather than auto-applying them.

- [ ] **Step 3: Resolve the open question from the spec**

Spec §9 item 13: `getExistingPhones`/`getExistingEmails` are **owner-scoped, not hostel-scoped**, so a tenant at the owner's *other* hostel is reported as a duplicate here. ADR-162 deliberately made identity guards hostel-scoped. Decide with the user whether this is intentional for tenant identity or a bug, and record the answer in `docs/obsidian/Decisions.md` or `docs/obsidian/TODO.md`. Do not change the behaviour without that decision.

---

## What follows this plan

- **Plan 2 — Workbook and rooms** (spec Phases C, E): ExcelJS template builder with the pre-filled Rooms tab and dropdowns, Rooms-tab parsing and room creation via `roomRepository`, chunked resumable confirm, input hardening, and the `revalidate` PII fix.
- **Plan 3 — Owner flow and dispatch** (spec Phases D, F): the responsive review queue and stage stepper in `apps/frontend`, plus the `QUEUED` invitation state, its migration, wave sending, and the four `QUEUED` handling sites.
