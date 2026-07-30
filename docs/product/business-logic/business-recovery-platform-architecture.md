# Business Recovery Platform — Architecture

Status: **DRAFT — approved directionally, refined once, not yet implemented (implementation plan in progress).** This is the umbrella architecture superseding the standalone framing of the two prior docs:

- [[Operation Recovery (Undo) System]] (`operation-recovery-undo-system-proposal.md`) — its audit findings and Tier 1 mechanics (Room Shift, Admission, Expense, Settings, Document, Reservation, KYC executors) remain valid; they now become **Correction Handlers registered on this platform**, not a separate system.
- [[Financial Corrections Framework]] (`financial-corrections-framework-proposal.md`) — its payment/ledger/allocation audit and correction-workflow mechanics (Reverse/Transfer/Split/Merge/Reallocate) remain valid; they become the platform's **first Correction Handlers**.

Nothing in either prior doc's *domain audit* changes. What changes is the shell around them: instead of two independent systems plus a bolt-on Tier 3, there is **one platform, one core object, one lifecycle, one self-registering handler seam** — and any future HMS module plugs into it without editing platform code.

**Revision note**: this version folds in six refinements requested after the first pass — (1) a hard platform/domain-policy boundary, (2) explicit recovery dependencies between cases, (3) idempotency + safe retry, (4) event-driven integration instead of direct coupling to notifications/analytics, (5) plugin-style self-registration instead of a hand-maintained registry file, (6) reconfirmed Phase 1 scope. Each is its own section below (§4, §7, §8, §9, §10).

---

## 1. Vision

Every correction in HMS — whether it's undoing a room shift, reversing a payment, or transferring money between tenants — is an instance of the same business object: a **Correction Case**. A Correction Case is not a log row; it is a first-class, stateful entity with its own lifecycle, timeline, audit history, and execution record. It is designed to be **the primary artifact support staff and owners look at to answer "what happened to this payment/tenant/room, and what did we do about it"** — replacing ad-hoc log-grepping across the five overlapping audit tables the initial audit found (`activity_logs`, `actionLog`, `systemEventLog`, `admin_financial_audit_log`, domain-specific logs).

The platform does not reimplement domain logic, and — per refinement 1 — it does not accumulate domain logic either. It is purely an orchestration and case-tracking layer that calls into existing services (`settlement-engine.ts`, `financial-correction-gateway.ts`, `room-allocation-service.ts`, `obligation-engine.ts`, etc.) — consistent with the "compose, don't reimplement" precedent (`financial-read-model-service.ts`) that governs the rest of this codebase.

---

## 2. Core abstraction: Correction Case

```
correction_cases                              -- supersedes recoverable_operations (Tier 1)
  id                                             and payment_corrections (Tier 2) as ONE table
  hostel_id            Uuid   -- required, never optional
  domain               CorrectionDomain   -- PAYMENTS | ROOMS | AGREEMENTS | EXPENSES |
                                              ADMISSIONS | RENEWALS | SETTINGS | DOCUMENTS |
                                              KYC | RESERVATIONS  (open for future domains)
  case_type            String  -- e.g. "PAYMENT_REVERSAL", "ROOM_SHIFT_UNDO", "PAYMENT_TRANSFER"
  tier                 RecoveryTier   -- OPERATIONAL_UNDO | FINANCIAL_CORRECTION | ADMINISTRATIVE_REVERSAL
  status               CaseStatus    -- DRAFT | PREVIEW | VALIDATED | EXECUTING | COMPLETED | FAILED | EXPIRED | CANCELLED
  entity_refs          Json[]  -- [{type, id}] — every entity this case touches or will touch
  reason               String
  actor_id             Uuid
  actor_role           String
  before_snapshot      Json    -- captured at DRAFT, pre-any-mutation
  preview_impact       Json?   -- last computed ImpactReport (see §5)
  execution_result     Json?   -- ids of rows written, success/failure detail
  case_detail          Json    -- handler-specific payload (e.g. {fromTenantId, toTenantId} for a transfer),
                                   validated by the handler's own schema, not a fixed column set
  idempotency_key      String  @unique  -- client- or handler-generated; see §8
  depends_on           Uuid[]  -- other correction_cases.id this case cannot execute before; see §7
  undo_expires_at      DateTime?  -- meaningful only for OPERATIONAL_UNDO cases
  correlation_id       Uuid?      -- best-effort link back to activity_logs
  created_at, updated_at

correction_case_events                        -- supersedes recovery_events + payment_correction_events,
  id                                              append-only, ONE unified timeline
  correction_case_id   Uuid  -- FK
  event_type           String  -- CREATED, PREVIEWED, VALIDATED, EXECUTION_STARTED,
                                   EXECUTION_SUCCEEDED, EXECUTION_FAILED, EXPIRED, CANCELLED,
                                   BLOCKED_ON_DEPENDENCY, RETRIED
  actor_id, actor_role
  reason               String?
  snapshot             Json?
  ip_address, user_agent
  created_at
```

**Why one table, not one-table-per-domain**: a `case_detail` JSON payload (validated per-`case_type` by the owning handler, not the platform) keeps the platform genuinely pluggable — a new domain adds a new `case_type` + handler + JSON shape, never a schema migration to the core table. This mirrors the existing `change_requests.before/diff` JSON-snapshot convention and `admin_financial_audit_log.before_state/after_state`, both already established patterns in this codebase.

**Migration note relative to the prior two docs**: the separate `recoverable_operations`/`payment_corrections` schemas proposed earlier are replaced by this single `correction_cases` table before either is built — since neither has shipped, there is no backward-compatibility cost to unifying now rather than after.

---

## 3. Lifecycle state machine

```
                 handler.createCase()
                        │
                        ▼
                     DRAFT ───────────────(owner abandons)────────▶ CANCELLED
                        │
                    handler.computeImpact()   [Validation & Preview Engine]
                        ▼
                    PREVIEW ─────────(window expiry, OPERATIONAL_UNDO only)──▶ EXPIRED
                        │
                    handler.validate()   [domain policy + window + row-locks + dependency check]
                        ▼
                   VALIDATED  ──(unmet dependency)──▶ stays VALIDATED, blocked, re-checked when
                        │                              the dependency case completes (see §7)
                    handler.execute(tx, case, actor)   -- one $transaction, idempotent (see §8)
                        ▼
                   EXECUTING
                    ┌───┴───┐
                    ▼       ▼
               COMPLETED   FAILED  ──(safe retry, see §8)──▶ EXECUTING
```

- **DRAFT → CANCELLED** and **PREVIEW/VALIDATED → EXPIRED** are the only non-terminal exits; `COMPLETED` is the only true terminal state — a case is never reopened once completed (matches the "no redo" stance already established in both prior docs). `FAILED` is retry-eligible, not terminal, per §8.
- **Concurrency guard**: only one case may be `EXECUTING` against a given entity at a time — enforced by row-locking the entity (not just the case row) inside `validate()`, using the same `FOR UPDATE` discipline every domain service in this codebase already uses.
- **Tier 3 (Administrative Reversal) folds into this same machine**: its `validate()` step delegates to the existing `change_requests` governed-approval pipeline as a sub-step before a case can reach `VALIDATED` — Tier 3 is not a separate mechanism, it's a tier value plus a stricter domain policy (see §4).

---

## 4. Platform vs. domain policy separation (refinement 1)

**Rule: the platform core (`correction-registry.ts`, `recovery-service.ts`, `correction-preview-engine.ts`, the Prisma models) contains zero business rules about specific entities.** It only knows how to move a case through DRAFT→PREVIEW→VALIDATED→EXECUTING→COMPLETED/FAILED, row-lock, check dependencies, and dispatch to whatever handler owns the `case_type`. Every question of the shape "is this specific action allowed right now" — *"Can a signed agreement be reversed?"*, *"Can payments be transferred after month-end closing?"*, *"Is this hostel's undo window 15 or 30 minutes?"* — is answered by a **domain policy object**, never by platform code.

```ts
interface CorrectionPolicy<TDetail = unknown> {
  canPreview(ctx: OperationContext): Promise<boolean>;
  canExecute(kase: CorrectionCase<TDetail>): Promise<PolicyResult>;  // { allowed: boolean; reason?: string }
  windowFor?(kase: CorrectionCase<TDetail>): Date;  // OPERATIONAL_UNDO only — per-hostel window lookup lives HERE, not in the platform
}

interface CorrectionHandler<TDetail = unknown> {
  caseType: string;
  domain: CorrectionDomain;
  tier: RecoveryTier;
  policy: CorrectionPolicy<TDetail>;   // <-- all business rules live behind this seam

  createCase(ctx: OperationContext): Promise<CorrectionCase<TDetail>>;
  computeImpact(kase: CorrectionCase<TDetail>): Promise<ImpactReport>;   // read-only, never writes
  execute(tx: PrismaTx, kase: CorrectionCase<TDetail>, actor: Actor): Promise<ExecutionResult>;
  affectedEntities(kase: CorrectionCase<TDetail>): EntityRef[];
}
```

`recovery-service.ts`'s generic `validate(caseId)` step is now mechanical: load the case, resolve the handler, call `handler.policy.canExecute(kase)`, row-lock `affectedEntities()`, check `depends_on` (§7) — and reject if the policy says no, without ever encoding *why* itself. A reviewer can audit "did we get the agreement-signed rule right?" by reading one small policy file, never by reading platform code — and hostel-specific/tenant-specific rule creep has exactly one place it's allowed to live.

`ImpactReport` (produced by `computeImpact()`) is unchanged from the first draft:

```ts
interface ImpactReport {
  balanceChanges: { entityType: string; entityId: string; before: unknown; after: unknown }[];
  obligationChanges: { obligationId: string; before: unknown; after: unknown }[];
  ledgerEntries: { direction: "DEBIT" | "CREDIT"; reason: string; amount: number; tenantId: string }[];
  affectedReports: string[];
  notifications: { channel: string; template: string; recipient: string }[];
  warnings: string[];
}
```

---

## 5. Validation & Preview Engine

One shared service, `correction-preview-engine.ts`, domain-agnostic, unchanged in shape from the first draft:

```
previewEngine.preview(caseId)
  → loads the case, resolves its handler from the registry
  → calls handler.policy.canPreview(ctx)  [cheap eligibility check before spending effort on impact calc]
  → calls handler.computeImpact(case)
  → stores the result on case.preview_impact, transitions DRAFT → PREVIEW
  → returns the ImpactReport for the UI
```

This is the single place "business impact" gets computed for *any* correction type — a room-shift undo and a payment transfer render through the same UI component, just with different `ImpactReport` content.

---

## 6. Correction Handler interface — full shape

Combining §4's policy seam with the lifecycle methods:

```ts
interface CorrectionHandler<TDetail = unknown> {
  caseType: string;
  domain: CorrectionDomain;
  tier: RecoveryTier;
  policy: CorrectionPolicy<TDetail>;

  createCase(ctx: OperationContext): Promise<CorrectionCase<TDetail>>;
  computeImpact(kase: CorrectionCase<TDetail>): Promise<ImpactReport>;
  execute(tx: PrismaTx, kase: CorrectionCase<TDetail>, actor: Actor): Promise<ExecutionResult>;
  affectedEntities(kase: CorrectionCase<TDetail>): EntityRef[];
}
```

Handlers call into existing domain services to fill `ImpactReport` and to perform `execute()` — e.g. Transfer Payment's `computeImpact()` calls `financial-read-model-service.ts` + a dry-run of `settlement-engine.ts`'s planner; its `execute()` calls the extended `financial-correction-gateway.ts` + `settlement-engine.executePlanInTx`. No handler forks or reimplements these.

---

## 7. Recovery dependencies (refinement 2)

Some corrections cannot execute independently — e.g. reversing a Tenant Admission may require reversing its Room Allocation first. `correction_cases.depends_on: Uuid[]` (added in §2) makes this explicit and queryable, instead of handlers silently reaching into each other.

**Rule**: a case cannot leave `VALIDATED` and enter `EXECUTING` while any id in `depends_on` refers to a case that is not yet `COMPLETED`. `recovery-service.ts`'s execution step checks this mechanically (platform-level — dependency *ordering* is a scheduling concern, not a business rule, so it stays in the platform per §4's boundary; *which* dependencies a case has is decided by the handler's `createCase()`, which is domain-specific).

```
Owner undoes a Tenant Admission
        │
        ▼
tenantAdmissionUndoHandler.createCase(ctx)
        │  discovers the admission also created a Room Allocation
        │  creates a SECOND case (roomAllocationUndoHandler) first,
        │  sets the admission-undo case's depends_on = [roomAllocationCase.id]
        ▼
Both cases go through PREVIEW/VALIDATED independently (owner sees both in the
Recovery Center, correctly ordered)
        │
        ▼
recovery-service.ts refuses to execute the admission-undo case until the
room-allocation-undo case reaches COMPLETED; if the dependency case is
CANCELLED or EXPIRED instead, the dependent case transitions to FAILED
with reason "dependency not satisfied" rather than executing partially
```

This generalizes cleanly: any handler whose `createCase()` discovers a prerequisite simply creates (or references) another case and lists it in `depends_on` — the platform never needs to know *why* one domain depends on another, only that it must wait.

---

## 8. Idempotency and safe retry (refinement 3)

Every `correction_cases` row has a unique `idempotency_key` (§2). Two failure modes must never produce duplicate financial/state effects:

1. **Client double-submit** (owner double-clicks "Confirm"): the API layer generates the idempotency key from `(hostelId, caseType, case_detail hash, actor_id)` if the client doesn't supply one, and `POST /corrections` upserts on that key — a duplicate request returns the existing case, it never creates a second one.
2. **Partial execution failure** (the process crashes mid-`execute()`, or a downstream call times out after its write committed): `execute()` must be safe to call twice for the same case. Two concrete mechanisms, reusing what already exists in the schema rather than inventing a new one:
   - The `payments` table already has `idempotency_key String? @unique` (confirmed in the schema audit). Every reversal/forward payment row a handler's `execute()` creates uses a **deterministic** idempotency key derived from the case, e.g. `` `correction:${caseId}:reversal` `` / `` `correction:${caseId}:forward:${n}` ``. A retried `execute()` that tries to re-insert the same row hits the unique constraint and the handler treats that as "already written, move on" rather than an error.
   - Before re-running `execute()` on a `FAILED` case, `recovery-service.ts` re-reads `execution_result` (§2) to see which of the handler's expected writes already succeeded, and passes that to the handler so it only performs the remaining ones — `execute()` is written as a sequence of idempotent steps, not one all-or-nothing block, wherever the underlying writes can't share one `$transaction` (e.g. a Transfer's reversal-then-forward across two obligations already needs two lock scopes in the existing `settlement-engine.ts` pattern).
3. A case that has retried past a configurable attempt limit moves to `FAILED` permanently and surfaces in the Recovery Center as "Failed — needs manual review," never silently retried forever.

---

## 9. Event-driven integration (refinement 4)

The platform never calls a notification service, analytics pipeline, or the WhatsApp assistant directly. Every case transition — especially `COMPLETED` — publishes a domain event through the **existing** `eventSystem` (`lib/events/index.ts`, the same `EventEmitter` every other domain service already uses):

```
recovery-service.ts, on any status transition:
  eventSystem.trigger("correction_case_transitioned", {
    caseId, domain, caseType, tier, fromStatus, toStatus, actorId, hostelId,
  })

  // COMPLETED specifically also triggers a domain-flavored event for
  // existing listeners that already expect it, e.g.:
  eventSystem.trigger("payment_corrected", { caseId, paymentIds, correctionType })
```

Consumers (Activity Log listener, WhatsApp correction-notice sender, future analytics/AI-assistant subscribers) each subscribe independently — the platform has no import, no direct call, no knowledge of any of them existing. This is the same decoupling `lib/events/index.ts` already provides for `payment_recorded`/`expense_created`/etc.; the platform is simply one more, consistent, producer on that same bus.

---

## 10. Plugin-based self-registration (refinement 5)

Instead of a hand-maintained `correction-registry.ts` that every new domain must edit, the registry is a singleton with a `register()` method, and each domain module calls it as a side effect of its own initialization — mirroring how `lib/events/index.ts` already wires ~20 event handlers without one giant switch statement:

```ts
// correction-registry.ts — platform code, never edited when a domain is added
class CorrectionRegistry {
  private handlers = new Map<string, CorrectionHandler>();
  register(handler: CorrectionHandler) {
    if (this.handlers.has(handler.caseType)) throw new Error(`duplicate case_type: ${handler.caseType}`);
    this.handlers.set(handler.caseType, handler);
  }
  resolve(caseType: string): CorrectionHandler { /* throws if missing */ }
}
export const correctionRegistry = new CorrectionRegistry();
```

```ts
// src/services/payments/corrections/payment-reversal-handler.ts — owned entirely by the payments domain
export const paymentReversalHandler: CorrectionHandler<PaymentReversalDetail> = { /* ... */ };
correctionRegistry.register(paymentReversalHandler);
```

```ts
// src/services/recovery/bootstrap.ts — imported once at app startup purely for side effects
import "../payments/corrections/payment-reversal-handler";
import "../payments/corrections/payment-transfer-handler";
import "../payments/corrections/reference-edit-handler";
// Phase 2+: import "../rooms/corrections/room-shift-undo-handler"; etc.
```

Adding a new domain later means: write the handler file, add one import line to `bootstrap.ts`. No platform file changes, no merge conflicts in a shared registry map.

---

## 11. Recovery Center

One owner-facing surface, not per-domain screens:

```
/owner/recovery-center
  ├── Case list — filterable by domain, tier, status
  │     [Undo Available · 12m left]  Room Shift — Tenant X            → Room 204 → Room 108
  │     [Preview Ready]              Payment Transfer — ₹5,000        Tenant A → Tenant B
  │     [Completed]                  Expense Voided — Plumbing repair
  │     [Failed — retry available]   Payment Reversal
  │     [Blocked on dependency]      Tenant Admission Undo → waiting on Room Allocation Undo
  └── Case detail
        Timeline (correction_case_events, unified — same component for every domain)
        Before / After snapshot
        Reason, Performed By, Timestamp
        Dependency chain (if any)
        Original ↔ Correction linkage
```

This is also the debugging artifact the user asked for: a support engineer investigating "what happened to this tenant's July payment" opens one case, not five overlapping log tables.

---

## 12. What does NOT change from the prior two docs

- All domain audit findings stand: payments/`rent_obligations` immutability, the `payment_groups` mutability gap, the invariant-regex bug (`payment.` vs `payments.`), the two duplicate `ActivityService` classes, the existing WhatsApp "UNDO EXPENSE" hard-delete needing migration, `LEDGER_CORRECTION` being declared-but-unused, and `financial-correction-gateway.ts`'s `ADJUSTMENT`/`REALLOCATION`/`REFUND` stubs being the literal precedent for this whole effort.
- Payments are still never mutated. Corrections are still expressed as new reversal/forward payment rows planned through the existing `settlement-engine.ts` — the platform does not introduce a second settlement path.
- The three-tier categorization (Operational Undo / Financial Correction / Administrative Reversal) still holds — it's now a `tier` column on one object instead of three separate systems.
- Everything in the Tier 1 and Tier 2 docs' "Edge Cases" and "Risks" sections still applies verbatim; they become edge cases/risks of specific *handlers and policies*, not of a whole separate system each.

---

## 13. Phased implementation plan (refinement 6 — Phase 1 reconfirmed, intentionally small)

**Phase 1 (build now, on approval):**
- Core platform: `correction_cases` + `correction_case_events` tables, the five-state lifecycle, the `CorrectionHandler`/`CorrectionPolicy` interfaces, the self-registering registry, the Validation & Preview Engine, dependency-check + idempotent-retry plumbing, event-bus publishing.
- Three handlers (payments domain only): **Reverse Payment**, **Transfer Payment**, **Edit Reference/Receipt**.
- **Correction Timeline** UI component and **Recovery Center** (list + detail), scoped to whatever handlers exist.
- Prerequisite fix carried over from the Tier 2 doc: correct the `architectural-invariants-check.ts` regex bug before relying on payment immutability as a safety guarantee.

Everything below is designed now, per this doc, and deliberately **not** built in Phase 1:

**Phase 2:**
- Handlers: **Split Payment**, **Merge Payments**, **Reallocate Payment**.
- Formalize **Administrative Reversal** policies (`canExecute()` → `change_requests` approval sub-step) for completed Move-Out, activated Renewal, post-activation KYC.
- **Bulk corrections** — batch-executing multiple cases under one parent case, built on the `depends_on` mechanism from §7.
- Tier 1's Operational Undo handlers (Room Shift, Admission, Expense, Settings, Document, Reservation) registered via §10's self-registration pattern.

**Phase 3:**
- **Analytics** — correction frequency/pattern dashboards composed from `correction_cases`, following "compose, don't reimplement."
- **AI assistance** — anomaly-triggered correction suggestions, or migrating the existing WhatsApp owner assistant's hard-delete "UNDO EXPENSE" feature onto this platform via the event bus (§9) instead of its own ad-hoc logic.

---

## 14. Risks specific to platform-level generalization

1. **Over-abstraction risk**: mitigated by §4's policy split — low-risk case types (Edit Reference) can have a near-trivial policy (`canExecute` always `{allowed: true}`) and transition DRAFT→PREVIEW→VALIDATED→EXECUTING synchronously in one API call; the state machine doesn't force separate round-trips, it just guarantees the same recorded transitions.
2. **`case_detail`/`case_detail` JSON validation drift**: mitigate with a mandatory Zod schema per `case_type`, validated on both write and read (open question 5 below still decides where that schema registry lives).
3. **Dependency cycles**: two cases whose `depends_on` reference each other would deadlock the executor. Mitigation: `recovery-service.ts` validates the dependency graph is acyclic before allowing a case into `VALIDATED`.
4. **Idempotency key collisions across domains**: mitigated by namespacing every generated key with `correction:{caseId}:...` (§8) — collisions are only possible within one case's own retries, which is the intended behavior.
5. **Everything else** — the financial-correctness, transaction-safety, and settlement-engine-reuse risks are unchanged from the Tier 2 doc's Risk Assessment and still apply to the Phase 1 handlers built on this platform.

---

## Open questions carried forward (plus two new ones)

1–4. All four open questions from the Financial Corrections doc still stand (obligation balance representation, `payment_groups` lockdown, Tier 3 procedural requirements, rollout order) — unchanged by this reorganization.
5. Should `case_detail`/policy validation schemas live centrally or be fully owned by each handler module with only a runtime-registered validator?
6. **New**: what's the retry attempt cap and backoff policy for `FAILED` cases (§8) — is retry owner-triggered only (a "Retry" button in the Recovery Center) or should anything auto-retry, and if so on what schedule (would need a cron sweep, matching the existing 13-cron-job pattern)?
7. **New**: for cross-domain dependencies (§7), who decides dependency direction when two domains could plausibly depend on each other (e.g. is Room Allocation Undo always a prerequisite of Admission Undo, or could a future case make it the reverse)? Recommend: the handler that owns the *earlier* action in the original operation's transaction order always owns the dependency declaration, to keep it deterministic — confirm this convention before Phase 2 adds more handlers.
