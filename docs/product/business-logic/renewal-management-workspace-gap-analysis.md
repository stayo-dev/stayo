
# Renewal Management Workspace — Phase 1 Gap Analysis

Status: **AUDIT ONLY — no code written.** This is the deliverable for "Phase 1: Audit current implementation. Produce a gap analysis. Do not code yet." Phase 2 (Renewal Case architecture design) has not started and should not start until the open questions in §7 are answered.

Related reading: `docs/superpowers/plans/2026-07-19-agreement-renewal-bugfixes.md` (the P0/P1 bug-fix pass this audit builds on — read that first, since several findings below reference specific fixes it just shipped), `docs/business-logic/operation-recovery-undo-system-proposal.md` (the format/rigor precedent this document follows), `docs/obsidian/Business-Rules.md`, `docs/obsidian/Decisions.md` ADR-012/013/014.

## 0. Relationship to the just-completed bug-fix pass

Seven verified P0/P1 bugs in the renewal subsystem were fixed immediately before this audit (commits `6b3c6cc4`…`17321bfc`, all with regression tests, full suite green at 577/577). That work is directly relevant to three pillars below:

- The **P0 bug #1/#2/#3/#4 fixes** (cron vs. manual-signing parity, row-locked chain integrity) are exactly what the vision's **"Activation Engine"** pillar (§6) asks for — behavior now matches between the two paths, but the *code* is still duplicated across two files. That deferred "P2: eliminate duplicated activation logic" task from the bug-fix plan **is** Phase 6/7 of this vision, not a separate piece of work.
- **ADR-013/014** (bug #6/#7 fixes) already partially deliver the vision's **"Notification Engine"** idempotency and successor-suppression requirements.
- Auditing the flow afterward (a manual walkthrough done in this same session) surfaced one more parity gap not in the original 7: manual signing never syncs `tenants.monthly_rent/security_deposit/maintenance_charge`, unlike cron activation. That's flagged again in §1.7 since it's squarely inside the Activation Engine's scope.

---

## 1. Pillar-by-pillar audit

### 1.1 Renewal Case / unified lifecycle

**Vision:** One `RenewalCase` orchestration entity with a canonical state machine (`ELIGIBLE → PREPARING → READY_TO_SEND → WAITING_FOR_TENANT → NEGOTIATING → ACCEPTED → AWAITING_SIGNING → READY_FOR_ACTIVATION → ACTIVE → COMPLETED`, plus `DECLINED/WITHDRAWN/FAILED/EXPIRED`).

**Current state:** No such entity or state machine exists. What exists instead is **three independent, overlapping state signals** that a caller has to manually reconcile:

| Signal | Values | Owner |
|---|---|---|
| `Agreement.status` | `DRAFT, SIGNED, EXPIRING_SOON, AGREEMENT_EXPIRED, RENEWED, TERMINATED, VOID` | `prisma/schema.prisma:2011` |
| `RenewalOffer.status` | `DRAFT, SENT, ACCEPTED, DECLINED, EXPIRED, REVISED, SUPERSEDED` | `prisma/schema.prisma:2021` |
| `RenewalDecisionService.evaluateAgreement().decision_state` | `CURRENT, EXPIRING_SOON, RENEWAL_AVAILABLE, RENEWAL_DECISION_PENDING, RENEWAL_OVERDUE_CRITICAL, MOVE_OUT_IN_PROGRESS, RENEWAL_BLOCKED_MOVED_OUT, EXPIRED_AND_RENT_OVERDUE` | `renewal-decision-service.ts:6-17` (computed, not stored) |
| Owner-pipeline-only 4th signal | `computePipelineStatus()`: `SENT, NEGOTIATING, ACCEPTED, AWAITING_PAYMENT, READY_FOR_SIGNATURE, DECLINED, DRAFT` | `renewal-offer-service.ts:840-856` (also computed, owner-queue-only, never persisted, and **not the same enum** as `decision_state` despite overlapping names) |

None of these four maps 1:1 to the vision's 12-state lifecycle. Mapping the vision's states onto today's data (illustrative, not exhaustive):

```
ELIGIBLE            → decision_state = RENEWAL_AVAILABLE (derived)
PREPARING           → RenewalOffer.status = DRAFT
READY_TO_SEND        → RenewalOffer.status = DRAFT (no distinct signal — same as PREPARING today)
WAITING_FOR_TENANT   → RenewalOffer.status = SENT, no RenewalDecision row yet
NEGOTIATING          → pipeline_status = NEGOTIATING (SENT + a decision:"SENT" row exists — see §3.2 for why this is a naming collision)
ACCEPTED             → RenewalOffer.status = ACCEPTED, Agreement(successor).status = DRAFT
AWAITING_SIGNING     → pipeline_status = AWAITING_PAYMENT | READY_FOR_SIGNATURE (deposit-obligation-dependent, not a first-class state)
READY_FOR_ACTIVATION → no signal at all — nothing distinguishes "signed, waiting for effective date" from "signed" in general, since signing and activation are the same status transition (DRAFT→SIGNED) on both paths
ACTIVE               → Agreement(successor).status = SIGNED and Agreement(predecessor).status = RENEWED
COMPLETED            → no signal — "renewal fully done" isn't tracked as distinct from "ACTIVE"
DECLINED             → RenewalOffer.status = DECLINED
WITHDRAWN            → no signal — no "owner withdrew the offer before tenant acted" concept exists (owner can only revise-and-supersede or let it expire)
FAILED               → no signal — an activation transaction that throws (chain race, deposit unpaid) just leaves the draft sitting in DRAFT with a RENEWAL_ACTIVATION_BLOCKED eventLog row; nothing marks the case itself as failed
EXPIRED              → RenewalOffer.status = EXPIRED (via expireStaleOffers, now actually wired — bug #5 fix)
```

**Gap:** Real. `READY_FOR_ACTIVATION`, `COMPLETED`, `WITHDRAWN`, and `FAILED` have no equivalent today at all. `NEGOTIATING` vs `WAITING_FOR_TENANT`, and `AWAITING_SIGNING` vs `ACCEPTED`, are currently indistinguishable without recomputing derived state.

**Reuse verdict — the key strategic question for Phase 2:** Does closing this gap require a new **table**, or a new **read-model service** that composes existing tables the way `RenewalDecisionService.evaluateAgreement()` already does for 8 of the 12 target states? The repo has an explicit, documented precedent for this exact choice (`docs/obsidian/Business-Rules.md` §"The Financial Read Model — compose, don't reimplement", and CLAUDE.md's own instruction: *"The fix pattern is a read model that composes existing services rather than recalculating"*). Given `evaluateAgreement()` already gets 8/12 states right by composing `Agreement` + `RenewalOffer` + tenant/move-out data with zero storage, my recommendation for Phase 2 to evaluate concretely: **a `RenewalCaseReadModel` computed service, not a new physical `renewal_cases` table**, with the sole exception of persisting the 3-4 states that genuinely have no derivable signal today (`WITHDRAWN`, `FAILED`, `COMPLETED`, arguably `READY_FOR_ACTIVATION`) — and even those might be addable as new/reused status values rather than a whole new table. This is a judgment call for Phase 2, not decided here, but the audit strongly suggests "compose" over "replace," per the vision's own First Principle.

### 1.2 Owner Renewal Workspace

**Vision:** One workspace with 12 named queues (Eligible, Drafts, Ready To Send, Waiting For Tenant, Negotiation, Accepted, Awaiting Signing, Ready For Activation, Scheduled, Completed, Expired, Failed) plus bulk generate/send/withdraw/extend/activate/export.

**Current state:** `apps/frontend/src/app/components/views/RenewalQueueView.tsx` — one 1,388-line component, two tabs (`'expiring' | 'offers'`), backed by:
- `GET /api/agreements/renewals` (owner queue, `filter: expiring|expired|overdue|move_out|all` — 5 filters, from `RenewalDecisionService.getOwnerRenewalQueue`)
- `GET /api/agreements/renewal-offers` (offer pipeline list, filterable by `offersFilter` client-side against `pipeline_status`)

Bulk support that **already exists**: bulk-generate (`generateBulkOffers`, 3 strategies: FLAT/PERCENTAGE/ROOM_CATEGORY), bulk-send (`sendBulkOffers`). Bulk support that **doesn't exist**: withdraw, extend, activate (there is no manual "activate now" endpoint at all — activation only happens via signing or cron effective-date), export.

**Gap:** Moderate, not severe. The two data sources (`getOwnerRenewalQueue` 5-filter + offer-pipeline 7-status) already cover roughly 9 of the vision's 12 queues if merged into one taxonomy; genuinely missing queues are `Ready For Activation`, `Scheduled` (both need the §1.1 signal gap closed first), and `Failed`. The UI itself is a single monolithic component, not a queue-per-page workspace — a real but lower-risk-than-backend restructuring task, gated on §1.1's lifecycle signal existing first (can't build a "Ready For Activation" queue tab before that state is computable).

### 1.3 Renewal Details Page (single-renewal workspace)

**Vision:** One page per renewal: Overview, Agreement Comparison, Offer History, Financial Validation, Timeline, Discussion, Documents, Notifications, Audit Trail, History.

**Current state:** No dedicated single-renewal detail page exists in `apps/frontend` at all — `RenewalQueueView.tsx` is list/queue-only; drilling into one tenant's renewal opens generic tenant-profile modals, not a renewal-specific view. Backend data for most sections already exists piecemeal (offer history via `revised_from_offer_id` walk in `getActiveOfferForTenant`; agreement history via `RenewalDecisionService.getAgreementHistory`), but nothing composes them into one response shape.

**Gap:** Full UI gap; partial backend gap (mainly Timeline and Documents sections — see §1.5, §1.9).

### 1.4 Agreement Comparison

**Vision:** Side-by-side diff (rent, deposit, maintenance, duration, room, bed, due date, rules) with added/removed/changed/unchanged highlighting.

**Current state:** No comparison view exists for renewals specifically, but a **directly reusable general-purpose diff engine already exists**: `src/services/change-management/diff-engine.ts` — generates structured `FieldDiff[]` (old/new value, category, financial-impact flag) from a `field-classification.ts` taxonomy, currently used for the change-request/undo-adjacent subsystem (see the Recovery/Undo proposal doc, §0). Two agreements' `content_snapshot`/`contract_*` fields are exactly the shape this engine already diffs for tenant-profile fields.

**Gap:** Low. This is close to a pure reuse — extending `field-classification.ts` with an `Agreement`/renewal-terms field set and feeding two agreement snapshots through the existing `diff-engine.ts` is materially smaller than building a new comparison engine from scratch.

### 1.5 Offer Versioning

**Vision:** Never overwrite; every revision is a new immutable version (V1→V2→V3) with snapshot, terms, reason, created-by, created-at.

**Current state:** **Already fully implemented and matches the vision closely.** `reviseOffer()` (`renewal-offer-service.ts:651-704`) never mutates the old row — it marks the old offer `SUPERSEDED` and creates a new row with `revised_from_offer_id` pointing back (self-relation `OfferRevision` in schema). `getActiveOfferForTenant()` already walks this chain to build a `revisions[]` array. Fields captured: full proposed-terms snapshot, `owner_notes` (closest existing thing to "reason" — free text, not a structured/required reason field), `created_at`. **Missing:** `created_by` (no actor field on `RenewalOffer` — `owner_id` exists but is the *offer's* owner, not necessarily "who clicked revise" if a hostel ever has multiple owner-role users; not a real gap today since the system is single-owner-per-hostel, but worth flagging for correctness under future multi-user-per-hostel), and no PDF snapshot per version (PDFs are only generated at *signing* time, not per offer revision — see §1.9).

**Gap:** Low. This pillar is essentially done; a Phase 2 task here would be additive (add `created_by`, make `owner_notes` do double duty as the reason field or add a dedicated one), not a rebuild.

### 1.6 Renewal Timeline

**Status: closed 2026-07-20.** See [[Decisions]] ADR-016. `RenewalTimelineEvent` (new table) + `renewal-timeline-service.ts` now give every renewal write path a persisted, queryable, actor-aware event, written inside the same transaction as the mutation it describes. Not fully complete against the original vision: `OFFER_VIEWED` is not implemented (no write-on-GET tracking added — deliberately out of scope for this pass, since it wasn't part of the previewed instrumentation list and needs its own idempotency/debounce design), and `discussOffer()`'s `RenewalDecision.decision: "SENT"` enum-overload (finding #3 below) was not fixed — `OFFER_DISCUSSED` is now recorded correctly on the *new* `RenewalTimelineEvent` table, but the older `RenewalDecision` row it writes alongside is untouched. `createRenewalDraft`'s `DRAFT_CREATED` and cron's `RENEWAL_ACTIVATION_BLOCKED` events are recorded with actor `SYSTEM` since neither call site currently receives caller-identity through its API (see ADR-016 consequences).

**Vision:** Immutable, queryable timeline (Offer Created → Sent → Viewed → Discussion Requested → Revised → Sent Again → Accepted → Signed → Activated → Completed), each event with timestamp/actor/source/reason/related-IDs.

**Original finding (now resolved for all but Viewed):** Two different mechanisms existed and neither was a real timeline:

1. **Owner-side actions produce zero persisted, queryable audit trail.** Every owner action in `renewal-offer-service.ts` (`generateOffer`, `sendOffer`, `sendBulkOffers`, `reviseOffer`) logs only via `logger.info(...)`/`logger.error(...)` (`getLogger("renewal-offer")`, apps/backend/lib/logger) — application/console log lines, not a database table. Confirmed by grep: **zero** `eventLog.log(...)` calls anywhere in `renewal-offer-service.ts`, despite `eventLog` (writing to `systemEventLog`, the same table `agreement-lifecycle-service.ts` uses for `RENEWAL_ACTIVATION_BLOCKED`/`AGREEMENT_RENEWED`) being available and used elsewhere in this exact subsystem. Once log retention rotates, "Offer Created"/"Offer Sent"/"Offer Revised" events are gone forever.
2. **Tenant-side actions are partially captured** in `RenewalDecision` (`offer_id, tenant_id, decision: RenewalOfferStatus, reason, created_at`) — but only for `acceptOffer`/`declineOffer`/`discussOffer`. This table has **no actor-role field** (always implicitly "tenant," can't represent "owner marked negotiating on tenant's behalf" or similar), and **no `VIEWED` event at all** — there is no "tenant opened the offer" tracking anywhere in the codebase (`getActiveOfferForTenant`/`GET /api/tenant/renewal-offer` is a pure read with no side effect).
3. `discussOffer()` writes `decision: "SENT"` to represent "tenant requested discussion" — reusing the `RenewalOfferStatus.SENT` enum value for a semantically unrelated meaning (see §3.2, a real footgun for anyone querying this table expecting `SENT` to mean "offer was sent").

**Gap:** High/full. This is the one pillar of the whole vision that genuinely needs new persisted schema — there is no existing table to compose this from, unlike almost everything else in this audit. A new lightweight, append-only `renewal_timeline_events` table (mirroring the shape of `recovery_events` from the Undo proposal, or `change_request_events`) is the closest existing precedent to follow, not a novel pattern for this codebase.

### 1.7 Activation Engine (eliminate cron/manual divergence)

**Status: closed 2026-07-20.** See [[Decisions]] ADR-015. `renewal-activation-engine.ts`'s `activateRenewal()` is now the single shared implementation both cron and manual signing call — including the `tenants.monthly_rent/security_deposit/maintenance_charge` sync gap flagged below, which is now fixed (manual signing performs it too). Signature/rules resolution correctly remains caller-specific (cron copies the predecessor's signature forward; manual signing captures a fresh one), per Business-Rules §13 — that's a deliberate behavioral difference, not duplication.

**Vision:** One shared activation pipeline both cron and manual signing call.

**Original finding (now resolved):** cron (`activateScheduledRenewals`) and manual signing (`signRenewalAgreement`) behaved identically (same safeguards, same locking pattern, same rent-schedule generation call) but were two separate, hand-duplicated implementations in two different files. One divergence survived the original bug-fix pass and was caught only during the post-fix flow audit: manual signing never wrote `tenants.monthly_rent/security_deposit/maintenance_charge`; cron activation did. Anything reading `tenants.monthly_rent` directly instead of via the active `Agreement.contract_rent` (confirmed consumers: `app/api/tenants/route.ts`, `app/api/auth/me/route.ts`, `rent-generation-service.ts`, `financial-service.ts`, and ~15 more) showed stale rent after a manually-signed renewal — closed by this consolidation.

### 1.8 Renewal Readiness Engine

**Status: closed 2026-07-20.** See [[Decisions]] ADR-015. `renewal-readiness-engine.ts` is now the single shared implementation — individual check functions plus `evaluateActivationReadiness`/`evaluateCreationReadiness` orchestrators, used by all three original call sites (cron, manual signing, manual draft creation). Each orchestrator returns *all* failing checks, not just the first, directly setting up the "explain why blocked" capability §1.13 (AI-readiness) flagged as needed.

**Vision:** One centralized engine validating Financial/Agreement/Room/Lifecycle/Move-Out/Occupancy/Deposit/Outstanding-Rent/Credits/Pending-Requests, returning `READY | BLOCKED | WARNING` with reasons; every activation path reuses it.

**Original finding (now resolved):** validation logic was duplicated across three call sites, each re-implementing overlapping checks rather than sharing one function — all three called the shared `isCurrentAgreementStatus()`/`assertAgreementLifecycleComplete()` helpers, but the *orchestration* (which checks to run, in what order, what to do on failure) was copy-pasted three times with subtle differences.

**Gap:** Real and directly actionable — this is the natural next refactor after the bug-fix pass, and it's exactly what "Phase 6: Refactor into a shared Activation Engine" already targets. A `RenewalReadinessEngine.evaluate(agreementOrDraft, checkSet)` that all three call sites invoke (each requesting the subset of checks relevant to its stage) would collapse this to one implementation. **Constraint to respect:** the vision's "Never duplicate financial logic" principle is already honored today via `FinancialLifecycleService.activatePayableObligations` as the sole choke point — a Readiness Engine must call into that, not reimplement deposit-checking logic itself.

### 1.9 Financial Continuity

**Vision:** No duplicated money, no orphan obligations, ledger reconciliation, future-credit preservation, deposit correctness, historical agreement integrity. Never bypass `FinancialPaymentFacade`.

**Current state:** Already solid, confirmed directly during the bug-fix pass (not re-audited from scratch here). `FinancialLifecycleService.activatePayableObligations` is the single choke point (per its own docstring: *"Every code path that can make an obligation payable ... routes through activatePayableObligations — there is no parallel/competing activation path anywhere else"*), and this was verified true for both activation paths, the deposit top-up path in `acceptOffer`, and the rent-schedule generator, during the bug fixes.

**Gap:** Low — this pillar needs preservation (don't break it while building the orchestration layer), not new work.

### 1.10 Notification Engine

**Vision:** Centralized, multi-tier (30/15/7/3/1 day) reminders plus offer-lifecycle events (Sent/Viewed/Revised/Accepted/Declined), Signing Required, Activated, Completed — idempotent, resilient to missed cron.

**Current state:** **Idempotency and cron-resilience are already solid** (delivery-layer `whatsapp_logs.idempotency_key` unique constraint; threshold-band stage matching per ADR-014, just shipped). Six templates exist today: `agreement_renewal_reminder_v1`, `agreement_renewal_overdue_v1`, `owner_renewal_alert_v1` (expiry-reminder family, 30/15/expiry-day/7-overdue/30-critical — **not** 3-day or 1-day tiers), and `renewal_offer_sent_v1`, `renewal_offer_declined_v1`, `renewal_offer_discussion_v1` (offer-lifecycle family). Split across **two separate, non-communicating services**: `agreement-renewal-notification-service.ts` (expiry family, called from the cron's daily walk) and `lib/services/notifications/whatsapp-renewal-handler.ts` (offer-lifecycle family, called via `eventSystem` listeners registered in `lib/events/index.ts`).

**Gap:** Moderate. Missing message types: `Offer Viewed` (blocked on §1.6's viewed-tracking gap — can't notify on an event that isn't tracked), `Offer Revised`/`Offer Accepted` (owner-facing confirmations — `Offer Accepted` partially covered since `acceptOffer`'s post-commit hook fires `notifyActivated` only when a deposit obligation was created, not unconditionally), `Signing Required`, `Activated`, `Completed`. No 3-day/1-day reminder tiers. The two-service split isn't wrong architecturally (different trigger sources: cron-driven vs. event-driven) but does mean "add a new renewal notification type" currently requires knowing which of two files to touch.

### 1.11 Support Experience

**Vision:** One screen, seconds to understand: status, blocking issues, financial status, notification history, offer history, timeline, agreement links, documents, audit.

**Current state:** No dedicated support view exists. Every ingredient is scattered: status via `RenewalDecisionService.evaluateAgreement`, blocking issues only as ephemeral `RENEWAL_ACTIVATION_BLOCKED` `systemEventLog` rows (queryable, but no UI surfaces them), financial status via the existing financial read-model (`financial-read-model-service.ts`, unrelated to renewal but composable), notification history via `whatsapp_logs` (exists, queryable, no renewal-specific view), offer history via the §1.5 revision chain, timeline **doesn't exist** (§1.6 blocks this pillar entirely), documents via `agreement.pdf_url` (exists per-agreement, no aggregated per-case view).

**Gap:** Full UI gap, blocked most heavily by §1.6 (Timeline) — every other ingredient already exists in queryable form and mainly needs composing, not building.

### 1.12 Analytics

**Vision:** Eligible/Renewed/Expired/Declined/Negotiated counts, avg rent increase, avg renewal time, conversion rate, pending-today, activation-success.

**Current state:** No renewal-specific analytics service exists. **Directly reusable precedent:** `lib/services/activation-analytics-service.ts` — same shape of problem (funnel counts, conversion rate, avg time-to-completion, abandonment-by-step), read-only aggregate queries via `prisma.groupBy`, already proven for the onboarding-activation funnel. A `RenewalAnalyticsService` following that exact pattern (groupBy `RenewalOffer.status`, avg `accepted_at - sent_at`, avg `proposed_rent/current_rent - 1` for rent-increase %) is a close structural copy, not a new pattern for this codebase.

**Gap:** Moderate — no existing data, but a proven, low-risk pattern to follow, and all the raw fields needed (`sent_at`, `accepted_at`, `declined_at`, `current_rent`, `proposed_rent`) already exist on `RenewalOffer`.

### 1.13 Future AI-readiness

**Vision:** Services decoupled from UI so an AI assistant can query them directly (pending renewals, generate offers, explain rent changes, explain blocks, summarize negotiation).

**Current state:** Foundation is reasonable — `renewalOfferService`/`renewalDecisionService`/`renewalStatusService` are plain classes with no UI coupling, callable from anywhere (already true of the codebase's general service-layer convention). The concrete blocker for *this specific* pillar is §1.8 (Readiness Engine): "explain why renewal is blocked" needs one function to call, and today that logic is hand-duplicated three ways with no single `explain()`-style entry point — an AI assistant integration would have to know about (and stay in sync with) three separate implementations to answer that question reliably.

**Gap:** Low direct gap, but transitively blocked by §1.8 for the one capability ("explain why blocked") most likely to be requested first.

---

## 2. Cross-cutting findings (not specific to one pillar)

1. **Audit writes are not transactionally coupled to the mutations they describe**, in the renewal subsystem specifically. `eventLog.log()` (`lib/services/event-log-service.ts`) always writes via the top-level `prisma` client — **never accepts or uses a `tx` parameter** — even when called from inside `agreement-lifecycle-service.ts`'s `activateScheduledRenewals` transaction callback. Today this happens to be safe only because the `eventLog.log(RENEWED)` call is the last statement before the transaction's implicit commit in current code — but architecturally, nothing prevents a future edit from adding a write *after* it that fails, at which point the audit trail would claim an activation happened that actually rolled back. This is the exact same class of finding the Recovery/Undo proposal doc already flagged as *"the single most important finding"* for that subsystem (§0 of that doc) — it recurs here independently. Any Phase 2 Timeline/Audit design (§1.6) must write its events **inside** the same `tx` as the mutation, not through the existing `eventLog` helper as-is.
2. **`RenewalDecision.decision` overloads `RenewalOfferStatus`'s `SENT` value** to mean "tenant requested discussion" (`discussOffer()`, `renewal-offer-service.ts:626-634`), which is semantically unrelated to an offer's own `SENT` status. Anyone querying `RenewalDecision` expecting `decision: "SENT"` to mean "the offer was sent to the tenant" will get it wrong. Worth a dedicated `RenewalDecisionType` enum (distinct from `RenewalOfferStatus`) in any Phase 2 schema work — cheap to fix, easy to keep missing if not flagged explicitly.
3. ~~`RenewalReadinessEngine` (§1.8) and `Activation Engine` (§1.7) are the same underlying refactor~~ — **closed 2026-07-20** as one merged piece of work, per the recommendation here. See ADR-015.
4. **Policy is almost entirely hardcoded, not configuration-driven**, despite the vision's Policy Engine ask. Confirmed via grep: the *only* renewal-specific value read from `hostel.preferences_config` anywhere in the renewal subsystem is `renewal_grace_period_days` (`renewal-decision-service.ts:56-61`, read ad-hoc from the raw JSON, not through the typed `resolvePreferences()` helper `lib/preferences.ts` uses for billing settings). Everything else the vision wants configurable per hostel — offer-expiry days (hardcoded `addDays(new Date(), 15)`, `renewal-offer-service.ts:185,322`), the 30/15/7-day reminder thresholds (hardcoded literals inside `determineRenewalStage`'s band logic itself), auto-activation toggle (doesn't exist as a toggle — cron always tries to activate everything eligible), negotiation-enabled, owner-signature-required, max-revisions, notification-preferences-beyond-target — is currently a code constant, not a setting.

---

## 3. Gap severity summary

| Pillar | Gap | Existing reusable foundation |
|---|---|---|
| Renewal Case / lifecycle | High (state machine) / Low-Moderate (data, if composed not rebuilt) | `RenewalDecisionService.evaluateAgreement` already derives 8/12 states |
| Owner Workspace | Moderate | `RenewalQueueView.tsx`, `getOwnerRenewalQueue`, `computePipelineStatus` — need restructuring + 3 new queue states, not a rebuild |
| Renewal Details Page | Full (UI) | Backend data mostly exists piecemeal; needs one composing endpoint |
| Agreement Comparison | Low | `diff-engine.ts` + `field-classification.ts` — near-direct reuse |
| Offer Versioning | **Already done** | `revised_from_offer_id` chain, `SUPERSEDED` pattern — matches vision closely |
| Renewal Timeline | **Closed 2026-07-20** (Viewed-tracking excluded — see §1.6) | `RenewalTimelineEvent` + `renewal-timeline-service.ts` — see ADR-016 |
| Policy Engine | High | Only `renewal_grace_period_days` is configurable today |
| Readiness Engine | **Closed 2026-07-20** | `renewal-readiness-engine.ts` — see ADR-015 |
| Activation Engine | **Closed 2026-07-20** | `renewal-activation-engine.ts` — see ADR-015; `tenants` sync gap also closed |
| Financial Continuity | **Already solid** | `FinancialLifecycleService` single choke point, verified during bug fixes |
| Notification Engine | Moderate | Idempotency/resilience solid (ADR-013/014); missing message types + 2-service split |
| Support Experience | Full (UI), blocked on Timeline | Every non-timeline ingredient already exists in queryable form |
| Analytics | Moderate | `activation-analytics-service.ts` is a proven, directly-copyable pattern |
| AI-readiness | Low direct / blocked transitively on Readiness Engine | Service layer already UI-decoupled |

---

## 4. Recommended phase reordering (informed by the audit, for Phase 2 discussion)

The vision's own Phase 1-9 ordering is reasonable but the audit surfaces two sequencing dependencies worth flagging before Phase 2 design locks in:

- **Timeline (§1.6) blocks more downstream pillars than any other gap** — the Renewal Details Page, Support Experience, and half the Notification Engine's missing message types (`Viewed`, `Revised`, `Signing Required`) all need it. It may be worth pulling forward, ahead of the vision's implied "UI phases first" ordering, since it's pure backend (one new table, one write path) and nothing else can be built on top of it until it exists. **Next candidate for implementation, now that Readiness/Activation Engine consolidation (below) is done.**
- ~~Readiness Engine and Activation Engine (§1.7/§1.8) are one refactor, not two~~ (finding §2.3) — **done 2026-07-20**, merged as recommended. See ADR-015.

This is a discussion point for Phase 2, not a decision made here.

---

## 5. Open questions requiring a decision before Phase 2 design starts

1. **`RenewalCase` — new table or computed read-model?** §1.1 lays out the evidence; the audit's lean is "compose, don't build a new entity" for most of the 12 states, with the exception of `WITHDRAWN`/`FAILED`/`COMPLETED`/`READY_FOR_ACTIVATION` which have no derivable signal today. Needs an explicit decision before any schema is drafted.
2. ~~Timeline table shape~~ — **resolved 2026-07-20**: bespoke `RenewalTimelineEvent` table, not coupled to the Undo proposal's schema. See ADR-016 "Alternatives considered."
3. **Policy Engine scope for v1** — the vision lists 11 configurable policies (§"Policy Engine" in the original prompt). Confirm which subset ships in Phase 2 vs. deferred; recommend at minimum promoting the existing `renewal_grace_period_days` pattern to cover offer-expiry-days and the reminder-day-list first, since those are the two most hardcoded values found in §2.4.
4. **Does "Bulk Withdraw" need a new domain concept, or is it "bulk decline-on-owner's-behalf"?** No `WITHDRAWN` concept exists anywhere in the current offer lifecycle (owner can only let an offer expire or supersede it via revise) — needs product clarification on whether withdrawal is materially different from expiry before it's designed.
5. **Confirm this document's scope boundary** — this audit does not include a Phase 2 design (Renewal Case schema, orchestration service code, API contracts). Confirm that's the next deliverable expected, and confirm the answers to Q1-Q4 above before that design starts, per the vision's own "never make large uncontrolled changes" principle.
