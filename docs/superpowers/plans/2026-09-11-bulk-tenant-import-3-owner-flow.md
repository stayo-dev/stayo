# Bulk Tenant Import — Plan 3: The Owner's Flow, and Sending in Waves

> **For agentic workers:** Execute inline with superpowers:executing-plans (the user's standing preference — do not dispatch per-task subagents). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the owner a screen for all of this — pick a hostel, download the workbook, upload it, fix what needs fixing one decision at a time, watch it import — and let them send the invitations in waves instead of forty at once.

**Architecture:** Phases D and F of the spec. Two backend preconditions first (issues must survive a reload; the counts must be served), then the frontend flow, then the `QUEUED` invitation state. The review queue is the heart of it: the error model built in Plan 1 has never been rendered.

**Tech Stack:** React 19 + Vite (`apps/frontend`), TanStack Query, Vitest **node-environment only**, Next.js 14 + Prisma (`apps/backend`).

**Spec:** `docs/superpowers/specs/2026-09-10-bulk-tenant-import-design.md`

**Depends on:** Plans 1 and 2 and the gap closures, all on `main` (PRs #78, #80, #81). `lib/services/bulk-import/` is complete; 196 tests.

## Global Constraints

- **Branch:** cut `feat/bulk-tenant-import-owner-flow` from `main` in its own worktree. Never `git checkout` in `/home/sp/Desktop/stayo` — a shared tree holding other people's uncommitted work.
- **The frontend test suite is node-environment only, no jsdom, and matches `src/**/*.test.ts` — not `.tsx`.** So every decision this feature makes lives in a pure `.ts` module with a colocated `.test.ts`, and components are thin renderers over already-tested state. **Do not add a `.test.tsx` or try to render a component.** The pattern to copy is `src/features/owner-tenants/invite/` — `settlementPreview.ts`, `paidAmountGuidance.ts`, `eligibilityCheck.ts` each beside their test.
- **All network access goes through `@lib/api-client`.** Raw `fetch`/`axios` in `app/`, `platforms/`, `shared/ui`, `features/`, `portal/` or `context/` fails `npm run check:architecture`, which the build runs.
- `apps/frontend`'s `npm run build` does **not** typecheck (esbuild). Run `npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0` and filter to your own files.
- Backend: `apps/backend/vitest.pure.config.ts`'s `include` is an **allowlist** — a test file not listed there silently never runs.
- **Baselines:** backend `npm run test:pure` fails 3 tests in `agreement-requirement.test.ts` and `whatsapp-guardian-reminders.test.ts`. Record the frontend `npm test` baseline before starting and compare against it.
- **Indian formats everywhere the owner reads:** dates DD/MM/YYYY, money `toLocaleString("en-IN")` (lakh grouping).
- **No copy invents behaviour.** Every string must describe what the backend actually does — the recurring defect in this subsystem is a column that is parsed, stored, echoed back, and never acted on. If a control implies something the backend does not do, do not build the control.
- Commit after every task.

## Verified facts this plan is built on

| Fact | Where |
|---|---|
| The invite wizard is a **modal** (`open` / `onClose`), opened from `HostelTenantsPage`, `HostelRoomsPage`, `VacancyQueuePage` and the onboarding preview | `src/features/owner-tenants/invite/InviteTenantWizard.tsx` |
| Owner tenants route is `/owner/tenants` → `TenantsWorkspace` (47 lines), with `:tenantId` nested as master-detail at `lg+`, full-bleed below | `src/platforms/owner/router/OwnerRoutes.tsx` |
| Frontend tests: `environment: 'node'`, `include: ['src/**/*.test.ts']` | `apps/frontend/vitest.config.ts` |
| `bulkImportService` already wraps every endpoint (`upload`, `revalidate`, `confirm`, batch status, `downloadTemplate(hostelId)`) and **nothing calls it** | `src/features/owners/api/index.js:230` |
| `issues` reach the immediate upload/revalidate response but are **not persisted**; `summary.blockers`/`choices` are computed but exposed by no route | `app/api/bulk-import/upload/route.ts`, `[batch_id]/confirm/route.ts` |
| Confirm is chunked: body `chunk_size`, response `progress { total, processed, remaining, succeeded, failed, stage }` and `rooms { created, updated, errors }` | `app/api/bulk-import/[batch_id]/confirm/route.ts` |
| `createInvitation` sets `expires_at = now + 7 days` at creation and dispatches immediately | `tenant-invitation-lifecycle-service.ts:263,566` |
| The expiry sweep selects `acceptance_status: PENDING` + invitation `status in (PENDING, OPENED, EXPIRED)` with `expires_at < cutoff` | `src/services/tenants/unaccepted-tenancy-expiry-service.ts:34-45` |
| The reminder service selects invitation `status in (PENDING, OPENED)` | `src/services/tenants/invitation-expiry-reminder-service.ts:67` |
| Duplicate detection is now **tenancy-based** (`INVITED`/`ACTIVE`), so a `QUEUED` invitation's tenancy already blocks a re-import — no change needed there | `lib/services/bulk-import/validation-service.ts` |

---

## Part A — Backend preconditions

### Task 1: Persist the issues, and serve the counts

The review queue renders `issues`. They currently exist only in the immediate upload response: reload the page, or come back to a batch, and every row looks clean. `summary.blockers`/`choices` are computed and thrown away.

**Files:**
- Modify: `apps/backend/app/api/bulk-import/upload/route.ts`, `revalidate/route.ts` (persist `issues` per row and the counts on the batch)
- Modify: `apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts` (GET preview returns them)
- Modify: `apps/backend/vitest.pure.config.ts`
- Test: `apps/backend/tests/bulk-import-issue-persistence.test.ts`

**Interfaces:**
- Produces: the batch's `validation_errors` gains `issues` on every valid/invalid/duplicate row entry, and `summary: { blockers, choices, warnings }`. `GET /api/bulk-import/[batch_id]/confirm` returns `validation.blockers`, `validation.choices`, and `preview.*[].issues`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";
// ... standard prisma + auth mocks, as in tests/bulk-import-revalidate.test.ts

describe("issues survive a reload", () => {
  it("stores each row's issues on the batch", async () => {
    await POST(uploadRequest());
    const stored = mockPrisma.__tx.bulk_import_batches.create.mock.calls[0][0].data.validation_errors;
    expect(stored.invalid[0].issues.map((i: any) => i.code)).toContain("PHONE_INVALID");
  });

  it("stores the blocker and choice counts", async () => {
    await POST(uploadRequest());
    const stored = mockPrisma.__tx.bulk_import_batches.create.mock.calls[0][0].data.validation_errors;
    expect(stored.summary).toMatchObject({ blockers: 1, choices: 0 });
  });

  it("serves them back from the batch preview", async () => {
    const res = await GET(new Request("https://api.test/x") as any, { params: { batch_id: BATCH_ID } });
    const { data } = await res.json();
    expect(data.validation.blockers).toBe(1);
    expect(data.preview.invalid[0].issues[0].code).toBe("PHONE_INVALID");
  });
});
```

- [ ] **Step 2: Register the test, run it, confirm it fails** — `issues` is absent from the stored payload.

- [ ] **Step 3: Persist them.** In both `upload` and `revalidate`, add `issues: r.issues` to each of the three row shapes written into `validation_errors` (`valid_rows`, `invalid`, `duplicates`), and add `summary: { blockers: validation.summary.blockers, choices: validation.summary.choices, warnings: validation.summary.warnings }`. In `confirm`'s `GET`, read them back and include `blockers`/`choices` in the `validation` block and `issues` in each preview row.

**Note on size:** `validation_errors` is a `Json?` column already holding every row's data. Issues add roughly 200 bytes per issue. At the 150-row cap with a few issues each this stays well under a megabyte — but if a future row cap rises, this is the column to watch.

- [ ] **Step 4: Run tests, confirm green, commit.**

---

### Task 2: An invitation can be created without being sent

ADR-165 requires that every imported tenancy gets a real invitation the tenant accepts. It does not require that forty of them leave at the same instant. Importing a running hostel should let the owner's books go right immediately and the tenant-facing messages go out when they choose.

**This is not a revival of `suppressInvitationNotification`.** That path let an owner run a tenancy nobody ever accepted. Here the invitation is still mandatory, still accepted by the tenant, still expires — only the moment of sending moves, and the expiry clock starts when it is sent rather than when it is created.

**Files:**
- Modify: `apps/backend/prisma/schema.prisma` (`tenant_invitations.dispatched_at DateTime?`)
- Create: `apps/backend/prisma/migrations_manual/<date>_invitation_dispatched_at.sql`
- Modify: `apps/backend/src/services/tenants/tenant-invitation-lifecycle-service.ts`
- Modify: `apps/backend/src/services/tenants/unaccepted-tenancy-expiry-service.ts`
- Modify: `apps/backend/src/services/tenants/invitation-expiry-reminder-service.ts`
- Test: `apps/backend/tests/bulk-import-deferred-dispatch.test.ts`

**Interfaces:**
- Produces: `createInvitation(data, ownerId)` accepts `dispatch?: "IMMEDIATE" | "DEFERRED"` (default `IMMEDIATE`). Deferred writes the invitation with `status: "QUEUED"` and no notification. A new `dispatchQueuedInvitations(invitationIds, ownerId)` sends them, stamping `dispatched_at` and setting `expires_at = now + DEFAULT_INVITE_DAYS`, status → `PENDING`.

**The migration rule for this repo — read before writing it.** Adding a field to a Prisma model changes every query that does *not* select it: Prisma requests all declared scalars on any `findFirst`/`findUnique`/`findMany` with no explicit `select`. On 2026-08-22 declaring one column ahead of its migration 500'd every hostel listing in production. So: **apply the SQL by hand first, verify it, then deploy the code.** Never `prisma migrate deploy` — this project's `_prisma_migrations` history was never populated and it would try to replay everything. Write the SQL `IF NOT EXISTS`, apply with `psql`, then confirm via `information_schema` **and** by running the exact query the code will issue.

- [ ] **Step 1: Write the failing tests**

```ts
describe("a deferred invitation", () => {
  it("is created QUEUED and sends nothing", async () => { /* assert dispatch mock not called, status QUEUED */ });
  it("starts its expiry clock when it is sent, not when it is created", async () => {
    // expires_at after dispatch ≈ now + 7 days, regardless of how long it sat queued
  });
  it("is still an invitation the tenant must accept", async () => {
    // acceptance_status stays PENDING; no attestation; ADR-165 unchanged
  });
});

describe("what QUEUED must not trip", () => {
  it("is not swept by the unaccepted-tenancy expiry", async () => { /* filter excludes QUEUED */ });
  it("gets no expiry reminder while it is unsent", async () => { /* reminder filter excludes QUEUED */ });
  it("still blocks a duplicate import", async () => {
    // The tenancy is INVITED/ACTIVE, so the tenancy-based duplicate check
    // already catches it. This test exists to keep that true.
  });
});
```

- [ ] **Step 2: Run, confirm failing. Then implement**, in this order: the SQL migration applied by hand; `dispatched_at` on the model; the `dispatch` option; `dispatchQueuedInvitations`; the two cron filters.

- [ ] **Step 3: Add the four QUEUED handling sites to a single source-guard test**, so a future status list cannot silently omit it:

```ts
it("every invitation-status filter accounts for QUEUED", () => {
  // Reads the two sweep services and asserts each either names QUEUED or
  // carries an explicit comment saying why it does not.
});
```

- [ ] **Step 4: `npm run check:activation-invariants`**, compare to baseline, commit.

---

### Task 3: Sending in waves

**Files:**
- Create: `apps/backend/app/api/bulk-import/[batch_id]/dispatch/route.ts`
- Modify: `apps/backend/app/api/bulk-import/[batch_id]/confirm/route.ts` (pass `dispatch: "DEFERRED"`)
- Test: `apps/backend/tests/bulk-import-dispatch-route.test.ts`

**Interfaces:**
- `POST /api/bulk-import/[batch_id]/dispatch` with `{ invitation_ids?: string[], limit?: number }` → `{ sent, failed, remaining, errors }`. No body sends the whole batch. Owner-scoped, idempotent (an already-dispatched invitation is skipped, not re-sent).

- [ ] **Step 1–4:** failing tests (owner scoping, idempotency, partial waves, a send failure not aborting the rest), implement, verify, commit.

---

## Part B — The owner's flow

### Task 4: The decision logic, as pure modules

Everything the screen decides lives here, tested without rendering anything. This is the bulk of the work and the reason the UI can be thin.

**Files:**
- Create: `apps/frontend/src/features/owner-tenants/import/reviewQueue.ts` + `.test.ts`
- Create: `apps/frontend/src/features/owner-tenants/import/importStages.ts` + `.test.ts`
- Create: `apps/frontend/src/features/owner-tenants/import/importProgress.ts` + `.test.ts`
- Create: `apps/frontend/src/features/owner-tenants/import/issueCopy.ts` + `.test.ts`

**Interfaces:**
- `reviewQueue.ts`
  - `type QueueRow = { row: number; data: Record<string, unknown>; issues: RowIssue[] }`
  - `buildReviewQueue(preview): { ready: QueueRow[]; needsYou: QueueRow[]; duplicates: QueueRow[]; groups: IssueGroup[] }` — `needsYou` ordered blockers first, then by row number.
  - `type IssueGroup = { code: string; severity: string; title: string; rows: number[]; canApplyToAll: boolean }` — `canApplyToAll` is true only for `ACKNOWLEDGE` fixes, because "apply to all" cannot mean "type the same room number into 32 rows".
  - `applyGroupDecision(queue, code, decision): QueueRow[]`
- `importStages.ts`: `type Stage = "CHOOSE_HOSTEL" | "DOWNLOAD" | "UPLOAD" | "REVIEW" | "IMPORT" | "SEND"`, `stageFor(state): Stage`, `completedStages(state): Stage[]`.
- `importProgress.ts`: `describeProgress(progress, rooms): { percent: number; headline: string; lines: string[] }` — Indian number formatting, and never claims completion while `remaining > 0`.
- `issueCopy.ts`: the owner-facing label for each `fix.kind`, and the group prompt (`"32 rows joined more than 2 years ago"` + the acknowledge action).

- [ ] **Step 1: Write `reviewQueue.test.ts` first**, covering:
  - a clean batch produces an empty `needsYou` and a `ready` count;
  - blockers sort above choices;
  - a repeated code groups into one entry naming every row;
  - `canApplyToAll` is false for `PICK_ROOM`/`EDIT_FIELD` and true for `ACKNOWLEDGE`;
  - `applyGroupDecision` clears the acknowledged issue from **every** row in the group and leaves other issues alone;
  - a row whose last blocker is resolved moves from `needsYou` to `ready`.
- [ ] **Steps 2–5:** the other three modules, each test-first.
- [ ] **Step 6:** run `npm test`, compare to the recorded baseline, commit.

---

### Task 5: The screen

**Files:**
- Create: `apps/frontend/src/features/owner-tenants/import/ImportTenantsSheet.tsx` (the modal, mirroring `InviteTenantWizard`'s `open`/`onClose` contract)
- Create: `apps/frontend/src/features/owner-tenants/import/steps/` — `ChooseHostelStep.tsx`, `UploadStep.tsx`, `ReviewStep.tsx`, `ImportStep.tsx`, `SendStep.tsx`
- Create: `apps/frontend/src/features/owner-tenants/import/api.ts` (feature API wrapper over `@lib/api-client`)
- Create: `apps/frontend/src/features/owner-tenants/import/useImport.ts` (query/mutation hooks)
- Modify: `apps/frontend/src/lib/queryKeys.ts` (a `bulkImport` key group)
- Modify: the page that opens it (alongside `InviteTenantWizard`)

**Design constraints — from the spec, not negotiable:**
- **One responsive design.** On a phone, `needsYou` is a card queue: one row, its issues, and only the fields that need touching. At `lg+` the same data is an editable grid. `ready` rows collapse into a single "38 ready" summary the owner never scrolls through.
- **Fix once, apply to all.** A repeated issue renders as one prompt naming the count, not one prompt per row. This is what keeps a three-year-old hostel usable.
- **The import step shows a determinate bar**, driven by polling `confirm` until `remaining` is 0, with the sub-stages named in the owner's words (rooms created, tenancies created, payments recorded, invitations queued).
- **Nothing is sent until the owner says so.** The send step is separate, and says plainly that the tenants have not been contacted yet.

- [ ] **Step 1:** the API wrapper and hooks (the chunk loop lives here — re-POST while `remaining > 0`).
- [ ] **Step 2–6:** each step component, thin over the Task 4 modules.
- [ ] **Step 7:** `npm run check:architecture`, `npx tsc --noEmit` filtered to these files, `npm test`, commit.

---

### Task 6: Docs, and the legacy page

- [ ] **Step 1:** `docs/obsidian/` — [[Features]] (the flow now exists), [[APIs]] (`/dispatch`, the persisted issues, the counts), [[Business-Rules]] (invitations are queued and sent in waves; the expiry clock starts at send), [[Changelog]], and an ADR for deferred dispatch. **Check the next free ADR number against `git show origin/main:docs/obsidian/Decisions.md`, not the local file** — numbers have collided across concurrent branches before.
- [ ] **Step 2: Decide the legacy page.** `apps/backend/app/(dashboard)/owner/bulk-import/` still posts the removed `billing_start_mode` and predates all of this. With a canonical flow in `apps/frontend`, it should be decommissioned — the repo has an established 410 pattern (37 routes use it). **Confirm with the user before deleting**; it is the only bulk-import UI that has ever existed and someone may be using it.
- [ ] **Step 3:** commit.

---

### Task 7: Verify

- [ ] Backend `npm run test:pure`; `check:invariants`, `check:financial-safety`, `check:activation-invariants` against their baselines.
- [ ] Frontend `npm test`, `npm run check:architecture`, `npx tsc --noEmit` filtered.
- [ ] **Run the flow against a real database.** Everything in Plans 1–3 is unit-tested and none of it has ever executed end to end. Import two tenants into a real hostel — one new, one with a back-dated joining date and an amount already paid — and confirm the obligations, the settlement and the room allocation are what the preview promised. **This is the single most valuable step in the plan.**
- [ ] `/code-review high`, then fix what it finds.

---

## What this plan does not do

- No second import format, no multi-hostel workbook, no editing already-imported tenants by re-upload.
- The `google-form-prompt` route stays untouched (flagged for decommission since Plan 1).
- Does not revisit the 24-month backfill cap, or the 150-row limit.
