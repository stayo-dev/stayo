# Bulk Tenant Import — Design

**Date:** 2026-09-10
**Status:** Approved, ready for planning
**Scope:** Owner-facing bulk onboarding of tenants (new and already-resident) into an existing hostel, including the rooms they live in and the money already paid.

---

## 1. Why

An owner joining Stayo with a hostel that has been running for years cannot get their residents in. The single-tenant invite wizard handles one person beautifully — historical joining date, back-rent backfill, an already-paid lump sum settled FIFO — but repeating it forty times is not a product.

A bulk-import backend already exists in this repo and is **not reachable from any screen**. It is also incomplete in ways that would actively corrupt an owner's books (see §9). This design finishes it rather than replacing it.

### What already exists

| Piece | State |
|---|---|
| `app/api/bulk-import/{template,upload,revalidate,[batch_id],[batch_id]/confirm,google-form-prompt}` | Live, unreferenced by any UI |
| `lib/services/bulk-import-validation-service.ts` (536 lines) | Live, parse + validate only |
| `bulk_import_batches`, `bulk_import_rows` | Real tables, with per-row execution status and idempotent retry |
| `bulkImportService` in `features/owners/api/index.js:230` | Exported, **called by nothing** |
| Single-invite financial machinery | Mature and tested — reused wholesale here |

### The constraint that shapes everything

**ADR-165**: tenant acceptance is mandatory and explicit. Every import fires a real invitation; the `suppressInvitationNotification` "just add to my records" path was deliberately removed. An unaccepted tenancy auto-expires after link expiry + grace. Bulk import cannot sidestep this — it can only choose *when* the invitation is sent (§7).

---

## 2. The workbook

Generated per hostel by `GET /api/bulk-import/template?hostel_id=…`, built with **ExcelJS 4.4.0** (already a dependency — supports data validation, cell locking, styling; SheetJS does not).

The template is **not a static file**. It is built from the hostel's live data so the owner never retypes what Stayo already knows.

| Sheet | Contents |
|---|---|
| **Read me** | Locked. Hostel name + ID stamp, hostel's due day, "amounts in ₹, paste values not formulas", one worked example row, and a count of rooms/tenants already in Stayo for this hostel. |
| **Rooms** | Every existing room **pre-filled and greyed**: Room No, Floor, Capacity, Sharing Type, Base Rent, Currently Occupied. Blank rows below for rooms not yet in Stayo. |
| **Tenants** | One row per tenant. Room column is a **dropdown bound to the Rooms sheet**. |

### Tenants columns

| Column | Required | Behaviour when blank |
|---|---|---|
| Name, Phone | yes | — (phone normalised to `+91…`) |
| Email | conditional | required only when invite delivery is by email — **a change**: validation currently rejects any row without an email, even though `createInvitation` requires only phone and WhatsApp delivery exists |
| Room | yes | dropdown; typo'd room numbers become impossible |
| Monthly Rent | no | room's `base_rent` |
| Joining Date | yes | real historical date for existing residents |
| Security Deposit | no | hostel billing default |
| Maintenance Charge | no | hostel billing default |
| Maintenance Type | no | dropdown `MONTHLY / ONE_TIME / NONE` |
| Agreement Months | no | hostel default (12) |
| **Amount Already Paid** | no | `0`/blank ⇒ brand-new tenant |
| **Paid Includes Deposit** | no | dropdown `YES / NO` |
| **Payment Method** | if paid > 0 | dropdown `CASH / UPI / BANK_TRANSFER / …` |
| Notes | no | — |

The last three mirror `amount_paid` / `amount_includes_deposit` / `payment_method` on the existing `POST /api/tenants/invite-settlement-preview` exactly.

**A new tenant and an existing tenant use the same row shape.** The only difference is a past joining date and a non-zero Amount Already Paid. No mode switch, no second template.

**Cover stamp:** the hostel ID on the locked Read-me sheet is verified at upload against the selected hostel. Uploading Sri Adithya's workbook into Sri Balaji is refused with a named error, not silently imported. One workbook per hostel; a multi-hostel owner runs the flow once per hostel. This avoids making `bulk_import_batches.hostel_id` nullable and sidesteps room numbers repeating across hostels.

---

## 3. Financial model

Composes `onboardingFinancialsService` and `financialPaymentFacade` **unchanged**:

```
joining 2026-01-05, rent 8500, deposit 25500, maintenance 500/mo
  → backfill Jan..Sep rent obligations   (capped at 24 months)
  → deposit obligation 25500
  → maintenance obligations
Amount Already Paid 76500, includes deposit YES
  → FIFO settle → deposit + Jan..Jun clear
  → Jul, Aug, Sep outstanding = 27000
```

`financial-plan.ts` **composes `lib/billing/invite-settlement-preview.ts`** — the same pure planner behind the single-invite preview. It does not recalculate dues. This is CLAUDE.md's read-model rule, and it is what stops bulk and single-invite from drifting the way the owner dashboard and tenant portal did.

Three conditions must be resolved at **preview** time, never at execution:

- **Overpayment.** `createInvitation` throws when `paid_amount > dues + 0.01`. At batch scale that is a failed row mid-execution. Validation computes each row's dues from its own terms and surfaces overpay as a row issue with the exact figures.
- **Backfill truncation.** A joining date >24 months back caps silently today. Becomes a visible, acknowledgeable row notice.
- **Deposit double-count.** `Paid Includes Deposit = NO` with a Security Deposit set means the deposit is still owed. Shown explicitly.

---

## 4. Owner flow

```
Tenants ▸ + Invite ▸ Import many

 1  Choose hostel      template is built for THAT hostel
 2  Download workbook  rooms pre-filled, room dropdown live
 3  Upload             parse Rooms tab, then Tenants tab
 4  Review             "38 ready · 2 need you · 1 already in Stayo"
 5  Confirm            rooms created → tenancies live → payments recorded
                       invitations QUEUED, nothing sent yet
 6  Send               Invited tab: send all, or in waves
```

The 5/6 split is the ADR-165 accommodation: the owner's books are correct immediately, and the tenant-facing blast is a separate, deliberate act.

---

## 5. The error system

**This is a headline requirement, not a detail.** The owner is a hostel operator with a spreadsheet, not an engineer reading validation output.

### Structured, not stringly-typed

Today errors are free text (`"Room 1O1 not found in hostel"`). Replace with:

```ts
type RowIssue = {
  code: IssueCode;
  severity: "BLOCKER" | "NEEDS_CHOICE" | "NOTICE";
  field?: string;
  row: number;
  title: string;        // what happened, in the owner's words
  detail: string;       // the specific numbers/values involved
  fix: FixAffordance;   // what the UI renders to resolve it
};
```

Severity decides the flow — and it is why the >24-month case is not a wall:

- **BLOCKER** — the row cannot import until changed.
- **NEEDS_CHOICE** — the row imports once the owner picks (e.g. capped backfill: confirm or change the date).
- **NOTICE** — imports as-is, owner is simply told.

### Catalogue

| Code | Severity | Owner-facing copy | Fix affordance |
|---|---|---|---|
| `ROOM_NOT_FOUND` | BLOCKER | "Room 1O1 isn't in Sri Adithya Boys Hostel." | dropdown of nearest matches, + "add this room" |
| `ROOM_CAPACITY_EXCEEDED` | BLOCKER | "Room 102 holds 3 and already has 3." | choose another room, or raise capacity |
| `ROOM_NO_RENT` | BLOCKER | "Room 105 has no rent set." | enter rent inline |
| `PHONE_INVALID` | BLOCKER | "98765 isn't a 10-digit mobile number." | edit inline |
| `DUPLICATE_IN_FILE` | NEEDS_CHOICE | "This phone is on rows 7 and 22." | keep one, drop the other |
| `DUPLICATE_IN_SYSTEM` | NEEDS_CHOICE | "Ravi (+91…) is already a tenant here." | skip row / open tenant |
| `PAYMENT_METHOD_MISSING` | BLOCKER | "₹51,000 paid, but no payment method." | dropdown |
| `OVERPAID` | NEEDS_CHOICE | "You entered ₹90,000 paid, but only ₹76,500 is owed from 5 Jan. ₹13,500 extra." | reduce amount / change joining date |
| `BACKFILL_CAPPED` | NEEDS_CHOICE | "Joined 5 Jan 2023 — 32 months. We'll bill the most recent 24 (from Oct 2023). Earlier months won't be imported." | confirm / change date |
| `FORMULA_IN_CELL` | BLOCKER | "This cell contains a formula. Paste as values." | edit inline |
| `DATE_UNREADABLE` | BLOCKER | "'May' isn't a full date. Use 05/01/2026." | date picker |
| `HOSTEL_STAMP_MISMATCH` | BLOCKER (file) | "This file was made for Sri Adithya Boys Hostel." | switch hostel / new template |

Every entry names **the actual value**, **the actual hostel/room**, and **what to do**. No error may render as a bare code or a raw exception message.

### Fix once, apply to all

The single most important affordance. A hostel running three years hits `BACKFILL_CAPPED` on nearly every row; three duplicate rows produce the same choice repeatedly. When an issue code repeats, the queue offers one decision for the whole group:

```
32 rows joined more than 24 months ago
We'll bill the most recent 24 months for each.
Earlier months won't be imported.
        [ Change dates ]   [ Understood — apply to all 32 ]
```

Without this, the risk raised during design — that the cap is the common case rather than an edge — turns a working import into 32 identical prompts.

### Where it renders

One responsive design. On a phone, rows needing attention are a card queue: one row, its issues, only the fields that need touching. On a wide screen the same data is an editable grid. Clean rows collapse into a "38 ready" summary that is never scrolled through. Reuses `POST /api/bulk-import/revalidate`.

---

## 6. Progress and trust

The owner must always know what is happening and that nothing was lost.

**Stage stepper** across the whole flow (Choose → Download → Upload → Review → Import → Send), with the current stage and completed stages always visible.

**Determinate progress during confirm**, fed by chunked execution (§7) — not a spinner:

```
Importing into Sri Adithya Boys Hostel
[███████████████░░░░░░░]  27 / 41

✓ Rooms created            12 of 12
✓ Tenancies created        27 of 41
✓ Payments recorded        18 of 18
  Invitations              queued, not sent
```

Sub-stages are named in the owner's vocabulary. On completion the summary states exactly what exists now and what the next action is — never a bare "Done".

---

## 7. Execution and safety

Requirement: **no crashes, no partial tenants, no lost work, no leaked data — whether or not errors occur.**

### Ordering

Rooms first, then tenants. Room creation reuses `RoomCreateSchema` + `roomRepository` + `roomCapacityService` + the `eventSystem` emit that `POST /api/rooms` uses — never raw Prisma writes, so ordering and capacity bookkeeping stay correct.

### Chunked, resumable confirm

`executeInvitationBatch` already skips rows whose `execution_status === "SUCCESS"` — resumability exists and is unused. Confirm processes a bounded slice (~25 rows), returns `{processed, remaining}`, and the client polls until zero.

This replaces today's 150-rows-in-60s loop, which **cannot finish** (`maxDuration = 60`, each row a transaction with a 30s timeout plus notification dispatch). It needs no queue infrastructure, and a dropped connection loses nothing because all state lives in `bulk_import_rows`.

### Failure isolation

- Each row is its own transaction (`createInvitation` already wraps one). A failing row rolls back that row alone and is recorded `FAILED` with its reason; the batch continues.
- Rooms created before a later failure are real rooms and are kept, recorded on the batch so a retry does not duplicate them.
- Double-submit cannot double-charge: row-level `SUCCESS` skip plus `idempotencyKey: invite-settle:${invitation.id}` on the settlement.
- The owner can close the tab and resume the batch; `bulk_import_rows.mapped_data` persists the parsed rows.

### Input hardening

The uploaded file is parsed, never stored. Guards: size cap, row cap, column cap, cell-length cap, formula rejection (exists), zip-bomb/sheet-count guard, and **extension + magic-byte sniffing in addition to MIME type** — the current `file.type` allowlist rejects `.xlsx` files that browsers report as `application/octet-stream`.

### Data protection

- Batch and row reads are already owner-scoped (`owner_id: session.sub`); this must hold on every new route.
- No secrets in `validation_errors`. The existing `sanitizeValidatedRow` strips `onboarding_password_hash`, implying credentials once flowed through this JSON — the new row type must not carry a password field at all.
- **`revalidate` currently creates a *new* batch on every edit**, orphaning the previous batch with a full copy of tenant PII. Change it to update in place, and add retention cleanup for completed/abandoned batches.

---

## 8. Module split

Replace `lib/services/bulk-import-validation-service.ts` with a directory, keeping `bulkImportValidationService` as the orchestrator export so route call sites change shape once:

```
lib/services/bulk-import/
  template-builder.ts    ExcelJS: cover stamp, pre-filled Rooms, dropdowns
  workbook-parser.ts     both tabs, header aliasing, formula rejection
  room-resolution.ts     match by room_no, plan creations, capacity math
  tenant-validation.ts   identity, duplicates, dates, capacity
  financial-plan.ts      per-row dues + paid-amount plan (composes the invite planner)
  issues.ts              the IssueCode catalogue and owner-facing copy
  index.ts               orchestrator → ValidationResult
```

The existing file would otherwise roughly double, covering parsing, rooms, tenants and money in one place — the shape CLAUDE.md warns about.

---

## 9. Defects in the existing code

Found while designing, from reading the current implementation. Each is to be fixed as part of this work, and a full review pass (`/code-review`) is a required step **after** implementation, not a substitute for this list.

**Correctness — corrupts the owner's books**

1. `sanitizeImportRowForStorage` (`upload/route.ts`) strips `maintenance_charge`, `maintenance_type`, `billing_start_mode`, `rent_source` before persisting. The confirm step can never see them.
2. `executeInvitationBatch` passes only 8 fields to `createInvitation`, dropping maintenance, agreement duration and paid amount. **Combined with (1): imported tenants get no maintenance obligation and no already-paid settlement.** Import 40 existing residents today and all 40 appear massively overdue.
3. Duplicate and invalid rows still consume room capacity in `roomAssignmentsSeen`, because the capacity block never consults `isDuplicate`. Three duplicate rows for a 3-capacity room falsely reject a legitimate fourth.
4. `parseDate`'s final fallback is `new Date(trimmed)`, which accepts junk like `"May"` and silently yields a wrong date rather than an error.

**Error handling — the exact problem this design is fixing**

5. The `MAX_IMPORT_ROWS` error message lacks the `VALIDATION_ERROR` prefix its own catch block tests for, so it is swallowed and rewritten as *"Failed to parse file. Please ensure it's a valid Excel or CSV file."* **An owner with 200 rows is told their file is corrupt.**
6. The `file.type` allowlist rejects `.xlsx` uploads that browsers report as `application/octet-stream`.

**Dead and misleading**

7. `billing_start_mode` (`JOINING_DATE` / `IMPORT_DATE`) is parsed, validated, stored and shown in the preview, and has **zero consumers**. Purely decorative. Remove.
8. `rent_source` is hardcoded `"ROOM_CONFIG"` even when the sheet supplied the rent.

**Robustness and scale**

9. Confirm cannot finish a large batch (§7).
10. `sheet_to_json` is called twice on the same worksheet — full double parse.
11. `executeInvitationBatch` locates rows by `updateMany({batch_id, normalized_email, normalized_phone})` instead of the row's own primary key, and re-queries per row.
12. `revalidate` orphans batches with PII (§7).

**Flagged, not decided**

13. `getExistingPhones` / `getExistingEmails` are **owner-scoped, not hostel-scoped** — a tenant at the owner's *other* hostel is reported as a duplicate here. ADR-162 deliberately made identity guards hostel-scoped. Needs a decision; may be intentional for tenant identity, but it is inconsistent with the stated rule.

---

## 10. Schema

- `tenant_invitations.dispatched_at DateTime?` — the only new column.
- `QUEUED` needs **no migration**: `status` is a plain `String`, not a Prisma enum.

Per the 2026-08-22 production outage rule (adding a field to a Prisma model changes every query that does *not* select it): `tenant_invitations` has `include:`-only reads, so **the migration is applied by hand via the Supabase SQL editor/psql before the code deploys**, written `IF NOT EXISTS`, and verified against `information_schema` plus the real endpoint. Never `prisma migrate deploy` — this project's `_prisma_migrations` history was never populated.

---

## 11. Deferred dispatch

`createInvitation` gains `dispatch: "IMMEDIATE" | "DEFERRED"`. Deferred writes the invitation `QUEUED`; a new `POST /api/bulk-import/[batch_id]/dispatch` sends in waves, and **`expires_at` is recomputed at send time** so the tenant's clock starts when they actually receive the link.

This requires a new ADR that states explicitly: **deferral is not a revival of the `suppressInvitationNotification` path ADR-165 removed.** The invitation remains mandatory and tenant-accepted; only the send moment moves.

Four places `QUEUED` must be handled — each a live bug if missed:

- **Duplicate detection** — `getExistingPhones`/`getExistingEmails` filter `PENDING/OPENED/ACTIVATION_STARTED`. Without `QUEUED`, **re-uploading the same file creates duplicate tenancies.** Sharpest of the four.
- **`expire-unaccepted-tenancies` cron** — must skip `QUEUED`, or it closes tenancies whose invites were never sent.
- **`invitation-expiry-reminder-service`** — same.
- **`tenant_invitation_reservations`** — needs verification. Under ADR-165 the tenancy holds a real allocation, so the reservation may be redundant for this path. To be confirmed during implementation, not assumed.

---

## 12. Frontend

New feature directory `apps/frontend/src/features/owner-tenants/import/`, mirroring the invite wizard's existing shape.

The frontend test suite is **node-only, no jsdom, matches `src/**/*.test.ts`**. So all decision logic lives in pure `.ts` modules — `reviewQueue.ts` (ordering, grouping by issue code, what needs attention), `rowValidation.ts`, `importProgress.ts`, `issueCopy.ts` — each with its own `.test.ts`, exactly like the neighbouring `settlementPreview.ts` and `paidAmountGuidance.ts`. Components stay thin renderers. No `.test.tsx`.

All network access goes through `@lib/api-client` (enforced by `check-architecture.mjs`).

---

## 13. Verification

- Backend: `npm run test:pure` for the new modules; `npm run check:invariants`, `check:financial-safety`, `check:activation-invariants`.
- Frontend: `npm test`, `npm run check:architecture`.
- A full `/code-review` pass over the finished bulk-import tree, per §9.
- Live-data check before trusting any data-shape assumption — phone format in particular is stored two ways in this system.

---

## 14. Phasing

This is large enough that it should land in reviewable stages, each independently verifiable and each leaving the tree working:

| Phase | Delivers | Verifiable by |
|---|---|---|
| **A — Fix what's broken** | §9 defects 1–8, no new surface. Bulk import stops dropping financial fields and stops lying about parse failures. | `test:pure`, `check:financial-safety` |
| **B — Module split** | §8 directory, behaviour-preserving, plus the `issues.ts` catalogue replacing free-text errors. | `test:pure`, unchanged route responses except issue shape |
| **C — Workbook** | ExcelJS template builder with pre-filled rooms and dropdowns; Rooms-tab parsing and room creation. | `test:pure`, manual download/upload round-trip |
| **D — Review queue** | Frontend import flow: stage stepper, responsive review queue, fix-once-apply-to-all. | frontend `npm test`, `check:architecture` |
| **E — Execution** | Chunked resumable confirm, determinate progress, input hardening. | large-batch run against a real DB |
| **F — Deferred dispatch** | `QUEUED` state, migration, wave sending, and the four `QUEUED` handling sites (§11) + new ADR. | `check:activation-invariants`, cron behaviour |

Phase A is worth shipping on its own regardless of the rest — it is a live correctness bug in code that is already deployed.

---

## 15. Out of scope

- Multi-hostel workbooks (one workbook per hostel, §2).
- Importing individual historical *payment* rows — the lump sum covers the need.
- Editing already-imported tenants by re-upload.
- The unused `google-form-prompt` route — flagged for decommission, not touched here.

---

## 16. Documentation to update in the same change

`docs/obsidian/`: [[Features]], [[APIs]], [[Database]], [[Business-Rules]], [[Bugs]] (the defects in §9), [[Decisions]] (new ADR for deferred dispatch), [[Changelog]].
