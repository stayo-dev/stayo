---
tags: [business-rules, domain]
---

# Business Rules

Related: [[Database]] · [[APIs]] · [[Backend]] · [[Features]]

Everything below was extracted by reading the actual implementation (not types, not doc-comments alone) in `apps/backend/`. File:line references point at the evidence. Anything not verifiable in code is explicitly marked **Unknown**.

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
- **On completion**: remaining unpaid rent obligations are bulk-waived ("Move-out settlement confirmed — outstanding rent waived") rather than left outstanding, and the ledger balance is debited via `applyAdvanceSettlementInTx`, guarded against double-application.

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
- **Tenant-side WhatsApp bot commands**: `BAL`/`BALANCE`, `SWITCH`, `DUES`, `PAY`, `STATUS`, `HELP`. Resolution is no longer an exact match on the whole message (which silently dropped "test help", "help!" and "please send my dues" — see [[Bugs]]); `resolveCommandKey()` tries, in order, **the whole normalized message → the first word → the single known command anywhere in it**, with punctuation stripped. The last step requires exactly one distinct match, so "should I pay or check dues" is treated as ambiguous rather than guessed; a message that *opens* with a command honours it ("pay or dues?" → `PAY`). A command hidden inside a longer word never matches ("payment" ≠ `PAY`).
- **Every inbound WhatsApp text gets a reply — silence is a bug.** If no owner-assistant handler, interactive reply, command or pending selection state claims a message, the bot answers with "Sorry — I didn't understand that." followed by the standard help text. Handler exceptions are caught per message (one bad message no longer abandons the rest of the batch) and answered with a brief failure notice. Both replies are rate-limited per sender (fallback 3 / 10 min, error notice 2 / 10 min) so a stranger sending noise can't be turned into a reply loop.
- **Routing is identity → intent → permission** ([[Decisions#ADR-039|ADR-039]]). Every inbound message first resolves a sender identity (`OWNER | TENANT | STAFF | ADMIN | UNKNOWN`, carrying *all* roles the phone holds), then a ranked list of intent candidates, and only then checks whether that sender may invoke that intent. Nothing is refused before it is understood. The owner assistant is no longer the entry point — it is one candidate among several, reached when the sender is a verified owner or the message starts with `LINK`, and it may decline (returning `handled: false`), in which case the tenant commands still get their turn.
- **Who may do what** is declared in one place, the intent registry's `allowedRoles`: `HELP`, interactive replies, pending-selection replies and the owner assistant (because `LINK` must work from an unknown number) are open to everyone; `BAL`/`DUES`/`PAY`/`STATUS`/`SWITCH` require a recognised sender. An unrecognised number asking for dues gets an explicit "this number isn't linked yet" reply telling it how to link, not silence. Owner-side assistant uses a separate, richer ID-based interactive-menu system (`owner-whatsapp-assistant.ts`, 7180 lines) rather than flat keywords — full command enumeration for the owner side was not completed; treat as **Unknown/partially explored** beyond `HELP`/`DUES`.

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
2. **Tenants** self-sign-up via `/api/auth/tenant-signup`, creating a **marketplace account**: `role: TENANT`, `owner_id` null, **no `tenants` row**. This account can browse and enquire; it is not a tenant of any hostel.
3. **A tenant *of a hostel*** is only ever created by an owner's invitation + activation. That flow reuses an existing marketplace profile rather than creating a second one — it rejects an existing profile only when that profile already has an *active* `tenants` row.
4. **Admins** are never self-serve — first via `scripts/bootstrap-platform-admin.ts`, later by invitation.

Consequences that surfaces must respect: a TENANT session can legitimately have `tenant_id: null`, so anything reading dues/agreements/room must tolerate its absence (`/api/auth/me` already does), and post-login routing sends such a user to hostel search rather than the tenant portal.

## Signup phone verification

Added 2026-07-31 ([[Decisions#ADR-034|ADR-034]]). **Phone verification is required for signup only when the provider can actually deliver it.**

1. **Mode resolution** (`lib/services/auth/phone-verification-mode.ts`): `PHONE_VERIFICATION_MODE=on|off` wins if set; otherwise verification is `on` only when `OTP_PROVIDER=whatsapp` **and** an access token **and** a phone-number ID **and** `WHATSAPP_OTP_TEMPLATE` are all present. (`WHATSAPP_BUSINESS_ACCOUNT_ID` is deliberately excluded — it isn't used to send.) Any other override value is ignored and logged.
2. **Circuit breaker** (`lib/services/auth/otp-provider-breaker.ts`): 3 send failures within 10 minutes opens the breaker for 15 minutes, during which no call is made to Meta at all. After the cooldown one trial send is allowed — success closes it, failure re-opens it for another cooldown. State is in Redis with an in-process fallback; a breaker is advisory, so a per-instance view is acceptable.
3. **Degradation is scoped to signup.** Only purposes `PHONE_VERIFICATION` and `LEAD_CAPTURE` degrade. Every other purpose keeps the hard `502 OTP_SEND_FAILED`.
4. **A failing send degrades its own request**, not merely subsequent ones — the user who trips the breaker must not be the one who eats the error.
5. **Rate limits are enforced before the skip path**, so it can never become an unthrottled way to write rows keyed by an arbitrary phone number.
6. **The outcome is recorded, not enforced away**: `profiles.phone_verified`/`mobile_verified` and `platform_leads.phone_verified` carry which path a signup took, and the admin leads list shows an "Unverified" marker.
7. **Explicit non-goal:** nothing retroactively verifies accounts or leads created while degraded. There is no login-time prompt, no dashboard banner, and no step-up gate for unverified users — turning the credentials on affects new signups only.

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
