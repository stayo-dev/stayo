
# Operation Recovery (Undo) System — Design Proposal

Status: **DRAFT — awaiting approval, not implemented.** Do not build against this until it's signed off; see [[Decisions]] for where an ADR will land once approved. This document is the deliverable for the "audit architecture, then design, before writing code" instruction — no code has been written yet.

**Superseded by the umbrella architecture**: [[Business Recovery Platform]] (`docs/business-logic/business-recovery-platform-architecture.md`). The domain audit and per-action mechanics below are still authoritative, but the `recoverable_operations`/`recovery_events` schema and standalone Recovery Engine described here are replaced by that document's unified `correction_cases`/`correction_case_events` model — the actions below become **Correction Handlers (tier: OPERATIONAL_UNDO)** registered on that platform, not a separate engine. Read the platform doc first; treat this doc as the source of truth for *what each action needs to do*, not *what tables to create*.

Related reading once this ships: `docs/obsidian/Business-Rules.md`, `docs/obsidian/Database.md`, `docs/business-logic/financial-consistency-investigation-report.md` (the "compose, don't reimplement" precedent this design follows).

## Scope note — three-tier recovery model

Recovery across the system splits into three tiers, each with a different risk profile and a different mechanism. **This document covers only Tier 1.**

| Tier | Covers | Mechanism | Doc |
|---|---|---|---|
| 1. Operational Undo | Room Shift, Tenant Admission (pre-activation), Reservation, draft Agreement, pending Renewal Offer, Settings Changes, Document Upload, KYC Approval (pre-downstream-consumption) | Self-service, timed window (15–30 min), compensating operation via the Recovery Engine below | this document |
| 2. Financial Corrections | Payments, payment allocations, ledger entries, deposits, future credits — never time-boxed the same way; always reasoned + previewed | Correction workflows (Reverse/Transfer/Split/Merge/Reallocate/Edit-reference) that never mutate `payments` history | [[Financial Corrections Framework]] (`docs/business-logic/financial-corrections-framework-proposal.md`) |
| 3. Administrative Reversal | High-blast-radius lifecycle actions past the point of simple undo: completed Move-Out, activated Agreement Renewal, KYC Approval after downstream activation | Routed through the existing `change_requests` governed-approval pipeline rather than one-click self-undo | see §9 of the Financial Corrections doc and the eligibility matrix note below |

Payment Recorded and Deposit Adjustment, originally listed in the eligibility matrix below (§6), are **reassigned to Tier 2** and removed from this document's scope — see the Financial Corrections Framework doc for their design. Everything else in §6 stays Tier 1 as originally designed, except where noted.

---

## 0. Audit summary (what already exists)

This section is the output of a full read-first pass over `apps/backend/` before any design decisions below were made.

| Concern | Current state | File(s) |
|---|---|---|
| Activity Log | `activity_logs` table, written by `lib/services/activity.service.ts` (`.log()`), triggered via a central `EventEmitter` (`lib/events/index.ts`, ~20 named events like `payment_recorded`, `expense_created`). **Fired after the business `$transaction` commits, in a swallowed try/catch** — can silently drop or drift from the real mutation. | `lib/services/activity.service.ts`, `lib/events/index.ts` |
| Activity Log (confusable duplicate) | A second class also named `ActivityService`, at `lib/services/activity-service.ts`, is an unrelated **read-model** that recomputes a feed from `payments`/`roomAllocation` directly — never touches `activity_logs`. Real landmine for anyone building on "the" activity service. | `lib/services/activity-service.ts` |
| Audit Trail | Not one table — five overlapping ones: `actionLog`, `activity_logs`, `systemEventLog`, `admin_financial_audit_log` (richest: has `before_state`/`after_state` JSON), plus domain-specific logs. Already flagged as ambiguous in `docs/obsidian/Database.md`. | `prisma/schema.prisma` |
| Closest existing "undo" precedent (generic) | `change_requests` + `change_request_events` — `entity_type`/`entity_id` polymorphic addressing, `before`/`diff` JSON snapshots, mandatory `reason`, `actor_id`/`actor_role`, append-only companion event table with IP/user-agent. Built for governed *pre*-approval changes to tenant profile fields; **never wired for financial entities** despite `field-classification.ts` explicitly classifying `payments.amount_paid`/`rent_obligations.amount`/ledger amounts as "Category D — reversal only." This is dead infrastructure, and the best template to extend. | `src/services/change-management/{change-request-service,entity-adapter,field-classification}.ts`, schema.prisma:2343-2426 |
| Closest existing "undo" precedent (financial) | `payment_recovery.ts` (`RecoveryExecutor`) — a real one-off reversal: writes `payment_recovery_operations` (correlates original attempt → reversal), then in one `$transaction` posts a `LEDGER_CORRECTION` debit, marks the original attempt `CORRECTED`. Reads as an incident-response script (hardcoded amount), not a reusable primitive — but the shape is exactly right. | `src/services/payments/payment-recovery.ts` |
| Closest existing "undo" precedent (lifecycle) | Move-Out Cancellation. The move-out state machine is forward-only and `COMPLETED`/`REJECTED` are terminal with no reverse transition. `cancelRequest()` doesn't restore anything — it flips status to `REJECTED`; "undo" is *emergent* because capability checks (`TRANSFER_ROOM`, etc.) simply stop looking at rejected requests. **Design lesson: undo doesn't always mean literally reversing every side effect — sometimes it means a terminal side-state plus guards that treat "cancelled" as "never happened."** | `lib/services/move-out-service.ts:267`, `lib/services/move-out-state-machine.ts` |
| Existing (bad) precedent to fix | `owner-whatsapp-assistant.ts` already has a 30-minute "UNDO EXPENSE" feature — but it's a **hard delete**, no compensating record, no audit trail of the undo itself. Directly violates the audit-first goal this project states. | `lib/services/notifications/owner-whatsapp-assistant.ts:4596-4654` |
| Transaction boundaries | Every domain write path that matters (`payment-service.ts`, `obligation-engine.ts` `...InTx` functions, `room-allocation-service.ts`, `renewal-offer-service.ts`, `tenant-invitation-lifecycle-service.ts`, `move-out-service.ts`) already wraps its mutation in one `prisma.$transaction`, often with `FOR UPDATE` row locks and, for the renewal chain, count-checked `updateMany` (`count !== 1` → throw) to guard concurrent chain edits. **This is the natural boundary a compensating transaction must respect and imitate.** | see per-domain files above |
| Payments/obligations immutability | Statically enforced: `architectural-invariants-check.ts` forbids any `prisma.payment.(update|delete|...)` call outside allowed paths. `rent_obligations` is "replace by cancel+create," not edited — but there's **no single backend endpoint that does cancel+create atomically today**; it's a manual two-call frontend pattern. | `scripts/architectural-invariants-check.ts:70-76`, `obligation-engine.ts:281,371` |
| Expenses | The opposite extreme: **fully mutable and hard-deletable today** (`updateExpense`, `deleteExpense` in `lib/services/expense-service.ts`), no ledger linkage, no soft-delete. This is a second existing audit-first violation, independent of the WhatsApp one above. | `lib/services/expense-service.ts:640,704` |
| Settings | `hostels.preferences_config` (JSON) is overwritten in place on update; only a summary event (`changed_by`/`changed_domains`, no before/after body) is logged. No settings-history table exists. | `lib/services/hostel-policy-service.ts:839-918` |
| Actor/auth context | Consistently resolvable: `resolveOwnerScope(session)` → `{actor_id, owner_id, role}`, never falls back across owner IDs. This is the field to thread through every recovery record as "Performed By." | `lib/auth/resolve-operational-scope.ts` |
| hostelId invariant | Enforced today by `architectural-invariants-check.ts` (no optional `hostelId`, no `hostels[0]` fallback). Any new service in this design must comply, not be added to the script's allowlist. | `scripts/architectural-invariants-check.ts` |
| Notifications | No queue system — synchronous, in-request, fired via `eventSystem` handlers or Vercel Cron. No automatic "payment received" WhatsApp message was found (only receipts/reminders), so undo's main notification burden is *correction* messages, not retraction. Existing idempotency-key pattern (`whatsapp_logs.idempotency_key`, `ON CONFLICT DO NOTHING`) is directly reusable for "undo notice" messages. | `lib/services/notifications/whatsapp-template-delivery.ts:44-166` |

**The single most important finding:** activity/audit writes are *not* transactionally coupled to the business mutation they describe (fired post-commit, errors swallowed). Any Undo system that reads `activity_logs` to decide what's undoable would inherit that unreliability. The recovery record must instead be written **inside the same `$transaction`** as the original mutation — this becomes the central design decision below.

---

## 1. Architecture proposal

Add one new bounded context, `apps/backend/src/services/recovery/` (new domain → lives under `src/services/`, per the repo's own convention that newer domains go there, not `lib/services/`). It does **not** replace or restructure Activity Log, Audit Trail, Financial Ledger, Agreement Engine, or Room Engine — it sits alongside them and calls into their existing services to perform compensations, exactly the way `financial-read-model-service.ts` composes rather than recalculates.

```
Owner clicks "Undo"
        │
        ▼
POST /api/recovery/:operationId/undo
        │
        ▼
RecoveryService.undo(operationId, actor)
        │  1. row-lock recoverable_operations (FOR UPDATE)
        │  2. RecoveryPolicy.isEligible()  — window + state guards
        │  3. look up CompensationExecutor for operation_type
        │  4. new $transaction:
        │       - executor.compensate(tx, operation)   [calls existing domain services]
        │       - mark recoverable_operations.status = UNDONE
        │       - write recovery_events (UNDO_SUCCEEDED)
        ▼
eventSystem.trigger("operation_undone", ...)   ← reuses existing event bus
        │
        ▼
Activity Log / WhatsApp correction message / dashboard cache invalidation
   (all via existing listeners — nothing new to build here)
```

The **write side** (capturing that something undoable happened) is symmetric and is the safer half to design correctly:

```
Existing domain service (payment-service.ts, room-allocation-service.ts, ...)
        │
        ▼
prisma.$transaction(async (tx) => {
    ... existing business mutation ...
    await recoveryService.registerOperation(tx, {
        hostelId, operationType, entityType, entityId,
        actorId, actorRole, beforeSnapshot, affectedEntities,
    })  ← ONE new call, same tx, same commit/rollback boundary
})
```

Registering inside the same transaction is the integration point that fixes the drift risk found in section 0 — the recovery record cannot exist without the mutation having committed, and vice versa.

---

## 2. Recovery Engine design

- **Operation Registry** (`recovery-registry.ts`) — a typed map from `RecoverableOperationType` → `CompensationExecutor`. One executor per action family (not per fine-grained action — e.g. Admission and Reservation share an executor family since they share transactional machinery).
- **Recovery Service** (`recovery-service.ts`) — public entry point: `registerOperation()` (write side, called from within existing domain transactions) and `undo()` (read + compensate). Owns row-locking and re-emits through the existing `eventSystem`.
- **Compensation Executors** (`executors/*.ts`) — one file per domain family; each wraps *existing* domain services rather than writing new mutation logic:
  - `payment-executor.ts` → generalizes `payment-recovery.ts` + `financial-correction-gateway` + `obligation-engine.waiveObligationInTx`.
  - `expense-executor.ts` → replaces the current hard-delete `deleteExpense` path with a voided-entry + reversal-entry pattern (see §3).
  - `room-shift-executor.ts` / `admission-executor.ts` / `reservation-executor.ts` → wrap `room-allocation-service.ts` and the existing `resendInvitation` "unwind" logic in `tenant-invitation-lifecycle-service.ts`.
  - `renewal-executor.ts` → mirrors the existing count-checked `updateMany` chain-unlink technique from `renewal-offer-service.ts` / `agreement-lifecycle-service.ts`.
  - `settings-executor.ts` → restores `hostels.preferences_config` from the captured `before_snapshot`.
  - `document-executor.ts`, `kyc-executor.ts`, `deposit-adjustment-executor.ts` → thin wrappers per §6.
- **Recovery Policy** (`recovery-policy.ts`) — `canUndo()` combines two independent checks: (a) time — `now < undo_expires_at`, window from `hostels.preferences_config.undoWindowMinutes` (new field, default 20, clamp 15–30, per-hostel configurable through the existing settings pipeline); (b) state — has the entity moved to a state where compensation is no longer safe (e.g. Agreement now SIGNED, Move-Out now COMPLETED, a second payment already allocated against the same obligation)? State guards can downgrade eligibility even *inside* the time window.
- **Undo Eligibility** — surfaced per-operation via `canUndo()` / `undoExpiry()` / `affectedEntities()`, the exact three methods the brief asked each operation to expose, implemented on the executor interface:
  ```ts
  interface CompensationExecutor {
    operationType: RecoverableOperationType;
    classify(ctx: OperationContext): RecoverabilityClass;   // FULL | PARTIAL | NONE
    canUndo(op: RecoverableOperation): Promise<boolean>;
    undoExpiry(op: RecoverableOperation): Date;
    affectedEntities(op: RecoverableOperation): EntityRef[];
    captureBeforeSnapshot(ctx: OperationContext): Promise<Json>;  // called pre-mutation, inside the original tx
    undo(tx: PrismaTx, op: RecoverableOperation, actor: Actor): Promise<void>;
  }
  ```
- **Recovery History** (`recovery-history-service.ts`) — read model only; composes `recoverable_operations` + `recovery_events` + calls existing per-domain read services for human-readable previews ("this will restore Room 204, Bed 3"). Follows the `financial-read-model-service.ts` compose-don't-reimplement precedent explicitly.

---

## 3. Entity relationship changes

No existing table is restructured. Additions:

```
recoverable_operations (new)
  id, hostel_id (required), operation_type, entity_type, entity_id,
  actor_id, actor_role, reversibility_class, status,
  before_snapshot (json), affected_entities (json[]),
  correlation_id (nullable, best-effort link to activity_logs row),
  undo_expires_at, created_at
      │ 1:N
      ▼
recovery_events (new, append-only)
  id, recoverable_operation_id (FK), event_type, actor_id, actor_role,
  reason, snapshot (json, nullable), ip_address, user_agent, created_at

expenses (existing table — additive columns only)
  + voided_at, voided_by, voided_reason, reversal_of_expense_id (self-FK,
    mirrors Agreement.renewed_from_agreement_id/renewed_to_agreement_id)
```

Everything else (payments, rent_obligations, tenant_financial_ledger, roomAllocation, Agreement, tenants, identificationDocument) is reused as-is: their existing cancelled_at/waived_at/is_active/status/refund_status fields are exactly what compensations write to. Only `expenses` needs new columns, because it's the one subsystem with no existing reversal concept at all.

## 4. Database additions

New enums:
```prisma
enum RecoverableOperationType {
  PAYMENT_RECORDED
  DEPOSIT_ADJUSTED
  EXPENSE_CREATED
  TENANT_ADMISSION
  ROOM_ALLOCATION
  ROOM_SHIFT
  AGREEMENT_CREATED
  RENEWAL_OFFER_CREATED
  RENEWAL_ACCEPTED
  KYC_APPROVED
  SETTINGS_UPDATED
  DOCUMENT_UPLOADED
  RESERVATION_CREATED
}
enum RecoverabilityClass { FULL PARTIAL NONE }
enum RecoveryStatus { ACTIVE UNDONE EXPIRED LOCKED FAILED }
```

`recoverable_operations(hostel_id, entity_type, entity_id, created_at)` indexed for lookups; `(status, undo_expires_at)` indexed for the expiry-sweep cron (new 14th cron job, alongside the 13 existing ones, e.g. reusing the `expireStaleOffers` pattern to flip `ACTIVE → EXPIRED` — no deletion).

## 5. Service architecture

```
apps/backend/src/services/recovery/
  recovery-service.ts        # registerOperation(), undo(), getEligibleUndos()
  recovery-registry.ts        # operation_type -> executor map
  recovery-policy.ts          # canUndo() time+state rules, per-hostel window lookup
  recovery-history-service.ts # read model, composes existing services
  executors/
    payment-executor.ts
    expense-executor.ts
    admission-executor.ts
    room-shift-executor.ts
    reservation-executor.ts
    renewal-executor.ts
    settings-executor.ts
    document-executor.ts
    kyc-executor.ts
    deposit-adjustment-executor.ts

apps/backend/app/api/recovery/
  route.ts                    # GET eligible undos for hostel
  [operationId]/route.ts      # GET detail
  [operationId]/undo/route.ts # POST undo, body { reason }
  history/route.ts            # GET recovery_events history for a hostel/entity
```

Every route resolves `hostelId` via `resolveOwnerScope`, non-optional, per the existing invariant — this service is explicitly **not** added to any allowlist in `architectural-invariants-check.ts`.

## 6. Undo eligibility matrix

| Action | Classification | Window behavior | Notes |
|---|---|---|---|
| Payment Recorded | — moved to Tier 2 | — | See [[Financial Corrections Framework]] — Reverse Payment workflow. |
| Payment Adjustment / Deposit Adjustment | — moved to Tier 2 | — | See [[Financial Corrections Framework]] — ledger correction workflows. |
| Tenant Admission / Tenant Creation | FULL → PARTIAL | Full while `tenant.status = INVITED`; downgrades once `ACTIVE` (allocation + obligations exist) | Reuses the existing `resendInvitation` "delete-draft-agreement + regenerate obligations" unwind pattern for the FULL case. |
| Room Allocation | FULL | Full window, unless a later shift/move-out already occurred | Close-and-reopen `roomAllocation` rows, same as normal shifts. |
| Room Shift | FULL | Full window | Reverse shift = new allocation reopening the prior room; never mutates history in place. |
| Agreement Creation | PARTIAL → NONE | Full while `DRAFT`; NONE once `SIGNED` | Signed agreements require the normal termination flow, not undo. |
| Renewal Offer | FULL | Full window while `PENDING` | Simple status flip, mirrors `expireStaleOffers` cron precedent. |
| Agreement Renewal (offer accepted) | PARTIAL → Tier 3 | Full while successor still `DRAFT`/not activated; **once activated (`RENEWED`/`SIGNED`), escalates to Tier 3 (Administrative Reversal)** rather than NONE | Pre-activation: reverses the count-checked chain-link `updateMany`, restores predecessor status (Tier 1). Post-activation: too high-blast-radius for self-service undo — routed through `change_requests` governed approval instead of being permanently un-reversible. |
| Expense Creation / Maintenance Expense | FULL | Full window | **Requires migrating off today's hard-delete** onto voided+reversal-entry columns (see §3); also replaces the WhatsApp "UNDO EXPENSE" hard-delete feature. |
| Notice Creation | N/A | — | No distinct "Notice" backend entity exists today (only `FINAL_NOTICE` reminder tier and eviction fields on move-out). **Flag: needs product clarification before inclusion; excluded from v1 scope.** |
| KYC Approval | PARTIAL → Tier 3 | Full window, unless downstream activation already consumed it | Flip `document_verified`/`is_verified` back while safe (Tier 1); **once a dependent activation has consumed the approval, escalates to Tier 3** rather than being blocked outright. |
| Move Out | PARTIAL → Tier 3 | Full while not yet `COMPLETED` | The existing `cancelRequest()` **is** the sanctioned undo — wrap it with a `recoverable_operations` record (Tier 1). **Once `COMPLETED`, the state machine is terminal by design — reversing it is Tier 3 (Administrative Reversal), not simply unsupported.** |
| Move Out Cancellation | NONE | — | Undoing a cancellation is just "start a new move-out request"; not modeled as a redo. |
| Settings Changes | FULL | Full window | Requires capturing a before-snapshot at write time (not stored today — becomes `recoverable_operations.before_snapshot`). |
| Document Upload | FULL | Full window | Flip `is_active` back / remove the new row; no ImageKit asset deletion needed (none happens today either). |
| Reservation | FULL | Full window, while pre-agreement | Same executor family as Admission. |

**Tier 3 (Administrative Reversal) note:** rows above marked "escalates to Tier 3" are not modeled as a new bespoke reversal mechanism in this document. They route through the existing `change_requests`/`change_request_events` governed-approval pipeline (the same one `field-classification.ts` already earmarks for Category D/L3 fields but never wired up) — an owner *requests* the reversal with a reason, and it is applied only through that approval flow, not the instant self-service `undo()` path this document otherwise describes. Full design of that pipeline's extension is left to a follow-up doc if this direction is approved; it is out of scope for the Recovery Engine itself.

## 7. UI wireframe proposal

**Tenant Activity timeline** — show the full chain instead of hiding anything:
```
● Payment Recorded          ₹5,000 · 2:14 PM
  ↓
● Payment Reversed          Reason: Undo by Owner
  Performed by: Owner (Sharan) · 2:26 PM
  [ Original #a1b2 → Reversal #c3d4 ]
```
Each undoable row gets:
- `Undo available` badge + live countdown (`Xm remaining`) while `status = ACTIVE` and `now < undo_expires_at`.
- `Undo period expired` badge once past the window (`status = EXPIRED`).
- `Reversed` badge on the original event, `Recovered` badge on the compensating event, linked bidirectionally.
- An "Undo" button that opens a confirm dialog requiring a reason (mirrors `change_requests.reason` being mandatory).

**System Audit Trail** — every undo is itself an audit row:
```
Payment Reversed
  Performed By: owner_id / actor_role
  Timestamp: ...
  Reason: "Recorded against wrong tenant"
  Original Event ID: recoverable_operations.id
  Recovery Event ID: recovery_events.id
```

## 8. Edge cases

- **Concurrent dependent action** — e.g. a second payment gets allocated against an obligation before the first payment's undo runs. Handled by row-locking the same rows the original transaction locked (`FOR UPDATE`) inside `undo()`; if the entity has moved to a state the executor's `canUndo()` no longer accepts, the operation is downgraded to `LOCKED` at undo-time, not just at creation-time.
- **Notification already sent** — can't unsend a WhatsApp receipt; compensate by sending a correction message reusing the existing `idempotency_key` pattern, not by trying to retract.
- **Cron races** (e.g. `expireStaleOffers` firing between offer creation and undo) — same row-lock discipline the renewal chain code already uses; no new concurrency primitive needed.
- **Undo of an undo (redo)** — explicitly out of scope for v1; redo means re-performing the original action through its normal flow.
- **Multi-hostel scoping** — `hostelId` required end-to-end, never falls back, consistent with the existing invariant script.
- **Double-submit of the Undo button** — guarded by a conditional `status: ACTIVE → UNDONE` update with a count check (`count !== 1` → already handled/expired), same technique as the renewal chain linking.
- **Timezone/clock** — `undo_expires_at` stored as absolute `timestamptz`; all comparisons server-side.

## 9. Risks

- **Scope size** — 13 operation types × dedicated executor is real surface area. Recommend phasing: **Phase 1** (low blast radius, no cross-cycle financial risk): Expense, Settings, Document Upload, Room Shift, Reservation. **Phase 2**: Payment/Deposit ledger corrections. **Phase 3**: Admission and Renewal chain-unlink. Move-Out-completed and Renewal-activated stay permanently NOT REVERSIBLE by design, not a phasing gap.
- **Existing conflicting feature** — the WhatsApp "UNDO EXPENSE" hard-delete must be migrated onto the new expense executor, not left running in parallel (it would otherwise bypass the audit trail this whole project exists to guarantee).
- **Duplicate `ActivityService` naming collision** — pre-existing landmine; recovery UI code must be careful to read from `activity.service.ts` (the writer) and not confuse it with the unrelated read-model of the same class name in `activity-service.ts`.
- **`activity_logs` unreliability** — since writes there are post-commit and swallowed, it cannot be the Undo system's source of truth; `recoverable_operations`/`recovery_events` (written in-transaction) must be authoritative, with `activity_logs` treated as a secondary display feed only.

## 10. Rollback strategy (for shipping this feature safely)

- Fully additive migration: two new tables, three new enums, four new nullable columns on `expenses`. Nothing existing is altered — zero risk to current reads if the feature is disabled.
- Gate `/api/recovery/*` and the UI badges behind a per-hostel preference flag (default off), using the same `preferences_config` pipeline as everything else in Settings — enable gradually, disable instantly, no schema rollback needed.
- Executors are independent and registry-driven: if one is found buggy post-launch, disable just that `operation_type` in the registry (it falls back to `NONE` reversibility) without affecting the others.
- No backfill needed or attempted — operations that happened before this ships simply have no `recoverable_operations` row and are correctly treated as not undoable.

---

## Open questions requiring a decision before implementation starts

1. **Expense system change** — are we comfortable adding `voided_at`/`reversal_of_expense_id` columns and retiring the hard-delete path (including the WhatsApp "UNDO EXPENSE" feature), or should hard-delete remain for non-undo manual edits while only undo-triggered reversals use the new path?
2. **"Notice Creation"** — no such distinct entity exists in the codebase today. Confirm intended scope (tenant announcements? legal/eviction notice? reminder escalation tier?) before it's added to the matrix.
3. **Default undo window** — 15 vs 20 vs 30 minutes as the shipped default (clamped range is fine either way; need one concrete default for `DEFAULTS.undoWindowMinutes`).
4. **Phasing** — confirm the 3-phase rollout above is acceptable, or if a specific action (e.g. Payments) needs to be in Phase 1 despite higher risk.
