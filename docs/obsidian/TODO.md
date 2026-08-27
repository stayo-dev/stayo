---
tags: [todo, backlog]
---

# TODO / Backlog

Related: [[Bugs]] · [[Features]] · [[Decisions]]

Running backlog of documentation and follow-up work. Not a replacement for a real issue tracker — use this for things worth remembering across sessions that don't have a ticket yet.

## Documentation backlog

- [ ] Add real ER diagram to [[Database]] (relation table exists, not yet rendered as a diagram).
- [ ] Add sequence/state diagrams listed as TODO in [[Architecture]] (move-out state machine is a good first Mermaid `stateDiagram-v2` candidate — full graph is already written out in [[Business-Rules]]).
- [ ] Refresh `docs/data-models/schema.md` and `docs/data-models/enums.md` — confirmed stale against the live schema (19 undocumented models, 13 undocumented enums, `AdvanceLedgerReason`/`AdvanceLedgerType` renamed to `FinancialLedgerReason`/`FinancialLedgerType` without the docs catching up). See [[Database]] §6.

## Unknowns flagged during the 2026-07-18 codebase audit (need team clarification, not guesses)

- [ ] `lib/services/activity-service.ts` vs `activity.service.ts` — two near-duplicate `ActivityService` classes; which is canonical? See [[Backend]].
- [ ] Which of the four overlapping "financial issue" tables (`financial_invariant_failures`, `payment_operational_anomalies`, `payment_reconciliation_items`, `financial_reconciliation_issues`) is currently authoritative? See [[Database]].
- [ ] `paymentAttempt`'s two generations of provider-reference fields (`merchant_txn_id`/`gateway_txn_id` vs `merchant_transaction_id`/etc.) — which is canonical at the code level? See [[Database]].
- [ ] Whether rent is prorated anywhere for partial-month billing (not found in `lib/billing/engine.ts`) — check `agreement-rent-schedule-service.ts`. See [[Business-Rules]].
- [ ] **Decide what renewal's `KEEP_AS_CREDIT` deposit policy should do** now that future rent credit is gone from the payment path ([[Decisions#ADR-036|ADR-036]]). `renewal-offer-service.ts` is the only remaining writer of `FUTURE_RENT_CREDIT_TOPUP` — it carries an excess security deposit forward at renewal. Options: settle it against the next installment(s), force `REFUND`, or keep it as the one legitimate credit.
- [ ] Full enumeration of owner-side WhatsApp assistant commands (only `HELP`/`DUES` confirmed; the assistant uses ID-based interactive menus, not a flat command table like the tenant side). See [[Business-Rules]].
- [ ] Whether `components/landing-v2/*` or `components/marketing/*` is the live marketing component set in `apps/frontend` — both exist with overlapping names. See [[Frontend]].
- [ ] Whether `apps/frontend/src/services/index.ts` (root barrel) still has any consumers, or is dead. See [[Frontend]].
- [ ] Three routes with no auth guard found in code (`GET /api/owner/integrity`, `GET /api/metrics`, `GET /api/debug/whatsapp-health`) — confirm intentionally public/internal vs. a real gap. See [[APIs]].
- [ ] `/api/owners/invitations` vs `/api/tenants/invite` — near-duplicate routes calling the same service; consolidate or document why both exist. See [[APIs]].

## Known follow-up work (carried from [[Bugs]])

- [ ] Fix manual ledger POST route (`/api/tenants/[id]/financial-ledger`) enum validation mismatch — see [[Bugs]].
- [ ] Live-database audit for tenants with stale simultaneous Outstanding + Future Credit — see [[Bugs]].
- [ ] **Sweep every cron route against `apps/backend/vercel.json`.** 16 cron routes exist; only a handful are scheduled, and `food-carry-forward` was correct, complete and unscheduled for six weeks with the docs asserting otherwise — a route being written is not evidence it runs, and reading the code alone will not catch this. **why:** the same class of silent omission almost certainly exists elsewhere — **related:** [[Bugs]], [[Food]], [[APIs]].
- [ ] **Decide what `hostels.food_included` is for.** Written by onboarding and `hostel-provisioning-service`, validated in `src/validators/hostels`, and read by **nothing** in the food module — and at audit time it was `false` on both hostels *despite both running published menus*, so it is unused and wrong. Either gate the Food tab on it or drop the column — **related:** [[Food]] §15, [[Database]].
- [ ] **Tenant Food tab labels the latest *published* month "Current", not the actual calendar month.** If September is unpublished, a tenant sees August's Monday presented as today's meals with no staleness cue (`useTenantFoodSchedule`). **why:** it silently shows students the wrong menu — **related:** [[Food]] §15.

### Food Phase 2 — deferred by product decision, 2026-08-05

Phases 0 and 1 shipped and the module is **MVP production-ready**; work moved back to the remaining owner workflows. When Food resumes, this is the agreed order — it is not the design doc's original 14→23 sequence:

- [ ] **Phase 2a first — the read model, and nothing that migrates.** One `food-memory-service.ts` (mirroring `getExpenseMemory`) feeding four consumers: library card stats (served count, last served, votes, ≥3 threshold), history-as-story, a Universal Search provider, and Action Center food cards. Plus food spend per head per day, and the `food-service.ts` extraction that kills the four copies of `firstOfMonth`. **why:** all reads and composition — high value, no schema change, nothing that can damage a live menu — **related:** `docs/design/food-module-redesign.md` §8.2, [[Food]].
- [ ] **Phase 2b — blocked on a test database.** The `is_manual` per-cell lock, the Plan-<Month> flow (Build / Fill gaps / Shuffle unlocked / Start over), one-tap "Ask students", copy-library-between-hostels. And Phase 3's `serve_date`. **why:** these are structural migrations, and the standing rule is that **any structural migration waits for `DATABASE_URL_TEST`**; additive non-schema work continues to ship on pure tests, as Phases 0–1 did — **related:** [[Food]] §15, `docs/design/food-module-redesign.md` §8.1.
- [ ] **Provision `DATABASE_URL_TEST`.** Gates Phase 2b/3, and also the parked TOCTOU fix on `POST /api/food/schedules/generate` (the in-transaction re-decide narrows the race but takes no row lock; the atomic form is a conditional `updateMany … where status NOT PUBLISHED`). **why:** shipping an untested concurrency or migration change is worse than a documented one — **related:** [[Food]], [[Bugs]].

## Template

```markdown
- [ ] <task> — **why:** <reason> — **related:** [[links]]
```

## See also
- [[Bugs]] for the open issues these tasks often trace back to
- [[Changelog]] for what's already been done


## Post-launch — recategorise two WhatsApp templates from MARKETING to UTILITY

**Deferred deliberately on 2026-08-07 — do this after launch, not before.**

`stayo_owner_onboarding_complete` ("your hostel is live") and `stayo_owner_account_activated` were submitted to Meta under the **MARKETING** category, but both are transactional in intent. Marketing templates are subject to per-user marketing opt-out and Meta's marketing frequency caps, so an owner who has opted out of marketing may **never receive them** — and nothing in our logs would distinguish that from a successful send.

The other three funnel templates (`lead_received`, `invitation`, `lead_rejected`) are correctly UTILITY.

Changing the category requires resubmitting the template for Meta review, which is why it is deferred: the risk is silent non-delivery to a subset of owners, not a broken flow, and re-review would stall launch.

When picked up: edit the category in WhatsApp Manager, wait for approval, then run `npm run check:whatsapp-template` to confirm shape and language still match. See [[Business-Rules]] for the full verified template table.

## Owner tenant profile — slice 2 and adjacent gaps (raised 2026-08-26)

Spec: `docs/superpowers/specs/2026-08-26-owner-tenant-profile-design.md`.

- **Vault document-share review has no owner UI.** `GET /api/owner/document-shares` and `PATCH /api/owner/document-shares/:shareId/verdict` (the identity vault, ADR-110/111/112) have **zero frontend callers**. A tenant who shares a vault document with a hostel creates a review request no owner can see or act on. `documentGroups.ts` already accommodates the group and is called with an empty share list until this lands.
- **The owner↔tenant document conversation is read-only.** `POST /api/tenants/:id/documents/:docId/message` exists, `tenantService.postDocumentMessage` wraps it, and `parseRejectionThread` already parses the thread — but the review card shows only the owner's latest rejection line. The tenant's replies are fetched and discarded.
- ~~`CorrectPaymentModal` has no mount point.~~ **Done 2026-08-27** — wired into `TenantDetailPage`'s Activity tab. One limit worth knowing: `recent_activity` is capped at 15 mixed items server-side, so only payments inside that window are correctable from the profile. A fuller payment history surface would lift that.
- **Per-tenant service requests.** The owner sees complaints hostel-wide at `/owner/more/service-requests` only; there is no way to ask what *this* tenant has raised from their profile.
- **Risk score detail.** `/api/tenants/:id/score` returns `insights[]` and `suggestions[]`; the card renders `[0]` of one of them, with no link to the payments driving the score.
- **Unverified:** the document-download 401 described in [[Bugs]] was traced from source but never reproduced against a running instance. Worth confirming the `hms_session` cookie's real lifetime before assuming the same failure mode exists elsewhere (receipts, exports) that also open backend URLs directly.

- **The monthly rent cron writes obligations with no `agreement_id`.** `rentGenerationService.generateMonthlyRent`'s `rentRows`/`maintRows` omit the field entirely, so only agreement-signed tenants get linked obligations. The rent-change path no longer depends on that link ([[Bugs]], 2026-08-26), but anything else filtering obligations by `agreement_id` inherits the same blind spot — worth an audit. Linking it in the cron is **not** a safe drop-in: `@@unique([agreement_id, rent_month, obligation_type])` would collide with the schedule service's rows once a `DRAFT` agreement is signed, and `skipDuplicates` would silently skip the real schedule.

- **Rent *generation* still branches on the agreement system.** `rentGenerationService.generateMonthlyRent` builds `tenantsWithAgreementSchedules` from signed agreements and takes a different path for tenants who have one. The rent-*change* path was decoupled in [[Decisions#ADR-125|ADR-125]]; generation was not. Worth deciding whether an agreement should influence generation at all, given an owner can switch the whole ceremony off.

- **`payment-service` still refreshes the old tenant score.** After every payment it calls `tenantAnalyticsService.calculateTenantScore`, which writes the superseded algorithm's number into `tenant_behavior_scores.score`. Nothing reads that column since [[Decisions#ADR-126|ADR-126]] — the new scorer derives on read — so this is dead work on the payment path. Removing it is safe but touches payment code, which is not a path to change casually alongside a scoring feature.
- **Reviews carry no reviewer photo.** `photo_url` now renders on the owner tenant list and profile, but a published review shows no face — the review response has no reviewer photo field at all. Adding one is a backend change to the review projection.

- **`/tenant/profile/details` is an orphaned route with a fourth completion percentage.** It renders the legacy `TenantProfilePortalPage` from the frozen `src/portal/` tree, and **nothing anywhere links to it** — it is reachable only by typing the URL. It computes its own `completionPercent` from its own field list, while `profile-identity-service` documents `completion_percent` as the canonical number that surfaces read "instead of each computing their own (three different ad hoc versions existed before this)". Either delete the route and the page, or point it at the canonical number — but not leave a fourth version of a figure the tenant is judged by.

## Owner-managed tenants — Phase 2 and follow-ups (raised 2026-08-27)

Spec: `docs/superpowers/specs/2026-08-27-owner-managed-tenants-design.md`. Phase 1 (adopt, add-directly, the conditional invariants, reach without an account) shipped — see [[Features]], [[Business-Rules]], [[Decisions#ADR-127|ADR-127]]. Phase 2 was deliberately sequenced out and is **not built**.

- [ ] **Build the OTP-gated claim flow (design spec §7).** A tenant enters their phone, verifies by OTP, is shown a confirmation card naming the hostel/room/owner ("You're listed at Sunrise Boys Hostel, Room 204, since 12 July. Owner: Ramesh.") before anything links, and on confirm flips `OWNER_MANAGED → SELF_SERVE` with `profile_id` set on the **same** `tenant_id` — obligations, payments, receipts, ledger and allocations all preserved for free, since they hang off `tenant_id` not `profile_id`. The spec is explicit that an owner marking a number verified is never accepted as proof of possession — only the tenant's own OTP is. Also covers: a multi-match picker when several hostels/tenancies match the number, marketplace-profile reuse when the verifying person already has a `profile: phone: null` account (ADR-113), and owner notification ("Rakesh has joined the app") on claim. — **why:** this is the other half of the feature — Phase 1 lets the owner keep records and reach the tenant by WhatsApp, but the tenant has no self-serve path back onto the platform until this ships — **related:** [[Business-Rules]], [[Database]], [[Decisions#ADR-127|ADR-127]].
- [ ] **Once the claim route exists, Phase 1's reminder copy to an owner-managed tenant should carry a claim link.** The design spec (§8, point 4) calls for every WhatsApp message to an owner-managed tenant to include a zero-pressure invitation to self-serve. Phase 1 shipped the reach (WhatsApp reminders now reach these tenants via `resolveTenantPhone`) but not the link, because there is nowhere for it to point yet — `whatsappReminderDeliveryService.sendRentReminder`'s template does not currently accept one. — **why:** without it, an owner-managed tenant who *would* claim their tenancy if they knew they could has no way to discover that — **related:** [[Business-Rules#Notification triggers|Business-Rules]], [[Features]].
- [ ] **Build Revoke.** `SELF_SERVE → OWNER_MANAGED` for a tenant who stopped using the app, reusing the existing Redis session-revocation deny-list. Money is untouched by design (obligations keep generating, payments stay recordable) — only login access closes, and the owner must be warned plainly before triggering it, since it signs the tenant out. — **why:** specified in the design (§6) as one of the four transitions, not yet built — **related:** `docs/superpowers/specs/2026-08-27-owner-managed-tenants-design.md` §6.
- [ ] **A fifth site still inner-joins `profiles` on `tenant.profile_id` and was not converted with the other four.** `src/services/settlements/payout-notifications.ts:62`'s `tenantName()` helper (`JOIN profiles pr ON pr.id = t.profile_id`) backs the "a tenant paid you" in-app notification. Lower severity than the four fixed sites — the function already degrades to the literal string "A tenant" on any failure, including a missed join, rather than dropping the notification — but it is the same defect shape: an owner-managed tenant's payment would notify the owner as an anonymous "A tenant paid ₹X" instead of by name. — **why:** consistent with the class of bug fixed in [[Bugs]] for the other four sites, just not required for adoption's core promise (rent chasing) to work — **related:** [[Bugs]], [[Business-Rules]].
- [ ] **The design spec's fourth activation invariant was never implemented.** `docs/superpowers/specs/2026-08-27-owner-managed-tenants-design.md` §5 calls for a check that no tenant may hold both a `TenantPolicyAcceptance` and be `OWNER_MANAGED` without having once been `SELF_SERVE` — meant to catch a forged-consent regression. `scripts/activation-invariants-check.ts` as shipped implements only the other three `OWNER_MANAGED` checks (display name + phone present, an attestation exists, no linked auth identity). — **why:** it's the specific check the spec names for the regression this whole ADR is designed to prevent (a `TenantPolicyAcceptance` fabricated for someone who never registered) — **related:** [[Database]], [[Business-Rules]], [[Decisions#ADR-127|ADR-127]].
- [ ] **Apply the `20260827100000_owner_managed_tenants` migration before any of this code reaches a real environment.** `access_mode`, `display_name` and `tenant_owner_attestations` exist only in `apps/backend/prisma/schema.prisma`/`prisma/migrations/` — **not applied to dev, test, or production as of this writing.** Per the 2026-08-14/2026-08-22 outage pattern ([[Bugs]]), a `tenants` column declared in `schema.prisma` but absent from the database 500s every unselected read of that table, and `tenants` is read on effectively every authenticated request. — **why:** shipping the declaring code ahead of the migration is the exact failure mode that has taken production down twice before — **related:** [[Database]], [[Bugs]].
