---
tags: [business-rules, domain]
---

# Business Rules

Related: [[Database]] · [[APIs]] · [[Backend]] · [[Features]]

Everything below was extracted by reading the actual implementation (not types, not doc-comments alone) in `apps/backend/`. File:line references point at the evidence. Anything not verifiable in code is explicitly marked **Unknown**.

## Marketing listing lifecycle — after approval (2026-08-22)

An APPROVED listing is no longer the end of the line. Two admin actions exist, and the one thing
that separates them is whether the live page survives:

| Action | Approved revision | Live page | Owner gets |
|---|---|---|---|
| **Request changes** | stays `APPROVED` | **stays up** | a DRAFT seeded from the live content, carrying the note and section flags |
| **Unpublish** | becomes `WITHDRAWN` | **goes blank** | the reason, and can edit/resubmit |
| **Suspend hostel** | untouched | hostel leaves Discovery entirely | — |

Rules that hold:

- **Both need something live.** No `APPROVED` revision → 409.
- **Request changes refuses while a submission is queued** (`PENDING_REVIEW`): that submission is
  the thing to review, and annotating a different draft would leave the queue item unanswered.
- **Unpublish is allowed while a submission is queued.** The live page and the queued submission
  are different things; a false claim comes down now regardless of what is behind it.
- **Unpublish always demands a written reason.** There are no section flags on that path to lean
  on, so the sentence is all the owner gets.
- **`WITHDRAWN` ≠ `REJECTED`.** REJECTED never went live; WITHDRAWN was live and was taken down.
- The hostel stays on Discovery for both actions — only `suspend-listing` removes it.

See [[Decisions#ADR-089|ADR-089]] and [[APIs]].

## Late fee / billing calculation

**File:** `lib/billing/engine.ts` (pure functions, no DB/side effects).

- **Modes** (`LateFeeRule.type`): `flat` (fixed amount), `percentage` (`round(rentAmount × pct / 100)`, computed against whatever `rentAmount` the caller passes — see below, not necessarily the original full rent), `per_day` (`dailyAmount × activeDays`).
- **Grace days**: `effectiveDelay = max(daysDelayed − graceDays, 0)` — subtracted uniformly before any rule evaluates.
- **Rules stack**: enabled rules sorted by `after_days` ascending, applied cumulatively (not first-match-wins).
- **Cap**: `max_late_fee` (0 = uncapped) enforced against the *running cumulative total across all rules* — once adding a fee would exceed the cap, it's clipped and flagged `capped: true`.
- **Legacy config normalization**: `resolveRules()` handles both the old single-field config (`late_fee_type`/`late_fee_amount`/etc.) and the newer `late_fee_rules[]` array.

**Actual per-day accrual happens in `src/services/payments/reminder-service.ts::processDailyReminders`**, not in `calculateLateFees` itself (which has zero production callers beyond its own test — it appears to exist for a possible frontend "what-if" preview, not verified here):

- Computes `accumulatedFees` per obligation by summing existing `LATE_FEE` rows for the same allocation+rent_month; skips all rules entirely once `accumulatedFees >= maxCap`.
- **`per_day` rules create one new `LATE_FEE` obligation row per calendar day** (idempotent via same-day existence check + DB unique-constraint fallback) — late fees compound as a sequence of discrete obligation rows, not by mutating the original rent obligation.
- **`flat`/`percentage` rules fire once per rule per rent_month.**
- **Base amount for percentage/per-day fees is the outstanding remainder** (`ob.remaining_amount ?? ob.amount`), not the original obligation amount — a partially-paid obligation accrues late fees on the remainder only.
- Each new late-fee obligation is immediately routed through `financialLifecycleService.activatePayableObligations` so it's payable right away.
- **Possible doc/code drift**: `financial-service.ts`'s own header comment claims late fees are applied "by incrementing `late_fee`/`total_amount` on the base RENT obligation" — the actual runtime behavior (separate `LATE_FEE` obligation rows) contradicts this. Flagging as **Unknown/needs clarification** which description is authoritative; don't assume the header comment over the executed code path.
- **Proration** for partial-month billing: not found in `lib/billing/engine.ts`. **Unknown** whether `agreement-rent-schedule-service.ts` handles this elsewhere — not examined.

## Obligation lifecycle

**Files:** `src/services/payments/obligation-engine.ts`, `financial-obligation.types.ts`, `financial-lifecycle-service.ts`.

**Two-column state model** (the actual current model, despite an older doc-comment in `obligation-engine.ts` describing a single-column `DRAFT → PENDING → PARTIAL → PAID → WAIVED/CANCELLED` chain that no longer matches the schema):

- `lifecycle_status`: `ACTIVE → WAIVED | CANCELLED` — terminal once non-ACTIVE.
- `settlement_status`: `UNPAID → PARTIAL → PAID` — tracked independently.
- A `PresentationStatus` (`OVERDUE|UPCOMING|PENDING|PARTIAL|PAID|WAIVED|CANCELLED`) is **derived only, never persisted**, via `derivePresentationStatus(lifecycle, settlement, dueDate, now)`.
- A legacy single `status` column is still dual-written for compatibility via `toLegacyStatus()`.

**Creation**: `createInitialObligations()` (called inside the tenant-invite transaction — creates RENT/SECURITY_DEPOSIT/one-time-MAINTENANCE idempotently) and `createObligationInTx()` (the universal manual-creation path behind `POST /api/payments/obligations`, validating against 10 canonical `OBLIGATION_TYPES`: RENT, SECURITY_DEPOSIT, ADMISSION, MAINTENANCE, LATE_FEE, FINE, EXTRA_CHARGE, DAMAGE, UTILITY, ADDITIONAL_CHARGE, OTHER).

**Activation**: `markObligationsPayableInTx()` transitions `UPCOMING → PENDING`, idempotent. Orchestrated by `FinancialLifecycleService.activatePayableObligations()`, which also sweeps available future-rent credit immediately after activation.

**Cancellation** (`cancelObligationInTx`): only allowed on actionable-status obligations (`OVERDUE|PENDING|PARTIAL|UPCOMING`) with **zero payments** — explicitly rejects with "Cannot cancel an obligation that has payments. Use waiver instead." No ledger correction is generated (no money was owed yet).

**Waiver** (`waiveObligationInTx`): allowed on actionable-status obligations with outstanding balance > 0. Creates a `LEDGER_CORRECTION` debit via `financialCorrectionGateway`. If the obligation had a partial payment, `settlement_status` stays `PARTIAL` (retains payment history) rather than resetting.

**No in-place edit endpoint — confirmed by grep**: zero `PATCH`/`PUT` handlers exist anywhere under `app/api/payments/obligations/`. The only correction paths are cancel (pre-payment) or waive (post-payment). **There is no dedicated "replace obligation" endpoint or transaction bundling cancel+create as one operation** — if a caller wants a "create replacement, cancel original" correction, that is two separate API calls, not a first-class supported operation. Treat "editing = create-replacement + cancel-original" as an *emergent manual pattern* used by the frontend (see `[[Features]]` — Owner Financial Workspace), not something the backend enforces atomically.

**UI simplification (2026-07-22)**: `ObligationCard.tsx` used to show Cancel and Waive as two simultaneously-visible red buttons whenever an obligation was `PENDING` (both `isActionable` and `isEditable` were true for that status), which owners read as two competing "delete" options rather than a state-dependent choice. The card now derives `hasPayments` from the obligation's own `payments[]` array and shows exactly one of the two: **Cancel Charge** when zero payments exist, **Waive Balance** when any payment (even partial) exists — mirroring the backend guard in `cancelObligationInTx` exactly, so the button shown is always the one that will actually succeed. Also renamed `WaiveObligationModal`'s dismiss button from "Cancel" to "Back", since a generic dialog-dismiss button sharing the word "Cancel" with the destructive row action was part of the same confusion. See [[Changelog]].

## Rent Change — immediate, owner-only repricing

**Files:** `src/services/payments/rent-change-service.ts` (`applyRentChangeInTx`), `app/api/tenants/[id]/change-rent/route.ts`. See [[APIs]] for the endpoint contract.

- **Rent changes are immediate and owner-only — no tenant approval.** `src/services/change-management/field-classification.ts` classifies `agreement.contract_rent` as **Category C — Contractual** ("Never directly editable. Creates agreement amendment. Requires tenant approval + financial recalculation" per that file's own header comment), which is the category the Change Requests workflow (`/api/change-requests/*`, see [[APIs]]) governs for other contractual fields (agreement dates/duration, deposit, maintenance, payment frequency). `POST /api/tenants/:id/change-rent` deliberately does **not** route rent through that governed path — an owner submitting a rent change takes effect the moment the request is confirmed (identity-token gated, same as obligation cancel/waive), with no tenant-side accept/reject step. Treat this as an intentional, scoped exception for rent specifically, not evidence that Category C governance was removed for the other fields in that list.
- **The owner picks an effective-from month.** `Agreement.contract_rent` is updated unconditionally (it's the current/going-forward rent), and only `rent_obligations` rows for that agreement with `rent_month >= effectiveFromMonth` are candidates for repricing.
- **Only zero-payment obligations are actually repriced.** Of the candidates at/after the effective month, only those with no rows in `payments` (and `lifecycle_status: ACTIVE`, `settlement_status: UNPAID`, `is_superseded: false`) get their `amount`/`total_amount` overwritten to the new rent. This reuses the same safety invariant `agreement-rent-schedule-service.ts` already enforces elsewhere (a `rent_obligations` row may be repriced in place only when nothing has been paid against it yet) — consistent with "obligations are audit-first, no in-place edit once money has moved" (see Obligation lifecycle, above).
- **Obligations before the effective month, or with any recorded payment, are never touched** — even if they're in the candidate window by month. History is preserved exactly as it was billed/paid.
- **`tenants.monthly_rent` is kept in sync with `agreement.contract_rent`.** `applyRentChangeInTx` writes both in the same transaction (`tx.tenants.update({ where: { id: agreement.tenant_id }, data: { monthly_rent: newRentAmount } })`), mirroring the `tenantContractSync` pattern renewal activation already uses (`renewal-activation-engine.ts`). Without this the frontend's "current rent" display (sourced from `tenant.monthly_rent`, not `agreement.contract_rent`) would go stale after a successful change. See [[Bugs]].
- The backend's real repricing safety guard is **zero payment records** (`payments.length === 0` on the obligation), not net-zero-paid. This matters after a Payment Reversal correction (see Correct Payment in [[Features]]): a reversed obligation has net `paid === 0` but *two* payment rows (original + offsetting reversal), so the backend correctly skips it, while the frontend's pre-submit preview (which only has net paid/outstanding via `getTenantDues()`, not raw payment-row counts) still counts it as repriceable. The frontend does not special-case this — it surfaces the real outcome after the fact via the response's `obligationsUpdated` count rather than trying to predict it beforehand. See [[Bugs]].
- Returns `obligationsUpdated`/`updatedObligationIds` so the caller can show exactly which obligations changed, rather than the frontend recomputing which rows should have moved.

## Payment allocation

**File:** `src/services/payments/settlement-planner.ts` (planning) + `settlement-engine.ts` (execution — "pure execution module," never imports from the planner in the other direction).

**Not pure date-FIFO — priority-tiered, then chronological within tier.** Obligations are sorted by `SETTLEMENT_PRIORITY` first: `SECURITY_DEPOSIT(1) → ADMISSION(2) → MAINTENANCE(3) → RENT(4) → LATE_FEE/FINE(5) → EXTRA_CHARGE/DAMAGE/UTILITY/ADDITIONAL_CHARGE(6) → OTHER(7)`, then by `due_date` ascending. So within the RENT tier it's true oldest-first FIFO, but across types priority wins — e.g. a later-due security deposit settles before an older overdue rent.

- **Partial payments**: each allocation gets `PAID` if fully covered, else `PARTIAL`.
- **Overpayment** (changed 2026-07-31, [[Decisions#ADR-036|ADR-036]]): there is **no future-rent-credit balance any more**. Every rupee must land on a real installment. Before planning, a payment larger than what is currently due generates the tenant's next installment(s) from their ACTIVE agreement (`rentGenerationService.ensureInstallmentsForTenant`), and the planner then allocates across them. If the agreement cannot yield further installments — it has ended, or there is none — the payment is **rejected** (`BAD_REQUEST`) rather than parked anywhere. The planner reports any residue as `unallocated`, which the engine treats as an error, never a balance. Settlement invariant is now `Paid = ΣAllocations` exactly, with no credit term.
- **Full-tier policy**: if `policy.allow_partial` is false, the minimum acceptable payment equals the entire first incomplete tier (ONBOARDING → RECURRING → PENALTIES → ADHOC), not an arbitrary amount.
- **Minimum part payment** (extended 2026-08-05, [[Decisions#ADR-043|ADR-043]]): when partial payments *are* allowed, the floor is the **strictest** of three values — ₹1, `partial_payments.minimum_amount` (absolute, rupees), and `partial_payments.minimum_percentage` (0-100, applied to the tenant's **total outstanding**, rounded **up**). Both configured values are floors, so the larger wins. The result is then **clamped to the total outstanding**, so a ₹5,000 absolute floor can never make a remaining ₹500 balance unpayable. `minimum_percentage` is new; it is ignored entirely when partial payments are off, and absent/0 means "no percentage floor". Verified by 17 pure tests in `tests/settlement-planner-minimum-percentage.test.ts`.
- **Rejection wording is owner-facing** (2026-08-05, ADR-043): `rejection_reason` states the *policy* ("This hostel doesn't accept part payments. Rent must be cleared in full — ₹8,000"), never a flag name. The plan also echoes `policy_minimum_amount` / `policy_minimum_percentage` so a UI can explain *why* the floor is what it is instead of presenting a bare number.
- **Chronology guard**: when a caller selects specific obligations to pay, the code enforces that no earlier unpaid RENT obligation can be skipped while a later one is selected.
- **Execution**: locks obligations `FOR UPDATE` in the same priority order via a **hand-duplicated SQL `CASE` clause** in `settlement-engine.ts` — explicitly commented as needing manual sync with the planner's priority constant (a real maintenance risk if one is changed without the other).

## Collection queue prioritisation

Added 2026-08-05 ([[Decisions#ADR-045|ADR-045]]). Decides **who the owner contacts first**. It reads money from the existing read models and never derives its own figure — `outstanding` and `last payment` from `financialService.getTenantPaymentSummary`, overdue-ness from `isOverdue()`.

**Buckets** (section order): `NEEDS_ATTENTION` → `DUE_TODAY` → `AWAITING_REMINDER` → `DUE_SOON`. A tenant owing nothing, or whose next due date is beyond the 7-day window, is not in today's queue at all.

**The reminder rule.** A tenant reminded within `reminderCooldownDays` (2) drops to `AWAITING_REMINDER` — chasing again immediately is noise. **But** once they pass `reminderCooldownMaxOverdueDays` (7) the deferral stops: a reminder that old has visibly not worked. Without that cap, live data put 7 of 10 tenants in "waiting" and ranked an 11-day-overdue tenant below a 12-day one.

**Score** (orders rows *within* a bucket; every point is attributed and shown to the owner):

| Factor | Points | Cap |
|---|---|---|
| Days overdue | `days × 2` | 60 days (120) |
| Outstanding | `₹1,000 = 1` | 50 |
| Previously paid late | `count × 10` | 30 |
| Has never paid | 15 | — |
| 3+ reminders, still unpaid | 20 | — |

Caps exist so one very large balance cannot bury every genuinely overdue tenant, and so extreme lateness stops being the only differentiator. `score` always equals the sum of its factors — asserted by test. Ties break by name so the queue does not reshuffle between refreshes.

## Flexible payment links

**Files:** `src/services/payments/payment-link-service.ts` (`PaymentLinkService.getOrCreateToken`), `app/api/payments/pay-link/route.ts`, `app/api/payments/pay/[token]/route.ts`, reusing the same `buildSettlementPlan` FIFO engine as offline "Receive Payment" (see [[Database]] `payment_link_tokens`, [[Decisions]] ADR-017).

A payment link (`payment_link_tokens`) is tenant-scoped, not obligation-locked. `obligationId`, if supplied when generating the link, is stored only as a default-amount hint on the payer page — it does not restrict what can actually be paid. The payer can enter any amount on the link's page; the backend FIFO-allocates it across the tenant's currently outstanding obligations (`PAYABLE_STATUSES = OVERDUE|PENDING|PARTIAL|UPCOMING`) using the same `buildSettlementPlan` engine the owner's offline "Receive Payment" flow uses — any amount left over after covering everything payable now generates and settles the tenant's next installment instead of being credited (see Payment allocation above, [[Decisions#ADR-036|ADR-036]]). A tenant with zero outstanding obligations can still generate and use a link to pay ahead of their next rent — `getOrCreateToken` no longer requires resolving a specific unpaid obligation before it will mint a token. Both owners and tenants can generate a link (`POST /api/payments/pay-link`); a tenant session is force-scoped to `session.tenant_id` and forbidden from passing `obligationId` or a mismatched `tenantId` — only an owner may target an arbitrary tenant/obligation in their own hostel. See [[Decisions]] ADR-017 for why this changed from the prior obligation-locked, dues-only behavior.

## Settlement (move-out)

**File:** `lib/services/move-out-service.ts::calculateSettlementPreview` (read-only, computed on demand until owner approval).

- Splits the tenant's ledger balance into a "security deposit portion" vs. "extra advance balance" by reconciling against paid SECURITY_DEPOSIT/ADVANCE obligation amounts.
- Pulls current dues (`rentDue`, `lateFeesDue`, derived `maintenanceAndOtherDues`) from `financialService.getTenantDues()`.
- Pulls inspection deductions (damages, cleaning, missing items, other) from `move_out_inspections`.
- **Formula**: `net = paidSecurityDeposit + extraAdvanceBalance − totalDues − totalDeductions`. `settlement_direction` = `OWNER_OWES_TENANT` (net > 0) / `TENANT_OWES_OWNER` (net < 0) / `SETTLED` (net = 0).
- **Owner can override** the computed net at approval time — no bound/sanity check against the computed value beyond `amount ≥ 0` and a valid direction enum.
- Transitions gated via `move-out-state-machine.ts::assertTransition()` — canonical graph: `REQUESTED → {SETTLEMENT_PENDING, REJECTED} → {SETTLEMENT_APPROVED, REJECTED} → PHYSICALLY_VACATED → {SETTLEMENT_PENDING_PAYMENT, COMPLETED} → COMPLETED`, both terminal. Also defines **capability freezes** per status — e.g. a tenant cannot transfer rooms, change rent, or edit their profile while a move-out is `REQUESTED`/`SETTLEMENT_PENDING`/`SETTLEMENT_APPROVED`.
- **Active disputes block completion** — `assertNoActiveDisputes()` throws if any dispute is `OPEN`/`UNDER_REVIEW`.
- **On completion** (changed 2026-08-26, [[Decisions#ADR-130|ADR-130]]): the ledger balance is debited via `applyAdvanceSettlementInTx`, guarded against double-application. Remaining unpaid rent obligations are now governed by **`duesDisposition`**, which **defaults to `RECOVERABLE`** — the tenancy closes, the debt does not. Only `duesDisposition: "WAIVE"` runs `obligationEngine.bulkWaiveInTx`. Previously the waiver was unconditional, behind an owner button labelled "Confirm Refund & Complete", so closing the books on a tenant who owed ₹25,000 wrote off ₹25,000 with no mention of it.
- **A recoverable debt does not quietly grow.** Leaving obligations standing after move-out is safe because the two things that would compound them already exclude former tenants: `reminder-service` (which applies late fees, `where: { status: "ACTIVE" }`) and `rent-generation-service` (`tenant: { status: "ACTIVE" }`). So a `FORMER_TENANT` accrues no late fee, receives no reminder, and has no new rent generated — while `payment-service` has **no** tenancy-status gate, so their payment can still be recorded. The debt sits frozen and collectable.
- **Quick exit** (`moveOutService.quickExit`, 2026-08-26): an owner can close an exit that needs no *judgement* (damages) and carries no *disagreement* (dispute) in one action. It walks the same public methods and therefore the same `assertTransition()` — the audit trail is identical to a five-step exit. Money moving does not disqualify it; a deposit refund or outstanding dues are normal at move-out. It is **resumable, not atomic** (each step is its own transaction), and it **recomputes the settlement and refuses with `STALE_PREVIEW`** if it no longer matches the figures the caller displayed.

## The Financial Read Model — "compose, don't reimplement"

**File:** `src/services/payments/financial-read-model-service.ts` (full file read).

Explicitly documented as a **presentation-only composition layer** fixing a historical bug class where ~6 independently duplicated outstanding/overdue calculators disagreed between owner and tenant screens (one used the wrong column, `o.amount` instead of `o.total_amount`, silently dropping late fees — see `docs/business-logic/financial-consistency-investigation-report.md` and [[Decisions]] ADR-001).

Composes exactly three existing sources, nothing recomputed beyond pure display math (day-diff, bucket splitting):
1. `financialService.getTenantDues()` — obligation-level dues breakdown.
2. `tenantFinancialLedgerService.getBalance()` / `getBalanceForTenant()` — ledger balance, future-rent credit, security deposit.
3. `settlement-planner.isOverdue()` — per-item overdue determination.

Two entry points: `getFinancialReadModel(tenantId, ownerId, hostelId)` (owner context) and `getFinancialReadModelForTenant(profileId)` (tenant self-service, backing `GET /api/tenants/me/financial-read-model`). **Any new financial-summary surface must follow this pattern** — see [[Decisions]] ADR-001.

### Same pattern, second domain: business-expense financials

`apps/backend/lib/services/expense-service.ts` exports shared, period-parameterized functions — `getBusinessRevenue(ownerId, start, end, hostelId?)`, `computeNetProfit()`, `computeProfitMargin()`, `computeExpenseRatio()`, `withCategoryPercentages()` — used by both the Expenses dashboard (`getAllExpenses()`, called with a fixed "this month" window) and the expense export report (`expense-export-service.ts::getExportSummary()`, called with the export's own filtered date range). Same formulas and query shape in both places; only the date window and the expense total each caller supplies differ. See [[Decisions]] ADR-010.

A revenue-lookup failure in the export is isolated (try/catch around just that one call) so it degrades only the Financial Summary section (`revenue`/`netProfit`/`expenseRatio` become `null`, exposed to the UI/report as "unavailable") rather than failing the whole export — no partial/estimated figures are substituted.

### `operational_type` is a derived classification, never owner-entered

The owner picks only a **Category** when logging an expense. `operational_type` (Operational/Utility/Maintenance/Staff/Emergency — analytics/dashboard/report classification, distinct from the `expense_type` column) is always computed server-side from the canonical `CATEGORY_TO_OPERATIONAL_TYPE` map in `expense-service.ts` via `deriveOperationalType(category)` — the single source of truth for this mapping (e.g. Electricity/Water/Gas Cylinders/Internet → Utility, Staff Salary/Security → Staff, Maintenance & Repairs → Maintenance, Medical & Emergency → Emergency, everything else → Operational).

- `createExpense` always derives it from the resolved category; any client-supplied `operational_type` is ignored (the field was removed from the create/edit UI and the service's typed input entirely — see [[Decisions]] and [[Changelog]]).
- `updateExpense` recomputes it **only when `category` is part of the update** — editing an expense without changing its category leaves the existing `operational_type` untouched. This means older rows keep whatever value they already have (no migration needed) and are corrected automatically the next time their category is edited.
- There used to be a second, fuzzy title+category regex heuristic (`suggestedOperationalType`) that duplicated this classification with different logic and a client-side copy in `apps/frontend/src/features/expenses/constants.ts` — both were removed in favor of the single canonical map, per the "don't duplicate mappings across frontend/backend" requirement.

## Notification triggers

**Files:** `src/services/payments/reminder-service.ts`, `lib/services/collection-strategy-service.ts`, `lib/services/notifications/whatsapp-webhook-event-service.ts`.

- **Configurable per-hostel schedule**, three presets plus custom:
  - **Gentle**: before-due `[2]`, after-due `[1, 7]`.
  - **Standard**: before-due `[3, 1]`, after-due `[1, 5, 10]`.
  - **Aggressive**: before-due `[5, 3, 1]`, after-due `[1, 2, 3, 5, 7, 10, 14]`.
- **Escalation**: first scheduled day → `DUE_SOON`; last scheduled day (only if ≥3 total steps) → `FINAL_NOTICE`; everything between → `WARNING`.
- **Reminders fire only on exact configured day-offsets**, not "≥ N days." Never repeats the same reminder type twice in a row; never re-sends after `FINAL_NOTICE` (terminal).
- Late-fee generation and reminders share the same daily cron but are independently toggleable per hostel (`auto_send_reminders`, `auto_apply_late_fees`).
- **Channels**: in-app (default on), email (if tenant has `personal_email`), WhatsApp (**default off** — `config.reminder_whatsapp ?? false`). WhatsApp is explicitly skipped for `LATE_FEE_ADDED` — no template exists yet for that type ("LATE_FEE_TEMPLATE_OUT_OF_SCOPE").
- **Manual one-tap reminder** (owner-triggered): always targets the tenant's single oldest unpaid+overdue obligation, always sends type `WARNING` regardless of actual overdue-day count.
- **Reach a tenant with no account (2026-08-27, owner-managed tenants Phase 1).** Recipient name/phone are resolved via `resolveTenantName(tenant)`/`resolveTenantPhone(tenant)` (`lib/tenants/tenant-identity.ts`), never by reading `tenant.profiles?.name`/`.phone` directly. For a `SELF_SERVE` tenant this is unchanged (`profiles.name`/`.phone`). For an `OWNER_MANAGED` tenant, `profiles` is absent by design, so both fall back to `tenants.display_name`/`tenants.phone_1` (phone normalized to E.164). Before this fix an owner-managed tenant's WhatsApp reminder always skipped as `TENANT_PHONE_MISSING` and email addressed them as the literal string "Tenant" — see the access-mode section above. **WhatsApp is the only channel that can reach an `OWNER_MANAGED` tenant** — they have no app and often no email — yet `config.reminder_whatsapp` defaults to `false` per hostel, so adoption surfaces this plainly to the owner (`AdoptTenantSheet`) rather than silently promising delivery that will not happen.
- **In-app is never "sent" for an `OWNER_MANAGED` tenant.** `triggerNotification` marks the in-app channel `{ attempted: false, sent: false, skipped: true, reason: "NO_TENANT_ACCOUNT" }` unconditionally for an owner-managed tenant, before the ordinary `reminder_in_app` on/off check even runs — there is no in-app surface for someone with no account to open.
- **`reminder_logs` is escalation state, not just an audit trail — a row is written only when a channel actually delivered.** The next reminder's type (`DUE_SOON → WARNING → FINAL_NOTICE`) is chosen from the most recent `reminder_logs` row for that obligation. In-app used to write a row unconditionally on every trigger, including a skip — so an unreachable tenant (no WhatsApp, no email, and now correctly no in-app) would still climb the escalation ladder purely from those unconditional writes, reach `FINAL_NOTICE`, and then go permanently silent forever, while the owner's dashboard reported "final notice sent" against someone who was never contacted once. Fixed: `triggerNotification` now computes `deliveredChannel` (`IN_APP` if `result.in_app.sent`, else `WHATSAPP` if `result.whatsapp.sent`, else `EMAIL` if `result.email.sent`, else `null`) and writes to `reminder_logs` **only** when that is non-null. See [[Bugs]] for the full defect writeup.
- **Resident & guardian commands** — see the dedicated section below. Superseded 2026-08-27 by [[Decisions#ADR-128|ADR-128]]: the old `BAL`/`BALANCE`/`SWITCH`/`DUES`/`PAY`/`STATUS`/`HELP` surface (routed identity → intent → permission per [[Decisions#ADR-039|ADR-039]]) is replaced by `RENT`, `PAY`, `PLAN`, `RECEIPT`, `HELP`.
- **Every inbound WhatsApp text gets a reply — silence is a bug.** If no owner-assistant handler, interactive reply or command claims a message, the bot answers with what *does* work rather than with an apology (the old copy opened "Sorry — I didn't understand that"). Handler exceptions are caught per message (one bad message no longer abandons the rest of the batch) and answered with a brief failure notice that states nothing was charged. Both replies are rate-limited per sender (fallback 3 / 10 min, error notice 2 / 10 min) so a stranger sending noise can't be turned into a reply loop.
- **Who may do what** is declared in one place, the intent registry's `allowedRoles` (`whatsapp-webhook-event-service.buildIntentRegistry()`), checked *after* the intent is known. Interactive replies, guardian verification codes and the owner assistant (because `LINK` must work from an unknown number) are open to everyone; the command center requires a recognised sender holding `BILLING_READ`. An unrecognised number gets an explicit reply naming **all three** ways to be recognised — guardian, resident, owner. Owner-side assistant uses a separate, richer ID-based interactive-menu system (`owner-whatsapp-assistant.ts`) rather than flat keywords — full command enumeration for the owner side was not completed; treat as **Unknown/partially explored**.

## Resident & guardian command center

Added 2026-08-27 ([[Decisions#ADR-127|ADR-127]], [[Decisions#ADR-128|ADR-128]]). **Files:** `lib/services/notifications/command-center/` (`commands.ts`, `voice.ts`, `rent-summary.ts`, `installment-plan.ts`, `receipt.ts`, `menu.ts`, `context.ts`, `service.ts`, `guardian-access.ts`, `guardian-reminder-policy.ts`, `payment-confirmation.ts`).

1. **Five commands, two audiences.** `RENT` (what is due and when), `PAY` (a secure link), `PLAN` (instalment progress), `RECEIPT` (last payment), `HELP`. Retired words — `BAL`, `BALANCE`, `DUES`, `STATUS`, `SWITCH` — all still resolve to `RENT` and are advertised nowhere. A bare greeting ("hi", "hello", "namaste") opens the menu, but **only as the whole message**: "hi, rent?" answers the rent question, because greeting-then-asking is how people actually type.
2. **`RENT` and `PAY` quote the same number.** Both read `current_payable_amount` from `financialReadModelService` — the canonical composed model ([[Business-Rules#The Financial Read Model — "compose, don't reimplement"|compose, don't reimplement]]). `PAY` issues a **tenant-scoped** `payment_link_tokens` row via `PaymentLinkService`, which prices the account at payment time and FIFO-allocates across it. The obligation-bound link the old `PAY` wrote directly is gone.
3. **No conversational mode.** Which resident an action is about rides in the interactive payload (`CC:<COMMAND>:<tenantId>`), re-authorised against the sender's own residents on arrival. A multi-resident sender gets a picker whose rows state room and amount due and carry the original command forward.
4. **Instalment position excludes deposits and maintenance.** `PLAN` counts rent obligations only — folding a one-off security deposit into "3 of 12" produces a count a parent would reasonably act on and that is wrong. Tenants with no billing plan (month-to-month) get ordinal numbering with no total.
5. **Nothing prints "N/A".** `@/lib/format`'s date helpers return that string on null; `voice.ts::shortDate` returns `null` instead, and any sentence that needed the value is not written.

### Guardian access on WhatsApp

1. **Recognition ≠ authorisation.** A phone matching `tenants.guardian_phone` resolves to role `GUARDIAN`, but the **first financial request** triggers a six-digit OTP to that handset (`authOtpService`, purpose `GUARDIAN_ACCESS`). Verification lasts **90 days**, read back from the `phone_verification_otps` row (`status = 'VERIFIED'`), not from a separate table.
   - **Two purposes count**: `GUARDIAN_ACCESS` and `ParentVerify`. The second is the onboarding verification a tenant completes when adding their guardian — a code sent to that handset and entered back, which activation already refuses to proceed without. Recognising only the first would send a second code to a number verified minutes earlier, the moment the guardian taps [Help] on the activation notice below. The distinction is real and deliberate: `ParentVerify` proves the number was reachable and cooperated, `GUARDIAN_ACCESS` proves the person holding it *now* asked for access. Both expire into the same 90-day window, after which the stronger challenge is issued.
2. **`GUARDIAN_ACCESS` never degrades.** It is excluded from `SKIPPABLE_OTP_PURPOSES`. When WhatsApp OTP delivery is unavailable the guardian is refused and pointed at the hostel — the check is not waived. Same rule as `PASSWORD_RESET`.
3. **Scope: money and stay basics.** Dues, instalment progress, payment links, receipts, room, hostel, agreement dates. **Not** move-out requests, documents or KYC — enforced by the command set containing no reader for them, not by copy.
4. **Person, not possession.** Guardians are addressed in the third person ("Aarav's rent"), residents in the second ("your rent"). A phone holding both relationships is judged **per resident**.
5. **A guardian is told the channel exists, once, when they are verified.** `stayo_guardian_whatsapp_activated` fires from `activationWorkflowService.completeProfile` the moment the tenant's guardian OTP passes and the row commits — before that, verification produced a database row and total silence, and a guardian's first ever message was a rent reminder weeks later. Idempotent on `(tenant, guardian number)`; **changing** the guardian's number sends afresh, because the new person has been told nothing. Non-blocking: onboarding never fails because WhatsApp did.
   - **`{{2}}` is the tenant's name, never a possessive.** The body supplies its own framing — "the guardian for {{2}}", "on behalf of your ward" — so a possessive renders "the guardian for Sharan's at Delux hostel". `tenantDisplayName()` strips one if a caller passes it rather than trusting every future call site; it is the exact inverse of `voice.ts::possessive` for both the `Sharan's` and `Anders'` forms.
   - **The [Help] quick reply is a real entry point.** A guardian's first interaction should be a tap, not a recall exercise. Tapping delivers an inbound webhook of type `button` — a type `extractMessageEvents` **explicitly dropped** until this template existed, so the tap would have been answered with silence. It now extracts as **text** carrying the payload word (`Help`), because a template quick reply is the reader *saying* that word; its payload is a plain keyword, not a `CC:` id, and resolves through the ordinary vocabulary.
6. **Payment confirmations reach a guardian only if verified.** `sendPaymentConfirmation` skips an unverified guardian number with reason `GUARDIAN_UNVERIFIED`, and skips a guardian number identical to the resident's (`GUARDIAN_SAME_AS_RESIDENT`) so one handset never gets the same message twice.

### Guardian reminder escalation

Superseded rule: guardians were contacted only at `daysOverdue >= 3`, so **every message a guardian ever received was a complaint** — the relationship opened in arrears. `guardian-reminder-policy.ts::decideGuardianReminder` (pure) now returns:

| `daysOverdue` | Guardian notified? | Reason |
|---|---|---|
| `< -3` | No | `TOO_EARLY` |
| `-3 … -1` | **Yes** | `HEADS_UP` — the message that actually collects on time |
| `0` | **Yes** | `DUE_TODAY` |
| `>= 1` | **Yes** | `OVERDUE` (from day 1, not day 3) |

Two suppressions regardless of timing: `NO_GUARDIAN_PHONE`, and `SAME_AS_RESIDENT` (compared on normalised digits, since the schema stores phone numbers inconsistently). A guardian send that fails is logged and never rethrown — the resident's own reminder already landed, and failing the batch would retry that one too.

## Agreement renewal expiry reminders

**Files:** `src/services/tenants/renewal-status-service.ts` (`determineRenewalStage`), `src/services/tenants/agreement-renewal-notification-service.ts` (`processRenewalNotifications`), called per-agreement from `AgreementLifecycleService.processDailyLifecycle`'s daily walk.

- **A successor agreement suppresses all further reminders on the predecessor.** Once a renewal offer has been accepted or a manual renewal draft created (`decision.has_successor` — i.e. `renewed_to_agreement_id` set, or a non-`VOID`/`TERMINATED` row in `renewed_agreements`), `determineRenewalStage` returns `null` unconditionally — the predecessor is waiting on its successor's own activation, not on the tenant to renew, so "please renew" nudges would be actively wrong. Fixed 2026-07-19; see [[Bugs]], [[Decisions]] ADR-013.
- **Stages are threshold bands, not exact-day matches** (fixed 2026-07-19; see [[Bugs]], [[Decisions]] ADR-014): `30_DAY_REMINDER` fires for `16 ≤ daysUntilExpiry ≤ 30`, `15_DAY_REMINDER` for `1 ≤ daysUntilExpiry ≤ 15`, `7_DAY_OVERDUE` for `daysOverdue ≥ 7`, `30_DAY_CRITICAL` for `daysOverdue ≥ grace_period_days` (checked before `7_DAY_OVERDUE`, so the two don't double-fire) — a stage that would have been missed by a single skipped cron run now still fires on the next run instead of being silently skipped forever. `EXPIRY_DAY_ALERT` (`daysUntilExpiry === 0`) intentionally stays an exact match — there's no meaningful catch-up for it, and broadening it would collide with `EXPIRED_RENT_OVERDUE`'s rent-overdue-state fallback.
- **Idempotency is enforced at the delivery layer, not by day-exactness.** `whatsAppTemplateDeliveryService.send()` keys on `idempotencyKey` (`agreement_renewal_<stage>:<agreementId>` / `owner_renewal_alert_<stage>:<agreementId>`) against a DB unique constraint (`whatsapp_logs.idempotency_key`, `ON CONFLICT DO NOTHING`) — a stage matching on several consecutive cron runs still only ever sends once.

## Correction Cases — Payment corrections (Reverse / Transfer / Edit Reference)

**Files:** `apps/backend/src/services/recovery/recovery-service.ts`, `correction-registry.ts`; handlers in `apps/backend/src/services/payments/corrections/` — `payment-reversal-handler.ts`, `payment-transfer-handler.ts`, `reference-edit-handler.ts`, plus the shared `payment-correction-shared.ts::reverseObligationPayment`. Schema: see [[Database]] `correction_cases`/`correction_case_events`.

Phase 1 of the Business Recovery Platform (`docs/business-logic/business-recovery-platform-architecture.md`) shipped three payment-correction handlers, all registered into `correctionRegistry` and driven through the same `recoveryService.createCase → preview → validate → execute` lifecycle:

- **Payments are never mutated to correct them — a correction always creates a new offsetting row.** `reverseObligationPayment()` (shared by Reverse and Transfer) never updates or deletes the original `payments` row; it inserts a new negative-amount `payments` row (`reference_number: REVERSAL:<paymentId>`) and recomputes the parent obligation's `settlement_status`/`status` from a fresh sum of all payments on that obligation. This is consistent with the pre-existing invariant that settled `payments` rows are immutable (architectural-invariants-check.ts, check 6) — corrections extend that append-only model rather than carving an exception into it.
- **Reverse Payment** (`PAYMENT_REVERSAL`): reverses one payment's effect on its obligation. It posts a `LEDGER_CORRECTION` debit via `tenantFinancialLedgerService` **only when the obligation is `ADVANCE` or `SECURITY_DEPOSIT`** — those are the only obligation types whose payment allocation itself writes a matching ledger credit in the first place (`settlement-engine.ts`, `reason: "DEPOSIT"`). A RENT (or any other) obligation's allocation writes no ledger entry to undo, so its reversal skips the ledger debit entirely and only restores the obligation's outstanding balance — writing one anyway would silently consume unrelated future-rent-credit the tenant might separately hold (see [[Bugs]]). `computeImpact()`'s preview mirrors the same condition, so it never promises a ledger entry that `execute()` won't create. **One reversal case per payment is enforced by a deterministic idempotency key**, `PAYMENT_REVERSAL:<paymentId>` (unique constraint on `correction_cases.idempotency_key`) — a second `createCase` call for the same payment reuses/conflicts with the existing case rather than creating a duplicate. Within a single case, retrying `execute()` is additionally idempotent at the reversal-row level (`correction:<correctionCaseId>:reversal` key on the new `payments` row).
- **Transfer Payment** (`PAYMENT_TRANSFER`): reverses the payment on the source obligation (same shared helper, same ADVANCE/SECURITY_DEPOSIT-only ledger-debit condition) and re-allocates the same amount as a new forward payment against the target tenant's open obligations via `buildSettlementPlan`/`executePlanInTx` (the same FIFO settlement engine payment receipt uses). Idempotency key: `PAYMENT_TRANSFER:<paymentId>` — same one-case-per-payment guarantee as Reverse.
- **Cross-hostel transfers are blocked by policy, at two layers.** `createCase()` throws synchronously if the source payment's `hostel_id` or the target tenant's `hostel_id` doesn't match the hostel the caller claims (`ctx.hostelId`), so a mismatched case is never persisted in the first place. `policy.canExecute()` independently re-checks both at execute-time (payment hostel, target-tenant hostel, and that the target can still accept the amount per `buildSettlementPlan`), guarding against hostel drift that happens *after* the case was created (e.g. the target tenant is moved to a different hostel between case creation and execution).
- **Edit Reference/Notes** (`PAYMENT_REFERENCE_EDIT`): the one payment-correction handler that *does* perform a direct update — but only on `payment_groups.reference_number`/`notes`, never on `payments` itself (the individual payment rows inside a group are untouched). Unlike Reverse/Transfer, edits are not one-shot-per-entity (the same payment group's reference/notes can be legitimately corrected more than once over time), so its idempotency key includes a random component (`PAYMENT_REFERENCE_EDIT:<paymentGroupId>:<uuid>`). That UUID is generated fresh inside every `createCase()` call, so **it does not dedupe a literal double-submit** — two calls for the same request produce two different keys and two independent `correction_cases` rows, each executed separately. This is safe only because `execute()` is a harmless idempotent field overwrite (re-applying the same `reference_number`/`notes` twice has no adverse effect), not because of the idempotency key. Its `createCase()` and `policy.canExecute()` both independently verify the payment group's `hostel_id` matches the case's hostel, mirroring the same createCase/canExecute pairing used by Reverse and Transfer.
- **All three handlers' `createCase()` re-validate hostel ownership of the entity being corrected, not just `policy.canExecute()`.** This was a deliberate fix applied across all three (Tasks 9, 10, 11): checking hostel ownership only in `canExecute()` would still let a mismatched-hostel case be created and persisted (as a case that could never validate/execute) — `createCase()` throwing immediately means a bad case is never written at all.
- **Execution retries are capped: two failed `execute()` attempts are allowed (each is a real handler invocation that leaves the case `FAILED`); a third call is refused synchronously (`recoveryService.execute` throws before touching the DB or invoking the handler) and the case remains permanently `FAILED`.** This cap (`MAX_RETRY_ATTEMPTS = 2` in `recovery-service.ts`) counts prior attempts from `execution_result.attempts`, so it survives across separate `execute()` calls, not just within one.

## Multi-hostel / `hostelId` invariants

**File:** `apps/backend/scripts/architectural-invariants-check.ts` — a static regex-based scanner (not runtime), 9 checks, exit-1 on violation:

1. Frontend `HostelContext` isolation — `../frontend/src` can't call hostel-context helpers directly except from `context/HostelContext.jsx`.
2. No direct `invalidateDashboardCache(` calls outside `lib/cache/dashboard-cache.ts` itself.
3. **`hostelId` must be a required parameter**, never optional, in operational service/route signatures (with 6 named exceptions).
4. **No "first hostel" fallback** (`hostels[0]`, or `findFirst` chains implying it) in operational code (8 named exceptions) — this exists because past bugs silently picked the wrong hostel for multi-hostel owners.
5. No `$queryRawUnsafe` outside a fixed allowlist of invariant/audit-tooling files.
6. **Settled `payments` rows are immutable** — no `update`/`updateMany`/`upsert`/`delete`/`deleteMany` on the `payment` model anywhere in application code.
7. Payment-attempt status transitions must go through `payment-service.ts`/`payment-status-event-service.ts`, not direct writes.
8. `portfolio-service.ts` may not query raw transactional tables (payment/rentObligation/tenant) without a hostel-scoping proximity check.
9. Frontend `useQuery` hooks must include `hostelId` in their query key (6 named exceptions).

## Account types — who can sign themselves up

Added 2026-07-31 ([[Decisions#ADR-035|ADR-035]]).

1. **Owners** self-sign-up via `/api/auth/owner-signup`, normally reached through the lead → admin approval → activation-link funnel. `profiles.role = OWNER`, `owner_id = own id`.
2. **Tenants** self-sign-up via `/api/auth/tenant-signup`, creating a **marketplace account**: `role: TENANT`, `owner_id` null, **no `tenants` row**. This account can browse and enquire; it is not a tenant of any hostel. Two ways in, both producing the identical account: **email + password** (name, email, password, confirm password) or **Google**. **Neither collects a phone number** — as of [[Decisions#ADR-113|ADR-113]] `phone` is optional on this endpoint, so a marketplace account is born `phone: null, phone_verified: false` and the number is collected **and verified once, at the enquiry**, per [[Decisions#ADR-078|ADR-078]]. A phone sent to the signup endpoint anyway must still carry a fresh verified-or-skipped OTP; the rule permits *no* number, never an *unverified* one.
3. **A tenant *of a hostel*** is only ever created by an owner's invitation + activation. That flow reuses an existing marketplace profile rather than creating a second one; whether it may do so is decided by the tenancy-eligibility rule below.
4. **Admins** are never self-serve — first via `scripts/bootstrap-platform-admin.ts`, later by invitation.

Consequences that surfaces must respect: a TENANT session can legitimately have `tenant_id: null`, so anything reading dues/agreements/room must tolerate its absence (`/api/auth/me` already does), and post-login routing sends such a user to hostel search rather than the tenant portal.

## Who may sign in with Google, and how a password may be reset (2026-08-08)

Changed by [[Decisions#ADR-054|ADR-054]] and [[Decisions#ADR-055|ADR-055]].

**Google sign-in** is available to **every** role — owner, tenant, admin. Two rules survive that change and are load-bearing:

1. **It never creates an account — on the plain login path.** `resolveSupabaseSession()` still matches only an existing `profiles` row, by `auth_user_id` or by verified email, and rejects an unknown email with `NO_STAYO_ACCOUNT`, whatever the role. Tenancy remains an owner-initiated relationship.
2. **It cannot skip activation.** A TENANT whose live tenancy is `INVITED` is rejected with `TENANCY_NOT_ACTIVATED` — the same gate `authService.login()` applies. Previously the blanket tenant block enforced this by accident; now it is explicit.

**Amendment, 2026-08-16 ([[Decisions#ADR-078|ADR-078]]):** rule 1 gained one narrow, explicit exception for **tenants only**, not a relaxation of the rule itself. `POST /api/auth/google/provision` — a separate endpoint, calling a separate function (`provisionMarketplaceTenantFromSupabase()`), never invoked from the login path — may create a new `role: TENANT` marketplace profile (no `tenants` row) when Google has verified the email and no `profiles` row exists for it at all. `resolveSupabaseSession()` itself is unmodified and still enforces rule 1 exactly as before for every other caller, including this same person's *next* login. Owners and admins can never be created this way — nothing calls the provisioning endpoint for `mode="owner"`. See [[Decisions#ADR-078|ADR-078]] for the full design and the invariant test that pins this.

**Password reset** has two channels, and both end at the same place:

| Channel | Proof | Token life | Delivered by |
|---|---|---|---|
| Email | Possession of the account's inbox | 1 hour | Resend link to `/reset-password` |
| Phone | A 6-digit WhatsApp OTP | **5 minutes** | Token returned in the API response |

The phone token is short because, unlike an emailed link, it is handed straight to the browser. Both channels submit to `POST /api/auth/reset-password`, so revocation of all other sessions, the one-time-use lock and Supabase identity sync happen once, in one place.

Rules that must not be relaxed:

- **`PASSWORD_RESET` never degrades.** It is excluded from `SKIPPABLE_OTP_PURPOSES`; when WhatsApp is unavailable the reset fails rather than proceeding without a code.
- **The email channel never reveals whether an account exists.** Identical response for any address; `delivery_degraded` is a function of provider configuration only, never of the submitted address.
- **Account *status* is never revealed on either channel.** A deactivated account reports exactly like a non-existent one.
- **Rate limits are applied before the account lookup**, on both channels — per-identifier and per-IP. **Corrected 2026-08-08:** an earlier version of this line claimed that means "no endpoint can be used to sweep a range." It does not. The **per-identifier** limit is irrelevant to enumeration, because probing uses a *different* identifier each time and each one gets a fresh budget; only the **per-IP** limit constrains it, at 20/hour, and IPs are cheap. It is also **entirely Redis-dependent** — `checkFixedWindowLimit` has no database fallback and `failOpen: true`, so with Redis unconfigured the limit allows everything (measured: a 6th request to a 5-per-15-min endpoint returned `200`; after Upstash was provisioned the same probe returns `429`). Accurate statement: **~20 probes/hour/IP when Redis is configured, unlimited when it is not.** Login is the exception — `checkRateLimit` falls back to `checkDatabaseRateLimit` on `login_attempts`, so brute-force protection survives a Redis outage.

**The phone channel does reveal whether the number is registered** (amended 2026-08-08, [[Decisions#ADR-055|ADR-055]]). `POST /api/auth/forgot-password/phone` returns 404 `NO_ACCOUNT_FOR_PHONE` rather than a generic success, because the signup routes already disclose the same fact (`ALREADY_EXISTS: Phone number already registered`, public and unauthenticated), while the generic reply stranded anyone who mistyped a digit on a code screen for five minutes. **Consequence to respect:** restoring non-disclosure here is pointless unless the signup routes are fixed first.

## One live tenancy per person (2026-08-07)

Changed by [[Decisions#ADR-053|ADR-053]]. A person may hold exactly one live tenancy — `INVITED` or `ACTIVE` — enforced by the partial unique index `tenants_one_live_tenancy_per_profile`, not by convention. The decision itself lives in `src/services/tenants/tenancy-eligibility-rules.ts` as pure functions; `tenancy-eligibility-service.ts` gathers the data.

Someone may start a new tenancy when **both** hold:

1. They hold no live tenancy.
2. Every tenancy they **actually moved into** has a `move_out_requests` row in `COMPLETED`.

Rule 2 keys on settlement, not on status: `FORMER_TENANT` is set at the exit date, which can precede the settlement money moving. It also keys on *having activated* — an invitation that expired or was cancelled before the tenant ever arrived owes no settlement, and must not trap them on the platform forever.

Refusals: `TENANT_HAS_ACTIVE_TENANCY` and `PREVIOUS_TENANCY_NOT_SETTLED`, both HTTP 409.

**Disclosure is scoped to ownership.** The refusal names the hostel and room **only when that hostel belongs to the owner asking**. For any other owner's property it says only "currently a tenant at another property on Stayo" — no hostel name, no room, no tenant id. Otherwise any owner could enumerate a competitor's roster, and a person's home address, by guessing emails. Enforced on both sides: the backend blanks the fields, and the frontend's `parseTenancyConflict` ignores a hostel name that arrives without an `OWN` scope.

**Accepting one invitation voids the others.** Several owners may invite the same person; the first acceptance cancels every other live invitation for them, releases those room reservations back to capacity with `release_reason: 'JOINED_ELSEWHERE'`, and logs `invitation_voided_joined_elsewhere` for the losing owners. A pending invitation from another owner therefore **does not** block a new invite — blocking there would let any owner reserve a person with an invite they never send follow-up on.

**Offered pre-submit, since 2026-08-27 ([[Decisions#ADR-129|ADR-129]]).** The same refusal, same OWN/OTHER disclosure scoping, is now also answerable *before* the owner submits the invite form: `GET /api/owners/invitations/eligibility?phone=&email=` wraps `checkEligibility` in a non-throwing, non-mutating `previewEligibilityByContact`. The Invite Tenant wizard's Tenant step debounces this on the phone field. No new information crosses the boundary — this is the same 409 signal offered earlier, plus a bare `has_account` boolean.

**The block applies to both of the wizard's exits, not only "Send invite" (merged 2026-08-27, [[Decisions#ADR-133|ADR-133]]).** "Just add to my records" (`submitAsOwnerManaged`, see the owner-managed tenants section below) creates the exact same `ACTIVE` tenancy an accepted invite eventually does — it is not a lesser commitment — so `useInviteWizard.ts`'s `isOwnerManagedValid` also requires `!eligibilityConflict`, the same debounced pre-submit signal that already gated `isStep0Valid`/`isStep3Valid` for the invite path. Without this, a person already active at another hostel could be blocked from Send but waved through the second exit as a back door. `ownerManagedMutation`'s own 409 is parsed through the same `parseTenancyConflict` as a check→submit-race safety net (`ownerManagedConflict`), rendered with the same OWN/OTHER-scoped card `submitConflict` already used.

## Owner-managed tenants — access is a second, independent axis (2026-08-27, Phase 1)

**Files:** `apps/backend/prisma/schema.prisma` (`TenantAccessMode`, `tenants.access_mode`/`display_name`), `apps/backend/lib/tenants/tenant-identity.ts` (`resolveTenantName`/`resolveTenantPhone`), `apps/backend/src/services/tenants/owner-managed-tenancy-service.ts` (`adopt`), `apps/backend/src/services/tenants/tenancy-allocation.ts` (`ensureActiveAllocation`), `apps/backend/scripts/activation-invariants-check.ts`. Design spec: `docs/superpowers/specs/2026-08-27-owner-managed-tenants-design.md`. See [[Database]], [[APIs]], [[Features]], [[Decisions]].

⚠️ **The migration adding `access_mode`/`display_name`/`tenant_owner_attestations` has not been applied to any database.** Every rule below describes what the code does once it is; until then this is dormant code, not live behaviour.

**Two axes, not one field doing two jobs.** `TenantStatus` (`INVITED → ACTIVE → FORMER_TENANT/EXPIRED/CANCELLED`) answers *"does this person live here and owe rent?"*. The new `TenantAccessMode` (`SELF_SERVE` default | `OWNER_MANAGED`) answers the independent question *"does this person have a way to log in?"*. Before this change those were conflated — `ACTIVE` was reachable only by the tenant completing their own registration, so a tenant who paid cash hand-to-hand and never touched the app stayed `INVITED` forever: no rent obligations generated, no reminders sendable, the room reading as vacant, occupancy/revenue analytics understating reality. **`ACTIVE` no longer implies an account.** It now means only "lives here, owes rent," reachable two ways: the tenant activates (unchanged, today's path — `SELF_SERVE`), or the owner adopts them (`OWNER_MANAGED`). Every consumer that already keyed on `ACTIVE` (rent generation, room capacity, analytics, reminders) works unchanged — the fix is that owner-managed tenants now actually reach that state, not that those consumers were rewritten.

**Transitions:**

| Transition | Trigger | Effect |
|---|---|---|
| **Adopt** | Owner: "Keep records myself" on a quiet invite (`POST /api/tenants/[id]/adopt`) | `INVITED → ACTIVE`, `access_mode = OWNER_MANAGED`, reservation converted to a room allocation, an attestation written. Rent generation begins on the next run. |
| **Add directly** | Owner ends the invite wizard with "Just add to my records" | Same effect as Adopt, via `createInvitation({ suppressInvitationNotification: true })` immediately followed by `adopt` — no token is ever dispatched. |
| **Claim** *(Phase 2, 2026-08-27)* | Tenant OTP-verifies their number (`POST /api/tenancy-claim/confirm`) | `OWNER_MANAGED → SELF_SERVE`, profile created/linked, same `tenant_id`, same financial history. See the claim section below and [[APIs]]. |

**Adopt does not cancel the invitation.** The superseded invitation stays resolvable, because a stale link the tenant clicks after adoption should route to claiming the tenancy Phase 2 will build, not to an error.

**Adopt is not the removed owner-side "Activate" button.** `InvitedTenantProfileView.tsx` documents that an earlier Activate button was deliberately deleted because it let an owner claim a tenant had completed registration when they had not. Adopt makes no such claim: it records, via the attestation, that registration did **not** happen, and marks the access mode accordingly. Asserting a fact about what didn't happen is why this is permitted where that button was not — see [[Decisions]] for the ADR.

**An owner attestation is never tenant consent.** `tenant_owner_attestations` records the owner's own assertion that a tenancy is managed offline — who attested, when, from what IP, an optional note. It is deliberately not a `TenantPolicyAcceptance`: that model is read everywhere as "the tenant accepted the hostel's rules," and forging one on an owner's click would make the audit trail lie in exactly the moment it is tested — a deposit dispute. See [[Database]].

**Activation invariants are now conditional on `access_mode`, not relaxed.** `scripts/activation-invariants-check.ts` (`npm run check:activation-invariants`) branches:

- `SELF_SERVE` + `ACTIVE` → must have `profile_id`, a completed profile, and a `TenantPolicyAcceptance` row — **unchanged, still as strict as before this change.**
- `OWNER_MANAGED` + `ACTIVE` → must have a non-blank `display_name` and `phone_1`, and at least one `tenant_owner_attestations` row.
- `OWNER_MANAGED` (any status) → must **never** hold a linked auth identity — checked as `profiles.auth_user_id IS NOT NULL`, since an owner-managed tenant should have no `profiles` row at all, let alone one bound to a live Supabase session. This is the invariant that matters most: it is the one that would catch a Phase-2 claim bug leaving a tenant simultaneously "owner-managed" and able to log in as someone else.

Weakening the checks globally was rejected in the design — a real self-serve bug (a genuinely `ACTIVE` self-serve tenant missing a `TenantPolicyAcceptance`) must still fail the check exactly as before; only the newly-legitimate `OWNER_MANAGED` shape gets its own rules rather than being exempted from the old ones.

**Reaching a tenant with no account is core to this phase, not a later refinement.** See the "Reach a tenant with no account" bullets under [[Business-Rules#Notification triggers|Notification triggers]] below for the reminder-side rules this required — `resolveTenantName`/`resolveTenantPhone`, the four inner-join sites that silently dropped these tenants from operational queries (fixed, see [[Bugs]]), and the `reminder_logs`-as-escalation-state rule.

**Phase 2 shipped 2026-08-27: the claim flow.** See the section immediately below. **Still not built:** the reminder-copy claim link (design spec §8.4), and Revoke (`SELF_SERVE → OWNER_MANAGED` for a tenant who stopped using the app). See [[TODO]].

## Claiming an owner-managed tenancy (2026-08-27, Phase 2)

**Files:** `apps/backend/lib/tenants/claim-eligibility.ts` (pure eligibility + proof rules), `apps/backend/src/services/tenants/tenancy-claim-service.ts` (`lookup`/`confirm`), `apps/backend/app/api/tenancy-claim/{lookup,confirm}/route.ts`, `apps/frontend/src/platforms/tenant/claim/{ClaimTenancyPage.tsx,claimSteps.ts}`. See [[APIs]], [[Features]], [[Decisions]], [[TODO]].

**What makes a tenancy claimable — `isClaimable`:** exactly `access_mode === "OWNER_MANAGED"` **and** `status === "ACTIVE"`.

- `SELF_SERVE` is excluded — it already has an identity attached (from signup or an earlier claim), so claiming it again would be an account takeover, not onboarding.
- `FORMER_TENANT`, `CANCELLED`, `EXPIRED` are excluded — a past resident must not be able to reopen a closed tenancy by re-verifying a phone number, and numbers get recycled to new subscribers over time.
- `INVITED` is excluded — that tenancy has its own live flow (accepting the invitation), not a claim. (A stale invitation link whose tenancy was since *adopted* — `OWNER_MANAGED` — is the one case that routes into claiming instead of erroring: `resolveByToken` throws `CLAIM_REQUIRED` for that specific combination; see [[APIs]]'s activation-context entry.)

**Phone is the identity.** `tenants.phone_1` (canonicalised via `normalizeIndianPhone`, E.164) is what `lookup` and `confirm` match against — there is no other credential in play before a proof of possession exists. `confirm` re-normalizes and re-compares the tenancy's *current* `phone_1` against the claimed number inside its own transaction, not anything cached from `lookup`: if the owner edited the phone between the two calls, the old number stops matching.

**SECURITY — the OTP skip path is never proof.** `authOtpService.sendPhoneOtp` writes a `phoneVerificationOtp` row with `status: "SKIPPED"` (never `"VERIFIED"`) when WhatsApp is unavailable (the same fallback `PASSWORD_RESET`/`PHONE_VERIFICATION` use elsewhere — see [[Decisions#ADR-034|ADR-034]]). **`TENANCY_CLAIM` is deliberately absent from `SKIPPABLE_OTP_PURPOSES`** (`lib/services/auth/phone-verification-mode.ts`, alongside `PASSWORD_RESET`), so a WhatsApp outage makes the *send* step fail rather than silently downgrading to an unverified "proceed anyway" — a claim can attach a person to years of someone else's obligations, payments, receipts and deposit, so this flow hard-fails closed rather than waving anyone through. `isOtpProofValid` (pure, in `claim-eligibility.ts`) is the single check both `lookup` and `confirm` run, independently, from scratch, against the database: it requires `status === "VERIFIED"` exactly, `purpose === "TENANCY_CLAIM"` exactly (a code verified for a different flow can never be redirected into a claim), and `verified_at` present, not in the future, and no older than `CLAIM_PROOF_MAX_AGE_MS` (10 minutes) relative to now. `confirm` never trusts that `lookup` ran, and neither ever trusts a client-supplied "verified" flag.

**Proof is single-use, consumed under a guarded update.** `consumeClaimProof` runs `UPDATE phone_verification_otps SET status = 'CONSUMED' WHERE id = :proofId AND status = 'VERIFIED'` and requires exactly one row affected — a read-then-write would let two concurrent `confirm` calls both observe "still VERIFIED" and both proceed; the guarded, single-statement update means whichever transaction commits first wins the row lock, and the loser's `WHERE` re-evaluates against the now-`CONSUMED` row under READ COMMITTED and matches zero rows, so it must fail the whole claim rather than proceed as if consumption succeeded. Consumption happens last, after every other write in `confirm`'s transaction (proof re-check, tenancy re-check, profile attach/create, the `SELF_SERVE` flip, the policy acceptance) — a lost race there rolls the entire transaction back, so the claim never partially applies.

**`lookup` returns display data only.** It is reachable pre-authentication by anyone holding a verified number, so a mistyped digit must never expose a stranger's finances — no obligations, no balances, no payment history, ever, from that endpoint (`toClaimSummary`'s hand-picked whitelist: `tenant_id, hostel_name, room_no, joined_on, owner_name, monthly_rent`).

**Consent is real, not the owner's attestation carried forward.** `confirm` writes the tenancy's first genuine `TenantPolicyAcceptance` — a full rules snapshot with interpolated variables (tenant name, hostel, room, rent, deposit, maintenance, joining date, owner name) and the tenant's own typed signature, gated by the same `REQUIRED_ACKNOWLEDGEMENTS` five-key check activation's `acceptRules` uses (kept as a deliberately decoupled local copy, not an import). The owner's original `tenant_owner_attestations` row from adoption is left exactly as it was — it stays true that the owner did keep the books for a period; claiming doesn't retroactively rewrite that history.

**SECURITY — a claim never overwrites an existing account's password.** The unauthenticated path (no signed-in `profileId`) may match an *existing* profile by phone rather than creating a new one — reuse, not duplication, for the same phone number. Before this fix, `confirm` unconditionally reset that profile's `password_hash` to whatever password the claim request supplied. Two real consequences: Indian mobile numbers get reassigned, so the new holder of a recycled number could OTP-verify it and silently take over the previous holder's marketplace account; and a legitimate marketplace user who already knew their password would have it silently changed without asking. `assertClaimablePhoneMatch` now refuses with **`401 SIGN_IN_REQUIRED`** whenever the matched profile already has a `password_hash` — the claimant must sign in on that account first and retry through the already-authenticated `profileId` path, which never accepts a password and so can never touch that account's credentials. Setting a password is still legitimate, and unchanged, for a profile with **no** `password_hash` — an invitation-created shell that was never activated has nothing to protect. See [[Decisions]] for the ADR and [[APIs]] for the error shape.

**The already-signed-in path is symmetric the other way.** When `confirm` is called with a `profileId` from a verified session, a password in the request body is refused outright (`400 VALIDATION_ERROR`) — that session already authenticates the caller, so accepting a password there would itself be a route to touch an account's credentials that doesn't need touching.

**Claiming notifies the owner, in-app.** On a successful `confirm`, the owner gets an in-app notification (`notifications` table, `type: "tenancy_claim"`) — reusing the existing mechanism `agreement-lifecycle-service.ts`'s `notifyOwner`/`notifyTenant` already write through, rather than a new channel. No WhatsApp template exists for this event. Fire-and-forget: the claim has already committed by this point, so a notification failure is logged and swallowed, never surfaced as a claim failure. See [[Features]].

## "Live tenancy" as the app-wide nav-gating definition (2026-08-16)

Added by [[Decisions#ADR-078|ADR-078]]. The app-wide bottom nav shows a Dashboard tab, and `ProtectedTenantRoute` allows `/tenant/*` at all, **only** when the signed-in person has a live tenancy — defined as `tenant_status` (surfaced on `/auth/me`, sourced from `tenants.status`) being `INVITED` or `ACTIVE`. This is not a new rule invented for navigation: it's the same "live" definition `profile-identity-service.ts`'s tenancy-fallback logic already used (`selectFallbackTenancy`), reused rather than redefined so the frontend and backend never disagree on what "live" means. An account existing (any signed-in `role: TENANT` profile) is explicitly **not** sufficient — a Discover-only marketplace account with no `tenants` row at all must never see a Dashboard tab or reach `/tenant/*`. `useTenantSession().isAuthenticated` (the gate several tenant-dashboard hooks share, e.g. `useTenantProfile`, `useTenantRoom`) was tightened to this same definition at the same time — previously it only checked `role === 'tenant'`, which would have fired tenancy-scoped API calls for a seeker with no tenancy once those hooks became reachable from the shared Profile hub.

## Joining a hostel does not require payment (2026-08-07)

Changed by [[Decisions#ADR-052|ADR-052]]. The room is assigned at activation, unconditionally. Security deposit and maintenance are ordinary dues — created at invite time, `PENDING`, payable after move-in, chased like rent. Nothing in the product is withheld from a tenant who owes them: not the room, not the dashboard, not move-out.

## How the security deposit amount is decided

Set by [[Decisions#ADR-060|ADR-060]]. `hostels.preferences_config.billing_defaults.deposit_calculation_mode` picks between two resolutions, applied by `hostel-billing-preferences-service.resolveTenantInviteDefaults` at **invite** time, per room:

| Mode | Amount collected |
|---|---|
| `FLAT` (default) | `security_deposit` — the same figure for every tenant |
| `MONTHS_OF_RENT` | `deposit_months × rent`, where `rent = auto_fill_room_rent ? room.base_rent : 0` |

Three consequences that are easy to get wrong:

- **`deposit.enabled` is not consulted by the resolver.** It affects display only. "No deposit" therefore has to be stored as `FLAT` with `default_amount: 0`; storing `MONTHS_OF_RENT` alongside `enabled: false` keeps collecting months × rent.
- **`MONTHS_OF_RENT` with `auto_fill_room_rent` off resolves to ₹0**, because the rent term is zero. The owner-facing Deposit screen warns about exactly this combination.
- **`deposit_months` is clamped 1–12**, `default_amount` to 0–1,000,000, and the nested `billing.deposit` and flat `billing_defaults` representations are kept in sync by `policyToStorage` spreading `toCompatibilityPreferences(policy)` — the nested policy is what the UI writes, the flat block is what the resolver reads.

## Whether a tenant must sign an agreement

Set by [[Decisions#ADR-059|ADR-059]]. `tenant_rules.agreement_required` (default **true**; an absent or null flag reads as **true**) decides whether the `RULES` and `AGREEMENT` onboarding steps apply.

- **It governs the signing ceremony only.** `Agreement` rows are created either way, because `contract_rent` on that record is what obligation generation, renewals and move-out settlement key to.
  - **Rent changes are the exception, since 2026-08-26 ([[Decisions#ADR-125|ADR-125]]).** They are anchored to `tenants.monthly_rent` and need no agreement at all — an optional record cannot sit on the critical path for money. Where an agreement exists its `contract_rent` is kept in step, because the readers above prefer it when present; it is a snapshot, not a gate.
- **When on, the order is `ACCOUNT → RULES → PROFILE → AGREEMENT → ACTIVATE`** — Identity precedes Agreement ([[Decisions#ADR-070|ADR-070]], 2026-08-14; previously Agreement preceded Profile). `RULES` is auto-accepted as a side effect of any `mutate()`/`getContext()` call once `ACCOUNT` is done, so in practice the tenant-facing sequence is Account → Identity → Agreement → Password/Activate.
- **A student profile's guardian *relationship* is no longer required at the Profile step** (ADR-070 amendment, 2026-08-14) — only guardian name and a verified guardian phone are, since Identity now runs before Agreement and nothing before Agreement collects a relationship label. It's filled in later only if a guardian actually co-signs the agreement (`signAgreement()` writes it back onto both `tenants.guardian_relation` and the `Agreement` row); otherwise it stays null.
- **Emergency contact is no longer collected during activation at all** (ADR-070 second amendment, 2026-08-14) — removed from the Identity screen by explicit direction; `saveProfile()` no longer requires it (still validated for format if ever supplied). Collected later, if needed, from the tenant portal profile instead — see the direct-editable field list below.
- **When off**, onboarding is `ACCOUNT → PROFILE → ACTIVATE`; attempting `RULES` or `AGREEMENT` is itself an invalid transition; and both activation gates (`assertTransition` **and** the independent re-check in the finalise path) stop requiring `rules_accepted`/`agreement_signed`.
- **Skipped steps report as not done, not as complete.** `progress_percent` is computed over the steps this hostel requires, so a skipped-agreement tenant reads 2-of-3 rather than being credited with signatures they never gave.
- **Turning it off is not retroactive** — agreements already signed remain, and remain credited.
- **Since 2026-08-11 ([[Decisions#ADR-063|ADR-063]]), it also gates the owner Home dashboard.** The unified Action Center's "Renewal Agreements" card only renders when `agreement_required` is on for the owner's primary hostel — reusing this flag rather than adding a second, dashboard-only toggle. This is a real second effect of the flag, not just onboarding: an owner who has turned agreements off for their hostel won't see the renewal-queue card at all on Home. See [[Features]].

The `PAYMENT_PENDING` / `RESERVED` / `MOVE_IN_READY` vocabulary is **deleted**. The tenant lifecycle is `INVITED` → `ACTIVE` (shown to owners as "Joined") → vacating → `FORMER_TENANT`.

Occupancy is a question about beds, not money: a room is occupied by every active allocation held by an `ACTIVE` tenant. It previously excluded anyone still `PAYMENT_PENDING`, which left a moved-in tenant's bed looking vacant and invitable.

## Food schedule generation is independent of voting (2026-08-08) — **superseded 2026-08-25**

**Superseded by [[Decisions#ADR-114|ADR-114]]: automatic schedule generation was removed entirely, not merely decoupled from voting.** There is no `Generate`/`Rebuild`/`Fill gaps` action left to gate on anything — the owner builds every week by hand via the Timetable page. This entry is kept for the historical record of the 2026-08-08 decision; see "Manual-only food scheduling" below for the current rule, and [[Food]] §18.

Deliberate product decision, not a bugfix — see [[Decisions]]. The owner Food tab's weekly schedule was generated straight from the Food Library (all active items per meal type, alphabetically), never from tenant votes, and Generate was never gated on a voting period's status.

- `POST /api/food/schedules/generate` only ranked by votes when a caller explicitly passed `votingPeriodId` — it no longer auto-detected an existing voting period for the hostel+month. No caller ever passed one.
- The owner-side Voting card and the tenant-side "Vote on this month's menu" section are both hidden.
- Voting's schema (`food_voting_periods`, `food_votes`), API routes, and frontend hooks/components are all still present and functional, just unused by the current flow — reversible groundwork for a future, likely different, "polling" feature rather than the same voting model being wired back in as-is. **This part is unaffected by the 2026-08-25 change** — the dormant voting system is still exactly as dormant as it was.

See [[Food]] §10 for the full historical detail (what changed, what stayed, and what's still dormant infrastructure).

## Manual-only food scheduling (2026-08-25)

See [[Decisions#ADR-114|ADR-114]] and [[Food]] §18 for the full write-up. The owner builds the weekly Timetable entirely by hand — no algorithm ever chooses, ranks, or copies a dish. Concretely:

- **No duplicate food within one meal slot.** Adding a library item already placed in that day+meal cell is a no-op (with an "Already added" indication), enforced once in a shared pure function so drag-add and tap-add can't drift apart. The same item is unaffected on a different day or a different meal type — those are separate cells.
- **No maximum items per meal.** A section's chip list scrolls/wraps; nothing warns about or blocks how many dishes are placed in one cell.
- **An incomplete week cannot be published.** Every individual empty day+meal cell blocks the Publish button until filled — the one exception to this module's general "publish checks only ever inform, never block" rule (§8's `variety`/`runs` checks still don't block; only emptiness does, since an empty cell is the literal placeholder tenants would otherwise see live, not a stylistic choice). The Ready-to-Publish panel itself stays a short summary line, not a per-cell enumeration.
- **A DRAFT schedule's edits still persist immediately — no Save button.** Add/remove/reorder each call the same PATCH endpoint directly, optimistically updated in the UI with rollback (and the existing error toast) on failure. **Superseded for a PUBLISHED schedule, 2026-08-27 ([[Decisions#ADR-123|ADR-123]])** — see below.
- **Renaming a Food Library item updates its display on the Meal Plan editor without duplicating the item** — the editor resolves each placed dish's name live against the current library rather than trusting the cell's stored snapshot. Deleting a library item was, and remains, a soft-delete (`is_active=false`) — a historical or published schedule referencing it never breaks. There is currently no owner-facing UI to rename/delete a library item (removed along with the Food Library browsing screens, [[Decisions#ADR-123|ADR-123]]) — the backend endpoints still exist and still work, just unused by any current screen.
- **Editing an already-published schedule now buffers, and requires an explicit Save (2026-08-27, [[Decisions#ADR-123|ADR-123]] — reverses this section's own 2026-08-25 rule for this one case).** Add/remove/reorder and Copy-to-days on a PUBLISHED schedule apply to what the owner sees on screen immediately, but are **not** sent to the backend until the owner taps "Save changes" — which appears only once there's at least one unsaved edit. Saving loops the same per-cell PATCH the DRAFT path already uses, one request per dirty cell, each with its own existing optimistic-update/rollback/`expectedUpdatedAt` stale-write guard — no new backend endpoint. Navigating away (back, hostel switch, month switch) with unsaved changes prompts Save/Discard/Cancel; a `beforeunload` listener catches tab close/refresh. The browser's own Back/Forward buttons are **not** intercepted (known limitation — this app uses a plain `BrowserRouter`, not a data router, so `useBlocker` isn't available). A DRAFT schedule — including the edits leading up to its very first Publish — is unaffected: those still PATCH immediately, exactly as before.
- **Month navigation never seeds content.** A schedule row is created empty on demand (idempotent `POST /api/food/schedules`) the first time the owner opens a given month's Timetable; it never copies the previous month and never auto-selects a dish, regardless of how many times that month is revisited.
- **A stale edit is rejected, not merged.** No realtime/multi-tab sync exists; the PATCH endpoint requires the client's last-known `updated_at` for the cell and refuses (`409`) if it doesn't match current, so a second tab's outdated click can't silently overwrite a newer one.

## Copying a food schedule to another hostel (2026-08-29)

See [[Decisions#ADR-136|ADR-136]] and [[Food]] §22 for the full write-up. `POST /api/food/schedules/[id]/copy-to-hostels` copies a schedule's full weekly pattern into one or more of the owner's other hostels for the same month.

- **Dishes are matched across hostels by name, never by id.** `food_menu_items` is a per-hostel library — a source item's id doesn't exist in the target hostel's library. Each distinct `(meal_type, name)` used in the source schedule is resolved once per target hostel: reuse an active item of that name, reactivate a soft-deleted one, or create it new — the same find/reactivate/create rule `POST /api/food/menu-items` already applies on a name collision.
- **The target's publish state always matches the source's, unconditionally — this is not a suggestion the owner can decline per copy.** A PUBLISHED source publishes the target too (fanning out the same `food_schedule_published` tenant notification, only on the DRAFT→PUBLISHED transition — copying onto an already-published target doesn't renotify). A DRAFT source leaves the target DRAFT. There is no separate "publish the target too?" step.
- **Overwriting existing content requires explicit confirmation.** If a target hostel already has any real content for that month, nothing is written on the first call — the route answers `409 CONFIRM_OVERWRITE` listing the affected hostels, and the caller must resend with `confirmOverwrite: true` to proceed. A target with no existing content for that month copies with no prompt.
- **A copy is one-shot, not a live sync.** After copying, the source and target schedules are completely independent — editing one never affects the other. Running the copy action again re-applies the source's current state to the target as of that moment; nothing keeps them linked in between.
- **Every target hostel must belong to the same owner as the source**, checked with the same `requireHostelBelongsToOwner` guard every other food route uses — never optional, never a fallback to any other hostel.

## Food Polls — ad-hoc, independent of the monthly voting window above (2026-08-08)

Real feature, `food_polls`/`food_poll_options`/`food_poll_votes` — deliberately a third, separate poll/vote concept in this module (see [[Decisions#ADR-057|ADR-057]]). Not to be confused with the dormant `food_voting_periods` window above, nor with the deleted mock "Food Polls" ([[Decisions#ADR-048|ADR-048]]).

- One poll = one owner-created instance (title, poll type, options, meal category, date, closing time) — not a recurring monthly window. Created and published in a single action; there is no draft state.
- `RATING`/`YES_NO` poll types still write to `food_poll_options` — the frontend resolves their fixed labels ("Yes"/"No", or "5 stars".."1 star") at creation time, so vote-counting logic never special-cases poll type.
- `allow_multiple = true` polls toggle a tenant's vote per option (multi-select); `allow_multiple = false` polls replace — any other vote this tenant holds on the poll is removed first, and tapping the already-selected option unselects it.
- `is_anonymous` is stored but has no current behavioral effect — no results view (owner or tenant) exposes a per-voter breakdown regardless of the flag, so there's nothing left to hide differently.
- Auto-closes daily via the same cron that already closes the dormant voting window (`app/api/cron/food-expiry`, renamed from `food-carry-forward` 2026-08-25 when its schedule-cloning responsibility was removed — [[Decisions#ADR-114|ADR-114]]), once `closes_at` passes.
- **A poll is editable while OPEN, never once CLOSED (2026-08-27, [[Decisions#ADR-124|ADR-124]]).** `PATCH /api/food/polls/[id]` rejects with 409 if `status !== 'OPEN'` — closing is still a one-way door for edits, matching how it's already a one-way door for voting.
- **An option that already has ≥1 vote can never be removed by an edit (2026-08-27).** `PATCH /api/food/polls/[id]` rejects the entire request (`OPTION_HAS_VOTES`, 409) if any option slated for removal has a vote — checked against `food_poll_votes` at request time, not a stale count. An option's label may be changed freely regardless of its vote count, and new options may always be added. `poll_type` itself is not editable post-creation.

See [[Food]] §16/§21 for full detail, including a documented minor inconsistency (the "Allow multiple selections" toggle is independent of the Poll Type selector, inherited unreconciled from the reference design).

## A scheduled meal can hold more than one dish (2026-08-24)

See [[Decisions#ADR-113|ADR-113]]. The weekly grain is unchanged — `food_schedule_meals` still keys exactly one row per `(schedule, day_of_week, meal_type)` — but that row's content is now an **ordered collection** of dishes, not one.

- **The owner edits a cell's item list, one item at a time, persisted immediately** *(checklist-with-Save described below is 2026-08-25 history — see "Manual-only food scheduling" above; the Timetable adds/removes/reorders directly, no staged selection or Save button any more)*. There is no more "tap an item and it immediately overwrites the cell" either way — every edit is the cell's full ordered list.
- **A meal may hold zero items.** An explicitly emptied cell is a valid, saved state, not an error — it renders like any other "Not set" cell everywhere it's read.
- **Order is preserved and meaningful for display** ("Rice • Dal • Curry • Chutney"), but the publish-checklist's "same item dominates a meal type" / "repeats on consecutive days" warnings compare cells by their **set of dishes**, not display order — reordering a cell's items must not make an otherwise-identical repeat invisible to those checks.
- ~~**"Move to another day" is disabled while a checklist edit is pending."**~~ *(Removed 2026-08-25 — cross-day swapping no longer exists in any form; see "Manual-only food scheduling" above.)*
- **The Discovery-listing mess-menu importer is unaffected.** It reads a single denormalized text field per cell (comma-joined dish names, kept in sync automatically) for a one-time copy into the listing draft — see [[Decisions#ADR-077|ADR-077]] for why that's a separate, owner-reviewed copy rather than a live read of the schedule.
- **The dormant monthly voting window (`food_votes`) is unrelated and untouched** — it already allowed a tenant to pick several items per meal type for *voting* purposes; this change is about what's actually served, not the vote.

See [[Food]] for the full write-up.

## Meal Timings — permanent config, never re-entered into the weekly menu (2026-08-19)

See [[Decisions#ADR-083|ADR-083]]. Two different things share the word "meal" and must stay separate:

- **Meal Timings** (`preferences_config.meal_timings`) — *when* a meal is served. Owner-configured once per hostel, rarely changes.
- **Weekly Menu** (`food_schedule_meals`) — *what* is served, per day. Changes every week; still has no time-of-day column and never will need one — a cell holds an ordered list of dishes (**since 2026-08-24**, see below), never a time.

**Every reader composes the two rather than re-deriving a time.** The weekly schedule grid's meal-type header, the owner Today card, the tenant Next Serving card and Today's Meals list all read the same `meal_timings` and pair it with whichever day's `food_schedule_meals` row is relevant — none of them store or accept a time of their own.

**Validation rules** (`sanitizeMealTimingsPayload`, `lib/services/food/meal-timings.ts`):
- `start`/`end` must be `"HH:mm"`, 24h.
- `start < end` **within** a meal type — no meal may span midnight. Overlap **between** different meal types is allowed (a hostel may run Lunch and Snacks close together); only a meal's own ordering is enforced.
- A disabled (`enabled: false`) meal is skipped everywhere it's read — the weekly grid header shows "Off," it's absent from the tenant's Today's Meals list, and it's never a Next Serving candidate. It stays editable while disabled (not hidden), so re-enabling doesn't require retyping hours.

**Status classification is end-exclusive**: a meal is `SERVING_NOW` from `start` up to (not including) `end`; `COMPLETED` from `end` onward. `nextServingAt()` returns the currently-serving meal if one exists, else the soonest upcoming one, else `null` once every enabled meal for the day is done.

**Unconfigured hostels get sensible defaults, never a blank state.** `DEFAULT_MEAL_TIMINGS` — Breakfast 07:00–09:00, Lunch 12:30–14:00, Snacks 17:00–18:00, Dinner 19:00–21:00 — is the fallback for any hostel that has never saved its own, applied per-meal so one malformed key doesn't blank the other three.

## Signup phone verification

Added 2026-07-31 ([[Decisions#ADR-034|ADR-034]]). **Phone verification is required for signup only when the provider can actually deliver it.**

1. **Mode resolution** (`lib/services/auth/phone-verification-mode.ts`): `PHONE_VERIFICATION_MODE=on|off` wins if set; otherwise verification is `on` only when `OTP_PROVIDER=whatsapp` **and** an access token **and** a phone-number ID **and** `WHATSAPP_OTP_TEMPLATE` are all present. (`WHATSAPP_BUSINESS_ACCOUNT_ID` is deliberately excluded — it isn't used to send.) Any other override value is ignored and logged.
2. **Circuit breaker** (`lib/services/auth/otp-provider-breaker.ts`): 3 send failures within 10 minutes opens the breaker for 15 minutes, during which no call is made to Meta at all. After the cooldown one trial send is allowed — success closes it, failure re-opens it for another cooldown. State is in Redis with an in-process fallback; a breaker is advisory, so a per-instance view is acceptable.
3. **Degradation is scoped to signup.** Only purposes `PHONE_VERIFICATION` and `LEAD_CAPTURE` degrade. Every other purpose keeps the hard `502 OTP_SEND_FAILED`.
4. **A failing send degrades its own request**, not merely subsequent ones — the user who trips the breaker must not be the one who eats the error.
5. **Rate limits are enforced before the skip path**, so it can never become an unthrottled way to write rows keyed by an arbitrary phone number.
6. **The outcome is recorded, not enforced away**: `profiles.phone_verified`/`mobile_verified` and `platform_leads.phone_verified` carry which path a signup took, and the admin leads list shows an "Unverified" marker.
7. **Explicit non-goal:** nothing retroactively verifies accounts or leads created while degraded. There is no login-time prompt, no dashboard banner, and no step-up gate for unverified users — turning the credentials on affects new signups only.

**Amendment, 2026-08-16 ([[Decisions#ADR-078|ADR-078]]):** phone verification is no longer part of signup at all for tenants — signup is Google-only and Google doesn't collect a phone number. The same OTP mechanism (points 1–5 above apply identically) now runs **once, at the moment it's actually needed**: `EnquiryPage` gates "Send enquiry to owner" on `profile.phone_verified`. If already `true`, nothing is asked again — not on this enquiry, not on the next one, until the phone number itself changes (`PATCH /api/profile` re-arms `phone_verified: false` only when the new value differs from what's on file). If `false` or no phone is on file (the common case for a fresh Google-provisioned account), the enquiry flow shows an inline confirm-phone-then-OTP step before submitting. Point 3's degradation scope needed no change — `PHONE_VERIFICATION` is still the purpose used, just triggered from a different UI moment.

**Agreement commitment (2026-08-25, [[Decisions#ADR-112|ADR-112]]).** When an agreement has a stateable duration, signing requires the tenant to explicitly confirm the term: two acknowledgements (`read_agreement`, `accept_term`), neither pre-ticked, recorded on `Agreement.content_snapshot` with the time, IP, user agent and the exact sentence shown. The server builds that record from its own computed lifecycle, so it is bound to the real dates rather than anything the client proposed. An agreement with a null or zero `agreement_duration_months` skips the requirement entirely and signs exactly as before.

**This is a promise, not a lock-in, and the copy must never say otherwise.** `AgreementTemplate.notice_period_days` is nullable and NULL on every live template, so `move-out-service` computes `notice_period_violation` against zero and records none — a tenant can raise a move-out at any time with no consequence. Any wording implying a penalty would be false. If a real lock-in is ever wanted, it means setting `notice_period_days` and deciding what early exit costs, across move-out and settlement — a separate decision.

**Amendment, 2026-08-24:** the above gate was **UI-only** until now, and `createEnquiry` wrote whatever `seeker.phone` held, `null` included — see [[Bugs]]. The server now enforces it: `discoveryService.createEnquiry` refuses a seeker with **no phone on file** (422, before any database work). Note the asymmetry, which is deliberate: the *UI* gates on `phone_verified`, the *server* gates on `phone` being present. Gating the server on the flag would refuse the [[Decisions#ADR-034|ADR-034]] seekers whose OTP was legitimately skipped because WhatsApp could not deliver — a path the UI itself lets through. The server enforces the floor ("this lead is callable"); the UI enforces the ceiling ("this number was proven").

See [[APIs]], [[Database]], [[Features]].

## Owner-acquisition funnel notifications

Added 2026-08-06 ([[Decisions#ADR-050|ADR-050]], [[Decisions#ADR-051|ADR-051]]). **Files:** `src/services/platform-leads/platform-lead-notification-service.ts` (all five sends, one place), `lib/services/notifications/providers/whatsapp/platform-lead-template-contracts.ts` (payload builders + env-var overrides), `src/services/platform-leads/lead-stage-mapper.ts`, `lead-transition-guards.ts`.

1. **Five templates, five triggers**, all WhatsApp, phone-number target `platform_leads.phone`:
   - ① `stayo_owner_lead_received` — fires from `POST /api/leads/self-serve`, immediately after the lead row (and its `tracking_token`) is created.
   - ② `stayo_owner_invitation` — fires from `approveLead()` (`POST /api/platform-admin/leads/[id]/approve`).
   - ③ `stayo_owner_account_activated` — fires from `POST /api/auth/owner-signup` when the signup carries a `lead_token`. **Supersedes** the older `stayo_owner_welcome` send for this flow.
   - ④ `stayo_owner_onboarding_complete` — fires from `markLive()`, when a lead's hostel actually goes live.
   - ⑤ `stayo_owner_lead_rejected` — fires only from `POST /api/platform-admin/leads/[id]/reject`, never from a plain status PATCH (see rule below).
2. **Four of five are fire-and-forget; the invitation send (②) is load-bearing.** ①③④⑤ are wrapped so a WhatsApp/provider failure is logged with the template name and swallowed — a delivery outage must never block lead creation, account activation, or a hostel going live. ② is the one deliberate exception, carried over unchanged from the pre-existing activation-link behaviour: if neither WhatsApp nor the email fallback succeeds, the lead is held at `APPROVED` rather than advancing to `INVITE_SENT`, so the admin sees the failure and can retry — nobody can activate an account they were never sent a working link to.
3. **The reject-vs-cold-lead rule.** `PATCH /api/platform-admin/leads/[id]` with `{status: "LOST"}` stays silent — it notifies nobody. `LOST` is used for two different real-world outcomes ("we reviewed and declined" and "the applicant went cold and stopped replying"), and auto-notifying every `LOST` would send a rejection message to someone who simply stopped responding. Only `POST /api/platform-admin/leads/[id]/reject` — which requires a non-empty `reason` and is refused (400 `INVALID_TRANSITION`) once a lead is `APPROVED` or beyond — sets `rejection_reason` and fires ⑤. This is the deliberate, symmetric counterpart to the existing `POST .../approve` action. See [[Decisions#ADR-051|ADR-051]].
4. **All template names/languages are env-var overridable** per template (`WHATSAPP_OWNER_LEAD_RECEIVED_TEMPLATE`, `WHATSAPP_OWNER_INVITATION_TEMPLATE`, `WHATSAPP_OWNER_ACCOUNT_ACTIVATED_TEMPLATE`, `WHATSAPP_OWNER_ONBOARDING_COMPLETE_TEMPLATE`, `WHATSAPP_OWNER_LEAD_REJECTED_TEMPLATE`, each with a matching `..._LANGUAGE` var), so a Meta-forced rename during template review is a config change, not a redeploy.
5. **Owner-facing stage collapsing.** The public tracking endpoint never leaks internal status vocabulary: `NEW`→"Submitted", `UNDER_REVIEW`→"Under review", `APPROVED`/`INVITE_SENT`→"Approved — activation link sent", `OWNER_ACTIVATED`/`HOSTEL_CREATED`→"Setting up your hostel", `LIVE`→"Live on Stayo", `LOST`→"Not proceeding" (shown as a terminal stage, not a partially-climbed ladder with greyed-out future steps).
6. **As of this writing, only ① `stayo_owner_lead_received` is approved in Meta.** Templates ②④⑤ (and ③, which is new relative to the superseded `stayo_owner_welcome`) are not yet approved — those sends fail until Meta approval completes. The code path is complete and correct for all five; the templates are the blocker. Contracts fail loudly with the template name in the log, not silently, so this is diagnosable in production. See [[Features]] for the honest per-template approval status and [[Decisions#ADR-050|ADR-050]] for why `stayo_owner_welcome` itself is now orphaned rather than reused.

See [[Features]], [[Database]], [[APIs]], [[Decisions]].

## Admissions / Leads — Accept / Hold / Reject (2026-08-20)

Added [[Decisions#ADR-087|ADR-087]]. This is the tenant-admissions `visitor_leads` funnel — distinct from the owner-acquisition `platform_leads` funnel documented above. **Files:** `src/services/admissions/admissions-service.ts` (`updateStatus`, `convertToInvitation`), `src/services/admissions/lead-transition-guards.ts` (`canTransitionLeadStatus`, pure), `lib/services/notifications/providers/whatsapp/enquiry-template-contracts.ts` (`TENANT_ENQUIRY_REJECTED`).

1. **Status transitions.** Any open funnel status (`NEW`/`INTERESTED`/`ROOM_VISITED`/`DECISION_PENDING`/`READY_TO_JOIN`) or `ON_HOLD` → `ACCEPTED`, `ON_HOLD`, or `REJECTED`. `REJECTED` is terminal — no `REJECTED → ACCEPTED` reopening exists in the product, so `canTransitionLeadStatus()` refuses it (409 `CONFLICT`) rather than the endpoint silently allowing it. A lead already `INVITED`/`JOINED` (already converted to a tenant) or `LOST` likewise cannot be re-accepted/held/rejected.
2. **Hold requires a message, stored as an ordinary `lead_notes` row — and sends no tenant notification.** `PATCH /api/leads/[id]` with `{status: "ON_HOLD", note}` — `note` is validated non-empty (400 `VALIDATION_ERROR` otherwise) and written to `lead_notes` in the same call. This is deliberately the entire effect: no WhatsApp (or any other) message is sent to the tenant when a lead is put on hold, by explicit product decision — Hold is an internal owner note, not a tenant-facing action. Re-holding an already-`ON_HOLD` lead is allowed (it just updates the note) rather than refused, since that isn't a status change worth blocking.
3. **Accept is two steps, not one.** `{status: "ACCEPTED"}` only flips the status — it does **not** create a tenant. The owner is then taken to the Add Tenant wizard (pre-filled from the lead), and only that submission — via `POST /api/leads/[id]/convert-to-invitation` — actually creates the tenant/invitation and flips status to `INVITED`. `convertToInvitation()` refuses (409) unless `lead.status === "ACCEPTED"`, and its pre-existing `converted_tenant_id` guard is what makes accepting twice / refreshing mid-flow / resubmitting the wizard safe against creating a duplicate tenant.
4. **Only Reject fires a tenant-facing WhatsApp notice; Accept and Hold fire none.** Unlike the owner-acquisition funnel above (which notifies on both invite and reject), this funnel's Hold action is intentionally silent — see point 2. The Reject send is best-effort and never fatal to the status write — a WhatsApp outage, or a template not yet approved in Meta, must not block the owner's action, same non-blocking pattern as the owner-acquisition funnel's ①③④⑤.
5. **The Reject template was already built, just never called.** `TENANT_ENQUIRY_REJECTED` (`stayo_tenant_enquiry_rejected`) existed in `enquiry-template-contracts.ts` before this change, written for a Discover-rejection flow that was never wired up — this feature is its first real caller. **Not yet approved in Meta as of this writing** — the send currently no-ops (logged, non-fatal) until that external approval completes; see [[Decisions#ADR-087|ADR-087]].
6. **Discover-sourced enquiries project `REJECTED` the same as `LOST`.** The seeker-facing `toEnquiryStage()` (`src/services/discovery/discovery-service.ts`) maps both to `"CLOSED"` — without this, a Discover-sourced lead the owner rejects would have shown the seeker "still reviewing" indefinitely, since the fallback bucket for unrecognized statuses is `"REVIEWING"`.
7. ~~**Tenant activation's phone-OTP requirement is deliberately unchanged.** No trust chain exists that marks an enquiry-captured phone as pre-verified, so this feature does not skip OTP for a lead-accepted tenant — doing so would weaken authentication, which was out of bounds. See [[Decisions#ADR-087|ADR-087]] point 7.~~
   **Superseded 2026-08-25 by [[Decisions#ADR-110|ADR-110]].** The trust chain now exists, and it did not require weakening authentication — it required *reading* proof that was already there. A Discover seeker OTP-verifies their number at enquiry time and `profiles.phone_verified` records it; the reason activation could not see that was a dropped profile link, not a missing chain. Activation now skips the OTP when the linked account has verified that exact number, or when the invitation was delivered to it over WhatsApp — and re-arms it the moment the invitee edits the number.
8. **A lead auto-transitions to `JOINED` when its tenant finishes activation (2026-08-26, [[Decisions#ADR-122|ADR-122]]).** `visitor_leads.status` flips to `JOINED`, scoped by `converted_tenant_id`, inside the same database transaction as the tenant's own `ACTIVE` flip (`TenantInvitationLifecycleService.completeActivation()`, `tenants/tenant-invitation-lifecycle-service.ts`) — so the two can never diverge across a crash between them. The write itself lives in a small leaf module, `src/services/admissions/lead-joined-transition.ts` (`markLeadJoinedForTenant`), not as a call from that file into `admissions-service.ts` directly — `admissions-service.ts` already transitively imports `tenant-invitation-lifecycle-service.ts` via `invitation-service.ts`, so importing back would create a circular import. `admissionsService.markJoinedForTenant()` still exists as a thin delegation to the same leaf function, for any future direct caller. This was previously dead code — `markJoinedForTenant` existed with zero callers — despite several places already reading `JOINED` defensively (funnel/stats aggregations, the Accept/Hold/Reject transition guard's terminal-status check, `discovery-service.ts`'s seeker-facing status projection); see [[Bugs]].

See [[APIs]], [[Database]], [[Features]], [[Decisions]], [[Bugs]].

## Enquiry room preference — a preference, never a reservation (2026-08-29, migration 077)

**Files:** `src/services/discovery/discovery-service.ts` (`createEnquiry`), `src/services/admissions/admissions-service.ts` (`getLeadForOwner`), `lib/services/room-capacity-service.ts` (`roomCapacityService`, unchanged), `src/services/tenants/tenant-invitation-lifecycle-service.ts` (`createInvitation`, unchanged).

1. **A preference is stored, not a hold.** `visitor_leads.preferred_floor_id`/`preferred_room_id` record what the tenant asked for at enquiry time. Neither column, nor anything this feature does, reserves a bed — no row is written to `room_reservations` or `tenant_invitation_reservations` for it. That is a deliberate, separate, owner-initiated mechanism (`admissionsService.reserveRoom`, point-in-time and expiring) which this feature does not touch or read from.
2. **Integrity is checked at submission; availability never is.** `createEnquiry` verifies a `preferred_room_id`/`preferred_floor_id` actually belongs to the enquired hostel (422 `VALIDATION_ERROR` otherwise) — nothing more. Whether the room is currently free is irrelevant at this point and deliberately never checked: a tenant is allowed to prefer a room that's already full, and the preference is still worth recording as information for the owner.
3. **Availability is judged fresh, exactly once, when the owner reviews the enquiry** — via `getLeadForOwner` composing `roomCapacityService.getRoomCapacitySnapshot`, the same single source of truth `createInvitation`'s final check uses (see [[Business-Rules]]'s "compose, don't reimplement" precedent for the financial read model). Skipped once the lead is `INVITED`/`JOINED`: the preference has done its job, and by then the room a tenant actually got may be a different one entirely.
4. **The Invite Tenant wizard's room field preselects only on a live "yes."** `leadPrefill.ts`'s `leadToInviteWizardData` copies the preferred room into `roomId` **only** when the backend just confirmed `preferred_room_available === true` for this read. `false` or unset (no preference; lead already converted) leaves `roomId` blank — the Stay step's own picker, backed by the same live `roomService.getAll(..., {grouped:true})` query, is what decides in that case.
5. **The final assignment goes through the same, unmodified authority.** `createInvitation`'s `SELECT … FOR UPDATE` row lock + `roomCapacityService` capacity check is untouched by this feature — a preselected-but-since-filled room is still refused there exactly as any owner-picked one would be. This feature can only ever suggest a starting point for the owner's own dropdown-equivalent; it cannot cause a room to be assigned twice.
6. **The owner can always override.** Nothing about a preference — available or not — disables or hides any room in the picker; occupied rooms simply render as unselectable squares, exactly as they would for a walk-in tenant with no stated preference.

See [[APIs]], [[Database]], [[Features]], [[Changelog]].

## Tenant self-service profile edits — governed vs. direct fields (2026-08-14, narrowed same day)

A tenant editing their own profile (`platforms/tenant` Profile tab → `PATCH /api/tenants/me/profile`) hits one of two paths depending on the field, per explicit product decision. **This was narrowed the same day it shipped**: an earlier pass also governed `permanent_address`/`date_of_birth`; the final, authoritative rule is that *only phone and email* require approval — everything else, including address and DOB, saves directly.

1. **Governed — requires owner approval before it takes effect**: primary phone (`phone_1`, and its synced twin `phone`), `personal_email`. `updateTenantSelfProfile()` (`src/services/tenants/tenant-service.ts`, `GOVERNED_FIELDS`) rejects these outright with a `VALIDATION_ERROR` if present in a direct `PATCH` payload — the only path to change them is `POST /api/tenants/me/profile-requests` (body `{fields, reason}`), which creates a `PENDING` `change_requests` row (`change_type: 'tenant_self_service_update'`, `entity_type: 'tenant'`) that only `POST /api/owner/profile-requests/[id]/approve` can apply. A tenant may have at most one pending request at a time (a second `POST` while one is `PENDING` 400s). **Opening the Profile tab's edit mode never itself requires approval** — only these two fields, once actually changed, route through the request flow.
2. **Direct — saves immediately, no approval step**: name, gender, blood group, nationality, PAN number, date of birth, address (`profile.city`/`state`/`pincode`), guardian name/relationship/phone (`guardian_name`/`guardian_relation`/`guardian_phone`, synced with `phone_2`), alternate/emergency phone (`phone_3`, synced with `profile.emergency_contact`), academic fields (college/course/branch/roll-number/year/`expected_completion_date`, or office/role for working professionals), photo.

**Aadhaar is not a directly-editable text field at all** — the Profile tab's Personal Information screen routes an Aadhaar edit to the existing document-upload flow (`onUploadDocument`, same mechanism as the Documents section) instead of a text input, since it's tied to an actual verified document (`identification_documents`, `doc_type: 'AADHAAR'`) rather than a hand-typeable value. PAN has no equivalent document/verification concept in this app and stays a plain text field (`tenants.pan_number`).

**A known, separate gate on guardian/alternate phone (not owner-approval — pre-existing OTP verification):** changing `phone_2`/`guardian_phone` or `phone_3`/`emergency_contact` away from a value that was already set triggers `updateTenantSelfProfile`'s pre-existing OTP-verification block (matching `data.phone_2_otp`/`data.phone_3_otp` against a verified `phoneVerificationOtp` row) — this predates the 2026-08-14 work and is unrelated to the owner-approval governance above, but it does mean the Emergency Contact screen's Phone/Alternate phone fields aren't *fully* frictionless the way "directly editable" implies for a number that's changing rather than being set for the first time. No OTP-request UI is wired into the Profile tab's edit form yet, so such a save currently fails with a clear `VALIDATION_ERROR` toast rather than silently succeeding or silently failing — see [[Bugs]].

**Why phone is blocked twice (`phone_1` *and* `phone`):** the service already synchronizes them as the same primary-contact-number concept (`syncedPhone = data.phone_1 || data.phone`) before this change existed — blocking only one would leave the other as a silent bypass.

**Why this isn't built on the existing `change_requests`-consuming `ChangeManagementFacade`:** that facade is hardwired the opposite direction (owner proposes, tenant approves — see [[Database]]); its `approve()`/`reject()` methods hardcode tenant-only authorization. Reusing it here would have meant modifying methods a live owner-facing feature depends on. Instead this is a small, separate set of routes (see [[APIs]]) writing to the same tables under a distinguishing `change_type`, applying the diff itself rather than going through the facade's `entityAdapterRegistry`.

**Primary phone verification (OTP) is now effectively dead for the self-service path** — `updateTenantSelfProfile`'s OTP-verification block (matching `data.phone_1_otp`/`data.phone_otp` against a verified `phoneVerificationOtp` row) can never execute anymore, since `phone_1`/`phone` are rejected before reaching it. Left in place rather than removed (low-risk, other unaudited callers may still reach this method) — flagged here so a future reader isn't confused by unreachable code. See [[Decisions]] ADR-069.

**Profile tab visual pattern**: the 4 detail screens (Personal information / Contact details / Emergency contact / Academic details) are read-only card views by default — label/value rows, a person-card for Emergency Contact, a "Verified" pill on Personal Information when KYC is complete — matching `Stayo Tenant.dc.html`'s own DETAIL-map design exactly. Tapping the screen's own bottom button (its original design copy — e.g. "Request a correction", "Update contact details") switches to an editable form inside the *same* card layout; saving (or a no-op with unchanged direct fields) returns to the read-only view. See `ProfileEditScreen.tsx` + `configs/profileEditConfigs.ts`.

## The portable profile — identity is person-level, verification is not (2026-08-15, phase B)

See [[Decisions#ADR-074|ADR-074]]. Three rules follow from identity moving off `tenants`.

**1. A person-level field changed by one owner changes it everywhere — so owners propose, they no longer apply.**

`field-classification.ts` used to put `college_name`, `roll_number`, `course`, `year_of_study`, `branch`, `section`, `office_name`, `office_location`, `job_role`, `profile_type`, `photo_url`, `gender` and `date_of_birth` in **Category A** (owner edits immediately, audit log only). All of them are now **Category B** — owner proposes, tenant approves — alongside guardian fields, `personal_email` and `permanent_address`, which were already B but pointed at `tenants`.

The test for Category B is **not** "is this sensitive". It is **"does one hostel changing it affect another"**. Under the old rules an owner editing `college_name` would silently rewrite the person's record at a hostel that owner has no relationship with.

Category A now holds only genuinely per-tenancy flags: `document_verified`, `profile_completed`, `mobile_verified` — each of which means "has *this* owner checked *this* tenant", not a fact about the person.

`temporary_address` deliberately stays on `tenants`: it is where someone lives *for this tenancy*, usually the hostel itself.

**Accepted cost, named before building:** owners lose immediate edit on academic and personal fields.

**2. A document is portable; a verification decision is not.**

The vault (`identity_documents`) holds the file, uploaded once. `identity_document_shares` holds one row per (document, hostel) and carries the verdict — `PENDING`/`VERIFIED`/`REJECTED`, plus who decided and when.

- An owner may see a document **only** through a live (non-revoked) share for a hostel they own.
- Owner A verifying a document does **not** make it verified for Owner B. The tenant re-uses the *file*, never the judgement.
- Revoking sets `revoked_at` rather than deleting, so an owner who verified something stays attributable afterwards.
- Re-granting a previously revoked share **keeps** its old status: the same owner already checked that same file, and making them re-verify is friction with no safety benefit.
- Rejection requires a reason — the same rule `owner_documents.review_note` already follows.
- Replacing a document of the same type retires the old row (`is_active: false`) instead of deleting it, because existing shares point at what the owner actually looked at.

This settles a contradiction in the design source: its verify screen promises "shared only with the owner you enquire to" while its profile screen promises "verified once, reuse anywhere". Only one can be the default; **uploaded once, verified per hostel** is it.

**3. Reads are profile-first with a tenancy fallback, and the precedence is fixed.**

Until the backfill has run for someone, their tenancy is still the best record available, so `getIdentity()` falls back to it: the **live** tenancy (`INVITED`/`ACTIVE`) first, else the most recently created — **never** an `orderBy: { status: 'asc' }`, which would prefer `INVITED` over `ACTIVE` because that is the order `TenantStatus` declares them. `scripts/backfill-profile-identity.ts` uses the identical precedence, so a read before the backfill and a read after it agree on which value wins.

Blank values are never written by an update. Onboarding writes back to this record and its forms ask for a subset of the fields, so treating an absent field as "clear it" would let a short form wipe a longer one's answers.

## Residency history — earned disclosure, facts only (2026-08-15)

See [[Decisions#ADR-075|ADR-075]], which narrows [[Decisions#ADR-053|ADR-053]] rather than reversing it.

**Who may see a person's stay history**, decided in one place (`residencyHistoryService.resolveAccess`), in this order:

1. an explicit `REVOKED` or `DECLINED` row → **no** (the tenant's refusal outranks everything)
2. an explicit `APPROVED` row → yes
3. engagement — an **open enquiry** to that hostel, or a **tenancy** at it → yes
4. otherwise → no

An owner who has not earned access gets an empty list and a reason, never a count and never a hint that history exists. **Typing an identifier is not engagement**, which is what keeps ADR-053's enumeration protection intact.

**What travels: facts only.** Hostel, city, joined/left dates, duration, room number, sharing, monthly rent, and whether the move-out settled.

**What never travels:** `exit_reason`, `exit_notes`, `tenant_behavior_scores`, or any owner-authored note. These are one owner's unreviewed opinion; letting them follow a person means a single bad exit blacklists them across every hostel on Stayo with no right of reply. Enforced by the projection and asserted by test.

**An invitation never taken up is not a stay.** Filtered on `activation_completed_at`, so an expired or cancelled invite never appears as a tenancy someone abandoned.

**Owners request; only tenants decide.** There is no owner route that grants access. A request cannot re-open a `DECLINED`/`REVOKED` answer — otherwise "no" becomes a nag, and the repeated ask is itself a message the tenant never consented to receiving.

**The known limit:** history cannot appear while an owner *composes* an invite, because the invitee has not responded and showing it there would rebuild the lookup-by-email oracle ADR-053 blocks. Owners request instead; the tenant answers.

**Consumed for blocking, not just display, since 2026-08-27 ([[Decisions#ADR-129|ADR-129]]).** A lead's own open enquiry is engagement (rule 3 above), so once access is granted, `stays` already includes any *other* hostel the person is currently live at. The owner Leads detail view (`LeadDetailSheet.tsx`) classifies this via `hostelRelationship.ts`'s `ACTIVE_ELSEWHERE` case and hides "Accept & invite" accordingly, replacing it with Call/Chat — this reads data already disclosed, it does not grant anything new. List-row cards deliberately do not get this treatment (would require an N+1 history fetch per row); the actual invite attempt is still backend-blocked regardless.

## The listing's mess menu is a reviewed claim, not this month's cooking (2026-08-15)

See [[Decisions#ADR-077|ADR-077]]. Stayo stores a weekly menu twice, on purpose, and the two answer different questions.

- **`food_schedules` / `food_schedule_meals`** — what is actually being cooked. Monthly, regenerable, can be driven by resident polls ([[Decisions#ADR-057|ADR-057]]). Lives in the Food tab; changes freely. See [[Food]].
- **`content.mess` on a marketing revision** — what the *listing* promises a prospective tenant. Passes through admin review like every other listing claim, and changes only when a new revision is approved.

**Discovery reads the second, never the first.** A menu shown to someone deciding whether to move in must not change without review, and must not vanish because next month's schedule has not been drafted yet.

**Rules the content schema enforces:**

- **Four meals, fixed** — Breakfast, Lunch, Snacks, Dinner. Owners write the dishes, set serving times and switch a meal off; they cannot add a fifth, or listings stop being comparable in search.
- **A meal switched off never reaches the listing.** Filtered server-side, so a listing cannot advertise a meal slot the owner does not serve.
- **The week is always exactly 7 rows.** Padded on the read path, because both the owner's day chips and Discovery's day chips index it positionally — a revision saved before this block existed must not make Tuesday read `undefined`.
- **`provided` defaults to false.** An unstated claim is false: silence renders as "Meals not provided", never as "meals included".
- **The reviewer sees the whole week** before approving. Approving a menu you cannot read is not approval.

## Resident reviews — the category set, and what "overall" means (2026-08-19, extended 2026-08-25, 2026-08-26)

See [[Decisions#ADR-086|ADR-086]], [[Decisions#ADR-115|ADR-115]] and [[Decisions#ADR-121|ADR-121]]. See [[Database#hostel_reviews (migration 071 — 2026-08-19; confirmed applied to the dev Supabase project 2026-08-25)|hostel_reviews]] and [[APIs#Reviews|the Reviews API table]]. Who may write one, `stayed_here`/`stay_months`, and the identity-aware-but-public read path are covered by [[Decisions#ADR-086|ADR-086]] and [[Decisions#ADR-101|ADR-101]] — this section is about the review's own content, not who may submit it.

- **The seven review categories** ([[Decisions#ADR-115|ADR-115]], Amenities dropped 2026-08-26) are Cleanliness, Maintenance, Food, Room Comfort, Staff & Management, Safety, Wi-Fi — hostel-specific, not Airbnb's holiday-flat set (`value`/`location` were dropped at the same time as the original six-to-eight migration). Food is the one category not always asked: a hostel with `food_included = false` is not scored on it. `rating_amenities` stays in the database schema unused rather than triggering another migration — same as `rating_value`/`rating_location` before 076 dropped them outright.
- **Overall Experience is a separate question, never an average of the categories** ([[Decisions#ADR-115|ADR-115]] reversed the original 2026-08-19 design here). The resident rates it directly; Discover's headline average is the mean of these standalone ratings, and each category has its own independent mean.
- **Automatic topic/sentiment detection never gates moderation.** A comment's free text is classified into categories and sentiment (`hostel_review_topics`, via a deterministic keyword classifier) purely for the admin insights view — "what are residents talking about". A negative sentiment must never auto-reject a review, and the moderation decision path never reads this table. Legitimate negative feedback is exactly the feedback a hostel needs to see.
- **Moderation is Stayo's, not the owner's.** `PUBLISH` / `REJECT` / `REQUEST_CHANGES` are admin-only actions, deliberately not delegated to the hostel's own owner — an owner choosing which reviews of their own hostel appear is a testimonial page, not a review system.
- **No average below one published review** (`MIN_REVIEWS_FOR_AVERAGE`, [[Decisions#ADR-121|ADR-121]] lowered this from 3 to 1 — see that ADR for the tradeoff this accepts). A hostel's first published review already shows the full score/distribution/category view; `emptyReason: 'TOO_FEW'` is kept as a distinct state in the type but can no longer actually fire (a hostel has either 0 reviews, `NONE_YET`, or ≥1, which now averages) — left in place rather than deleted so a future change to the constant doesn't need the branch rebuilt.

## Two tenant-ticket systems, kept deliberately separate (2026-08-16)

See [[Decisions#ADR-079|ADR-079]]. Two different complaint/ticket paths exist and must never be merged or cross-linked at the data layer:

- **Tenant → Owner/Hostel** — `tenant_service_requests` (Room's maintenance tiles) and the unused `complaints` table, both `owner_id`/`hostel_id`-bound. Reached from Room, and from Food/Payments via a link into `/tenant/complaints` (`TenantComplaintsPage`) — untouched by this change.
- **Tenant/User → Stayo Admin** — new `platform_support_tickets`, `profile_id`-scoped only, **no `owner_id`, no `hostel_id`, no relation to `tenants`**. Reached from the common Profile's standalone "Raise a ticket" section, available to any signed-in account regardless of role or tenancy — it reports a Stayo app/website problem, not a hostel issue, so gating it on tenancy would be wrong.
- **The distinguishing rule:** if a report is about *this hostel* (room, food, a payment), it goes to the owner via the existing system. If it's about *Stayo itself* (the app or website misbehaving, an account problem), it goes to Stayo Admin via the new one. Nothing in either route reads or writes the other's table.
- A ticket can only leave `OPEN` by an admin resolving it (`status → RESOLVED`, `admin_note` shown back to the reporter) — the reporter can never set their own ticket's status, same discipline as `owner_documents`' review-only `status`.

## Explicit "Unknown / needs clarification" items

- Whether/where rent is prorated for partial-month billing.
- The exact relationship between `mapLegacyReason()` (in `tenant-financial-ledger-service.ts`, not read in full) and the schema's `FinancialLedgerReason` enum values — the `credit()` method's literal type union (`DEPOSIT|TOPUP|SECURITY_DEPOSIT_COLLECTED|FUTURE_RENT_CREDIT_TOPUP`) doesn't obviously cover all 10 schema enum values.
- Full enumeration of owner-side WhatsApp assistant commands beyond `HELP`/`DUES`.
- Whether `rent_obligations.obligation_type` has a DB-level CHECK constraint or relies solely on the TypeScript `OBLIGATION_TYPES` array for validation.
- Which of the codebase's several overlapping "financial issue" tracking tables (`financial_invariant_failures`, `payment_operational_anomalies`, `payment_reconciliation_items`, `financial_reconciliation_issues`) is currently authoritative — see [[Database]].

## See also
- [[Database]] for the schema these rules operate on
- [[APIs]] for the endpoints that enforce them
- [[Decisions]] for the architectural decisions behind the "compose, don't reimplement" pattern and the obligation-immutability model
- [[Features]] for the user-facing surfaces built on top


### Owner-funnel WhatsApp template languages (verified 2026-08-07)

A Meta template is addressed by **(name, language)**. Sending the wrong language code fails with error 132001 ("template name does not exist in the translation") even when the template itself is approved and healthy. Confirmed against the Graph API:

| Template | Language | Status | Category |
|---|---|---|---|
| `stayo_owner_lead_received` | `en_IN` | APPROVED | UTILITY |
| `stayo_owner_invitation` | `en` | APPROVED | UTILITY |
| `stayo_owner_lead_rejected` | `en` | APPROVED | UTILITY |
| `stayo_owner_onboarding_complete` | `en` | APPROVED | **MARKETING** |
| `stayo_owner_account_activated` | `en` | PENDING | **MARKETING** |
| `stayo_owner_welcome` | `en_IN` | APPROVED | UTILITY (orphaned, no caller) |

Only `lead_received` was submitted as English (IND); everything else is plain English. The defaults in `platform-lead-template-contracts.ts` now match, and a test pins them.

**Open question — the two MARKETING templates.** `onboarding_complete` ("your hostel is live") and `account_activated` are transactional in intent but were submitted under MARKETING. Marketing templates are subject to per-user marketing opt-out and Meta's marketing frequency caps, so an owner who has opted out of marketing may never receive them. Recategorising to UTILITY in WhatsApp Manager would need re-approval. See [[Features]] and [[APIs]].

## Owner payouts — what the owner is shown, and why it adds up

**Files:** `src/services/settlements/owner-payout-read-model.ts` (composition), `owner-payout-month.ts` + `payout-promise.ts` (pure), `gateway-ledger.ts` (ingestion), `apps/frontend/src/features/owner-money/payouts/payoutState.ts` (the voice). See [[Decisions#ADR-090|ADR-090]], [[Decisions#ADR-091|ADR-091]].

### Every rupee is in exactly one of four states

| State | Derived from |
|---|---|
| **Owed** | `rent_obligations`, via `collectionQueueService` — composed, never recomputed |
| **Paid to you directly** | `payments` with `payment_attempt_id IS NULL` |
| **With Stayo** | captured `TENANT_RENT` transactions whose settlement item is **not** `PAID` |
| **In your bank** | captured transactions whose item **is** `PAID` |

Conservation is structural: `settlement_item_transactions.transaction_id` is `UNIQUE`, so a captured rupee is in exactly one of the last two, always. `assembleMonth` **derives** `throughStayo = inYourBank + withStayo` and `collected = direct + throughStayo` rather than accepting them and checking — there is no code path where a rupee is shown twice or lost.

- **The partition keys on `item_status <> 'PAID'`, not an enumerated pending list.** An item that is `FAILED`, `CANCELLED`, or attached to no run at all is money Stayo still holds. Enumerating "pending" statuses would mean a status added later silently drops money out of the owner's total — the one direction this screen must never fail in.
- **A `FAILED` transfer stays counted.** A total that shrinks at the moment a transfer fails is the fastest way to lose an owner.
- **"Paid to you directly" is never added to anything Stayo owes.** This is a *display* distinction; settleability still comes only from `gateway_transactions`, per migration 070. Reversal rows are summed in rather than filtered out, so a corrected payment nets to zero instead of counting forever.
- **Negative sums are clamped to zero, not passed through.** A negative here is a data fault; a visible zero can be investigated, a plausible-but-wrong total cannot.

### The promise (T+2 working days)

`expectedPayoutDate(capturedAt)` = the IST capture date plus two working days, weekends skipped, **bank holidays deliberately not modelled** — a payout falling on a holiday is reported late, honestly, rather than the promise being quietly bent. Computed once at run creation and stored (see [[Decisions#ADR-091|ADR-091]]).

`scorePromises()` grades only items that carried a promise **and** have been paid; lateness is judged on the **IST** day, so an admin transferring at 11:55 PM IST met the promise and one transferring at 12:05 AM IST did not. The streak breaks at the first late payout. Below two judged payouts the counter says nothing — a record of one is not a record.

### Gateway ingestion, and the three rules that keep it safe

`recordCapturedRentInTx` runs inside the same transaction as settlement, at all three paths of `finalizePaymentAttempt` (advance / deposit / rent).

1. **Inside a Postgres savepoint.** A failed statement aborts the whole transaction, so a plain try/catch would be a lie — the settlement would roll back anyway. Concretely: deploying ahead of migration 075 would otherwise have failed *every gateway payment in production*. The savepoint makes recording the settlement record genuinely optional relative to taking the money, which is the correct priority: a missing gateway row makes Stayo under-settle and an admin can fix that; a rolled-back capture leaves a tenant charged with no record anywhere.
2. **No `provider_payment_id` → no row.** Without it there is no idempotency key, and a replayed webhook would create a second settleable row — Stayo would pay an owner twice. Skipping errs toward under-settling, which is visible and correctable; double-paying is not.
3. **The stored amount is the attempt amount in rupees.** The provider reports paise; taking its number directly is a 100× error waiting to happen in a table that decides real bank transfers, and there are currently zero captured payments in any environment to verify the payload shape against. The provider's figure is preserved under `raw.__provider_amount_paise` so the two can be reconciled once real captures exist. **If they ever disagree, the gateway is right.**

### Owner-facing vocabulary

The word **"settlement" never appears in owner-facing copy** — owners do not use it, the same reason Obligations were renamed to Charges. Internal identifiers stay `settlement_*`. `PENDING` and `PROCESSING` both read as "With Stayo": the difference is Stayo's workflow, not something an owner asked about. Every pending state is shown as a state **plus a date**, never "Processing".

The strip's voice priority is **failed › paid today › pending › settled › never**. A failure outranks all good news, because an owner told only the pleasant half of the truth trusts the pleasant half less next time.

## Money exports

**Files:** `src/services/exports/financial-year.ts` (pure), `export-documents.ts` (pure — rendering, no I/O), `owner-money-export-service.ts` (gathering), `export-request.ts` (parsing). See [[Decisions#ADR-093|ADR-093]]–[[Decisions#ADR-095|ADR-095]].

- **The financial year is April–March.** Presets resolve on the server; a January export's "this FY" began in the *previous* calendar year, which a naive `year - 1` gets wrong and which has its own test.
- **A custom range is refused, not repaired.** Silently swapping reversed dates produces a document that looks right and covers the wrong period.
- **Exports compose the read models the screens use** — `ownerPayoutReadModel.rentReceived` / `.payoutsForPeriod` and `collectionQueueService.getQueue`. Rent received uses the *same* definitions as the Money screen's month block (`payment_attempt_id IS NULL` for direct, captured `TENANT_RENT` for gateway), so an exported total and an on-screen total cannot disagree.
- **Verified and owner-recorded money never merge into one figure** in proof of income — enforced by the pure `proofOfIncomeSections()`, which always returns both sections even when one is empty.
- **The chase list is dated "as at generation", not to the export period.** An owner chasing rent wants who owes *today*; dating it to a past range would mislead him.
- **Rendering is separated from gathering** so the risky half — pdf-lib throws outright on any glyph its font cannot encode — is testable with no database.

## Saving a floor's rooms, and removing a hostel (2026-08-24)

**A floor save is a statement of what the floor is** ([[Decisions#ADR-114|ADR-114]]). `POST /api/floors/:id/rooms` takes the floor as it should be and makes it match, rather than only appending. Rules it enforces, all in the pure `planFloorRoomSave`:

- A room number is unique per hostel, and the DB index covers **inactive** rooms — so a retired room still owns its number. Re-adding that number revives the row; it never inserts a second one.
- A number held by a **live** room on another floor is a conflict, and stays a 409. Two rooms claiming one number is the owner's call, not the server's.
- Rooms are **retired, never deleted** (`is_active: false`) — allocations, invitations and activity logs still point at them.
- **A room a tenant is allocated to cannot be removed**, and **a room cannot be shrunk below the number of people in it** — that would leave a tenant allocated to a bed that no longer exists. Both refusals name the room.

**A floor is deletable only when empty, and a room only when nobody holds a bed in it** ([[Decisions#ADR-099|ADR-099]]). Both are **real** deletes, unlike a hostel. `DELETE /api/rooms/:id` refuses an active allocation *and* an ACTIVE invitation reservation — a bed held for an invited tenant is as much a claim as an occupied one, and the owner is told which of the two it is, since one needs a move-out and the other needs the invite cancelled. `DELETE /api/floors/:id` refuses a floor with any active room: emptying it first is deliberate, so deleting a floor never becomes a way to delete rooms nobody looked at. Neither is possible on an ARCHIVED or INACTIVE hostel.

**Removing a hostel archives it.** `DELETE /api/hostels/:id` sets `status: ARCHIVED` with `archived_at`/`archived_by`/`archive_reason`. Nothing about a tenancy, payment or obligation is destroyed — this system keeps financial history — so no surface may describe it as permanent deletion. The backend refuses while **any tenant is still allocated**; `ArchiveHostelModal` states that reason, blocks the action, and offers a route to check the tenants out. Restoring is possible via `PATCH {status: "ACTIVE"}` and is wired — the dashboard's ARCHIVED tab offers Reactivate on every archived card.

**An archived hostel with no history at all can be deleted for good** ([[Decisions#ADR-100|ADR-100]], `DELETE /api/hostels/:id/permanent`). Two conditions, both server-enforced: it must **already be archived**, and it must have **zero** tenants, payments, rent obligations, room allocations, agreements, receipts, expenses and enquiries. Anything with history stays archived forever, and the refusal says so — a hostel that carried tenancies is never destroyable, because its money records have to outlive it. Only rooms, floors and the hostel row are removed. This is the one irreversible action in the owner app.
