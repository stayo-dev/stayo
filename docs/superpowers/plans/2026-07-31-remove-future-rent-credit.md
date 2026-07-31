# Remove Future Rent Credit — Allocate Directly to Installments

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every rupee collected maps to a real rent installment. The future-rent-credit balance is removed entirely; an overpayment generates the tenant's next installment(s) from their agreement and settles them.

**Architecture:** Today `Planner → SettlementPlan{allocations, future_credit} → Engine`, where the Engine credits `future_credit` to `tenant_financial_ledger`. After this change the plan carries no `future_credit`: before planning, the payment service ensures enough installments exist for the amount being paid (tenant-scoped generation derived from the agreement), then the planner allocates across all of them. If installments cannot be generated far enough (agreement ends), the payment is **rejected** rather than parked.

**Tech Stack:** Next.js 14 App Router, Prisma 5, Postgres, Vitest, React 19.

## Global Constraints

- **Money is integer paise where precision matters; obligations are the source of truth.** Never derive "amount due" outside the obligation tables.
- **`tenant_financial_ledger` is currently EMPTY (verified: 0 rows).** This is a code change, not a data migration. Re-verify before starting; if rows exist, stop and re-plan.
- **Tenant-scoped generation must not become a second rent-generation implementation.** Add the new method *inside* `RentGenerationService`, reusing its existing ledger (`rent_generation_ledgers`) and `system_locks` discipline. `generateMonthlyRent()` is hostel-wide and must NOT be called from a payment path — doing so would create next month's rent for every tenant in the hostel as a side effect of one person paying ahead.
- **Obligations are immutable/audit-first.** No obligation-edit endpoint exists; corrections are replacement + cancellation. Generation adds rows, never rewrites them.
- Run before committing anything in this plan: `npm run check:invariants`, `npm run check:financial-safety`, `npm run check:payment-production`.
- Backend tests: `cd apps/backend && npx vitest run tests/<file>.test.ts`. Single worker; DB-backed suites need `DATABASE_URL_TEST` + a `test` schema (absent in the current dev box — mock `@/lib/db` as the existing payment tests do).
- Documentation is part of the change (Task 7), not a follow-up.

---

### Task 1: Tenant-scoped installment generation

**Files:**
- Modify: `apps/backend/src/services/payments/rent-generation-service.ts`
- Test: `apps/backend/tests/tenant-installment-generation.test.ts`

**Interfaces:**
- Consumes: `prisma`, `rentGenerationLedgerService`, the existing lock helper in this file.
- Produces:
  ```ts
  ensureInstallmentsForTenant(input: {
    tenantId: string;
    ownerId: string;
    hostelId: string;
    amountNeeded: number;   // rupees still unallocated after existing obligations
    tx?: Prisma.TransactionClient;
  }): Promise<{ created: string[]; coveredAmount: number; exhausted: boolean }>
  ```
  `exhausted: true` means the agreement cannot yield further installments (ended or absent) and `coveredAmount < amountNeeded`.

**Behaviour:** read the tenant's ACTIVE `Agreement` (`contract_rent`, `contract_payment_frequency`, `agreement_end_date`). Walk forward from the latest existing obligation's period, creating one obligation per period until `amountNeeded` is covered or `agreement_end_date` is passed. Each creation goes through the same `rent_generation_ledgers` idempotency key the monthly job uses, so a later cron run cannot duplicate it.

- [ ] **Step 1: Write the failing test** — cases: generates one installment when the shortfall is under one period's rent; generates several across periods; stops at `agreement_end_date` and returns `exhausted: true`; returns `exhausted: true` with no ACTIVE agreement; is idempotent when called twice with the same shortfall; never touches another tenant's obligations.
- [ ] **Step 2: Run it, confirm it fails** — `npx vitest run tests/tenant-installment-generation.test.ts`
- [ ] **Step 3: Implement `ensureInstallmentsForTenant`** reusing this file's lock + ledger helpers.
- [ ] **Step 4: Run it, confirm it passes.**
- [ ] **Step 5: Commit** — `feat(rent): add tenant-scoped installment generation`

---

> **Revision (2026-07-31, after Task 1 landed):** Tasks 2–5 must land as **one
> atomic commit**, not four. Measured on the real tree: renaming
> `future_credit` → `unallocated` touches **20 non-test consumer sites** plus
> **5 test files** (`settlement-planner`, `settlement-planner-policy`,
> `quick-collect`, `receipt-verification`, `payment-link-flow`). The engine
> reads `plan.future_credit` directly, so changing the planner alone leaves the
> build broken. Keep the task sections below as the working order, but commit
> once at the end of Task 5 with every consumer and test updated together.
>
> Task 1 is unaffected — it is self-contained and already committed (`e44a405`).

### Task 2: Planner stops producing future credit

**Files:**
- Modify: `apps/backend/src/services/payments/settlement-planner.ts` (`future_credit` at :249, :352, :557; summary strings at :545-552)
- Test: `apps/backend/tests/settlement-planner-no-credit.test.ts`

**Interfaces:**
- Produces: `SettlementPlan` loses `future_credit` and gains `unallocated: number` — money the planner could not place on any obligation. Callers must treat `unallocated > 0` as an error, never as a balance.

- [ ] **Step 1: Write the failing test** — exact-payment allocates fully with `unallocated: 0`; underpayment allocates FIFO and leaves obligations partly settled; overpayment against a set of obligations that *does* cover it allocates across all of them; overpayment beyond available obligations reports `unallocated > 0`; summary strings no longer mention "future credit".
- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Replace `future_credit` with `unallocated`** and rewrite the three summary branches — the "→ credited as future rent" wording is removed entirely.
- [ ] **Step 4: Run it plus the existing planner suites.**
- [ ] **Step 5: Commit** — `refactor(payments): planner reports unallocated instead of future credit`

---

### Task 3: Engine stops writing credit ledger entries

**Files:**
- Modify: `apps/backend/src/services/payments/settlement-engine.ts` (:57, :89-96, :121, :219, :277, :358-400, :417, :440)
- Test: `apps/backend/tests/settlement-engine-no-credit.test.ts`

**Interfaces:**
- `SettlementInput.fundingSource` is **removed** — with no credit balances there is no `EXISTING_CREDIT` money to spend.
- `SettlementResult.future_credit` is removed.
- The engine throws `BAD_REQUEST: Payment exceeds what can be settled` when `plan.unallocated > 0`, rather than crediting.

- [ ] **Step 1: Write the failing test** — a plan with `unallocated > 0` throws and writes nothing (assert no payment rows and no ledger call); a fully-allocated plan settles and makes **zero** `tenantFinancialLedgerService` calls; the guard at :219 still rejects an empty plan.
- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Delete both ledger branches** (the `EXISTING_CREDIT` debit and the `FUTURE_RENT_CREDIT_TOPUP` credit) and the `fundingSource` parameter; add the `unallocated` guard.
- [ ] **Step 4: Run it plus every settlement/payment suite.**
- [ ] **Step 5: Commit** — `refactor(payments): engine no longer credits payment excess`

---

### Task 4: Payment service ensures installments before planning

**Files:**
- Modify: `apps/backend/src/services/payments/payment-service.ts`
- Modify: `apps/backend/app/api/payments/record-offline/route.ts`
- Test: `apps/backend/tests/overpayment-generates-installment.test.ts`

**Flow** (inside the existing transaction, before the planner runs):

```ts
const outstanding = sumOutstanding(obligations);
if (amount > outstanding) {
  const shortfall = amount - outstanding;
  const gen = await rentGenerationService.ensureInstallmentsForTenant({
    tenantId, ownerId, hostelId, amountNeeded: shortfall, tx,
  });
  if (gen.exhausted) {
    throw new Error(
      `BAD_REQUEST: Cannot accept ₹${amount} — only ₹${outstanding + gen.coveredAmount} of installments exist for this tenant`,
    );
  }
  obligations = await refetchObligations(tx, tenantId); // now includes the generated rows
}
```

- [ ] **Step 1: Write the failing test** — paying exactly outstanding creates no new obligation; paying more generates the next installment and marks it settled by the same payment group; paying beyond the agreement's end is rejected with `BAD_REQUEST` **and rolls back** (assert no obligation and no payment persisted); the generated obligation carries the correct `hostel_id`/`owner_id`.
- [ ] **Step 2: Run it, confirm it fails.**
- [ ] **Step 3: Implement the orchestration above.**
- [ ] **Step 4: Run it plus `tests/deposit-payment-flow.test.ts`, `tests/duplicate-rent-prevention.test.ts`, `tests/move-out-accounting.test.ts`.**
- [ ] **Step 5: Commit** — `feat(payments): overpayment generates and settles the next installment`

---

### Task 5: Purge the remaining references

**Files (all containing `FUTURE_RENT_CREDIT` / `future_credit`):** `financial-domain.ts`, `financial-payment-facade.ts`, `financial-timeline-service.ts`, `merchant-context.ts`, `payment-recovery.ts`, `receipt-service.ts`, `tenant-financial-ledger-service.ts`, `lib/services/billing-timeline-service.ts`, `lib/events/index.ts`, `lib/pdf/receipt-template-pdf-lib.ts`, `src/services/tenants/renewal-offer-service.ts`, and routes `payments/create-intent`, `payments/pending-verification`, `payments/record-offline`, `payments/pay/[token]`, `verify/receipt`.

- [ ] **Step 1: Enumerate** — `grep -rn "FUTURE_RENT_CREDIT\|future_credit\|futureCredit" apps/backend --include="*.ts" | grep -v node_modules` (was 132 hits).
- [ ] **Step 2: Remove each**, deciding per site: a *flow type* (`PAYMENT_FLOW.FUTURE_RENT_CREDIT`) is deleted; a *receipt/timeline display branch* is deleted along with its copy; `tenantFinancialLedgerService`'s credit/debit-for-rent-credit methods are deleted, keeping any reasons still used by settlement/move-out.
- [ ] **Step 3: Decide the enum.** `FinancialLedgerReason` is a Postgres enum. Leave the values in place (dropping enum values needs a table rewrite and the ledger is empty anyway) but remove all code that writes them; note this in `Database.md`.
- [ ] **Step 4: Re-run the grep** — only comments explaining the removal may remain.
- [ ] **Step 5: Full suite + all three checks** — `npm test`, `check:invariants`, `check:financial-safety`, `check:payment-production`.
- [ ] **Step 6: Commit** — `refactor(payments): remove future-rent-credit surface`

---

### Task 6: Collect Payment UX

**Files:**
- Modify: `apps/frontend/src/features/owner-tenants/quick-collect/QuickCollectModal.tsx` (:361-368 amount step)

- [ ] **Step 1: Quick-amount chips** beneath the input — `Full ₹8,800`, `Half ₹4,400`; tapping sets the amount. Also make the Outstanding figure (:349-352) tappable to fill.
- [ ] **Step 2: Live consequence line** replacing the static hint at :367:
  - `amount < outstanding` → `₹7,800 will remain outstanding`
  - `amount === outstanding` → `Clears all dues`
  - `amount > outstanding` → `Creates next month's installment and settles ₹1,200 of it`
  - The third string must match Task 4's real behaviour — write it only after Task 4 lands.
- [ ] **Step 3: `npm run build`** (architecture + branding checks).
- [ ] **Step 4: Commit** — `feat(owner): faster, clearer money collection`

---

### Task 7: Documentation

- [ ] `docs/obsidian/Decisions.md` — ADR-036: why credit balances were removed in favour of direct installment settlement; alternatives (cap the amount / keep an unapplied balance) and why rejected; the consequence that paying ahead now *creates* obligations, and that an overpayment past the agreement end is refused.
- [ ] `docs/obsidian/Business-Rules.md` — replace the future-credit rules with: every payment maps to an installment; overpayment generates the next one; nothing is generated past `agreement_end_date`.
- [ ] `docs/obsidian/Database.md` — `tenant_financial_ledger` no longer written by the payment path; retained `FinancialLedgerReason` enum values now unused.
- [ ] `docs/obsidian/APIs.md` — `record-offline` and the payment routes: new `BAD_REQUEST` when the amount exceeds available installments.
- [ ] `docs/obsidian/Changelog.md` + `docs/obsidian/Features.md`.
- [ ] Commit — `docs: record the removal of future rent credit`

---

## Final verification

- [ ] `npm test` (backend), `npm run check:invariants`, `check:financial-safety`, `check:payment-production`
- [ ] `npm run build` (frontend)
- [ ] Live: collect exactly-outstanding, under, and over against a seeded tenant; confirm the over case creates one obligation and settles it, and that a second identical call does not duplicate it.
- [ ] `grep -rn "future_credit" apps/backend --include="*.ts" | grep -v node_modules` returns only explanatory comments.
