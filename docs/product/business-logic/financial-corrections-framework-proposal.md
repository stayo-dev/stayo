# Financial Corrections Framework — Design Proposal

Status: **DRAFT — awaiting approval, not implemented.** Companion to [[Operation Recovery (Undo) System]] (`docs/business-logic/operation-recovery-undo-system-proposal.md`) — that document covers Tier 1 (Operational Undo); this one covers Tier 2 (Financial Corrections) of the three-tier recovery model. No code has been written yet.

**Superseded by the umbrella architecture**: [[Business Recovery Platform]] (`docs/business-logic/business-recovery-platform-architecture.md`). The payment/ledger/allocation audit and correction-workflow mechanics below (Reverse/Transfer/Split/Merge/Reallocate/Edit-Reference) are still authoritative, but the standalone `payment_corrections`/`payment_correction_events` schema described here is replaced by that document's unified `correction_cases`/`correction_case_events` model — these workflows become **Correction Handlers (tier: FINANCIAL_CORRECTION)** registered on that platform. Read the platform doc first, especially its Phase 1 scope (Reverse Payment, Transfer Payment, Edit Reference/Receipt only — Split/Merge/Reallocate are Phase 2 per that doc's §9).

## Why financial operations get a separate framework, not generic Undo

Payments, ledger entries, deposits, and allocations are accounting records. Accounting records are never deleted or silently edited — they are corrected by posting new, linked, explicit entries against the original. A timed "Undo" button (Tier 1's model) is the wrong mental model here: a correction should be possible whenever a mistake is discovered (a day later, per the brief's own Scenario 1), not only within a 15–30 minute window, and it must always show a preview and require a reason — closer to a bookkeeping correction than an "oops, ctrl-Z."

---

## 0. Audit summary (payment/ledger/allocation internals)

Full read of `payment-service.ts`, `financial-payment-facade.ts`, `settlement-engine.ts`, `financial-correction-gateway.ts`, `tenant-financial-ledger-service.ts`, and `prisma/schema.prisma`'s payment-related models, on top of the audit already recorded in the Tier 1 doc.

| Question | Finding | File(s) |
|---|---|---|
| Is there a persisted per-obligation allocation record? | No dedicated `payment_allocations` table. `payments.obligation_id` (schema.prisma:715) is a **required, single, non-nullable FK** — one `payments` row = one obligation. A ₹20,000 receipt split across N obligations is already, today, **N separate `payments` rows sharing one `payment_group_id`** (`settlement-engine.ts:262-309`, `tx.payments.create` once per allocation). | `settlement-engine.ts:262-309`, schema.prisma:715 |
| What is `payment_groups`? | A wrapper for one money-receipt event ("every payment recording creates a group... contain one or more individual payments/allocations", schema.prisma:1020-1046): `total_amount`, `method`, `reference_number`, `settlement_breakdown` (Json), `future_credit_amount`, `tenant_id`. **Freely mutable today — no invariant protects it**, already updated once per settlement (`settlement-engine.ts:426-432`). | schema.prisma:1020-1046 |
| Where does "future credit" (overpayment) live? | No separate credit table — it's `tenant_financial_ledger` rows with reasons `FUTURE_RENT_CREDIT_TOPUP` (credit, written `settlement-engine.ts:386-399`) and `FUTURE_CREDIT_APPLIED` (debit, `:366-385`). Availability is computed on demand by `tenantFinancialLedgerService.getFutureRentCreditBalanceInTx` → `_computeFinancialLedgerAvailabilityInTx`, which sums payments against SECURITY_DEPOSIT/ADVANCE obligation types plus these ledger rows. | `tenant-financial-ledger-service.ts:464-489`, `financial-payment-facade.ts:196-289` |
| What does `financial-correction-gateway.ts` actually do? | `applyCorrection({type, obligationId, tenantId, ownerId, actorId, amount, reason, displayLabel})` (`:67-134`) is single-obligation-scoped, no `paymentId`/tenant-transfer concept. Only `WAIVER` (writes a `tenant_financial_ledger` debit, reason `OBLIGATION_WAIVER`) and `CANCELLATION` (no ledger write) are implemented. **`ADJUSTMENT`, `REALLOCATION`, `REFUND` are explicit stubs that return `success:false` with the message "...Use the Financial Corrections framework when available."** This framework is that follow-up — the codebase already named it. | `src/services/payments/financial-correction-gateway.ts:67-134` |
| Is `tenant_id` a column on `payments` (making "transfer" a column edit)? | Yes, duplicated on both `payments.tenant_id` (schema.prisma:716) and `payment_groups.tenant_id` (:1024), also reachable via `rent_obligations.tenant_id`. A true "Transfer Payment" done as a column edit is blocked by the immutability invariant on `payments` — it must be structural (new rows), never a column change. | schema.prisma:715-716, 1024 |
| Any mutable field on `payments` today? | No — and a real bug was found while checking: the invariant script's regex bans `prisma.payment.(update\|delete\|...)` — **singular** `payment.` — but the actual Prisma accessor for the model is `payments` (**plural**; confirmed via `paymentRepository.ts:26-28` calling `prisma.payments.update`). The regex never matches the real accessor name, so the "payments are immutable" guarantee is **not actually enforced by CI today**. This must be fixed as a precondition for this framework's core safety claim to hold. | `scripts/architectural-invariants-check.ts:69-76` |
| Is `tenant_financial_ledger` correctable via offsetting rows already? | Yes in principle (only `refund_status` is documented-mutable, gated to `SECURITY_DEPOSIT_REFUNDED`), but `LEDGER_CORRECTION` — the enum value seemingly built for exactly this — **is declared and type-checked against, but never actually written as a literal reason anywhere in the codebase.** It's aspirational, unexercised. This framework is what finally uses it. | `tenant-financial-ledger-service.ts:376-387`, enum `FinancialLedgerReason` |

**Answer to the key feasibility question:** Reverse / Split / Reallocate / Merge are structurally buildable today using only new rows, because payments are already obligation-scoped 1:1 and multi-row-per-group is the existing mechanic for splitting one receipt. **Transfer Payment (cross-tenant) is the hard case** — it needs a new correction/pointer record linking a reversal on Tenant A to a fresh forward payment on Tenant B, since `tenant_id` cannot be edited on the original row.

---

## 1. Financial Corrections Architecture

Core rule: **`payments` rows are never mutated or deleted, ever, for any correction.** Every correction is expressed as new rows: one or more reversal `payments` rows (negative amount, same obligation as what they're undoing) plus, where the money is being re-homed, one or more new forward `payments` rows (allocated via the existing `settlement-engine.ts`, never a hand-rolled allocator) — all linked back to the original via a new `payment_corrections` record.

This finally gives real bodies to `financial-correction-gateway.ts`'s stubbed `ADJUSTMENT`/`REALLOCATION`/`REFUND` types, adds `TRANSFER`/`SPLIT`/`MERGE`/`REFERENCE_EDIT`, and puts the long-declared-but-unused `LEDGER_CORRECTION` ledger reason into real use.

```
Owner opens a payment → "Correct this payment"
        │
        ▼
POST /api/payments/:id/corrections/preview  { type, ... }
        │  PaymentCorrectionReadModel composes:
        │    financial-read-model-service + settlement-engine (dry-run plan)
        │  → returns Current vs After diff, no writes
        ▼
Owner reviews preview, enters mandatory reason, confirms
        │
        ▼
POST /api/payments/:id/corrections  { type, reason, ... }
        │
        ▼
PaymentCorrectionService.apply()
        │  1. row-lock affected obligations/payment_group (FOR UPDATE, same
        │     discipline as settlement-engine.ts)
        │  2. reject if payment already terminally corrected (no double-correct)
        │  3. one $transaction:
        │       - financial-correction-gateway: write reversal payment row(s)
        │       - settlement-engine.executePlanInTx: write forward payment row(s)
        │         where applicable (Transfer/Split/Reallocate/Merge)
        │       - tenant_financial_ledger: LEDGER_CORRECTION entries
        │       - payment_corrections + payment_correction_events rows
        ▼
eventSystem.trigger("payment_corrected", ...)  ← reuses existing event bus,
        feeds Activity Log / Tier-1's Activity Timeline / dashboards
```

Same integration principle as Tier 1: the correction record commits atomically with the ledger/payment writes it describes, inside one transaction — not appended afterward.

---

## 2. Correction Workflow Matrix

| Workflow | Mechanism | New rows | Existing state affected | Notes |
|---|---|---|---|---|
| **Reverse Payment** | One reversal `payments` row (negative, same obligation/tenant) + `LEDGER_CORRECTION` ledger entry | 1 `payments`, 1 `tenant_financial_ledger`, 1 `payment_corrections` | Obligation's outstanding balance restored | Direct generalization of `payment-recovery.ts`'s existing one-off shape |
| **Transfer Payment (A→B)** | Reversal on A's obligation + new forward payment(s) on B's obligation, planned via `settlement-engine.ts` | 1 reversal (A), N forward (B), 1 `payment_corrections` linking both | Obligation A restored to outstanding; Obligation B reduced | `payments.tenant_id` never edited — new rows carry Tenant B's id |
| **Split Payment** | Reversal of the original single-obligation row + N new forward rows across obligations/tenants, same `payment_group_id` | 1 reversal + N forward | Affected obligations' paid amounts | Reuses the exact multi-row-per-group mechanic that already exists for a receipt spanning obligations |
| **Merge Payments** | Reversal of each constituent row + one consolidated new forward allocation | Reversals for each source + new forward row(s), 1 `payment_corrections` referencing all sources | — | "Merge" = batch reverse + single re-settle, not a DB-level merge |
| **Reallocate Payment** (same tenant, different obligation) | Reversal on obligation X, new forward row on obligation Y | 1 reversal + 1 forward | Both obligations' paid amounts | Keep the same `payment_group_id` — receipt event is unchanged, only its allocation |
| **Edit Reference Details** (UTR/reference number/notes) | Direct update — but only ever on `payment_groups`, never `payments` | none (append a correction *event* for audit) | `payment_groups.reference_number` / `notes` | Closes a real gap: `payment_groups` edits today leave **no** audit trail at all |
| **Attach/Replace Receipt** | Same as above | none | `payment_groups.receipt_url` (or ImageKit ref field) | Same audit-event requirement |
| **Correction Notes** | Mandatory `reason` field on every `payment_corrections` row | — | — | Enforced at the API layer, not optional |

---

## 3. Payment State Machine

`payments` rows carry no status column today and never gain one — the state machine below is a **computed display state**, produced by a new read-model composer, never a mutated column:

```
RECORDED ──┬─▶ REVERSED     (terminal for that payment — no further correction allowed)
           ├─▶ TRANSFERRED  ─┐
           ├─▶ SPLIT         ├─▶ CORRECTED  (rollup display state, shown in Activity Timeline)
           ├─▶ REALLOCATED  ─┘
           └─▶ MERGED  (this payment is one of several sources consumed into a merge)
```

Guard rule: once a payment has a terminal correction (`REVERSED`, or fully consumed by `MERGED`), the gateway rejects any further correction attempt on it — "undo a correction" (redo) is out of scope for v1, matching the Tier 1 doc's stance on redo.

---

## 4. Ledger Impact Analysis

Every correction posts an explicit ledger pair rather than touching an existing entry:

- **Reverse**: `LEDGER_CORRECTION` debit for `-amount` against the original obligation/tenant.
- **Transfer**: `LEDGER_CORRECTION` debit on Tenant A (referencing the original payment); Tenant B's side needs no new ledger reason — it's posted by the normal forward-payment ledger path the new payment already triggers.
- **Split / Reallocate**: one debit/credit pair per affected obligation.
- **Merge**: N debits (one per source) + one or more credits for the consolidated allocation.
- **Future-credit interaction**: if a correction changes an obligation that previously triggered a `FUTURE_CREDIT_APPLIED` sweep, the correction must re-invoke the same credit-availability check `applyAvailableCredits` uses — never leave a stale credit application referencing an obligation state that no longer exists (see Edge Cases).

**Reconciliation invariant**: after any correction, re-running `financial-read-model-service.ts`'s composed balance for the affected tenant(s)/obligation(s) must match what the correction intended to produce. This is the verification method — never a second, independent balance calculation.

**Open implementation question** (flagged, not resolved by this audit): is `rent_obligations`'s outstanding/paid amount a stored denormalized value that corrections must explicitly decrement/increment, or purely derived at read time from summed `payments`? This must be confirmed before writing the reversal-row logic — get it wrong and obligation status silently corrupts.

---

## 5. Activity Timeline Design

Reuses the Tier 1 Activity Timeline surface, sourced from the new `payment_correction_events` table (authoritative — not the unreliable post-commit `activity_logs`):

```
Payment Recorded          ₹20,000 · Tenant A · UTR 291839
        ↓
Payment Transferred
   From: Tenant A
   To:   Tenant B
   Reason: "Recorded against wrong tenant"
   Performed by: Owner · 10:42 AM
        ↓
Current Status: Corrected
```

```
Payment Recorded → Payment Reversed → Payment Re-recorded → Payment Transferred → Current Status: Corrected
```

---

## 6. UI/UX Proposal

- Payment detail view: a "Correct this payment" action menu — Reverse / Transfer / Split / Reallocate / Merge / Edit Reference — gated by the Permission Model (§11).
- **Correction Preview** (mandatory step before any write):
  ```
  Current              Tenant A · July Rent · Paid ₹8,500
  After Correction      Tenant A · July Rent · Outstanding ₹8,500
                        Tenant B · July Rent · Paid ₹8,500
  Ledger changes        + Reverse Entry (Tenant A)
                        + New Allocation (Tenant B)
  ```
- Reason field required, "Confirm" disabled until filled — mirrors the `change_requests.reason` mandatory-field precedent.
- Payment list/detail shows a "Corrected" badge linking to the full correction chain (bidirectional: original ↔ every correction that touched it).

---

## 7. Database Changes

```prisma
model payment_corrections {
  id                    Uuid      @id
  hostel_id             Uuid      // required, never optional — invariant compliance
  correction_type        PaymentCorrectionType // REVERSE | TRANSFER | SPLIT | MERGE | REALLOCATE | REFERENCE_EDIT
  source_payment_ids     Uuid[]
  source_payment_group_id Uuid?
  target_tenant_id       Uuid?    // TRANSFER only
  reversal_payment_ids   Uuid[]
  forward_payment_ids    Uuid[]
  reason                 String   // mandatory
  actor_id               Uuid
  actor_role             String
  before_snapshot        Json
  after_snapshot         Json
  status                 PaymentCorrectionStatus // APPLIED (one-shot; corrections aren't themselves undoable in v1)
  created_at             DateTime
}

model payment_correction_events {
  id                     Uuid @id
  payment_correction_id  Uuid  // FK
  event_type             String
  actor_id               Uuid
  actor_role             String
  reason                 String?
  ip_address             String?
  user_agent             String?
  created_at             DateTime
}
```

- `payments`: **no new columns** — immutability fully preserved.
- `payment_groups`: optional additive `last_corrected_at`, `correction_count` — denormalized convenience only, always recomputable from `payment_corrections`, not load-bearing.
- New enums: `PaymentCorrectionType`, `PaymentCorrectionStatus`.
- Reuses existing `FinancialLedgerReason.LEDGER_CORRECTION` (already declared, never written until now).
- **Prerequisite fix, independent of new tables**: correct the invariant-check regex (`payment\.` → `payments\.`) so the "payments never mutated" guarantee is actually enforced by CI — right now it silently doesn't match the real Prisma accessor name.
- Recommend also bringing `payment_groups` under the invariant script's protection, with an explicit carve-out for the settlement engine's own legitimate `settlement_breakdown` updates and for this framework's new reference-edit path (which must go through the logged correction-event flow, not a raw update).

---

## 8. Service Changes

- **`financial-correction-gateway.ts`**: implement the three already-stubbed types for real (`ADJUSTMENT`, `REALLOCATION`, `REFUND`), add `TRANSFER`, `SPLIT`, `MERGE`, `REFERENCE_EDIT`. Input shape widens from single-obligation-scoped to accept `paymentIds[]` / `fromTenantId` / `toTenantId` where relevant.
- **New `payment-correction-service.ts`** — orchestrator: row-locks, calls the gateway for reversal writes, calls `settlement-engine.ts` (unmodified) for any new forward allocation, writes `payment_corrections` + `payment_correction_events`.
- **New `payment-correction-read-model.ts`** — preview/state-machine composer, following the `financial-read-model-service.ts` precedent (compose, never recalculate).
- **No changes** to `payment-service.ts`'s existing recording paths (`recordPayment`, `recordTenantPayment`, etc.) — corrections are additive.
- **`settlement-engine.ts`** reused as-is for allocation planning; must gain unit-test coverage confirming its behavior for correction-driven calls is unchanged from normal payment recording.

---

## 9. API Design

```
POST /api/payments/:paymentId/corrections/preview   { type, ... }   → diff only, no writes
POST /api/payments/:paymentId/corrections            { type, reason, ... } → executes
GET  /api/payments/:paymentId/corrections            → correction history for a payment
GET  /api/payment-corrections/:correctionId          → detail
```
Every route resolves `hostelId` via `resolveOwnerScope`, non-optional, matching the existing invariant. Cross-hostel `target_tenant_id` (Transfer) is rejected at this layer before it ever reaches the gateway.

---

## 10. Edge Cases

- **Stale future-credit sweep**: correcting a payment that previously triggered `FUTURE_CREDIT_APPLIED` elsewhere must re-run the credit-availability check, potentially cascading into a second correction on the downstream obligation — never leave a dangling reference to a state that no longer exists.
- **Double-correction**: rejected outright by the state machine (§3) — a payment with a terminal correction cannot be corrected again; "undo a correction" is out of scope for v1.
- **Race with a new payment on the same obligation**: reallocation/transfer must re-check the obligation's current outstanding balance under the same row-lock discipline `settlement-engine.ts` already uses, not trust a value read before the lock.
- **Cross-hostel transfer**: blocked outright — Tenant B must belong to the same hostel as Tenant A.
- **Merge across different `payment_group_id`s**: allowed, but `before_snapshot` must capture every source individually for audit fidelity.
- **Rounding**: split amounts must sum exactly to the original paise value; reject (don't silently floor/drop) on any remainder mismatch.

---

## 11. Permission Model

- Financial Corrections are still **owner self-service** (not admin-only) but require an explicit elevated step beyond Tier 1's one-click undo: mandatory preview + mandatory reason, no silent/implicit corrections anywhere in the UI.
- This is distinct from **Tier 3 (Administrative Reversal)** — completed Move-Out, activated Renewal, post-activation KYC — which is not part of this framework and instead routes through the existing `change_requests` governed-approval pipeline (see the Tier 1 doc's §6 note); that tier may require a second-actor/admin approval, to be confirmed if that direction is approved.
- All three tiers derive actor identity from the existing `resolveOwnerScope`/`resolveTenantScope` — no new auth concept required.

---

## 12. Risk Assessment

1. **Obligation balance representation is unconfirmed** — whether `rent_obligations` outstanding/paid is stored or derived must be nailed down before writing reversal logic; getting it wrong silently corrupts obligation status. Highest-priority open question.
2. **The immutability invariant currently doesn't fire** (regex bug, `payment.` vs `payments.`) — this framework's core safety claim ("payments never mutated") is not actually CI-enforced today. Fix is a precondition, not a nice-to-have, independent of whether this framework ships.
3. **`payment_groups` is unprotected** today (freely updatable, no audit trail on edits) — recommend locking it down as part of this work, with a narrow allowlist for the settlement engine's own legitimate updates and this framework's logged reference-edit path.
4. **`settlement-engine.ts` reuse risk** — must not regress its behavior for ordinary (non-correction) payment recording; needs explicit before/after test coverage.
5. **Scope/effort** — this is materially larger than Tier 1's Operational Undo (six correction workflows, cross-tenant transfer, ledger reconciliation guarantees). Recommend phasing: **Phase 1** — Reverse Payment + Edit Reference/Notes (lowest risk, matches the gateway's existing stub shape most directly). **Phase 2** — Reallocate + Split (same-tenant, same-hostel). **Phase 3** — Transfer + Merge (cross-tenant, highest complexity).

---

## Open questions requiring a decision before implementation starts

1. Is `rent_obligations`'s paid/outstanding amount stored or derived? (Blocks all reversal-row design until confirmed.)
2. Should `payment_groups` be locked down to the same immutability standard as `payments`, or intentionally kept as the one "editable" surface (reference/notes/receipt) as this doc assumes?
3. What does Tier 3 (Administrative Reversal) actually require procedurally — is routing through the existing `change_requests` pipeline sufficient, or does it need a genuinely new approval concept (e.g. a second admin login) that doesn't exist in the codebase today?
4. Confirm the three-phase rollout order (Reverse/Edit → Reallocate/Split → Transfer/Merge) is acceptable, given Transfer is explicitly called out as Scenario 1 in the original brief and owners may want it earliest despite being the highest-complexity workflow.
