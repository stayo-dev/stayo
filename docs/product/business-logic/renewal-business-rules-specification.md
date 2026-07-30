
# Agreement Renewal — Business Rules Specification

Status: **DRAFT — awaiting product sign-off. No code written or changed by this document.** This is the deliverable requested as the prerequisite to Phase 2 of `docs/business-logic/renewal-management-workspace-gap-analysis.md` — the business contract that Workspace/Readiness Engine/Activation Engine/Timeline/Policy Engine implementation will be built against.

Related reading: `docs/superpowers/plans/2026-07-19-agreement-renewal-bugfixes.md` (bug fixes this spec's "as-implemented" facts reflect), `docs/business-logic/renewal-management-workspace-gap-analysis.md` (the audit this spec answers open questions from), `docs/obsidian/Business-Rules.md`, `docs/obsidian/Decisions.md` ADR-012/013/014.

## How to read this document

Every rule below is tagged one of three ways. **Do not treat these as interchangeable** — that distinction is the entire point of this document:

- 🟢 **AS-IMPLEMENTED** — this is what the system does today, verified against code (file:line cited). Stating it here doesn't mean it's correct or final; it means it's a fact, not a proposal.
- 🟡 **RECOMMENDATION** — no rule exists today (or an existing one is ambiguous); this is a proposed rule with reasoning, **not yet approved**. Implementation must not start from a 🟡 until it's promoted to 🟢-by-decision (i.e., you sign off and it becomes the spec).
- 🔴 **OPEN QUESTION** — genuinely undecided; deliberately no default is asserted, because guessing here is exactly the "late product decision causing rework" failure mode this document exists to prevent.

Every 🔴 in this document is also collected in §21 for a single sign-off pass.

---

## 1. Renewal Eligibility Rules

🟢 **An agreement is renewal-eligible only in status `SIGNED`, `EXPIRING_SOON`, or `AGREEMENT_EXPIRED`.** Enforced identically (same three-status list, `CURRENT_AGREEMENT_STATUSES`) at both offer-generation (`generateOffer`, `renewal-offer-service.ts:126`) and manual-draft-creation (`createRenewalDraft`, `agreement-renewal-service.ts:11`) entry points. `DRAFT`, `RENEWED`, `TERMINATED`, `VOID` are never eligible.

🟢 **Only one active offer per agreement at a time.** `generateOffer` throws `CONFLICT` if `renewal_offers_source` already has a row in `DRAFT`/`SENT` (`renewal-offer-service.ts:112-123`). A second offer can only be created after the first is superseded (via revise), declined, or expired.

🟢 **Only one successor agreement per predecessor.** `createRenewalDraft` throws `AGREEMENT_SUCCESSOR_EXISTS` if `renewed_to_agreement_id` is already set or an active (non-`VOID`/`TERMINATED`) row exists in `renewed_agreements` (`agreement-renewal-service.ts:142-153`). `acceptOffer` enforces the same invariant via a count-checked conditional `updateMany` on the link column rather than a pre-check (bug #4 fix — see ADR-012).

🟢 **An active move-out request blocks renewal**, at both draft-creation and signing time. Statuses counted as "active": `REQUESTED, INSPECTION_PENDING, INSPECTION_DONE, SETTLEMENT_APPROVED, PAYMENT_PENDING, DISPUTED, SETTLEMENT_PENDING, APPROVED` (`renewal-decision-service.ts:19-28`, mirrored in `agreement-renewal-service.ts:155-175`, `agreement-renewal-signing-service.ts:173-191`, and — as of the bug-fix pass — `agreement-lifecycle-service.ts`'s cron path too). `COMPLETED`/`REJECTED` move-outs do **not** block renewal.

🔴 **Is renewal eligibility blocked, warned, or unaffected by outstanding rent dues on the *predecessor* agreement (unrelated to the renewal's own deposit top-up)?** 🟢 **As-implemented today: unaffected.** `generateOffer`/`acceptOffer`/`createRenewalDraft` never check the tenant's general rent-overdue status. `RenewalDecisionService.evaluateAgreement` *surfaces* overdue rent as an informational state (`EXPIRED_AND_RENT_OVERDUE`, used only for reminder-notification prioritization) but never blocks any renewal action on it. This is a genuine 🔴 for product to confirm is intentional — see the user's own example question ("Should renewal be blocked by outstanding dues, or just warned?"). No recommendation asserted here; needs a decision.

🔴 **Renewal window (minimum/maximum days before expiry that an offer can be generated).** No such check exists at all today (not even hardcoded) — an owner can generate a renewal offer for an agreement that expires in 400 days, or one day before/after it already expired (as long as status is still one of the 3 eligible values). 🟡 **Recommendation:** add a configurable window (e.g. "offers can be generated starting N days before `agreement_end_date`," default unrestricted/0 to preserve current behavior) rather than silently introducing a restriction that doesn't exist today.

---

## 2. Renewal Lifecycle & State Transitions

🟢 **There is no single canonical lifecycle state today** — see gap-analysis §1.1 for the full audit. The state is currently the *combination* of `Agreement.status` (predecessor and successor) + `RenewalOffer.status` + derived `decision_state`. This specification defines the **target** unified lifecycle (subject to the 🔴 in gap-analysis open question #1 on whether it's a new table or a read-model) and maps every current signal onto it, so Phase 2 has one source of truth to implement against regardless of how that storage question resolves.

### 2.1 Canonical states (proposed)

🟡 Twelve states, matching the original vision, each with its precise entry/exit condition defined against **existing** fields (no new fields required to compute any of these, except where marked):

| State | Entry condition (computed from existing data) | Exit condition |
|---|---|---|
| `ELIGIBLE` | Predecessor status ∈ {SIGNED, EXPIRING_SOON, AGREEMENT_EXPIRED}, no active offer, no successor, no active move-out | An offer is generated (→ `PREPARING`) or the predecessor becomes ineligible (renewed/terminated/void, or move-out starts) |
| `PREPARING` | `RenewalOffer.status = DRAFT`, `revised_from_offer_id = null` (first draft, not yet sent) | Owner sends it (→ `WAITING_FOR_TENANT`) |
| `READY_TO_SEND` | 🔴 No distinct signal from `PREPARING` today — **open question, see §21.1**: is this meant to be a validation gate (owner has filled required fields) rather than a time-based state? If so it may not need a stored value at all — just a readiness check run before allowing the "Send" action. |
| `WAITING_FOR_TENANT` | `RenewalOffer.status = SENT`, no `RenewalDecision` row yet for this offer | Tenant acts (accept/decline/discuss) or offer expires |
| `NEGOTIATING` | `RenewalOffer.status = SENT` **and** a `RenewalDecision` row with `decision = "SENT"` (the discuss-overload — see gap-analysis §2.2, needs the enum split first) exists for this offer | Owner revises (new offer version, back to `WAITING_FOR_TENANT` on send) or tenant accepts/declines the current terms as-is |
| `ACCEPTED` | `RenewalOffer.status = ACCEPTED`, successor `Agreement.status = DRAFT`, deposit obligation (if any) still unpaid | Deposit paid (if required) or none required (→ `AWAITING_SIGNING`) |
| `AWAITING_SIGNING` | Successor `Agreement.status = DRAFT`, no unpaid deposit obligation, `agreement_start_date` in the future | Signed manually, or `agreement_start_date` reached (→ cron attempts activation) |
| `READY_FOR_ACTIVATION` | 🔴 No distinct signal from `AWAITING_SIGNING` today — same open question as `READY_TO_SEND`: is this "signed, waiting for effective date" (a real, computable state: successor `status = SIGNED` but `agreement_start_date > today`, only reachable via manual signing before the effective date) or "unsigned, effective date imminent"? These are different states with different implications and the vision's diagram doesn't disambiguate. **See §21.2.** |
| `ACTIVE` | Successor `Agreement.status = SIGNED`, predecessor `Agreement.status = RENEWED` | Successor itself later needs renewal (own lifecycle restarts) or is terminated |
| `COMPLETED` | 🔴 No signal distinguishes this from `ACTIVE` today. **See §21.3**: proposed definition is "renewal fully done, including PDF generated and rent schedule generated" — both of which already happen synchronously inside the activation transaction, so this may be **the same instant as `ACTIVE`**, not a later state, unless "Completed" is meant to mean something else (e.g. "first month's rent collected"). Needs a decision, not an implementation guess. |
| `DECLINED` | `RenewalOffer.status = DECLINED` | Terminal (owner may generate a *new* offer, which is a new `RenewalOffer` row, not a reactivation of this one) |
| `WITHDRAWN` | 🔴 No signal exists. **See §21.4** (mirrors gap-analysis open question #4). |
| `FAILED` | 🔴 No signal exists. **See §21.5**: proposed definition — an activation transaction threw (chain-race, or a safeguard failed at cron time) and the draft is still sitting in `DRAFT` past its `agreement_start_date`. This is currently silent (just retried every cron run indefinitely) rather than surfaced as a distinct state — needs a decision on whether indefinite silent retry is the intended behavior or whether it should surface after N failed attempts. |
| `EXPIRED` | `RenewalOffer.status = EXPIRED` (set by `expireStaleOffers`, wired into the daily cron as of bug #5) | Terminal |

### 2.2 State transition diagram

```
                              ┌──────────┐
                              │ ELIGIBLE │
                              └────┬─────┘
                                   │ owner: generateOffer()
                                   ▼
                          ┌────────────────┐
                          │   PREPARING    │  (RenewalOffer DRAFT)
                          └───────┬────────┘
                                  │ owner: sendOffer()
                                  ▼
                       ┌─────────────────────┐
              ┌───────▶│  WAITING_FOR_TENANT │◀────────────┐
              │        └──────────┬──────────┘             │
              │                   │                        │
              │      ┌────────────┼────────────┐           │ owner: sendOffer()
              │      │            │            │           │ (on the new revision)
    tenant:   │      │ tenant:    │  tenant:    │           │
    discuss() │      │ accept()   │  decline()  │           │
              │      ▼            ▼            ▼           │
              │  ┌─────────┐ ┌─────────┐  ┌──────────┐      │
              └──│NEGOTIATING│ │ACCEPTED │  │ DECLINED │      │
                 └─────┬────┘ └────┬────┘  └──────────┘      │
                       │           │        (terminal)       │
          owner:       │           │                         │
          reviseOffer()└───────────┼─────────────────────────┘
                                   │ deposit obligation (if any) paid,
                                   │ or none required
                                   ▼
                         ┌──────────────────┐
                         │  AWAITING_SIGNING │
                         └─────────┬─────────┘
                                   │
                    ┌──────────────┴───────────────┐
                    │                               │
          owner/tenant: sign-renewal          agreement_start_date
          (before effective date)             reached (cron)
                    │                               │
                    ▼                               ▼
           [READY_FOR_ACTIVATION?]         activateScheduledRenewals()
           see §21.2                     safeguards pass │ safeguards fail
                    │                                    │      or chain race
                    └─────────────┬──────────────────────┘      │
                                  ▼                              ▼
                             ┌─────────┐                   ┌─────────┐
                             │  ACTIVE  │                   │  FAILED  │  see §21.5
                             └────┬─────┘                   └─────────┘
                                  │
                            [COMPLETED?]
                            see §21.3
                                  │
                                  ▼
                        (successor's own lifecycle
                         restarts from ELIGIBLE
                         when it approaches expiry)

  Any state before ACCEPTED
       │
       │ owner: withdraw()  — see §21.4, action doesn't exist today
       ▼
  ┌───────────┐
  │ WITHDRAWN │  (terminal)
  └───────────┘

  WAITING_FOR_TENANT / NEGOTIATING
       │
       │ offer_expires_at reached, expireStaleOffers() cron sweep
       ▼
  ┌─────────┐
  │ EXPIRED │  (terminal)
  └─────────┘
```

🟢 **Terminal states today** (no further transition possible without starting a new renewal from scratch): `DECLINED`, `EXPIRED`, `TERMINATED`/`VOID` agreement statuses. 🟢 **`ACTIVE` is not currently terminal** — the successor agreement itself becomes the new predecessor for a *future* renewal cycle once it approaches its own expiry; the lifecycle is cyclical per-tenant, not one-shot.

---

## 3. Offer Lifecycle

🟢 **`RenewalOfferStatus` enum (schema, 7 values):** `DRAFT, SENT, ACCEPTED, DECLINED, EXPIRED, REVISED, SUPERSEDED`. Confirmed transitions in code:

| From | To | Trigger | Code |
|---|---|---|---|
| (none) | `DRAFT` | `generateOffer()` / `generateBulkOffers()` | `renewal-offer-service.ts:160-188`, `299-325` |
| `DRAFT` | `SENT` | `sendOffer()` / `sendBulkOffers()` | `:340-343`, `:357-370` |
| `SENT` | `ACCEPTED` | `acceptOffer()`, tenant-initiated | `:445-448` |
| `SENT` | `DECLINED` | `declineOffer()`, tenant-initiated | `:580-583` |
| `DRAFT` or `SENT` | `DECLINED` | `declineOffer()` also accepts `DRAFT` (`:578`) — 🔴 **is this intentional?** A tenant declining an offer the owner never sent is an odd path; worth confirming whether `declineOffer` should be tenant-reachable at all for a `DRAFT` offer (it has no way to *see* a `DRAFT` offer via `getActiveOfferForTenant`, which filters to `SENT` only — so this branch is currently unreachable through the tenant UI, only reachable if an owner-side code path ever called it, which none do today). Likely dead branch, not a real business rule — flagging so it isn't mistaken for one. |
| `DRAFT` or `SENT` | `SUPERSEDED` | `reviseOffer()` — old offer marked `SUPERSEDED`, new `DRAFT` created | `:657-704` |
| `DRAFT` or `SENT` | `EXPIRED` | `expireStaleOffers()` cron sweep, `offer_expires_at <= now` | `:803-810` |

🟢 **`REVISED` status value in the enum is never actually written by any code path** — `reviseOffer` writes `SUPERSEDED` to the *old* offer, not `REVISED`. Confirmed by grep: no `status: "REVISED"` write exists anywhere. 🔴 Either this is dead/reserved-for-future enum value, or there's a missing distinction between "SUPERSEDED because revised" vs. "SUPERSEDED for some other reason" that was intended but never implemented — worth a product decision on whether `REVISED` should replace `SUPERSEDED` specifically for the revise path (keeping `SUPERSEDED` for a hypothetical other cause), or be removed from the enum as unused.

🟢 **Discuss does not change offer status.** `discussOffer()` only logs a `RenewalDecision` row and fires a notification — the offer stays `SENT` and remains fully acceptable on its original terms at any point during or after a discussion (`renewal-offer-service.ts:617-648`).

🟢 **Revising always creates a new offer row; it never edits in place.** Confirmed already in gap-analysis §1.5 — this rule is solid and matches the vision.

---

## 4. Owner Actions & Permissions

🟢 Actions and their route/service, all requiring `session.sub` (owner) and, for single-agreement actions, hostel ownership match (`agreement.hostel.owner_id === session.sub`):

| Action | Route | Preconditions |
|---|---|---|
| Generate single offer | `POST /api/agreements/{id}/renewal-offer` | Agreement eligible (§1), no active offer, owner owns hostel |
| Generate bulk offers | `POST /api/agreements/renewal-offers` (bulk mode) | Same, per-agreement, applied across a filtered set |
| Send offer | `POST /api/agreements/renewal-offers/{id}/send` | Offer status `DRAFT`, owner owns offer |
| Send bulk offers | (service-level `sendBulkOffers`, best-effort per offer — a failure on one offer doesn't block the rest) | Batch exists, owner owns batch |
| Revise offer | `PATCH /api/agreements/renewal-offers/{id}` | Offer status `DRAFT` or `SENT`, owner owns offer |
| Create manual renewal draft (no offer) | `POST /api/agreements/{id}/renewal-draft` | Agreement eligible, no successor exists — 🟢 **role-open**: route allows `OWNER, ADMIN, TENANT` (`renewal-draft/route.ts:11`), not owner-only |
| Sign renewal | `POST /api/agreements/{id}/sign-renewal` | 🟢 **role-open**: `OWNER, ADMIN, TENANT` all permitted (`sign-renewal/route.ts:11`) — an owner can sign on the tenant's behalf today, with no distinct "who actually needs to sign" requirement enforced beyond capturing whichever signature fields are provided in the request body |
| View renewal queue | `GET /api/agreements/renewals` | Owner scope only |
| View agreement history | `GET /api/agreements/history` | Owner or tenant scope |

🔴 **Withdraw offer** — no such action/route exists today (see §2.1 `WITHDRAWN`, §21.4).
🔴 **Extend offer expiry** — no such action exists (owner's only lever today is `reviseOffer` with a new `offer_expires_at`, which creates a whole new offer version rather than extending the existing one in place).
🔴 **Bulk withdraw / bulk activate / bulk export** — none exist today (bulk generate and bulk send do).

🟡 **Recommendation:** `sign-renewal` currently allowing `TENANT` role to submit an `owner_signature_url` (nothing in the route or service stops a tenant-role request from populating owner-signature fields, though the frontend presumably doesn't expose that field to tenants) is a permission-model gap worth tightening — the *service layer* doesn't enforce which role may supply which signature, only the route-level "is this agreement yours" check. Flagging for the Readiness/Activation Engine design in Phase 2, not asserting a fix here.

---

## 5. Tenant Actions & Permissions

🟢 Actions, all requiring `session.sub` matched against `tenant.profile_id`:

| Action | Route | Preconditions |
|---|---|---|
| View active offer | `GET /api/tenant/renewal-offer` | Offer status `SENT` only — a `DRAFT`, `ACCEPTED`, `DECLINED`, or `EXPIRED` offer is invisible to `getActiveOfferForTenant` (`renewal-offer-service.ts:771`) |
| Accept offer | `POST /api/tenant/renewal-offer/{id}/accept` | Offer `SENT`, not past `offer_expires_at`, offer belongs to this tenant |
| Decline offer | `POST /api/tenant/renewal-offer/{id}/decline` | Offer `SENT` or `DRAFT` (see §3 dead-branch note) |
| Discuss offer | `POST /api/tenant/renewal-offer/{id}/discuss` | Offer `SENT` |
| Sign renewal | `POST /api/agreements/{id}/sign-renewal` | Tenant owns the agreement (role-open, see §4) |
| Create manual renewal draft | `POST /api/agreements/{id}/renewal-draft` | 🔴 route permits `TENANT` role — **is a tenant-initiated renewal draft (without an owner-generated offer at all) an intended product flow, or is this route accidentally over-permissioned?** No frontend surface for this was found in `apps/frontend` for the tenant role; flagging rather than asserting either way. |

🟢 **A tenant cannot see an offer's revision history unless it's the currently-active `SENT` offer's chain** — `getActiveOfferForTenant`'s `revisions[]` walk only runs from the *currently active* offer backward; there is no tenant-facing endpoint to see a `DECLINED` or `EXPIRED` offer's own history independently.

🟢 **No tenant-facing "why is renewal blocked" explanation exists** — this is the AI-readiness gap identified in gap-analysis §1.13, restated here as a tenant-permission-adjacent gap: a tenant with `RENEWAL_BLOCKED_MOVED_OUT`/`SUCCESSOR_EXISTS` sees `renewal_available: false` and a `renewal_blocked_reason` enum value (machine-readable) from `evaluateAgreement`, but there is no confirmed UI surface translating that into tenant-facing copy — **not verified either way in this pass since it's a frontend concern outside this backend-focused spec's evidence base; flagging as unverified rather than asserting a gap.**

---

## 6. Financial Rules

### 6.1 Rent, deposit, maintenance changes

🟢 **Rent, deposit, and maintenance are set entirely by the owner at offer-generation time**, with no system-enforced cap or floor. `proposed_rent`/`proposed_security_deposit`/`proposed_maintenance` accept any positive value the owner provides (`generateOffer`, no min/max validation beyond `!proposed_rent` truthiness in the route handler — i.e., zero or negative isn't explicitly rejected by a numeric range check, only "falsy" values like `0`/`null`/`undefined` are rejected by the `if (!proposed_rent ...)` guard in the route). 🔴 **No maximum rent-increase percentage exists** — an owner could propose a 10x rent increase and the system would accept it. Whether this needs a guard rail (e.g., a warning past some % threshold, or a hard cap) is a genuine product/legal question (rent-control-adjacent jurisdictions may require this) — **not answered here.**

🟢 **Deposit delta is computed automatically, not owner-entered directly as a delta.** `additional_deposit_required = max(0, proposed_deposit - deposit_held)`; `deposit_refund_eligible = max(0, deposit_held - proposed_deposit)` (`renewal-offer-service.ts:156-158`). `deposit_held` is computed from the tenant's `tenant_financial_ledger` CREDIT rows for `SECURITY_DEPOSIT_COLLECTED`/`SECURITY_DEPOSIT_TOPUP`, falling back to `tenants.security_deposit` if no ledger rows exist (`_computeDepositHeld`, `:812-816`).

### 6.2 Deposit top-up (increase case)

🟢 **If `additional_deposit_required > 0` at acceptance, a `PENDING` `SECURITY_DEPOSIT` obligation is created** on the successor agreement (`acceptOffer`, `:465-483`), immediately routed through `financialLifecycleService.activatePayableObligations` (correct — never bypasses the sole financial choke point).

🟢 **This obligation gates both activation paths identically** (as of bug #2 fix — manual signing now checks it, matching cron's pre-existing check). Payment happens through the **normal dues/payment flow** (PhonePe checkout or manual receipt against this obligation like any other `rent_obligations` row) — there is no renewal-specific payment UI; **confirmed as-implemented, not a gap**, since `rent_obligations` is deliberately the single source of truth for all money owed (per `CLAUDE.md`'s own architectural principle).

### 6.3 Excess deposit (decrease case)

🟢 **Three policies, only two are implemented:**

| Policy | Behavior |
|---|---|
| `KEEP_AS_CREDIT` | Creates a `CREDIT` ledger entry, reason `FUTURE_RENT_CREDIT_TOPUP`, `balance_after` computed from a fresh in-transaction ledger aggregate (`:501-518`) |
| `REFUND` | Creates a `DEBIT` ledger entry, reason `SECURITY_DEPOSIT_REFUNDED`, `refund_status: "PENDING"` — 🔴 **note: this only records that a refund is owed; no actual money-movement/payout mechanism is triggered by this code path** (consistent with the rest of the codebase, where refunds are presumably handled by a separate settlement/payout process not part of the renewal subsystem — not verified in this pass, flagging as unverified) | `:519-538` |
| `KEEP_AS_DEPOSIT` | 🟢 **No code branch handles this value at all** — confirmed by grep, zero matches. If selected, excess deposit produces **no ledger entry whatsoever**. This may be *correct by design* (the excess simply remains part of the larger deposit balance, requiring no ledger movement since nothing is being converted or paid out) — but this asymmetry (2 of 3 policies write a ledger row, one is silently a no-op) is non-obvious and worth the spec stating explicitly rather than leaving implicit. 🟡 **Recommendation: confirm `KEEP_AS_DEPOSIT` as an intentional no-op in this spec (not a bug) so it isn't "fixed" into an unwanted ledger entry later** — but this is the product's call, not asserted as correct here.

### 6.4 Waivers

🔴 **No renewal-specific waiver mechanism exists.** The generic `rent_obligations` waiver path (referenced in `docs/obsidian/Business-Rules.md` §"Obligation lifecycle") could presumably apply to a renewal's deposit top-up obligation like any other obligation, but this was not verified in this pass and no renewal-specific waiver rule exists to document.

### 6.5 Rent increase caps / negotiation limits

🔴 Already covered in §6.1 — restated here for completeness against the requested outline: no cap, no floor, no negotiation-round limit (see §11 Offer Revision Rules for the related "max revisions" gap).

---

## 7. Room-Change Renewals

🟢 **Not supported by the renewal flow.** `RenewalOffer` has no room/allocation field at all — `roomCategory` is read from the tenant's *current* active `room_allocations` purely to select a rent template (`_resolveTemplateInTx`), never to propose or execute a room change. A room change during a renewal cycle today requires **two separate operations**: a room shift (via `room-allocation-service.ts`, outside this subsystem) and the renewal itself — there is no integrated "renew into a different room" flow, and no validation exists connecting the two (e.g., nothing stops a renewal from activating while a room shift is mid-flight, since renewal's move-out check doesn't consider room-shift state at all).

🔴 **Should room-change be integrated into renewal** (single flow, one offer proposes both new terms and a new room), or **remain deliberately separate** (renew first, shift rooms separately, or vice versa)? This is a real product-scope question for Phase 2's Renewal Case design, not answered here.

---

## 8. Hostel-Change Renewals

🟢 **Not supported by the renewal flow, and not conceptually the same operation as `tenant-transfer-service.ts`.** `hostel_id` on both the offer and successor agreement is always inherited from the source agreement (`agreement.hostel_id`); there is no code path where a renewal offer proposes a *different* hostel. The **existing, separate** Tenant Transfer feature (`tenant-transfer-service.ts`) already handles hostel-to-hostel moves (atomic allocation close+create, financial-record-stays-with-old-hostel, `tenants.hostel_id` updated) but is entirely independent of Agreement Renewal — a transfer does not create or touch a `RenewalOffer`/successor `Agreement` at all.

🔴 **Is "hostel-change renewal" actually a request for the Renewal subsystem to gain transfer-like capability, or is it asking whether Transfer and Renewal should be explicitly documented as separate-by-design (transfer first, then renew in the new hostel, or renew first then transfer)?** Given Transfer already exists as a mature, purpose-built feature (atomic, audit-trailed, financial-record-preserving), the audit's lean — consistent with the "compose, don't duplicate" principle — is that Renewal should **not** absorb Transfer's responsibility; the two should stay separate and this spec should just document the *sequencing* rule (e.g., "a hostel transfer must complete before a new renewal offer can be generated in the new hostel," or vice versa). **Not decided here — genuine 🔴.**

---

## 9. Agreement Versioning Rules

🟢 **`agreement_version` increments by exactly 1 per renewal**, computed as `Number(source.agreement_version || 1) + 1` at both offer-acceptance (`renewal-offer-service.ts:409`) and manual-draft-creation (`agreement-renewal-service.ts:197`) time — consistent between the two creation paths.

🟢 **The version chain is a strict linked list, not a tree.** `renewed_from_agreement_id`/`renewed_to_agreement_id` are single-valued (not arrays), and the successor-uniqueness rule (§1) enforces at most one successor per predecessor — so an agreement's full history is always a single linear chain, never branching. `RenewalDecisionService.getAgreementHistory` returns this chain ordered by `agreement_version desc`.

🟢 **A predecessor becomes immutable (status `RENEWED`) at the exact moment its successor activates** — not at offer-acceptance time. Between acceptance and activation, the predecessor remains in its prior status (`SIGNED`/`EXPIRING_SOON`/`AGREEMENT_EXPIRED`) and — per the normal per-agreement lifecycle-managed-statuses list — can still receive its own expiry-tracking status transitions from the cron's main walk during that window (e.g., could flip `EXPIRING_SOON → AGREEMENT_EXPIRED` while a successor sits unsigned in `DRAFT`). This is a subtle but real behavior: **a renewed-but-not-yet-activated tenant's predecessor agreement can show as "expired" in places that read `Agreement.status` directly, even though a successor already exists and the tenant has already renewed.** (This is exactly the scenario ADR-013's fix addresses for WhatsApp notifications specifically — but the underlying status field itself still shows `AGREEMENT_EXPIRED` to any other consumer that doesn't separately check `has_successor`.)

🟢 **`content_snapshot` is a point-in-time JSON copy, not a live reference** — each agreement version freezes its own terms; changing a template or hostel default later never retroactively affects a signed agreement's snapshot.

---

## 10. Offer Revision Rules

🟢 **Unlimited revisions.** No `max_revisions` counter or limit exists anywhere in the code — an owner could revise the same offer 50 times, each creating a new `SUPERSEDED`-chained row. 🟡 **Recommendation:** this matches the "unlimited by default, configurable cap available" pattern already used elsewhere in the codebase for similar unbounded-by-default settings — but whether a cap is warranted at all is a product call (§21.6), not asserted here.

🟢 **A revision inherits unset fields from the offer being revised**, not from the original agreement — e.g. `proposed_duration_months: newTerms.proposed_duration_months ?? oldOffer.proposed_duration_months` (`reviseOffer`, `:669`). This means revising a revision compounds forward, not back to agreement defaults — worth stating explicitly since it's not obvious from the UI alone.

🟢 **Revising resets `is_custom_override: true` unconditionally** on the new offer (`:696`) — even if the revision happens to exactly match the original template defaults. This flag currently has no observed downstream consumer in the renewal subsystem itself (not verified against frontend usage in this pass) — flagging as an unverified-impact fact, not asserting it's a problem.

🔴 **Can a tenant "counter-offer" with specific numbers, or is `discussOffer`'s free-text message the only negotiation surface?** 🟢 **As-implemented: free text only.** `discussOffer` takes an unstructured `message` string; there is no structured "tenant proposes rent X" data path — the owner has to interpret the WhatsApp/portal message and manually construct the revision. Whether structured counter-offers are in scope for the Workspace's "Negotiation" queue is a genuine 🔴 for Phase 2 UX design.

---

## 11. Withdrawal Rules

🔴 **No withdrawal action exists today at any level** (offer or draft). Restated from §2/§4/gap-analysis for completeness: the closest existing mechanisms are (a) letting an offer expire naturally, or (b) revising an offer with terms so unfavorable the tenant would decline (not a real withdrawal, a workaround). **Full open question — see §21.4.**

---

## 12. Expiry Rules

🟢 **Two independent expiry concepts exist and must not be conflated:**

1. **Offer expiry** (`RenewalOffer.offer_expires_at`) — defaults to `now + 15 days` if the owner doesn't specify one (`addDays(new Date(), 15)`, hardcoded, both single and bulk offer paths, `:185, :322`), swept by `expireStaleOffers()` (now wired into the daily cron per bug #5). Governs how long a `SENT` offer stays acceptable.
2. **Agreement expiry** (`Agreement.agreement_end_date` → `AGREEMENT_EXPIRED` status) — the underlying lease term ending, tracked entirely separately by the cron's main expiry-walk loop, unrelated to any offer.

🟢 **An offer can expire while its underlying predecessor agreement is still perfectly current** (e.g., owner sends an offer 60 days before expiry with a 15-day acceptance window; if the tenant doesn't respond, the offer expires with 45 days still left on the lease — the tenant can simply be sent a new offer).

🔴 **Is the 15-day default offer-expiry window itself correct, and should it scale with how far out from `agreement_end_date` the offer was sent** (e.g., an offer sent 5 days before expiry probably shouldn't get a 15-day acceptance window that outlives the lease)? 🟢 **As-implemented: no such scaling exists** — the 15-day default is flat regardless of how close to expiry the offer was generated, meaning an offer's `offer_expires_at` can legitimately fall *after* `agreement_end_date`. Not asserted as a bug, but worth an explicit product decision on whether that's acceptable.

---

## 13. Auto-Activation Policy

🟢 **Auto-activation is not a toggle — it is the unconditional default behavior of the cron for every eligible draft.** There is no `preferences_config` flag, no opt-out, no per-hostel or per-tenant setting anywhere in the codebase that disables `activateScheduledRenewals` from attempting to activate a `DRAFT` successor once `agreement_start_date <= today`, provided the four safeguards (predecessor renewable, no active move-out, lifecycle-complete, no unpaid deposit) all pass.

🟢 **Auto-activation does not require a fresh tenant signature.** This directly answers the user's example question ("What happens if the tenant doesn't sign but auto-activation is enabled?"): **auto-activation is always effectively "enabled," and it activates regardless of whether the tenant ever explicitly e-signed the successor document** — it copies the *predecessor's* original signature fields forward (`agreement-lifecycle-service.ts`, the `tenant_signature_url: predecessor.tenant_signature_url` assignment block) on the theory that accepting the renewal offer (via WhatsApp/tenant-portal accept action) already constituted the tenant's consent, and the signing ceremony on the successor document is a formality that can be satisfied by carrying forward proof of the original agreement's consent rather than requiring a second one.

🔴 **Is "offer acceptance = sufficient consent for auto-activation without a fresh signature" the intended legal/product position, or should auto-activation be blocked (or made opt-in) until an explicit fresh signature exists?** This is arguably the single highest-stakes open question in this entire document — it has legal-agreement-validity implications, not just UX ones, and the current behavior (silently carrying forward an old signature onto a new document with different terms) may not be something the product team has actually decided on versus something that emerged as an implementation convenience. **No recommendation asserted — flagged as the top-priority item in §21.**

🟡 **Recommendation (contingent on the above being resolved either way):** whichever answer is chosen, make it an explicit, named policy (`auto_activation_requires_signature: boolean`, per-hostel, default = current behavior to avoid a breaking change) rather than leaving it as unconditional/implicit — this is exactly the kind of setting the vision's Policy Engine pillar calls for.

---

## 14. Manual Activation Policy

🟢 **"Manual activation" and "signing" are the same event** — there is no separate "activate" action distinct from `sign-renewal`; calling `signRenewalAgreement` with a valid signature *is* the activation (same DRAFT→SIGNED transition, same rent-schedule generation, same predecessor RENEWED transition, all in one call). This differs structurally from cron activation, which activates without any signature input at all (§13).

🟢 **Manual signing can happen at any point after acceptance, including before the successor's `agreement_start_date` has arrived** — there is no "too early to sign" check; a tenant/owner can sign the day the offer is accepted even if the new term doesn't start for months. 🔴 **Is early activation (successor `SIGNED` with a future `agreement_start_date`) intended to immediately start billing, or should rent-schedule generation itself respect the future start date?** 🟢 **As-implemented:** `generateForAgreementInTx` schedules obligations starting from `agreement_start_date` regardless of when signing happened (a signed-but-not-yet-started agreement gets `UPCOMING`-status obligations for future months, not `PENDING` ones — confirmed via `statusFor()`'s `month.getTime() > currentMonth.getTime()` check) — so this is **already handled correctly** by existing logic; restating here so it's documented as a confirmed-correct behavior, not an unverified assumption.

---

## 15. Notification Matrix

🟢 **Existing templates and triggers**, consolidated from the bug-fix work and gap-analysis §1.10:

| Event | Template | Trigger | Recipient(s) | Tiers/thresholds |
|---|---|---|---|---|
| Expiry approaching | `agreement_renewal_reminder_v1` | Daily cron, `determineRenewalStage` | Tenant + Owner | 16-30 days left, 1-15 days left (bands, post bug #7) |
| Expiry day / overdue | `agreement_renewal_overdue_v1` | Same | Tenant + Owner | Day 0, ≥7 days overdue, ≥grace-period days overdue |
| Owner-side expiry alert | `owner_renewal_alert_v1` | Same cron pass, same stage | Owner | Mirrors tenant tiers |
| Offer sent | `renewal_offer_sent_v1` | `renewal_offer_sent` event (fired by `sendOffer`) | Tenant (+ guardian if applicable) | — |
| Offer declined | `renewal_offer_declined_v1` | `renewal_offer_declined` event | Owner | — |
| Discussion requested | `renewal_offer_discussion_v1` | `renewal_offer_discussion_requested` event | Owner | — |

🟢 **Suppressed once a successor exists** (ADR-013) — expiry reminders stop entirely, on the WhatsApp channel, once `has_successor` is true.

🟢 **Idempotent per (stage, agreement) or (event, offer)**, resilient to missed cron runs for the day-band stages (ADR-014).

🔴 **Missing per the vision, none implemented:** `Offer Viewed` (blocked on view-tracking not existing — §2.1/§5), `Offer Revised` (tenant-facing "your offer was updated" notice), `Offer Accepted` (owner-facing confirmation — partially covered today only when a deposit obligation was created, via the generic `obligation_created` event, not a renewal-specific message), `Signing Required` (a nudge once accepted-but-unsigned sits for N days), `Activated` (confirmation to either party once the successor goes live), `Completed`, and the vision's 3-day/1-day reminder tiers (only 30/15/0/7-overdue/grace-critical exist today).

🔴 **Should the in-app (non-WhatsApp) 30d/15d notifications in `agreement-lifecycle-service.ts`'s main loop get the same successor-suppression fix as the WhatsApp channel (ADR-013), or is the current WhatsApp-only scope intentional?** Flagged already during the bug-fix pass as a discovered-but-out-of-scope gap; restated here as a formal open question rather than an informal aside, since this spec is meant to resolve exactly this kind of ambiguity.

---

## 16. Failure & Recovery Scenarios

🟢 **Chain-race failure (bug #4 class):** if two concurrent operations touch the same predecessor/successor pair, the losing transaction throws (`"CONFLICT: ..."` or `"Renewal chain changed during cron activation (...)"`) and rolls back entirely — no partial state, no orphaned rows (post bug #4 fix; pre-fix, this could silently create an orphaned successor). The losing request's caller sees an error; there is no automatic retry at the application layer for this specific failure (a human/subsequent cron run would need to re-attempt).

🟢 **Cron activation failure (safeguard blocks, or an unexpected throw):** the draft is left exactly as it was (still `DRAFT`), a `RENEWAL_ACTIVATION_BLOCKED` event is logged with a `reason` field (for the four known safeguard blocks) or the error is caught by the outer per-draft `try/catch` and pushed to `summary.errors[]` (for anything else, e.g. an unexpected DB error). **The cron will retry indefinitely on every subsequent daily run** — there is no maximum-retry-count, no escalation, and no distinct "given up" state (this is the `FAILED` state gap from §2.1/§21.5).

🟢 **Deposit-unpaid failure:** both activation paths block identically (post bug #2 fix) and simply wait — no timeout, no automatic decline, no reminder specifically about the unpaid deposit beyond whatever generic overdue-obligation reminders the normal rent-reminder system sends (outside this subsystem's scope, per `docs/obsidian/Business-Rules.md` §"Notification triggers").

🔴 **Should there be a maximum wait time for an unpaid deposit before the renewal is auto-declined/expired, freeing the tenant to re-negotiate or the owner to withdraw?** No such timeout exists today — genuinely open.

🔴 **What happens if the successor agreement's room becomes unavailable before activation** (e.g., the room is deleted, or its capacity changes) **— since renewal doesn't touch room allocation at all** (§7), is this actually a possible failure mode? 🟢 **As-implemented: renewal activation never reads or validates room/capacity state at all** — it has no dependency on the room remaining available, since it doesn't reallocate the tenant. This scenario is therefore **not applicable** under the current (no room-change) design — restating this explicitly closes out one of the seven example questions the user posed, with a concrete "doesn't apply, here's why" rather than silence.

🔴 **PDF generation failure during activation:** 🟢 **As-implemented, this is already a *handled*, non-blocking failure** — `signRenewalAgreement` catches PDF-generation errors, still returns success with `pdfGenerated: false, pdfError: <message>`, and still commits the activation transaction (`agreement-renewal-signing-service.ts:317-328`). Cron activation does not attempt PDF generation synchronously at all (only manual signing does) — 🔴 **is cron-activated agreements never getting a PDF at all (vs. manual signing's best-effort attempt) an intentional asymmetry, or a gap?** Not resolved here.

---

## 17. Exception Handling & Edge Cases

Directly answering the seven example questions from the request, each tagged:

1. **"Is Withdrawn different from Expired?"** 🔴 Open — see §2.1, §21.4. As-implemented, neither concept exists as a distinct state; only `EXPIRED` (time-based) exists.
2. **"Should renewal be blocked by outstanding dues, or just warned?"** 🔴 Open — see §1. As-implemented, neither blocks nor warns at the point of generating/accepting an offer (only the renewal's *own* deposit top-up is enforced).
3. **"Should room changes be allowed during renewal?"** 🔴 Open — see §7. As-implemented, not supported at all (requires a separate Transfer/room-shift operation).
4. **"Can rent be changed after an offer is sent?"** 🟢 **Answered, not open:** not by editing the sent offer — only by revising it, which creates a *new* offer version (old one superseded) and requires re-sending. The tenant never sees an in-place-edited offer; they see a clearly distinct new version with the prior one's status flipped to `SUPERSEDED`.
5. **"What happens if the room becomes unavailable before activation?"** 🟢 **Answered, not open:** not applicable — renewal has no room dependency (§16).
6. **"What happens if the tenant doesn't sign but auto-activation is enabled?"** 🟢 **Answered, not open, but flagged as highest-priority:** auto-activation isn't a toggle, it's unconditional default behavior, and it activates without requiring any fresh signature at all, carrying the predecessor's signature forward (§13). This is the one answer in this list most likely to need product/legal re-evaluation rather than mere documentation.
7. **"Which policies are configurable per hostel?"** 🟢 **Answered:** exactly one, `renewal_grace_period_days`. Full inventory in §18.

Additional edge cases surfaced during this audit, not in the original seven:

🟢 **Double-signing race:** if two signing requests race for the same agreement, the `updateMany` count-check pattern (already present pre-bug-fix in `signRenewalAgreement`) causes the loser to throw `RENEWAL_DRAFT_REQUIRED`/`INVALID_RENEWAL_CHAIN` — already correctly handled.

🟢 **Predecessor flips to `AGREEMENT_EXPIRED` while a successor sits unsigned:** possible and already correctly tolerated — `isCurrentAgreementStatus` includes `AGREEMENT_EXPIRED` as still-renewable, and both activation paths accept it as a valid predecessor status.

🟢 **Tenant accepts an offer, then a move-out request is filed before signing/activation:** blocks both signing (existing check) and cron activation (added by the bug-fix pass) — the successor stays `DRAFT` indefinitely with no automatic cleanup (ties into the `FAILED`/timeout open questions above, since this is functionally a stuck state today).

🔴 **If a move-out is later cancelled, does the stuck renewal automatically resume, or does it require a fresh cron cycle / manual sign to notice the block has cleared?** 🟢 **As-implemented:** it resumes automatically on the *next* cron run (the move-out check is re-evaluated fresh every time, not cached) or the next manual sign attempt — no explicit "resume" action is needed, but there's also no notification telling anyone the block has cleared. Whether that silence is acceptable is a UX question for Phase 2, not a correctness gap.

---

## 18. Configuration / Policy Matrix

🟢 **Currently configurable (per-hostel, via `hostel.preferences_config`):**

| Setting | Key | Default | Read by |
|---|---|---|---|
| Grace period before renewal is "critically overdue" | `renewal_grace_period_days` | 30 | `resolveRenewalGracePeriodDays()`, `renewal-decision-service.ts:55-61` |

🔴 **Everything else the vision requests as configurable is currently hardcoded.** Full inventory, each with a 🟡 recommended default (= current hardcoded behavior, so promoting it to a setting is non-breaking) pending product confirmation of scope for Phase 2:

| Setting | Current hardcoded value | Location | 🟡 Recommended default if promoted to config |
|---|---|---|---|
| Default offer expiry window | 15 days | `renewal-offer-service.ts:185,322` | 15 days |
| Reminder day thresholds (30/15/7/etc.) | Fixed bands in `determineRenewalStage` | `renewal-status-service.ts` | 30/15/7/grace-period (current bands) |
| Auto-activation enabled | Always on, no toggle | `agreement-lifecycle-service.ts` (whole method) | On (preserve current behavior) — **contingent on §13's open question first** |
| Auto-activation requires fresh signature | No (carries predecessor's forward) | Same | No — **contingent on §13** |
| Negotiation enabled | Always available (discuss action always works) | `discussOffer` has no gate | Enabled |
| Owner signature required at signing | Not enforced as a distinct requirement (whichever fields are provided are accepted) | `signRenewalAgreement` | Not separately enforced (current) |
| Deposit policy default | Owner picks per-offer, `KEEP_AS_CREDIT` is the schema default | `RenewalOffer.deposit_refund_policy @default(KEEP_AS_CREDIT)` | `KEEP_AS_CREDIT` |
| Outstanding-due policy (block/warn/ignore renewal) | Ignore (§1) | n/a | **contingent on §21 decision** |
| Maximum offer revisions | Unlimited | n/a | Unlimited |
| Renewal window (days before expiry offers can start) | None (unrestricted) | n/a | Unrestricted |
| Room-change-during-renewal allowed | Not supported at all (not a policy toggle, a missing capability) | n/a | n/a — this is a capability gap, not a policy setting, per §7 |
| Notification preferences beyond target (TENANT/GUARDIAN/BOTH) | `notification_target` exists per-offer already | `RenewalOffer.notification_target` | Existing field is sufficient; no gap |

---

## 19. Complete Decision Table

🟢 Every distinct combination of (trigger, precondition state) and its as-implemented outcome, for the paths that exist today. This is the deterministic reference the vision's "complete decision table for every possible renewal outcome" asks for — organized by action, since the full cross-product of all state variables would be too large to be useful; each row is independently verifiable against the cited code.

### 19.1 `generateOffer` outcomes

| Predecessor status | Active offer exists? | Owner match? | Outcome |
|---|---|---|---|
| SIGNED/EXPIRING_SOON/AGREEMENT_EXPIRED | No | Yes | Offer created, `DRAFT` |
| DRAFT/RENEWED/TERMINATED/VOID | — | Yes | `400 BAD_REQUEST` |
| any eligible | Yes (DRAFT/SENT) | Yes | `409 CONFLICT` |
| any | any | No | `403 FORBIDDEN` |
| agreement not found | — | — | `404 NOT_FOUND` |
| eligible, room has category, no matching template | — | — | `400 BAD_REQUEST` (no template covers effective date) |

### 19.2 `acceptOffer` outcomes

| Offer status (pre-tx) | Expired? | Fresh in-tx status | Predecessor link state | Outcome |
|---|---|---|---|---|
| SENT | No | SENT | `renewed_to_agreement_id = null` | Successor created, offer → ACCEPTED, deposit obligation created if delta > 0 |
| SENT | Yes | — | — | `400 BAD_REQUEST` (expired) |
| DRAFT/ACCEPTED/DECLINED/EXPIRED/SUPERSEDED | — | — | — | `400 BAD_REQUEST` (wrong status) |
| SENT | No | **changed to non-SENT by a race** | — | `400 BAD_REQUEST` (post bug #4 fix — was previously silently allowed to proceed) |
| SENT | No | SENT | **already linked by a race** | `409`-equivalent thrown as `CONFLICT` (post bug #4 fix — was previously silently orphaning a successor) |

### 19.3 Activation outcomes (both paths, post bug-fix, now identical decision logic)

| Predecessor renewable? | Active move-out? | Lifecycle complete? | Deposit unpaid? | Chain still consistent at lock time? | Outcome |
|---|---|---|---|---|---|
| Yes | No | Yes | No | Yes | **Activated** — predecessor RENEWED, successor SIGNED, rent schedule generated |
| No | — | — | — | — | Blocked (logged, cron) / thrown `PREDECESSOR_NOT_RENEWABLE` (manual) |
| Yes | Yes | — | — | — | Blocked / thrown `MOVE_OUT_IN_PROGRESS` |
| Yes | No | No | — | — | Blocked / thrown `AGREEMENT_LIFECYCLE_INCOMPLETE` |
| Yes | No | Yes | Yes | — | Blocked (cron, logged reason) / thrown `SECURITY_DEPOSIT_UNPAID` (manual) |
| Yes | No | Yes | No | No (race) | Transaction throws, rolled back entirely, retried next attempt |

### 19.4 Notification-stage outcomes (per agreement, per cron run)

| has_successor? | daysOverdue ≥ grace? | daysOverdue ≥ 7? | daysUntilExpiry = 0? | daysUntilExpiry ∈ (0,15]? | daysUntilExpiry ∈ (15,30]? | rent overdue (state)? | Stage sent |
|---|---|---|---|---|---|---|---|
| Yes | — | — | — | — | — | — | **None** (suppressed, ADR-013) |
| No | Yes | — | — | — | — | — | `30_DAY_CRITICAL` |
| No | No | Yes | — | — | — | — | `7_DAY_OVERDUE` |
| No | No | No | Yes | — | — | — | `EXPIRY_DAY_ALERT` |
| No | No | No | No | Yes | — | — | `15_DAY_REMINDER` |
| No | No | No | No | No | Yes | — | `30_DAY_REMINDER` |
| No | No | No | No | No | No | Yes | `EXPIRED_RENT_OVERDUE` |
| No | No | No | No | No | No | No | **None** |

---

## 20. State Transition Diagram (agreement-pair level, consolidated)

🟢 This diagram shows the **actual, as-implemented** dual-agreement status view (predecessor + successor together), independent of the still-🔴 12-state `RenewalCase` model in §2 — this is the ground truth today, verified against every status-write in the codebase:

```
PREDECESSOR                              SUCCESSOR
─────────────                            ─────────
SIGNED ──┐
         │ (daysLeft ≤ 30)
         ▼
EXPIRING_SOON ──┐
                │ (daysLeft ≤ 0, no successor yet)
                ▼
        AGREEMENT_EXPIRED                (still renewable — isCurrentAgreementStatus
                                           includes this status)

  [ At any point while predecessor ∈ {SIGNED, EXPIRING_SOON, AGREEMENT_EXPIRED} : ]

        offer accepted / draft created ─────────────────────▶  (created) DRAFT
                                                                     │
                                          ┌──────────────────────────┤
                                          │                          │
                                explicit sign-renewal          agreement_start_date
                                (any time after creation)      reached, cron attempts
                                          │                    activation
                                          ▼                          ▼
        predecessor: RENEWED  ◀───────────┴──────────────────────────┘
                                                                     │
                                                                     ▼
                                                                  SIGNED
                                                          (successor is now itself
                                                           a "predecessor" for its
                                                           own future renewal cycle
                                                           — lifecycle restarts)

  [ Terminal, does not restart: ]
  TERMINATED, VOID  ── reached via unrelated flows (not renewal), never renewal-eligible again
```

---

## 21. Consolidated Open Questions Requiring Product Sign-off

Every 🔴 in this document, in priority order (highest-stakes first):

1. **[§13, HIGHEST PRIORITY]** Does offer acceptance constitute sufficient consent for auto-activation without a fresh signature on the successor document, or should this require an explicit signature (making auto-activation conditional, not unconditional)? Has legal-validity implications, not just UX.
2. **[§2.1]** Is `READY_TO_SEND` meant to be a distinct time-based state, or a validation gate before the `PREPARING → send` transition (no storage needed)?
3. **[§2.1]** Is `READY_FOR_ACTIVATION` meant to mean "signed early, waiting for effective date" or something else?
4. **[§2.1]** Is `COMPLETED` meant to be distinct from `ACTIVE` at all, given PDF + rent-schedule generation already happen synchronously at activation?
5. **[§2.1, §4, §11]** Does `WITHDRAWN` need to exist as a first-class action/state distinct from letting an offer expire or declining on the tenant's behalf?
6. **[§2.1, §16]** Does `FAILED` need to be a surfaced, distinct state (with a retry limit / escalation), or is indefinite silent cron retry the intended behavior?
7. **[§1]** Should outstanding rent dues on the predecessor block, warn, or have no effect on renewal eligibility/acceptance?
8. **[§1]** Should a renewal "window" (earliest/latest an offer can be generated relative to expiry) be introduced?
9. **[§6.1]** Should a maximum rent-increase percentage or a warning threshold exist?
10. **[§6.3]** Confirm `KEEP_AS_DEPOSIT` as an intentional ledger no-op (not a bug to be "fixed" later).
11. **[§7]** Should room-change be integrated into the renewal flow, or explicitly documented as always-separate (via Transfer/room-shift)?
12. **[§8]** Same question as §7, for hostel-change — integrate, or document the Transfer-then-Renew (or Renew-then-Transfer) sequencing as the sanctioned path?
13. **[§10]** Should offer revisions have a maximum count?
14. **[§12]** Should offer-expiry windows scale based on proximity to `agreement_end_date`, to prevent `offer_expires_at` from ever exceeding the lease's own end date?
15. **[§14 note, informational only — already answered as correctly-handled, included for completeness]** None — restated here only to confirm it does *not* need a decision, having been verified as already correct.
16. **[§15]** Should the same successor-suppression fix (ADR-013) extend to the plain in-app 30d/15d notifications, not just WhatsApp?
17. **[§16]** Should there be a maximum wait time for an unpaid deposit before auto-decline/expiry?
18. **[§16]** Is cron-activated agreements never getting a PDF (vs. manual signing's best-effort attempt) intentional?
19. **[§3]** Is the unused `REVISED` enum value meant to replace `SUPERSEDED` specifically for the revise path, or should it be removed?
20. **[§4]** Is tenant-role access to `renewal-draft` creation and to supplying owner-signature fields on `sign-renewal` intentional, or over-permissioned?

---

## Next step

Once the above are resolved (fully, partially, or explicitly deferred with a stated default), this document becomes the frozen contract §0 of the gap-analysis references. Phase 2 (Renewal Case architecture design) should cite specific numbered items from §21 by their resolution, not restate this spec's reasoning — keeping the two documents from drifting out of sync as decisions land.
