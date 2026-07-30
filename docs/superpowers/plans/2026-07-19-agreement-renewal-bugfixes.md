# Agreement Renewal Verified-Bug Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Additionally: this plan's own spec requires stopping for explicit user review after every task before starting the next one — do not batch multiple tasks between reviews, even though executing-plans normally allows that.**

**Goal:** Fix 7 verified defects in the Agreement Renewal subsystem (cron activation vs. manual signing parity, chain-integrity races, offer-expiration wiring, notification correctness) without redesigning any existing architecture.

**Architecture:** All fixes reuse existing services/patterns already established elsewhere in this exact subsystem — e.g. the `SELECT ... FOR UPDATE` + conditional `updateMany` + count-check pattern already used by `agreement-renewal-signing-service.ts` and `agreement-renewal-service.ts` is applied to the two call sites that are missing it (`agreement-lifecycle-service.ts`'s cron path, `renewal-offer-service.ts`'s `acceptOffer`). No new services, no schema migrations.

**Tech Stack:** Next.js 14 App Router backend (`backend-next/`), Prisma + Postgres, Vitest (single-worker, `fileParallelism: false`).

## Global Constraints

- Never bypass `FinancialLifecycleService.activatePayableObligations` for any obligation-creation path — reuse `agreementRentScheduleService.generateForAgreementInTx` rather than reimplementing rent-schedule creation.
- Every DB write inside a multi-step transition must use the locked-read + conditional-`updateMany`-with-count-check pattern already established in `agreement-renewal-signing-service.ts:94-209` and `agreement-renewal-service.ts:113-269` — do not introduce a third variant.
- Preserve all currently-passing tests in `backend-next/tests/agreement-renewal-*.test.ts`, `renewal-*.test.ts`, `whatsapp-renewal-*.test.ts` — every fix must be additive to existing test files unless a test is asserting the literal buggy behavior (none are, per investigation).
- After each task lands, update `docs/obsidian/Bugs.md` (new entries) and `docs/obsidian/Changelog.md` (one line each) per `CLAUDE.md`'s documentation rule — this is part of the task's definition of done, not a follow-up.
- Run `cd backend-next && npx vitest run tests/<file>.test.ts` after each change; do not proceed to the next task until it's green.
- **Stop after each task and wait for explicit user review before starting the next task** (per the user's own spec for this work — see "Deliverables" in the originating prompt).

---

## Investigation Summary (why these are real bugs, not spec misreadings)

Verified directly against the current code (not assumed from the bug report):

1. **`agreement-lifecycle-service.ts`'s `activateScheduledRenewals`** (cron path) marks the draft `SIGNED` but never calls `agreementRentScheduleService.generateForAgreementInTx` — while `agreement-renewal-signing-service.ts`'s `signRenewalAgreement` (manual path) does, at line 287. Confirms bug #1.
2. `signRenewalAgreement` never checks for an unpaid `SECURITY_DEPOSIT` obligation on the renewal agreement, while `activateScheduledRenewals` does (lines 312-328 of `agreement-lifecycle-service.ts`). Confirms bug #2 — backwards from a naive reading, but exactly as specced ("cron correctly blocks activation").
3. `activateScheduledRenewals` never checks `isCurrentAgreementStatus(predecessor.status)`, never checks for an active move-out request, and never calls `assertAgreementLifecycleComplete` — all three checks exist in `signRenewalAgreement` (lines 144-191) and in `agreement-renewal-service.ts`'s `createRenewalDraft` (lines 140-175). Confirms bug #3.
4. `activateScheduledRenewals` uses unconditional `tx.agreement.update` (no row lock, no precondition) instead of the `SELECT ... FOR UPDATE` + conditional `updateMany` + count-check pattern used everywhere else in this subsystem. Separately, `RenewalOfferService.acceptOffer` (in `renewal-offer-service.ts`) checks `offer.status !== "SENT"` *outside* the transaction (TOCTOU) and calls `updateMany({ where: { renewed_to_agreement_id: null } })` on the predecessor **without checking `.count`** — so a losing concurrent acceptance silently creates an orphaned successor `Agreement` instead of failing. Confirms bug #4.
5. `RenewalOfferService.expireStaleOffers()` is fully implemented but grep confirms zero callers anywhere in the codebase — its own docstring claims "Called by lifecycle cron" but `processDailyLifecycle` never calls it. Confirms bug #5.
6. `RenewalStatusService.determineRenewalStage` never checks whether the agreement already has a successor (`hasSuccessor`/`renewal_blocked_reason === "SUCCESSOR_EXISTS"`, both already computed by `RenewalDecisionService.evaluateAgreement`) before returning a reminder stage. Confirms bug #6.
7. `determineRenewalStage` uses exact equality (`daysUntilExpiry === 30`, `=== 15`, `daysOverdue === 7`, `=== gracePeriodDays`) — a single missed cron run permanently skips that stage, since the day counter moves past the exact value before the next run. Confirms bug #7. The delivery layer (`whatsapp-template-delivery.ts`) already enforces per-`(stage, agreement.id)` idempotency via a DB unique constraint on `whatsapp_logs.idempotency_key` with `ON CONFLICT DO NOTHING` — so switching from exact-match to threshold/range-match is safe: a stage can now match on multiple consecutive days, but will still only ever send once.

---

## Task 1: Cron activation generates rent schedules (P0 bug #1)

**Files:**
- Modify: `backend-next/src/services/tenants/agreement-lifecycle-service.ts`
- Test: `backend-next/tests/agreement-renewal-activation.test.ts`

**Interfaces:**
- Consumes: `agreementRentScheduleService.generateForAgreementInTx(tx, agreementId, options?)` from `backend-next/src/services/payments/agreement-rent-schedule-service.ts` (already used identically by `agreement-renewal-signing-service.ts:287`). Consumes `financialLifecycleService.notifyActivated(params)` from `backend-next/src/services/payments/financial-lifecycle-service.ts` (already used identically by `agreement-renewal-signing-service.ts:309-315`).
- Produces: no new exports; `activateScheduledRenewals` behavior change only.

- [ ] **Step 1: Write the failing test**

Add to `backend-next/tests/agreement-renewal-activation.test.ts`, after the mock setup at the top add a mock for the rent schedule service, then add a new test:

```ts
// Add near the other vi.mock(...) calls at the top of the file:
vi.mock("@/src/services/payments/agreement-rent-schedule-service", () => ({
  agreementRentScheduleService: {
    generateForAgreementInTx: mocks.generateForAgreementInTx,
  },
}));

vi.mock("@/src/services/payments/financial-lifecycle-service", () => ({
  financialLifecycleService: {
    notifyActivated: mocks.notifyActivated,
  },
}));
```

```ts
// Add to the mocks = vi.hoisted(() => ({ ... })) object:
generateForAgreementInTx: vi.fn().mockResolvedValue({ created: 12, updated: 0, skipped: 0, months: [] }),
notifyActivated: vi.fn(),
```

```ts
// New test, inside describe("AgreementRenewalActivation", ...):
it("generates the rent schedule for the activated draft inside the same transaction", async () => {
  const today = new Date("2026-07-01T00:00:00.000Z");
  const mockDraft = {
    id: "draft-agreement-id",
    tenant_id: "tenant-id",
    hostel_id: "hostel-id",
    status: "DRAFT",
    agreement_start_date: today,
    agreement_end_date: new Date("2027-06-30T00:00:00.000Z"),
    agreement_duration_months: 12,
    contract_rent: 8500,
    contract_security_deposit: 6000,
    contract_maintenance: 1000,
    contract_maintenance_type: "MONTHLY",
    contract_payment_frequency: "MONTHLY",
    template_id: "template-id",
    content_snapshot: { source: "renewal_offer", renewal_offer_id: "offer-id" },
    tenant: { owner_id: "owner-id", profiles: { name: "Adithya" }, rent_obligations: [] },
    template: { owner_signature_url: "url", owner_name: "Owner", rules_content: { rules: [] }, version_number: 1 },
    renewed_from_agreement: {
      id: "predecessor-agreement-id",
      status: "SIGNED",
      renewed_to_agreement_id: "draft-agreement-id",
      tenant_signature_url: "s", tenant_signature_name: "n", tenant_signed_at: today,
      tenant_ip: "127.0.0.1", tenant_user_agent: "UA",
      guardian_signature_url: null, guardian_signature_name: null, guardian_relation: null,
      guardian_signed_at: null, guardian_ip: null, guardian_user_agent: null,
      owner_signature_url: "o", owner_signature_name: "Owner",
      rules_snapshot: { rules: [] }, rule_version_id: "rule-v1", rule_version_number: "v1",
      content_snapshot: {},
    },
  };

  mocks.agreementFindMany.mockResolvedValue([mockDraft]);

  const summary = {
    checked: 0, marked_expiring: 0, marked_expired: 0, reminders_30d: 0, reminders_15d: 0,
    expiry_notifications: 0, skipped_legacy: 0, failed: 0, errors: [], renewals_activated: 0,
  };
  const touchedOwnerIds = new Set<string>();
  const touchedHostelIds = new Set<string>();

  await service.activateScheduledRenewals(today, summary, touchedOwnerIds, touchedHostelIds);

  expect(summary.renewals_activated).toBe(1);
  expect(mocks.generateForAgreementInTx).toHaveBeenCalledWith(
    expect.anything(),
    "draft-agreement-id"
  );
  expect(mocks.notifyActivated).toHaveBeenCalledWith(
    expect.objectContaining({ tenantId: "tenant-id", ownerId: "owner-id", hostelId: "hostel-id" })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && npx vitest run tests/agreement-renewal-activation.test.ts -t "generates the rent schedule"`
Expected: FAIL — `mocks.generateForAgreementInTx` was never called (0 calls).

- [ ] **Step 3: Implement the fix**

In `backend-next/src/services/tenants/agreement-lifecycle-service.ts`:

Add imports at the top:
```ts
import { agreementRentScheduleService } from "../payments/agreement-rent-schedule-service";
import { financialLifecycleService } from "../payments/financial-lifecycle-service";
```

Inside `activateScheduledRenewals`, immediately after the `tx.tenants.update({...})` call and before the `eventLog.log(AGREEMENT_ACTIVITY_EVENTS.RENEWED, ...)` call (i.e. still inside the `prisma.$transaction(async (tx) => { ... })` block), add:

```ts
          // Generate the rent schedule synchronously in the same transaction as
          // activation, exactly as the manual signing path does in
          // agreementRenewalSigningService.signRenewalAgreement — this is what
          // keeps cron activation and manual signing producing identical
          // financial state.
          await agreementRentScheduleService.generateForAgreementInTx(tx, draft.id);
```

After the `await prisma.$transaction(...)` block completes (still inside the `for (const draft of pendingActivations)` loop, after `summary.renewals_activated++;`), add the post-commit notification (mirrors `agreement-renewal-signing-service.ts:305-315`):

```ts
        const activatedOwnerId = draft.tenant?.owner_id || draft.hostel?.owner_id || null;
        if (activatedOwnerId) {
          financialLifecycleService.notifyActivated({
            tenantId: draft.tenant_id,
            ownerId: activatedOwnerId,
            hostelId: draft.hostel_id,
            source: "renewal_cron_activation",
          });
        }
```

Also update the misleading class-level doc-comment (it currently blanket-claims the whole cron "must never create obligations, touch ledgers... or change tenant status" — that's true of the *expiry-tracking walk* in `processDailyLifecycle`'s main loop, but `activateScheduledRenewals` already writes `tenants.monthly_rent/security_deposit/maintenance_charge` and, after this fix, rent obligations too — because it is completing the exact same lifecycle transition manual signing does):

```ts
  /**
   * The expiry-tracking walk below (status marking + 30d/15d/expiry-day
   * reminders) is deliberately isolated from occupancy and financials and
   * must never create obligations, touch ledgers, change tenant.status,
   * release rooms, or start move-outs.
   *
   * activateScheduledRenewals() is a different concern: it completes a
   * renewal activation that manual signing (agreementRenewalSigningService)
   * can also complete, so it intentionally mirrors that path's financial
   * writes (tenant contract fields, rent schedule generation) to keep both
   * activation routes producing identical state.
   */
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-next && npx vitest run tests/agreement-renewal-activation.test.ts`
Expected: PASS, all tests in the file green (including the two pre-existing tests).

- [ ] **Step 5: Run the full existing suite for this file plus the rent-schedule service's own tests to check for regressions**

Run: `cd backend-next && npx vitest run tests/agreement-renewal-activation.test.ts tests/agreement-rent-schedule-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Update `docs/obsidian/Bugs.md` and `docs/obsidian/Changelog.md`**

Add an entry to `docs/obsidian/Bugs.md` describing the gap (cron activation didn't generate rent schedules, causing signed renewal agreements with no rent obligations) and the fix (cron now calls the same `generateForAgreementInTx` the manual signing path uses). Link `[[Backend]]` and `[[Business-Rules]]`. Add one line to `docs/obsidian/Changelog.md`.

- [ ] **Step 7: Commit**

```bash
git add backend-next/src/services/tenants/agreement-lifecycle-service.ts backend-next/tests/agreement-renewal-activation.test.ts docs/obsidian/Bugs.md docs/obsidian/Changelog.md
git commit -m "fix(renewal): cron activation now generates rent schedule like manual signing"
```

**STOP — present root cause / diff / test results to user, wait for explicit review before Task 2.**

---

## Task 2: Manual signing enforces security deposit validation (P0 bug #2)

**Files:**
- Modify: `backend-next/src/services/tenants/agreement-renewal-signing-service.ts`
- Test: `backend-next/tests/agreement-renewal-signing-service.test.ts`

**Interfaces:**
- Consumes: nothing new — uses `tx.rent_obligations.findFirst` (already used identically by the cron path in `agreement-lifecycle-service.ts`'s `activateScheduledRenewals`, lines 288-297, and already present on the test file's `tx.rent_obligations` mock — currently missing `findFirst`, must be added).
- Produces: new error code `SECURITY_DEPOSIT_UNPAID` on `AgreementRenewalSigningError`.

- [ ] **Step 1: Write the failing test**

In `backend-next/tests/agreement-renewal-signing-service.test.ts`, first add `findFirst` to the `rent_obligations` mock inside `createDb()` (required regardless of pass/fail — the real code will call it once Step 3 lands, and other tests must not break):

```ts
    rent_obligations: {
      findFirst: vi.fn().mockResolvedValue(options.unpaidDeposit ?? null),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
```

Add `unpaidDeposit?: any;` to the `createDb` options type.

New test:

```ts
it("blocks signing when an unpaid security deposit obligation exists for the renewal agreement", async () => {
  const { db, tx, records } = createDb({
    unpaidDeposit: { id: "deposit-ob-1", agreement_id: "agreement-2", amount: 4000, status: "PENDING" },
  });
  const { service } = createService(db);

  await expect(service.signRenewalAgreement(validInput)).rejects.toMatchObject({
    code: "SECURITY_DEPOSIT_UNPAID",
    status: 409,
    details: expect.objectContaining({ obligationId: "deposit-ob-1", amount: 4000 }),
  });
  expect(records.get("agreement-1").status).toBe("SIGNED");
  expect(records.get("agreement-2").status).toBe("DRAFT");
  expect(tx.agreement.updateMany).not.toHaveBeenCalled();
});

it("allows signing when the security deposit obligation is already paid", async () => {
  const { db, records } = createDb({
    unpaidDeposit: null, // findFirst filters to PENDING/PARTIAL only, so a PAID row wouldn't be returned anyway
  });
  const { service } = createService(db);

  await service.signRenewalAgreement(validInput);

  expect(records.get("agreement-2").status).toBe("SIGNED");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && npx vitest run tests/agreement-renewal-signing-service.test.ts -t "blocks signing when an unpaid security deposit"`
Expected: FAIL — no such check exists yet, signing succeeds instead of throwing.

- [ ] **Step 3: Implement the fix**

In `backend-next/src/services/tenants/agreement-renewal-signing-service.ts`:

Add `"SECURITY_DEPOSIT_UNPAID"` to the `AgreementRenewalSigningErrorCode` union.

Inside the transaction in `signRenewalAgreement`, immediately after the `activeMoveOut` check block (after line 191, before the `predecessorUpdate` block), add — mirroring the exact query shape `activateScheduledRenewals` already uses in `agreement-lifecycle-service.ts:288-297`:

```ts
      const unpaidDeposit = await tx.rent_obligations.findFirst({
        where: {
          agreement_id: renewalAgreement.id,
          obligation_type: "SECURITY_DEPOSIT",
          status: { in: ["PENDING", "PARTIAL"] },
          is_superseded: false,
        },
      });
      if (unpaidDeposit) {
        throw new AgreementRenewalSigningError(
          "SECURITY_DEPOSIT_UNPAID",
          "Renewal security deposit must be paid before signing",
          {
            renewalAgreementId: renewalAgreement.id,
            obligationId: unpaidDeposit.id,
            amount: Number(unpaidDeposit.amount),
          }
        );
      }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-next && npx vitest run tests/agreement-renewal-signing-service.test.ts`
Expected: PASS, all tests including the pre-existing 11 tests in the file.

- [ ] **Step 5: Update `docs/obsidian/Bugs.md` and `docs/obsidian/Changelog.md`, commit**

```bash
git add backend-next/src/services/tenants/agreement-renewal-signing-service.ts backend-next/tests/agreement-renewal-signing-service.test.ts docs/obsidian/Bugs.md docs/obsidian/Changelog.md
git commit -m "fix(renewal): manual signing now blocks on unpaid renewal security deposit"
```

**STOP — present results, wait for review before Task 3.**

---

## Task 3: Cron transition safeguards + agreement chain integrity locking (P0 bugs #3 and #4)

Combined into one task because bug #3's checks (predecessor renewable, no active move-out, lifecycle complete) must run against a **locked** read to be race-free — implementing them without bug #4's locking fix first would just move the TOCTOU window rather than closing it. Two files are touched; each gets its own sub-steps and can be reviewed as two logical diffs within this one task if useful, but they land together since they're interdependent.

**Files:**
- Modify: `backend-next/src/services/tenants/agreement-lifecycle-service.ts` (cron: add locking + safeguards)
- Modify: `backend-next/src/services/tenants/renewal-offer-service.ts` (`acceptOffer`: add locking + count check)
- Test: `backend-next/tests/agreement-renewal-activation.test.ts`
- Test: `backend-next/tests/renewal-offer-service.test.ts`

**Interfaces:**
- Consumes: `isCurrentAgreementStatus` from `./agreement-status` (already exported, already used by `agreement-renewal-signing-service.ts`). `assertAgreementLifecycleComplete` from `./agreement-lifecycle-completeness` (already exported, already used by both existing draft-creation services).
- Produces: no new exports.

### Part A — cron (`agreement-lifecycle-service.ts`)

- [ ] **Step 1: Write the failing tests**

Add to `backend-next/tests/agreement-renewal-activation.test.ts`:

```ts
it("blocks activation when the predecessor is no longer in a renewable status", async () => {
  const today = new Date("2026-07-01T00:00:00.000Z");
  const mockDraft = {
    id: "draft-agreement-id",
    tenant_id: "tenant-id",
    hostel_id: "hostel-id",
    status: "DRAFT",
    agreement_start_date: today,
    tenant: { owner_id: "owner-id", profiles: { name: "Adithya" }, rent_obligations: [] },
    renewed_from_agreement: { id: "predecessor-agreement-id", status: "TERMINATED" },
  };
  mocks.agreementFindMany.mockResolvedValue([mockDraft]);

  const summary = { checked: 0, marked_expiring: 0, marked_expired: 0, reminders_30d: 0, reminders_15d: 0, expiry_notifications: 0, skipped_legacy: 0, failed: 0, errors: [], renewals_activated: 0 };
  await service.activateScheduledRenewals(today, summary, new Set(), new Set());

  expect(summary.renewals_activated).toBe(0);
  expect(summary.failed).toBe(0);
  expect(mocks.agreementUpdate).not.toHaveBeenCalled();
  expect(mocks.eventLogLog).toHaveBeenCalledWith(
    "RENEWAL_ACTIVATION_BLOCKED",
    "owner-id",
    expect.objectContaining({ reason: "Predecessor agreement is not in a renewable status" }),
    "tenant-id"
  );
});

it("blocks activation when the tenant has an active move-out request", async () => {
  const today = new Date("2026-07-01T00:00:00.000Z");
  mocks.moveOutFindFirst.mockResolvedValue({ id: "move-1", status: "REQUESTED" });
  const mockDraft = {
    id: "draft-agreement-id",
    tenant_id: "tenant-id",
    hostel_id: "hostel-id",
    status: "DRAFT",
    agreement_start_date: today,
    tenant: { owner_id: "owner-id", profiles: { name: "Adithya" }, rent_obligations: [] },
    renewed_from_agreement: { id: "predecessor-agreement-id", status: "SIGNED" },
  };
  mocks.agreementFindMany.mockResolvedValue([mockDraft]);

  const summary = { checked: 0, marked_expiring: 0, marked_expired: 0, reminders_30d: 0, reminders_15d: 0, expiry_notifications: 0, skipped_legacy: 0, failed: 0, errors: [], renewals_activated: 0 };
  await service.activateScheduledRenewals(today, summary, new Set(), new Set());

  expect(summary.renewals_activated).toBe(0);
  expect(mocks.eventLogLog).toHaveBeenCalledWith(
    "RENEWAL_ACTIVATION_BLOCKED",
    "owner-id",
    expect.objectContaining({ reason: "Move-out already in progress" }),
    "tenant-id"
  );
});
```

Add `moveOutFindFirst: vi.fn().mockResolvedValue(null)` to the hoisted `mocks` object, and add `move_out_requests: { findFirst: mocks.moveOutFindFirst }` to the mocked `prisma` object in the `vi.mock("@/lib/db", ...)` block. Also extend the transaction mock's `tx` object (the `mocks.transaction` callback) to include `$queryRaw: vi.fn()` and `agreement: { update: mocks.agreementUpdate, updateMany: mocks.agreementUpdateMany }` — add `agreementUpdateMany: vi.fn(async () => ({ count: 1 }))` to the hoisted mocks (needed for Part A Step 3's conditional-update rewrite).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && npx vitest run tests/agreement-renewal-activation.test.ts -t "blocks activation when the predecessor"`
Expected: FAIL — no such check exists, activation proceeds.

- [ ] **Step 3: Implement the fix**

In `backend-next/src/services/tenants/agreement-lifecycle-service.ts`, add the import:
```ts
import { isCurrentAgreementStatus } from "./agreement-status";
import { assertAgreementLifecycleComplete } from "./agreement-lifecycle-completeness";
```

In `activateScheduledRenewals`, replace the body of the `for (const draft of pendingActivations)` loop's pre-transaction section (everything from `const predecessor = draft.renewed_from_agreement;` down to the `pendingDeposit` block) with:

```ts
      try {
        const predecessor = draft.renewed_from_agreement;
        if (!predecessor) {
          throw new Error("Predecessor agreement not found for renewal draft");
        }

        const ownerId = draft.tenant?.owner_id || draft.hostel?.owner_id || null;

        if (!isCurrentAgreementStatus(predecessor.status)) {
          await eventLog.log("RENEWAL_ACTIVATION_BLOCKED", ownerId, {
            agreement_id: draft.id,
            predecessor_id: predecessor.id,
            tenant_id: draft.tenant_id,
            reason: "Predecessor agreement is not in a renewable status",
            predecessor_status: predecessor.status,
          }, draft.tenant_id);
          continue;
        }

        const activeMoveOut = await prisma.move_out_requests.findFirst({
          where: {
            tenant_id: draft.tenant_id,
            status: { notIn: ["COMPLETED", "REJECTED"] },
          },
          select: { id: true, status: true },
          orderBy: { created_at: "desc" },
        });
        if (activeMoveOut) {
          await eventLog.log("RENEWAL_ACTIVATION_BLOCKED", ownerId, {
            agreement_id: draft.id,
            predecessor_id: predecessor.id,
            tenant_id: draft.tenant_id,
            reason: "Move-out already in progress",
            move_out_request_id: activeMoveOut.id,
          }, draft.tenant_id);
          continue;
        }

        try {
          assertAgreementLifecycleComplete(draft, { agreementId: draft.id });
        } catch (error: any) {
          await eventLog.log("RENEWAL_ACTIVATION_BLOCKED", ownerId, {
            agreement_id: draft.id,
            predecessor_id: predecessor.id,
            tenant_id: draft.tenant_id,
            reason: "Agreement lifecycle metadata is incomplete",
            details: error?.details || null,
          }, draft.tenant_id);
          continue;
        }

        // Filter obligations to those belonging to this draft agreement
        const pendingDeposit = draft.tenant?.rent_obligations?.find(
          (ob) => ob.agreement_id === draft.id
        ) || null;

        if (pendingDeposit) {
          await eventLog.log("RENEWAL_ACTIVATION_BLOCKED", ownerId, {
            agreement_id: draft.id,
            predecessor_id: predecessor.id,
            tenant_id: draft.tenant_id,
            reason: "Unpaid security deposit top-up obligation",
            obligation_id: pendingDeposit.id,
            amount: Number(pendingDeposit.amount),
          }, draft.tenant_id);
          continue;
        }
```

(This preserves the existing `pendingDeposit` block's exact log shape — just reordered after the three new checks — so the existing "blocks activation if there is an unpaid security deposit obligation" test keeps passing unchanged.)

Then continue into Part B-equivalent locking for cron (this is bug #4's cron half): replace the transaction body's two unconditional `tx.agreement.update` calls with locked, conditional versions. Immediately inside `await prisma.$transaction(async (tx) => {`, add:

```ts
          await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${predecessor.id}::uuid FOR UPDATE`;
          await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${draft.id}::uuid FOR UPDATE`;
```

Replace:
```ts
          await tx.agreement.update({
            where: { id: predecessor.id },
            data: { status: "RENEWED", renewed_at: today },
          });
```
with:
```ts
          const predecessorUpdate = await tx.agreement.updateMany({
            where: { id: predecessor.id, status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] }, renewed_to_agreement_id: draft.id },
            data: { status: "RENEWED", renewed_at: today },
          });
          if (predecessorUpdate.count !== 1) {
            throw new Error("Renewal chain changed during cron activation (predecessor)");
          }
```

Replace the `tx.agreement.update({ where: { id: draft.id }, data: {...} })` call with `tx.agreement.updateMany({ where: { id: draft.id, status: "DRAFT", renewed_from_agreement_id: predecessor.id }, data: {...same data...} })`, and after it:
```ts
          if (draftUpdate.count !== 1) {
            throw new Error("Renewal chain changed during cron activation (draft)");
          }
```

A thrown error inside `prisma.$transaction` rolls the transaction back automatically and is caught by the existing outer `catch (err: any) { summary.failed++; summary.errors.push(...) }` in the loop — no new error handling needed there.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-next && npx vitest run tests/agreement-renewal-activation.test.ts`
Expected: PASS, all tests (2 pre-existing + 1 from Task 1 + 2 new here).

### Part B — `renewal-offer-service.ts`'s `acceptOffer`

- [ ] **Step 5: Write the failing test**

Read `backend-next/tests/renewal-offer-service.test.ts` first to match its existing mock conventions for `db`/`tx` (it wasn't fully read during investigation — read it before writing this step's exact test code, then add):

```ts
it("fails acceptance instead of creating an orphaned successor when the predecessor's renewed_to_agreement_id changed concurrently", async () => {
  // Arrange a tx mock whose agreement.updateMany for the predecessor-link
  // returns count: 0 (simulating a concurrent acceptance that already won).
  // Assert acceptOffer throws (a CONFLICT-style error) and that no
  // RenewalOffer.status:"ACCEPTED" update / RenewalDecision row is committed
  // as a side effect of the losing transaction.
});
```

(Exact assertions depend on the test file's existing `tx` mock shape — follow its established pattern for asserting transaction rollback/throw, matching how other `CONFLICT`/`BAD_REQUEST` cases in that same file are already asserted.)

- [ ] **Step 6: Run test to verify it fails**

Run: `cd backend-next && npx vitest run tests/renewal-offer-service.test.ts -t "orphaned successor"`
Expected: FAIL — current code doesn't check the count, so no error is thrown.

- [ ] **Step 7: Implement the fix**

In `backend-next/src/services/tenants/renewal-offer-service.ts`, inside `acceptOffer`'s transaction, immediately after `const roomAllocation = offer.tenant?.room_allocations?.[0];` add a row lock on the predecessor, matching `agreement-renewal-service.ts:114`:

```ts
      await tx.$queryRaw`SELECT id FROM "Agreement" WHERE id = ${offer.agreement_id}::uuid FOR UPDATE`;
```

Replace:
```ts
      await tx.agreement.updateMany({
        where: { id: offer.agreement_id, renewed_to_agreement_id: null },
        data: { renewed_to_agreement_id: newAgreement.id },
      });
```
with:
```ts
      const linkUpdate = await tx.agreement.updateMany({
        where: { id: offer.agreement_id, renewed_to_agreement_id: null },
        data: { renewed_to_agreement_id: newAgreement.id },
      });
      if (linkUpdate.count !== 1) {
        throw new Error("CONFLICT: A renewal was already accepted for this agreement");
      }
```

Also move the `newAgreement` creation to *after* this lock is acquired but the count-check still guards everything downstream (deposit obligation creation, ledger entries) from running on a losing transaction — since it's all one `$transaction`, the throw rolls back the `newAgreement.create` too, so no orphan row survives. No further reordering is required; the row lock plus the now-checked `updateMany` count is sufficient because Postgres will serialize the two concurrent transactions on the `FOR UPDATE` lock, and the loser's `updateMany` will see the winner's already-committed non-null `renewed_to_agreement_id` and match 0 rows.

Also fix the pre-transaction TOCTOU: the `if (offer.status !== "SENT")` check currently reads the pre-transaction `offer` fetch. Re-check status inside the transaction against a fresh, lock-ordered read. Add, right after the `FOR UPDATE` line:

```ts
      const freshOffer = await tx.renewalOffer.findUnique({ where: { id: offerId } });
      if (!freshOffer || freshOffer.status !== "SENT") {
        throw new Error(`BAD_REQUEST: Cannot accept offer in status ${freshOffer?.status || "UNKNOWN"}`);
      }
```

(This mirrors the re-check pattern already used for `predecessorUpdate.count`/`renewalUpdate.count` in `agreement-renewal-signing-service.ts`.)

- [ ] **Step 8: Run test to verify it passes**

Run: `cd backend-next && npx vitest run tests/renewal-offer-service.test.ts`
Expected: PASS, including all pre-existing tests in the file.

- [ ] **Step 9: Update `docs/obsidian/Bugs.md`, `docs/obsidian/Changelog.md`, and `docs/obsidian/Decisions.md`**

This one warrants a `docs/obsidian/Decisions.md` ADR entry (it's a deliberate architectural choice — locking pattern applied consistently — not just a bugfix), in addition to `Bugs.md` and `Changelog.md`.

- [ ] **Step 10: Commit**

```bash
git add backend-next/src/services/tenants/agreement-lifecycle-service.ts backend-next/src/services/tenants/renewal-offer-service.ts backend-next/tests/agreement-renewal-activation.test.ts backend-next/tests/renewal-offer-service.test.ts docs/obsidian/Bugs.md docs/obsidian/Changelog.md docs/obsidian/Decisions.md
git commit -m "fix(renewal): add missing transition safeguards and row-locked chain integrity to cron activation and offer acceptance"
```

**STOP — present results, wait for review before Task 4.**

---

## Task 4: Wire offer expiration into the lifecycle cron (P1 bug #5)

**Files:**
- Modify: `backend-next/src/services/tenants/agreement-lifecycle-service.ts`
- Test: `backend-next/tests/agreement-renewal-activation.test.ts` (or a new lightweight test block in the same file)

**Interfaces:**
- Consumes: `renewalOfferService.expireStaleOffers()` from `./renewal-offer-service` (already implemented, zero callers today).
- Produces: `AgreementLifecycleSummary` gains a new field `offers_expired: number`.

- [ ] **Step 1: Write the failing test**

```ts
vi.mock("./renewal-offer-service", () => ({
  renewalOfferService: { expireStaleOffers: mocks.expireStaleOffers },
}));
// add expireStaleOffers: vi.fn().mockResolvedValue({ expiredCount: 3 }) to hoisted mocks

it("expires stale renewal offers as part of the daily lifecycle run", async () => {
  mocks.agreementFindMany.mockResolvedValue([]);
  const summary = await service.processDailyLifecycle(new Date("2026-07-01T00:00:00.000Z"));
  expect(mocks.expireStaleOffers).toHaveBeenCalledTimes(1);
  expect(summary.offers_expired).toBe(3);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && npx vitest run tests/agreement-renewal-activation.test.ts -t "expires stale renewal offers"`
Expected: FAIL — `expireStaleOffers` never called, `summary.offers_expired` undefined.

- [ ] **Step 3: Implement the fix**

Add `offers_expired: number;` to `AgreementLifecycleSummary` and to the initial `summary` object literal (`offers_expired: 0`).

Add the import:
```ts
import { renewalOfferService } from "./renewal-offer-service";
```

In `processDailyLifecycle`, right after `await this.activateScheduledRenewals(...)`, add:

```ts
    try {
      const { expiredCount } = await renewalOfferService.expireStaleOffers();
      summary.offers_expired = expiredCount;
    } catch (err: any) {
      console.error("[CRON] Failed to expire stale renewal offers:", err);
      summary.errors.push(`Offer expiration failed: ${err?.message || String(err)}`);
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-next && npx vitest run tests/agreement-renewal-activation.test.ts`
Expected: PASS.

- [ ] **Step 5: Update docs, commit**

```bash
git add backend-next/src/services/tenants/agreement-lifecycle-service.ts backend-next/tests/agreement-renewal-activation.test.ts docs/obsidian/Bugs.md docs/obsidian/Changelog.md
git commit -m "fix(renewal): wire expireStaleOffers into the daily lifecycle cron"
```

**STOP — present results, wait for review before Task 5.**

---

## Task 5: Stop expiry notifications once a successor exists (P1 bug #6)

**Files:**
- Modify: `backend-next/src/services/tenants/renewal-status-service.ts`
- Test: `backend-next/tests/whatsapp-renewal-notification.test.ts`

**Interfaces:**
- Consumes: `decision.has_successor` (already computed and returned by `RenewalDecisionService.evaluateAgreement`, `renewal-decision-service.ts:225`).
- Produces: no new exports; `determineRenewalStage` now short-circuits to `null` when a successor exists.

- [ ] **Step 1: Write the failing test**

Add to `backend-next/tests/whatsapp-renewal-notification.test.ts`, inside the existing `describe("AgreementRenewalNotificationService integration", ...)`:

```ts
it("does not send any expiry reminder once a successor agreement already exists", async () => {
  const now = new Date("2026-06-29T00:00:00.000Z"); // would be exactly 15 days remaining
  const agreementWithSuccessor = {
    ...baseAgreement,
    renewed_to_agreement_id: "successor-1",
    renewed_to_agreement: { id: "successor-1", status: "DRAFT" },
  };

  const result = await agreementRenewalNotificationService.processRenewalNotifications(agreementWithSuccessor, now);

  expect(result.skipped).toBe(true);
  expect(result.tenantSent).toBe(false);
  expect(result.ownerSent).toBe(false);
  expect(mockDeliverySend).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && npx vitest run tests/whatsapp-renewal-notification.test.ts -t "does not send any expiry reminder once a successor"`
Expected: FAIL — currently still sends the 15-day reminder regardless of successor.

- [ ] **Step 3: Implement the fix**

In `backend-next/src/services/tenants/renewal-status-service.ts`, in `determineRenewalStage`, right after computing `const decision = renewalDecisionService.evaluateAgreement(agreement, now);`, add:

```ts
    if (decision.has_successor) {
      // A successor draft/agreement already exists (offer accepted or manual
      // renewal draft created) — the predecessor no longer needs "please
      // renew" nudges; it's just waiting on the successor's own activation.
      return null;
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-next && npx vitest run tests/whatsapp-renewal-notification.test.ts`
Expected: PASS, all pre-existing tests plus the new one.

- [ ] **Step 5: Update docs**

Update `docs/obsidian/Business-Rules.md` (this is a business-rule change, not just a bugfix — add an ADR to `docs/obsidian/Decisions.md` too, per `CLAUDE.md`'s rule). Note in the write-up to the user: the same day-exact-match reminder logic (without a successor check) also exists in `processDailyLifecycle`'s main expiry-tracking loop (the plain in-app notifications gated by `expiry_notified_30d_at`/`expiry_notified_15d_at`, `agreement-lifecycle-service.ts:196-255`) — flag this as a discovered adjacent gap for the user to decide whether to include in scope, do not fix it unless asked (bug #6 as specced is scoped to the WhatsApp/`RenewalStatusService` path).

- [ ] **Step 6: Commit**

```bash
git add backend-next/src/services/tenants/renewal-status-service.ts backend-next/tests/whatsapp-renewal-notification.test.ts docs/obsidian/Business-Rules.md docs/obsidian/Decisions.md docs/obsidian/Changelog.md
git commit -m "fix(renewal): stop WhatsApp expiry reminders once a successor agreement exists"
```

**STOP — present results (including the flagged adjacent gap), wait for review before Task 6.**

---

## Task 6: WhatsApp reminder resilience to missed cron runs (P1 bug #7)

**Files:**
- Modify: `backend-next/src/services/tenants/renewal-status-service.ts`
- Test: `backend-next/tests/whatsapp-renewal-notification.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: no new exports; `determineRenewalStage`'s day-matching changes from exact equality to threshold bands. Idempotency is preserved for free by the existing `whatsapp_logs.idempotency_key` unique constraint (`whatsapp-template-delivery.ts:149-166`) — the key is `(stage, agreement.id)`, not date-based, so a stage matching on multiple consecutive calls still only ever sends once.

**Design constraint verified against existing tests:** all 9 existing cases in `whatsapp-renewal-notification.test.ts` must keep passing unchanged (verified by hand during investigation — see plan's Investigation Summary). In particular, `EXPIRY_DAY_ALERT` and `EXPIRED_RENT_OVERDUE` must NOT be converted to range checks — `EXPIRED_RENT_OVERDUE` is a *state*-based fallback (real overdue rent, not day-count) and broadening `EXPIRY_DAY_ALERT` into a multi-day band collides with it (verified this would break the existing "sends EXPIRED_RENT_OVERDUE alert" test, which sits at 6 days overdue). Only the two "reminder" stages (30-day, 15-day) and the two overdue-milestone stages (7-day, 30-day-critical) get range treatment.

- [ ] **Step 1: Write the failing tests**

Add to `backend-next/tests/whatsapp-renewal-notification.test.ts`:

```ts
it("catches up a missed 30-day reminder when cron resumes at 25 days remaining", async () => {
  const now = new Date("2026-06-19T00:00:00.000Z"); // 25 days before July 14 — cron missed day 30
  mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.catchup1" });

  const result = await agreementRenewalNotificationService.processRenewalNotifications(baseAgreement, now);

  expect(result.tenantSent).toBe(true);
  expect(mockDeliverySend).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: "agreement_renewal_30_day_reminder:agreement-123" })
  );
});

it("prefers the 15-day reminder over the 30-day reminder once inside the 15-day window", async () => {
  const now = new Date("2026-07-02T00:00:00.000Z"); // 12 days before July 14
  mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.catchup2" });

  const result = await agreementRenewalNotificationService.processRenewalNotifications(baseAgreement, now);

  expect(mockDeliverySend).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: "agreement_renewal_15_day_reminder:agreement-123" })
  );
  expect(mockDeliverySend).not.toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: "agreement_renewal_30_day_reminder:agreement-123" })
  );
});

it("catches up a missed 7-day-overdue alert before the grace-period critical threshold", async () => {
  const now = new Date("2026-07-30T00:00:00.000Z"); // 16 days overdue, grace period 30 — cron missed day 7
  mockDeliverySend.mockResolvedValue({ sent: true, skipped: false, providerMessageId: "wamid.catchup3" });
  const expiredAgreement = { ...baseAgreement, status: "AGREEMENT_EXPIRED" };

  const result = await agreementRenewalNotificationService.processRenewalNotifications(expiredAgreement, now);

  expect(mockDeliverySend).toHaveBeenCalledWith(
    expect.objectContaining({ idempotencyKey: "agreement_renewal_7_day_overdue:agreement-123" })
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend-next && npx vitest run tests/whatsapp-renewal-notification.test.ts -t "catches up"`
Expected: FAIL — exact-match logic returns `null` for all three (none of 25, 12, or 16-days-overdue hit an exact threshold today), so `processRenewalNotifications` returns `skipped: true` and never calls `mockDeliverySend`.

- [ ] **Step 3: Implement the fix**

In `backend-next/src/services/tenants/renewal-status-service.ts`, replace the four exact-equality checks:

```ts
    // 1. Critical overdue (grace period limit) — band, not exact day, so a
    // missed cron run still catches up instead of silently skipping this
    // stage forever. Idempotency is enforced downstream by the per-(stage,
    // agreement) delivery-log unique constraint, not by exact-day matching.
    if (
      (states.includes("RENEWAL_OVERDUE_CRITICAL") || states.includes("RENEWAL_DECISION_PENDING")) &&
      daysOverdue >= decision.grace_period_days
    ) {
      return "30_DAY_CRITICAL";
    }

    // 2. 7 days overdue (band: 7 up to, but not including, the grace-period
    // critical threshold handled above)
    if (
      (states.includes("RENEWAL_OVERDUE_CRITICAL") || states.includes("RENEWAL_DECISION_PENDING")) &&
      daysOverdue >= 7
    ) {
      return "7_DAY_OVERDUE";
    }

    // 3. Expiry day (0 days left) — intentionally kept as an exact match.
    // Unlike the reminder/overdue bands, there's no meaningful "catch-up"
    // for a single expiry-day alert once it's passed — the tenant moves
    // straight into the overdue bands above, and broadening this into a
    // multi-day band would collide with EXPIRED_RENT_OVERDUE below (a
    // rent-overdue *state* check, not a day-count check).
    if (daysUntilExpiry === 0) {
      return "EXPIRY_DAY_ALERT";
    }

    // 4. 15 days left (band: 1 up to and including 15)
    if (daysUntilExpiry !== null && daysUntilExpiry > 0 && daysUntilExpiry <= 15) {
      return "15_DAY_REMINDER";
    }

    // 5. 30 days left (band: 16 up to and including 30)
    if (daysUntilExpiry !== null && daysUntilExpiry > 15 && daysUntilExpiry <= 30) {
      return "30_DAY_REMINDER";
    }
```

(Section 6, `EXPIRED_RENT_OVERDUE`, is unchanged.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend-next && npx vitest run tests/whatsapp-renewal-notification.test.ts`
Expected: PASS — all 9 pre-existing tests plus the 3 new ones, 12 total green.

- [ ] **Step 5: Update docs**

Add an ADR to `docs/obsidian/Decisions.md` (deliberate architectural choice: range-based stage matching relying on delivery-layer idempotency rather than date-exact matching relying on cron reliability). Update `docs/obsidian/Bugs.md` and `docs/obsidian/Changelog.md`.

- [ ] **Step 6: Commit**

```bash
git add backend-next/src/services/tenants/renewal-status-service.ts backend-next/tests/whatsapp-renewal-notification.test.ts docs/obsidian/Decisions.md docs/obsidian/Bugs.md docs/obsidian/Changelog.md
git commit -m "fix(renewal): make WhatsApp expiry reminder stages resilient to missed cron runs"
```

**STOP — present results, wait for review before deciding on P2.**

---

## P2 (only after explicit approval, do not start unprompted): Audit and deduplicate activation logic

Per the originating spec: audit `activateScheduledRenewals` (cron) vs. `signRenewalAgreement` (manual) now that Tasks 1-3 have brought them to parity, and if they still contain duplicated business logic (predecessor-renewable check, move-out check, lifecycle-completeness check, rent-schedule generation call, tenant-contract-field update), extract a shared helper — without changing observable behavior. This is explicitly deferred: "Do NOT change business behavior. Only eliminate divergence," and the user must approve scope before this starts, since it's a refactor across two files that Tasks 1-3 will have just modified.

---

## Self-Review Notes

- **Spec coverage:** all 7 numbered bugs (P0 #1-4, P1 #5-7) have a task. P2 is explicitly deferred pending approval, matching the spec's own "wait for review" instruction and its P2 framing ("After P0/P1 are complete").
- **Placeholder scan:** no TBD/TODO; Task 3 Part B Step 5's test is intentionally left as a shape-description rather than literal code because `renewal-offer-service.test.ts` wasn't read in full during investigation — the plan explicitly calls this out as the one step requiring a read-before-write, rather than silently guessing a mock shape that might not compile.
- **Type/signature consistency:** `generateForAgreementInTx(tx, agreementId, options?)`, `notifyActivated({tenantId, ownerId, hostelId, source})`, `isCurrentAgreementStatus(status)`, `assertAgreementLifecycleComplete(agreement, {agreementId})`, `expireStaleOffers(): Promise<{expiredCount: number}>`, `decision.has_successor: boolean` — all copied verbatim from the actual current source, not invented.
