# Financial Consistency Investigation Report

**Date:** 2026-07-16
**Status:** Investigation only — no fixes applied. Findings below are cited to exact files/lines; nothing here is guessed.
**Trigger:** Screenshots from the new Owner Financial Workspace UI surfaced simultaneous "Outstanding" + "Future Credit," divergent tenant-portal vs owner-dashboard numbers, and a Quick Collect flow that appeared to skip Settlement Preview.

---

## 0. Critical context found before anything else

The repository's `HEAD` commit is **`cf88ce94`**, authored **2026-07-16 08:53:27** (this morning), titled:

> *feat(financial-engine): unify obligation activation lifecycle, fix overdue dashboard and future-credit auto-consumption*

Its own commit message states almost verbatim the root cause behind Problem 1: obligation activation and future-rent-credit consumption were previously scattered behind an async, fire-and-forget `obligation_created` event that the primary activation path (`syncDueStatuses`) never even fired, so credit silently went unconsumed.

**This means Problem 1's mechanism has already been rewritten in code, today, before this investigation started.** The screenshots (timestamped 6:32 PM) were taken *after* this commit landed (8:53 AM), which raises three distinct possibilities that must be told apart before any further fix work:

- **(a)** The fix is real and correct, but whatever server produced the screenshots (production `sriadithyahostels.in`, and/or a local dev server) had not picked it up yet (not redeployed / stale process).
- **(b)** The fix is real and correct for *newly created* obligations going forward, but does **not retroactively repair** obligations/ledger rows that were already generated under the old, buggy fire-and-forget path before `cf88ce94` merged. The specific tenants in the screenshots may simply be carrying old, already-broken state.
- **(c)** There is a residual gap the commit didn't fully close (one candidate identified below, §1.4).

This distinction is why Problem 7 (data audit) matters more than it might first appear — it's the only way to tell (b) apart from (a)/(c), and I could not complete it (see §7).

---

## 1. Problem 1 & 5 — Future Credit + Outstanding coexisting; activation pipeline

### 1.1 How rent generation actually works (current `HEAD`)

- `lib/jobs/index.ts` is **dead code** — it imports three modules that don't exist (`../services/rent-generation-service`, `../services/payment-service`, `../services/payments/financial-domain`); `tsc` confirms `TS2307` on all three, and nothing in the repo imports `lib/jobs`. It is not wired to any cron/job runner. Ignore this file.
- The real cron entrypoint is `app/api/cron/generate-rent/route.ts:134` → `rentGenerationService.generateMonthlyRent()` in `src/services/payments/rent-generation-service.ts`.
- Inside `generateMonthlyRent`: obligation rows are inserted directly as `status: "PENDING"` (already payable) at `rent-generation-service.ts:420,461`, then in the **same transaction**, re-fetched and passed to `financialLifecycleService.activatePayableObligations(tx, ...)` at `rent-generation-service.ts:513–527`.
- `agreementRentScheduleService.syncDueStatuses({ hostelId, now })` (the path the commit message specifically calls out as previously broken) runs before generation, at `rent-generation-service.ts:111`.

### 1.2 The orchestrator: `FinancialLifecycleService.activatePayableObligations`

`src/services/payments/financial-lifecycle-service.ts:47–63`:
1. Calls `obligationEngine.markObligationsPayableInTx(tx, {obligationIds})` — domain-only UPCOMING→PENDING transition (`obligation-engine.ts:524–570`).
2. Unconditionally calls `financialPaymentFacade.applyAvailableCredits(tx, {tenantId, ownerId, hostelId, actorId: ownerId})` — **no `obligationIdFilter`**, i.e. a broad sweep across *all* the tenant's outstanding obligations, not just the newly-created one.

`applyAvailableCredits` (`financial-payment-facade.ts:198–283`): locks the tenant row, reads the ledger's future-credit balance (`tenantFinancialLedgerService.getFutureRentCreditBalanceInTx`), fetches every obligation with legacy `status IN ["OVERDUE","PENDING","PARTIAL","UPCOMING"]`, builds a settlement plan capped at `min(balance, totalOutstanding)`, and executes it with `fundingSource: "EXISTING_CREDIT"`.

**Confirmed call sites of `applyAvailableCredits`:**
- `financial-lifecycle-service.ts:55` — automatic sweep (fires from every `activatePayableObligations` call).
- `app/api/tenants/[id]/financial-ledger/adjust/route.ts:47` — manual, owner-initiated.

`receivePayment` (`financial-payment-facade.ts:111–173`, the "record a new payment" path) is a **separate** method funded from `NEW_PAYMENT` — it never calls `applyAvailableCredits`. This confirms the pre-fix bug precisely: before today, existing credit only ever got swept as a *side effect of the next new payment's settlement plan*, never proactively when a new obligation was generated.

**Confirmed call sites of `activatePayableObligations`** (11, per grep): `rent-generation-service.ts:523`, `agreement-rent-schedule-service.ts:231,300` (inside `syncDueStatuses`), `renewal-offer-service.ts:477`, `invitation-service.ts:200`, `reminder-service.ts:201,269`, `app/api/payments/obligations/route.ts:118`, `onboarding-maintenance-repair-service.ts:113`, `tenant-invitation-lifecycle-service.ts:376,669`.

### 1.3 Ledger mechanics

- `FUTURE_RENT_CREDIT_TOPUP` (credit *created*) — `settlement-engine.ts:387–397`, fires whenever a new payment's settlement plan overflows past what's owed.
- `FUTURE_CREDIT_APPLIED` (credit *consumed*, a DEBIT) — `settlement-engine.ts:366–380`, fires when `fundingSource === "EXISTING_CREDIT"` (i.e. from `applyAvailableCredits`, not from a new payment).
- `tenant-financial-ledger-service.ts:391–396` has an explicit comment marking older per-entry sweep helpers (`adjustAgainstObligation(InTx)`, `autoApplyFutureRentCreditToDuesInTx`, `autoApplyAdvanceToDuesInTx`) as **"retired — superseded by FinancialPaymentFacade.applyAvailableCredits"** — i.e. this exact mechanism has been reworked more than once; today's commit is the latest iteration.

### 1.4 One residual gap the commit did not fully close

`src/services/payments/onboarding-financials-service.ts:93,132,174` creates `rent_obligations` rows directly and does **not itself** call `activatePayableObligations` — activation is left to the *caller*. Verified both real callers (`tenant-invitation-lifecycle-service.ts:374–382` and `:667–675`) do correctly call `activatePayableObligations` on the returned `createdObligationIds`, so this is not currently an open hole for those two paths — but it is a fragile pattern: nothing enforces the follow-up call at the service boundary, so any *future* caller of `initializeOnboardingFinancials` that forgets it will silently reintroduce this exact bug for that path alone.

### 1.5 Root cause

**Prior to `cf88ce94` (this morning): backend / activation pipeline bug.** Future credit was only ever consumed reactively, as a side effect of the tenant's *next* payment's settlement plan — nothing ran at rent-generation or obligation-activation time to sweep existing credit against a newly created obligation. The commit fixes this by making `activatePayableObligations` (now called from 11 real sites, including the previously-silent `syncDueStatuses`) unconditionally invoke `applyAvailableCredits` inside the same transaction as obligation creation/activation.

**As of `HEAD`: the mechanism is fixed for all obligation-creation paths audited.** Whether the specific tenants in the screenshots are still showing the bug is now a **deployment-freshness or pre-existing-data question, not a code-correctness question** — see §7.

---

## 2, 4, 6 — Tenant vs owner divergence; audit table

There is **no single canonical "Financial Engine" that every screen reads**. There are **five independently-written calculators** for "outstanding/overdue," plus **two independent frontend recomputations** in the tenant portal that don't even read the backend fields that already exist for this purpose.

### 2.1 Audit table

| Consumer | Endpoint / File | Computation source | Canonical? | Notes |
|---|---|---|---|---|
| Tenant portal home — "Rent status" banner | `apps/frontend/src/portal/components/TenantPriorityStrip.tsx:21-46` | Client-side `daysUntil()`/`isOverdue` on `nextDue`; **amount** shown is `dues.total_due` (includes UPCOMING), not `dues.overdue_amount` | Partial | Backend already returns the correct `overdue_amount` on the same payload — this component just doesn't read it (`:31`). |
| Tenant portal Financials page — "Payment Overdue / Amount Overdue" hero | `apps/frontend/src/portal/pages/TenantFinancialsPage.tsx:581-667` (`financialHealth` memo) | Fully independent client math over `installments` derived from `GET /api/tenants/me/billing-timeline` | **No** | Never touches `dues.overdue_amount`. Feeds from the legacy `billing-timeline-service.ts`, not `financial-service.ts`/`obligation-engine.ts`. |
| Tenant portal "Future Rent Credit / Security Deposit" card | `TenantDashboardPage.tsx:332-352` via `GET /api/tenants/me/financial-ledger` | `tenantFinancialLedgerService.getBalanceForTenant()` | **Yes** | The one clean, canonical calculation on the tenant side. `future_rent_credit = max(0, balance - securityDeposit)` (`tenant-financial-ledger-service.ts:82`). |
| `GET /api/tenants/me/billing-timeline` | `lib/services/billing-timeline-service.ts` | Independent `daysUntil()`/state derivation (`:9-14,90-96`) | **No** | Does not call `derivePresentationStatus`/`isOverdue`/`obligation-engine` at all. This is the legacy service still powering the tenant Financials page. |
| `GET /api/payments/tenant-dues` | `payment-service.ts:735` → `financialService.getTenantDues` (`financial-service.ts:258-346`) | Semi-canonical | `overdue_amount` (`:329-331`) correctly uses `isOverdue()` from `settlement-planner.ts`. But `total_due` (`:321,336`) intentionally includes UPCOMING — frontends conflate this with "current owed" (`TenantPriorityStrip.tsx:31`, `TenantFinancialsPage.tsx:716`). |
| `GET /api/payments/financial-status` | `financial-service.ts:433-640` (`getTenantFinancialStatus`) | **Independent, 3rd calculator in the same file** | `payable_now` (`:543-550`) is a from-scratch re-fetch/re-sum, duplicating `getTenantDues()` in the same class with different status filters. Not currently wired to the tenant portal, but a live duplicate surface. |
| Owner Quick Collect — Outstanding / Future Credit pills | `RecordPaymentModal.tsx:197-198` via `tenantService.getOwnerTenantOverview()` | Outstanding: Yes / Future Credit: **No** | `outstanding` = same canonical `financial-service.ts` call as the tenant side (consistent). `future_rent_credit` is fed by `advance_balance`, a raw independent re-sum of `tenant_financial_ledger` computed inline at `tenant-service.ts:926-929` — no security-deposit netting, diverges from `tenant-financial-ledger-service.ts`'s figure the tenant portal reads. **This is the direct cause of the owner/tenant Future Credit mismatch shown in the screenshots.** |
| `GET /api/tenants/owner/tenants/[id]/overview` | `tenant-service.ts:822-1030+` | Mixed | `outstanding`/`overdue_amount`/`current_payable_amount` (`:918-921`) delegate to `financialService.getTenantDues` — fine. `advance_balance` (`:926-929`, returned `:1025`) is the same independent inline arithmetic flagged above. |
| `GET /api/payments/dues` (owner dues report) | `payment-service.ts:2945-2965` (`getDuesReport`) | **Independent, 4th calculator** | `Math.max(0, total_amount - paid)` reimplemented inline (`:2963`) — same formula as canonical, but a separate implementation, not a shared call. |
| Owner-side per-tenant ledger balance | *No route exists* at `GET /api/tenants/[id]/financial-ledger` returning ledger balance the way the tenant `me` route does | — | — | The owner side has no equivalent of the tenant's canonical `tenantFinancialLedgerService.getBalance()` read for "Future Credit" display — it falls back to the inline `advance_balance` sum instead. |
| Owner dashboard "stats-shell" (Business Health cards) | `lib/services/dashboard-service.ts:52` (`getOwnerStatsShell`) | **Independent, 5th calculator** | Raw `$queryRaw` SQL: `pending_total`/`overdue_total` use `GREATEST(o.amount - paid, 0)` (`:221,228,232-233`) — uses `o.amount`, not `o.total_amount`, **silently excluding late fees**, contradicting `financial-service.ts`'s own documented rule (`financial-service.ts:24-30`: "All calculations use `o.total_amount` … never write a raw obligation aggregate outside this file"). |
| Owner dashboard "TOP DUES" widget | `app/api/dashboard/portfolio-shell/route.ts:13-68` (`getOverduePreview`) | **Independent, 6th calculator, inline in a route file** | `outstanding = ro.amount - SUM(paid)` (`:35`, again excludes late fees), `days_overdue = CURRENT_DATE - ro.due_date` (`:36`) — a separate reimplementation, living directly in a route handler rather than any service. |
| Owner tenant list / cards | `financialService.getTenantPaymentSummary()` (`financial-service.ts:352-411`) | Independent (a **3rd** calc inside `financial-service.ts` itself) | Recomputes `pending`/`hasOverdueObligation` (`:386-393`) from scratch rather than calling its own sibling method `getTenantDues()`. |
| True canonical engine | `financial-payment-facade.ts` (`previewSettlement`, `receivePayment`, `applyAvailableCredits`), `obligation-engine.ts`, `settlement-planner.ts` (`isOverdue`, `buildSettlementPlan`) | **Yes** | Only genuinely shared by the write path (`receivePayment`) and `GET /api/payments/settlement-preview`. None of the *read-only* status/summary endpoints above call into `obligation-engine.ts` or `financial-payment-facade.ts` directly — they all sit one or more layers of reimplementation away from it. |

### 2.2 Root cause

**Backend, read-model layer.** `financial-service.ts` (specifically `isOverdue()` sourced from `settlement-planner.ts`) is the closest thing to a canonical *read* calculation and is used correctly in `getTenantDues()` — but at least five other places (billing-timeline-service, financial-service's own `getTenantFinancialStatus` and `getTenantPaymentSummary`, dashboard-service's raw SQL, portfolio-shell's inline SQL, tenant-service's inline `advance_balance`, payment-service's `getDuesReport`) independently reimplement overlapping pieces of "outstanding/overdue/future-credit," sometimes with materially different formulas (`o.amount` vs `o.total_amount` — a **real bug**, not just duplication, since it silently drops late fees from two of the six dashboard-facing calculators). On top of that, the tenant *portal frontend* adds two more independent recomputations that don't even read the backend fields already computed correctly for them.

---

## 3. Problem 3 — Settlement Preview bypass in Quick Collect

Confirmed directly from code (not inferred). `RecordPaymentModal.tsx`'s preview gate:

```ts
const previewEnabled = Boolean(currentTenant?.id) && parsedAmount > 0 && !resolvedObligationId;
```

`resolvedObligationId = context.obligationId`. Every call site of `RecordPaymentModal` was inspected:

| Call site | `obligationId` passed? | Preview shows? |
|---|---|---|
| `OwnerQuickActions.tsx:157` (`source: 'quick-collect'`) | No | Yes |
| `hostel-detail/tabs/FinancialsTab.tsx:20` (`source: 'quick-collect'`) | No | Yes |
| `HostelActivityCenterView.tsx:561` (`source: 'activity-center'`) | **Yes** (`recordPayment.dueId`) | **No** |
| `hostel-detail/tabs/TenantsTab.tsx:354` (`source: 'activity-center'`) | **Yes** (`showPayment.obligationId`) | **No** |
| `billing/FinancialControlCenter.tsx:1317` (dues-row "Collect") | **Yes** (`recordPayment.dueId`) | **No** |
| `AlertsView.tsx:713` (`source: 'alerts'`) | **Yes** (`recordPayment.dueId`) | **No** |

**4 of 6 call sites always pass a specific obligation ID** — this is the overwhelmingly common real-world path (an owner clicking "Collect" next to a specific overdue line item in a dues list, alert, or activity feed, exactly matching the tenant row — "Brahmarouthu ganesh 12d overdue" — visible in the background of the reported screenshot). `previewEnabled`'s ternary treats *any* obligation-scoped collect as "direct," disabling preview entirely, even though `GET /api/payments/settlement-preview` fully supports being scoped to a single obligation via `allowed_obligation_ids` and could render the preview for these flows too.

### Root cause

**Frontend, by design (not a state machine bug, feature flag, query failure, or hidden error).** This exact ternary existed before the Owner Financial Workspace redesign — it was inherited unchanged in the recent 5-step rewrite of `RecordPaymentModal.tsx`. The gap is real and was simply never noticed because the two `obligationId`-free call sites (generic "Quick Collect") are the least-used paths; the four obligation-scoped ones (which are what "Collect" buttons on dues rows/alerts actually trigger) silently skip preview.

---

## 4. Problem 7 — Data consistency audit

**Not completed — requires explicit authorization.** Attempting to read `DATABASE_URL` from `.env` (even redacted) to determine whether the configured database is a local/dev instance safe to query, or a shared/production one, was blocked by the environment's auto-mode safety classifier as a credential-exposure risk. I did not attempt to work around this.

What I *can* report from code alone:
- `apps/backend/scripts/reconcile-financial-migration.ts` exists and was clearly run at least once during a prior schema migration — it compares a legacy `advance_balance`/`future_rent_credit_balance` column against the sum of `tenant_financial_ledger` entries by `reason` (`FUTURE_RENT_CREDIT_TOPUP`, `FUTURE_RENT_CREDIT_ADJUSTMENT`). This confirms there **was** an earlier balance-tracking mechanism that predates the current ledger-derived model — exactly the kind of "data created before the new engine" scenario Problem 7 asks about.
- `package.json`'s `repair:advance-obligations` script points at `scripts/repair-advance-obligations.ts`, which **does not exist on disk** — a dead/broken npm script, unrelated to this investigation but worth flagging separately.
- I could not determine whether any current tenant rows have "Outstanding > 0 AND Future Credit > 0 where credit should already have been consumed" without querying the live database.

**Next step (needs you):** either authorize me to connect to a specific, confirmed-non-production database and run a read-only count query (e.g. tenants where an OUTSTANDING-status obligation exists and `tenant_financial_ledger` balance > 0, joined against each obligation's `created_at` relative to the `cf88ce94` deploy time), or run that query yourself and share the result. That single query resolves whether the screenshots reflect (b) pre-fix data or (a)/(c) from §0.

---

## 5. Dependency graph — financial data flow (as it actually exists today, not as intended)

```
                              ┌─────────────────────────┐
                              │   Payment recorded       │
                              │ (record-offline / etc.)  │
                              └────────────┬─────────────┘
                                           │
                                           ▼
                         financial-payment-facade.receivePayment()
                                           │
                                           ▼
                              settlement-engine.executePlanInTx()
                                 (fundingSource: NEW_PAYMENT)
                              ┌────────────┴─────────────┐
                              ▼                           ▼
                     obligations settled            overflow → ledger CREDIT
                                                   (FUTURE_RENT_CREDIT_TOPUP)
                                                             │
   ┌─────────────────────────────────────────────────────────┘
   │   (credit now sits in tenant_financial_ledger, unconsumed until swept)
   ▼
rent-generation-service.generateMonthlyRent()  ─┐
agreement-rent-schedule-service.syncDueStatuses()│  (+ 9 other activation call sites)
   │                                              │
   ▼                                              │
FinancialLifecycleService.activatePayableObligations() ◄──────────┘
   │
   ├──► obligationEngine.markObligationsPayableInTx()   (UPCOMING → PENDING)
   │
   └──► financialPaymentFacade.applyAvailableCredits()
              │
              ▼
        settlement-engine.executePlanInTx()
           (fundingSource: EXISTING_CREDIT)
              │
              ├──► obligations settled from credit
              └──► ledger DEBIT (FUTURE_CREDIT_APPLIED)

                        ▼▼▼  READ SIDE (where it forks into 5-6 disagreeing paths)  ▼▼▼

financial-service.getTenantDues()  ───────────────► GET /api/payments/tenant-dues
   (canonical-ish: uses settlement-planner.isOverdue)         │
                                                                ├─► Owner overview, Owner Quick Collect "Outstanding"
                                                                └─► Tenant portal `dues` (but total_due misused as "current owed")

financial-service.getTenantFinancialStatus()  ────► GET /api/payments/financial-status   (independent recompute, unused by portal — live duplicate)
financial-service.getTenantPaymentSummary()   ────► Owner tenant list/cards              (independent recompute, same file)
billing-timeline-service.getTenantTimeline()  ────► GET /api/tenants/me/billing-timeline ─► Tenant portal Financials page (independent overdue math, LEGACY)
tenant-service.ts inline advance_balance      ────► GET /api/tenants/owner/.../overview  ─► Owner Quick Collect "Future Credit"  (diverges from ledger service)
tenantFinancialLedgerService.getBalance*()    ────► GET /api/tenants/me/financial-ledger ─► Tenant portal "Future Rent Credit" card  (CANONICAL, isolated)
dashboard-service.getOwnerStatsShell()        ────► Owner dashboard stat cards           (raw SQL, o.amount not o.total_amount — drops late fees)
portfolio-shell route inline SQL              ────► Owner dashboard "TOP DUES"           (raw SQL, same late-fee bug, in a route file)
payment-service.getDuesReport()               ────► GET /api/payments/dues               (independent recompute, correct formula, duplicate code)

TenantPriorityStrip.tsx (frontend)            ────► reads dues.total_due as "the amount", own isOverdue — ignores dues.overdue_amount that's already correct
TenantFinancialsPage.tsx (frontend)           ────► own daysOverdue math over billing-timeline items — ignores dues.overdue_amount entirely
```

**Read:** every box below "READ SIDE" that isn't `financial-service.getTenantDues()` or `tenantFinancialLedgerService.getBalance*()` is a place where the same concept (outstanding / overdue / future credit) is computed independently, with no shared call back to `obligation-engine.ts` / `settlement-planner.ts` / `financial-payment-facade.ts`.

---

## 6. Phased fix plan (preserves the Financial Engine architecture — write path untouched)

The write path (`financial-payment-facade`, `settlement-engine`, `obligation-engine`, `settlement-planner`) is not implicated in any of the read-model findings above and should not be touched by this plan. Everything below is about making every *read* consumer call the same source.

### Phase 0 — Resolve the deployment/data ambiguity (blocks everything else)
- Confirm whether `cf88ce94` is deployed to whatever environment produced the screenshots.
- Run the read-only data audit from §4 (with authorization) to distinguish pre-fix data from a live bug.
- Without this, Phase 2+ risk being built against symptoms that Phase 0 alone already resolves.

### Phase 1 — Stop the bleeding on the two confirmed, code-level bugs (small, isolated, no architecture change)
1. **`RecordPaymentModal.tsx`** — change `previewEnabled` to not exclude obligation-scoped collects; call `settlementPreview(tenantId, amount, hostelId, [obligationId])` when `resolvedObligationId` is set, instead of skipping preview outright. This is the Problem 3 fix and is purely additive.
2. **`tenant-service.ts:926-929`** — replace the inline `advance_balance` re-sum with a direct call to `tenantFinancialLedgerService.getBalance()` (the same function the tenant portal already reads), so owner and tenant "Future Credit" agree. This is the single highest-leverage fix for the screenshots' most visible mismatch.
3. **`dashboard-service.ts:221,228,232-233`** and **`portfolio-shell/route.ts:35-36`** — change `o.amount` to `o.total_amount` to stop silently excluding late fees, matching `financial-service.ts`'s documented invariant.

### Phase 2 — Establish one canonical read function and migrate callers
1. Designate `financial-service.getTenantDues()` (already correctly built on `settlement-planner.isOverdue`) plus `tenantFinancialLedgerService.getBalance()`/`getBalanceForTenant()` as the two canonical read calls for "obligation status" and "ledger balance" respectively.
2. Migrate, one at a time, with a test per migration: `getTenantFinancialStatus()`, `getTenantPaymentSummary()`, `getDuesReport()`, `getOverduePreview()` (portfolio-shell), `getOwnerStatsShell()` (dashboard-service) to call the canonical functions instead of reimplementing them. Each of these currently has its own formula — replacing them is a mechanical but non-trivial refactor per call site, not a one-line change.
3. Retire or explicitly deprecate `billing-timeline-service.ts` for anything status-related — it's a legacy calculator now doing double duty as a UI-friendly timeline shape. Either fold its status logic to call `derivePresentationStatus`/`isOverdue`, or replace its consumer with the new `financial-timeline-service.ts` (already built and route-exposed for the owner workspace) plus `getTenantDues()`.

### Phase 3 — Frontend consumers stop recomputing
1. `TenantPriorityStrip.tsx` — read `dues.overdue_amount` directly instead of deriving "overdue" from a client-side date diff against `total_due`.
2. `TenantFinancialsPage.tsx`'s `financialHealth` memo — replace with the already-correct `overdue_amount`/`current_payable_amount`/`future_rent_credit` fields once Phase 2 makes the backing endpoint canonical.

### Phase 4 — Guardrail against regression
- Add a lightweight integration test (or extend `scripts/payment-financial-safety-check.ts`, which already exists for exactly this class of concern) asserting: for a fixed test tenant, `getTenantDues().overdue_amount` + `tenantFinancialLedgerService.getBalance().future_rent_credit`, computed independently through every consumer endpoint audited in §2.1, all agree to the rupee. This turns "five calculators drifting apart" from a silent failure mode into a CI-visible one.

---

## Open questions for you before Phase 1 starts

1. Is `cf88ce94` deployed to the environment(s) the screenshots came from (production `sriadithyahostels.in`, and the `localhost:5174` owner dashboard)?
2. Can you authorize a read-only data-audit query against a specific, named (non-production, or production-with-explicit-consent) database connection, so §4/§7 can be closed out with an actual data answer rather than a code-only inference?
3. Phase 2's migration of `getTenantFinancialStatus()`/`getTenantPaymentSummary()`/`getDuesReport()`/dashboard SQL to the canonical functions touches enough call sites that it's worth confirming you want it done incrementally (one endpoint + one PR at a time, per Phase 2 above) rather than as a single large refactor.
