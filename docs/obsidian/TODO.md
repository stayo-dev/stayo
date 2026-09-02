---
tags: [todo, backlog]
---

# TODO / Backlog

## v2 — un-shelve the Stayo Discover marketplace (2026-09-03, [[Decisions#ADR-170|ADR-170]])

v1 removed the public marketplace + owner listing/marketing surfaces from the frontend and gated the APIs behind `MARKETPLACE_ENABLED`. All code is on disk. To bring it back:

- [ ] **Backend:** set `MARKETPLACE_ENABLED=true` in the deployed backend env (and `.env` / `.env.test` locally). Confirm `/api/discover/hostels`, `/api/owner/hostels/<id>/marketing`, `/api/platform-admin/marketing-reviews` stop returning `410`. Then delete the `1b.` marketplace gate in `apps/backend/middleware.ts` once it is permanently on.
- [ ] **Router:** re-register `DiscoverRoutes()` in `apps/frontend/src/app/router/AppRouter.tsx` (it currently mounts `ProfileRoutes()` directly — keep `/profile` working after re-nesting or leave it hoisted).
- [ ] **`/`:** decide whether `/` returns to the `WelcomePage` audience fork (revert `PublicRoutes.tsx` + remove the returning-owner auto-forward added to `LandingPage.tsx`) or stays owner-first with a separate tenant entry point.
- [ ] **Nav:** restore the `{ to: '/discover', label: 'Explore', Icon: Compass }` entries in `apps/frontend/src/app/nav/appNavConfig.ts` (`EXPLORE_PROFILE_TABS` + `ACTIVE_TENANT_TABS`) and revert `appNavConfig.test.ts` / `tenancyState.test.ts` / `crossSurfaceLogin.test.ts` / `crossSurfaceLogin.ts` / `AuthCallbackPage.tsx` / `ProtectedTenantRoute.tsx` / `TenantFarewellPage.tsx` / `guideCopy.ts` back to routing no-tenancy users at `/discover`.
- [ ] **Owner:** restore the `marketing` tab in `HostelDrilldownLayout.tsx` and the real `<Route path="marketing">` (with its lazy `HostelMarketingPage` import) in `OwnerRoutes.tsx`.
- [ ] **Admin:** restore `/admin/listings*` routes + imports in `AdminRoutes.tsx`, the `Hostel Listings` nav item in `adminNav.ts`, its `pageHeaders.ts` entry, the Overview review-queue `listings` row in `overviewModel.ts` + `OverviewPage.tsx`, and revert `adminNav.test.ts` / `overviewModel.test.ts`.
- [ ] **Docs:** flip the "SHELVED for v1" banners in [[Features]], [[APIs]], [[Frontend]] back off.

## An owner-turned-tenant-of-another-hostel cannot yet reach that tenant portal (2026-09-01, [[Decisions#ADR-162|ADR-162]])

- [ ] `profile.role` is a single global field (`OWNER | TENANT | ADMIN`) that `getSession()`/`resolveSupabaseSession()` derive the entire authenticated session's role from. ADR-162 fixed `owner-managed-tenancy-service.ts` (and, at the time, `tenancy-claim-service.ts` — since removed, see [[Decisions#ADR-163|ADR-163]]) to stop refusing an owner of Hostel A from becoming a tenant of Hostel B — but doing so does not change that profile's `role` column, so the resulting account still authenticates as `OWNER` and cannot pass `resolveTenantScope` (which requires `session.role === "TENANT"`) to actually use the Hostel B tenant portal. Needs a real decision: a per-hostel role model, a session "acting as" mechanism, or something else — not a code patch to guess at.

## Owner tenant detail — inconsistencies seen alongside the move-out fix (2026-08-28)

- [ ] **A `CANCELLED` tenancy rendered a `Docs Pending` status badge.** The badge is computed from document state and ignores the tenancy status, so a closed tenancy advertises outstanding paperwork. Decide which wins and make the badge say it.
- [ ] **Settlement preview reported "could not be calculated"** on the same tenant. Worth tracing whether that is a consequence of the cancelled status or an independent failure.

## Connect an enquiring seeker to their waiting tenancy, without a second OTP (2026-08-30)

The Explore "Already staying at a hostel?" prompt was removed — see [[Changelog]] — because it sent someone who had *already* proved their phone through a second, separate OTP ceremony to reach the same tenancy.

- [ ] **Surface the waiting tenancy at enquiry time instead.** Since [[Decisions#ADR-078|ADR-078]] a seeker verifies their number when they send their first enquiry, and `verifyOtp` writes `phone_verified`/`mobile_verified` on every profile matching it. At that moment the backend can look up an `OWNER_MANAGED` tenancy on that number and tell them it is waiting.
- [ ] **Decide whether that can skip the claim OTP.** It should not be assumed. `TENANCY_CLAIM` is deliberately absent from `SKIPPABLE_OTP_PURPOSES` ([[Business-Rules]]) and the claim consumes a single-use proof, because claiming transfers a financial record. Reusing an enquiry-time verification means accepting a *stale* proof of possession — a real weakening of a deliberate control, and a product/security call rather than a refactor. An intermediate option is to keep the OTP but pre-fill the number and skip straight to the tenancy, so the ceremony is one tap rather than a flow.

## An enquiry can now arrive with no move-in date (2026-08-30)

[[Decisions#ADR-158|ADR-158]] made the seeker's move-in date default to "Flexible" and send nothing, rather than defaulting to today. The field was always optional at the API, but in practice every enquiry carried a date, so owner-side surfaces have never had to render its absence.

- [ ] **Check every owner-side surface that shows an enquiry's move-in date** renders a missing one as "Flexible" rather than blank, "Invalid date", or today. The owner enquiry list/detail, the lead funnel, and any WhatsApp notification template that interpolates it.
- [ ] **Decide whether "Flexible" should sort differently** in the owner's enquiry queue — a seeker with no date is not necessarily less urgent than one moving in next month.

## Piece B must restore the payout-account action (2026-08-30)

The failed-payout alert (`features/owner-money/payouts/payoutState.ts`) lost its "Check payout account" button because `/owner/more/payout-account` was never a route. The API behind it (`GET/PATCH /api/owner/payout-account`) exists and works, and the fields live on `profiles` (migration 070) — only the screen is missing.

- [ ] When Piece B builds the *Where your money goes* row, restore the action pointing at it, and restore the assertion in `payoutState.test.ts` that the alert offers a way to fix the bank details.
- [ ] The `'unavailable'` row state and `UNAVAILABLE_LABEL` survive in `MoreConfigurationHubPage`, `MoreConfigAccountPage` (staff roles, two-factor) and `config/agreements.ts`. Those surfaces are rebuilt in pieces B and C; delete the state with the last of them.

## Agreement PDF — legal review outstanding (2026-08-28)

- [ ] **Have a lawyer review the standard clauses** added in `lib/pdf/agreement-content.ts` (entire agreement, amendment, severability, governing law and jurisdiction, stamp duty). They are conventional neutral wording chosen to make the document structurally complete, not drafted or reviewed by counsel.
- [ ] **Decide the stamp-duty position properly.** The clause currently states that duty and registration are the parties' responsibility and that the electronic record is not itself stamped. Whether Stayo should instead facilitate e-stamping is a product decision.
- [ ] **Consider a witness block.** Not added, because whether witnesses are wanted for a hostel accommodation agreement is a legal/product call rather than a formatting one.
- [ ] `agreementReference` and `verificationUrl` are read off the render data with a fallback to empty — wire them from the agreement record so the page footer always carries a real reference.

## Retired hostel identity still in backend source (2026-08-28)

`npm run check:branding` in `apps/backend` now scans source and currently fails on three files. Each needs a different call, which is why none was changed with the receipt redesign:

- [ ] `lib/sanity/landingContent.ts` — a complete legacy hostel identity (name, email, postal address, SEO title) used as **fallback landing content**. A genuine public-facing leak; replace with Stayo/neutral defaults.
- [ ] `lib/security/owner-integrity-guard.ts:24` — the retired address sits in what reads as a security allowlist. **Do not change blind**; work out what the list gates first.
- [ ] `lib/services/notifications/owner-whatsapp-assistant.ts` — 3 sites of owner-facing copy ("Welcome to … Assistant"). Owner surface, so out of the resident/guardian scope.
- [ ] Once cleared, wire `check:branding` into the backend build the way `apps/frontend` wires its `dist` scan, so this cannot regress.

## Invalid `prisma.<model>` accessors — 18 latent runtime failures (2026-08-27)

`lib/db` exports `prisma` as `any`, so a mistyped model accessor compiles, builds, and throws `Cannot read properties of undefined` the moment the line runs. One of these took inbound WhatsApp down entirely ([[Bugs]]). **18 more are still in the tree**, verified against a generated client:

| Wrong | Correct | Files |
|---|---|---|
| `prisma.visitorLead` | `visitor_leads` | 6 (incl. `discovery-service`, `admissions-service`) |
| `prisma.paymentWebhookEvent` | `payment_webhook_events` | 4 |
| `prisma.paymentOperationalAnomaly` | *check schema* | 4 |
| `prisma.paymentReconciliationRun` | *check schema* | 3 |
| `prisma.paymentReconciliationItem`, `paymentAttemptStatusEvent`, `paymentProviderVerificationSnapshot`, `ownerOnboardingState` | *check schema* | 2 each |
| `leadActivity`, `leadNote`, `roomReservation`, `messageLog`, `messagePack`, `migrationAuditRun`, `financialInvariantFailure`, `rentGenerationLedger`, `tenant_advance_ledger`, `leads` | *check schema* | 1 each |

- [ ] Fix them. Several sit in payments/reconciliation, so verify each against `schema.prisma` rather than pattern-matching — a wrong "fix" here is worse than the bug.
- [ ] Then widen `tests/whatsapp-prisma-accessors.test.ts`'s `WATCHED` list to `lib/`, `src/` and `app/`. It is scoped to the WhatsApp tree today only because widening it now fails on all 18.
- [ ] Consider typing `lib/db`'s export as `PrismaClient` instead of `any`, which would make the compiler catch this class permanently. Large blast radius — likely surfaces many pre-existing errors, so scope it deliberately.

## WhatsApp command center — follow-ups (2026-08-27)

- [ ] **Submit the three generation-2 rent templates to Meta**: `stayo_rent_due_soon`, `stayo_rent_due_today`, `stayo_rent_overdue`. Exact bodies, parameter order, footer and button are in `providers/whatsapp/rent-reminder-template-contract.ts`. Until approved and named in `WHATSAPP_RENT_DUE_SOON_TEMPLATE` / `WHATSAPP_RENT_DUE_TODAY_TEMPLATE` / `WHATSAPP_RENT_OVERDUE_TEMPLATE`, readers still receive `- HMS` and "pay using the app". See [[Bugs]].
- [ ] **Confirm `stayo_guardian_whatsapp_activated` is approved in Meta** before relying on the onboarding handshake. It is wired and idempotent, but has never been sent against a live WABA — and the [Help] quick-reply path (webhook type `button`) is covered only by a unit test asserting the payload shape, not by a real tap.
- [ ] **Delete `whatsapp-resident-context.ts` and `whatsapp-balance-formatter.ts`.** Both are dead — no live caller since [[Decisions#ADR-128|ADR-128]] — and were left in place to keep that change reviewable.
- [ ] **End-to-end verification against a real WABA.** Nothing in this change has been exercised against live WhatsApp: the guardian OTP round trip, the interactive picker for a multi-resident guardian, and the payment-confirmation push are all covered only by pure unit tests. `DATABASE_URL_TEST` is still unset, so the DB-backed suite could not run either.
- [ ] **Decide whether guardians need a language other than English.** The vocabulary and copy are English-only; the structure supports per-locale variants but no decision has been taken, and each language multiplies the Meta template approval count.


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

Spec: `docs/superpowers/specs/2026-08-27-owner-managed-tenants-design.md`. Phase 1 (adopt, add-directly, the conditional invariants, reach without an account) shipped — see [[Features]], [[Business-Rules]], [[Decisions#ADR-133|ADR-133]]. Phase 2's claim flow has now also shipped — see below. **2026-08-28:** the orphaned-identity defect Phase 1's `profile_id: NULL` design caused in production is fixed — see [[Decisions#ADR-135|ADR-135]], [[Bugs]] — but it ships its own unapplied migration and pending data cleanup, both tracked below alongside Phase 1's still-unapplied one.

- ~~**Build the OTP-gated claim flow (design spec §7).**~~ **Done 2026-08-27 (Phase 2), removed 2026-09-01** — `POST /api/tenancy-claim/lookup` (display data only) and `POST /api/tenancy-claim/confirm` (re-validated OTP proof, single-use consumption, `OWNER_MANAGED → SELF_SERVE` flip on the same `tenant_id`, a real `TenantPolicyAcceptance`, session mint) shipped at `/claim`. **This entire flow was deleted 2026-09-01** — the problem it solved (an owner-managed tenancy's own activation link having nowhere to resolve) is now solved directly inside `resolveByToken`/`completeActivation` instead. See [[Decisions#ADR-163|ADR-163]], [[Business-Rules]].
- [ ] **Phase 1's reminder copy to an owner-managed tenant should carry their real activation link.** The design spec (§8, point 4) calls for every WhatsApp message to an owner-managed tenant to include a zero-pressure invitation to self-serve. Phase 1 shipped the reach (WhatsApp reminders now reach these tenants via `resolveTenantPhone`) but not the link — `whatsappReminderDeliveryService.sendRentReminder`'s template does not currently accept one. Simpler now than when this was written: there is no longer a separate claim route to point at, just the tenant's own `tenant.invitation.activationLink` (already resolvable, see [[Decisions#ADR-163|ADR-163]]) — the template just needs the parameter. — **why:** without it, an owner-managed tenant who would self-serve if they knew they could has no way to discover that — **related:** [[Business-Rules#Notification triggers|Business-Rules]], [[Features]].
- [ ] **Build Revoke.** `SELF_SERVE → OWNER_MANAGED` for a tenant who stopped using the app, reusing the existing Redis session-revocation deny-list. Money is untouched by design (obligations keep generating, payments stay recordable) — only login access closes, and the owner must be warned plainly before triggering it, since it signs the tenant out. — **why:** specified in the design (§6) as one of the four transitions, not yet built — **related:** `docs/superpowers/specs/2026-08-27-owner-managed-tenants-design.md` §6.
  - **Known interaction to resolve when Revoke lands (raised during Phase 2 Task 3, 2026-08-27):** two of `scripts/activation-invariants-check.ts`'s conditional `OWNER_MANAGED` checks will hard-fail for a *legitimately* revoked tenant, not just a genuine bug, because Revoke's design (§6) keeps the row and its linked profile — it only closes access via the Redis deny-list, which this Postgres-only script cannot observe. (1) `ownerManagedWithAuthIdentity` ("OWNER_MANAGED tenant must not hold a linked auth identity") — a revoked tenant keeps `profiles.auth_user_id` set. (2) `ownerManagedWithPolicyAcceptance` ("OWNER_MANAGED tenant must not hold a TenantPolicyAcceptance", added this task) — a tenant who claimed (and so wrote a real `TenantPolicyAcceptance`) and was later revoked keeps that row. The design spec §5 already anticipated the second case, phrasing the invariant as "…without having once been `SELF_SERVE`"; this task implemented the simpler unconditional form because, with no Revoke transition yet, no `OWNER_MANAGED` tenant can currently have been `SELF_SERVE` before, so the two forms agree today. Whoever builds Revoke needs to add that exemption (or equivalent — e.g. a flag Revoke sets) to both checks before shipping, or they will start failing CI on legitimate data. The checks themselves were deliberately left as-is here since Revoke does not exist yet.
- [ ] **A fifth site still inner-joins `profiles` on `tenant.profile_id` and was not converted with the other four.** `src/services/settlements/payout-notifications.ts:62`'s `tenantName()` helper (`JOIN profiles pr ON pr.id = t.profile_id`) backs the "a tenant paid you" in-app notification. Lower severity than the four fixed sites — the function already degrades to the literal string "A tenant" on any failure, including a missed join, rather than dropping the notification — but it is the same defect shape: an owner-managed tenant's payment would notify the owner as an anonymous "A tenant paid ₹X" instead of by name. — **why:** consistent with the class of bug fixed in [[Bugs]] for the other four sites, just not required for adoption's core promise (rent chasing) to work — **related:** [[Bugs]], [[Business-Rules]].
- ~~**The design spec's fourth activation invariant was never implemented.**~~ **Done 2026-08-27 (Phase 2 Task 3)** — `scripts/activation-invariants-check.ts` now has an unconditional `ownerManagedWithPolicyAcceptance` check ("OWNER_MANAGED tenant must not hold a TenantPolicyAcceptance"), reachable since claiming a tenancy writes a real acceptance. See the Revoke bullet above for the one exemption it will need once Revoke exists. — **related:** [[Database]], [[Business-Rules]], [[Decisions#ADR-133|ADR-133]].
- [ ] **Apply the `20260827100000_owner_managed_tenants` migration before any of this code reaches a real environment.** `access_mode`, `display_name` and `tenant_owner_attestations` exist only in `apps/backend/prisma/schema.prisma`/`prisma/migrations/` — **not applied to dev, test, or production as of this writing.** Per the 2026-08-14/2026-08-22 outage pattern ([[Bugs]]), a `tenants` column declared in `schema.prisma` but absent from the database 500s every unselected read of that table, and `tenants` is read on effectively every authenticated request. — **why:** shipping the declaring code ahead of the migration is the exact failure mode that has taken production down twice before — **related:** [[Database]], [[Bugs]].
- [ ] **Clean up the production data the orphaned-identity bug produced, then apply `20260827180000_one_live_tenancy_per_phone`.** The migration adds a partial unique index on `tenants.phone_1` for `ACTIVE`/`INVITED` rows and is **rejected outright while violating rows exist** — including the exact production incident that motivated it (one phone, three tenancies, one hostel). Find the violators first:
  ```sql
  SELECT phone_1, count(*), array_agg(id)
  FROM tenants
  WHERE status IN ('ACTIVE','INVITED') AND phone_1 IS NOT NULL
  GROUP BY phone_1 HAVING count(*) > 1;
  ```
  Each group needs a human decision (which tenancy is the real live one; what happens to the duplicates — cancel, or reconcile financial history first) that this task does not attempt to prescribe. — **why:** the index is the actual guarantee behind [[Decisions#ADR-135|ADR-135]]'s fix; the two application-layer checks that shipped alongside it are real but not a substitute for a database constraint — **related:** [[Database]], [[Bugs]], [[Decisions#ADR-135|ADR-135]].
- [ ] **Do not connect to or query the production database to run the detection query above from an automated agent.** Per this task's own operating constraints, identifying and cleaning the violating rows is human-supervised work, not something to script unattended against real tenant financial data. — **why:** a wrong resolution of "which of these three tenancies is real" touches obligations, payments and deposits — **related:** [[Bugs]], [[Business-Rules]].
- [ ] **Nothing records *how* a signature was captured.** Uploading a photo is now offered to tenants and guardians as well as owners ([[Decisions#ADR-140|ADR-140]], reversed 2026-08-30), but a stored signature blob looks identical whether it was drawn in-session or photographed. If a signature is ever disputed, "drew it during activation" and "uploaded an image" are very different provenance and the record cannot tell them apart. A capture-method flag alongside the blob would fix it. **why:** it only matters in a dispute, which is exactly when it cannot be added retroactively — **related:** [[Decisions#ADR-140|ADR-140]], [[Business-Rules]].
- [ ] **The whole product is off-brand typographically.** `apps/frontend/src/styles/theme.css` declares `--font-display: 'Playfair Display'` and `--font-body: 'Poppins'`, but the authoritative brand pack (`Stayo-Brand-Assetes/README.md`) specifies **Manrope** (headings/UI/wordmark, 600–800) and **Inter** (body). The printed menu was moved onto the real pair on 2026-08-30; every screen still uses the old one. **why:** a brand pack that the product does not follow is not a brand — and the discrepancy was only found because the menu PDF had to pick fonts explicitly — **related:** [[Decisions#ADR-144|ADR-144]], [[Frontend]].
- [ ] **`apps/backend/app/page.tsx` still serves the retired single-hostel marketing site.** 26 components under `apps/backend/components/landing/` plus `lib/sanity/landingContent.ts` render a full public site for one hostel — hero, room pricing, facilities, gallery, FAQ about wardens, a specific address and phone number. The retired *name* has been swept out, but the site itself is the wrong shape for a platform, and `apps/frontend` is the canonical UI per CLAUDE.md. **Deleting it is the product owner's call, not a cleanup**, which is why it was left. **why:** the backend's root URL currently presents Stayo as a single hostel in Secunderabad — **related:** [[Decisions#ADR-148|ADR-148]], [[Architecture]].
- [ ] **`apps/backend/content/legal.ts` names a personal Gmail as the legal contact.** The grievance-officer block carries an individual's name, personal address and mobile. That is a legal requirement to publish *something* reachable, so it was deliberately not edited during the branding sweep — but a platform should probably publish a role address (`support@yourstayo.com`) rather than a founder's personal Gmail. **why:** it is the one remaining hit in `check-production-branding.mjs` that is not a test asserting absence — **related:** [[Decisions#ADR-148|ADR-148]].
- [ ] **The brand pack's social assets bake in the retired `stayo.in` domain.** `Stayo-Brand-Assetes/stayo-brand-assets/social/stayo-og-1200x630.png` (and probably its siblings — the X, Instagram and LinkedIn exports) print `stayo.in`, not `yourstayo.com`. The shipped `og-cover.png` was patched pixel-side on 2026-08-30, but the source asset should be regenerated so the next person to use the pack does not reintroduce it. **why:** the domain is on every social share of the product — **related:** [[Decisions#ADR-148|ADR-148]].
- [ ] **Confirm the PWA splash on a real device after deploying.** Android snapshots the manifest icon and `background_color` when a shortcut is installed, so an existing shortcut keeps showing the pre-2026-08-30 icon until it is removed and re-added. The repo now ships the correct clay mark plus a full-bleed maskable, but that has not been observed on a device. **why:** the reported symptom (a blurry lockup in a white circle) is indistinguishable from a stale install, so only a fresh install proves the fix — **related:** [[Decisions#ADR-148|ADR-148]].
- [ ] **Cancel the duplicate August rent on tenancy `433586bb-e0f5-47c2-9ad7-1691efcab8fe`.** Obligation `8aec8b11-b0ad-4f71-8928-809b10508b52` (`RENT`, `2026-08-01`, ₹8,000) is the unallocated twin of an allocated row. [[Decisions#ADR-149|ADR-149]] stops new ones; this row predates the fix and must be cancelled through `POST /api/payments/obligations/[id]/cancel` so the ledger correction is recorded. **why:** the tenant is being shown ₹8,000 they do not owe — **related:** [[Bugs]].
- [ ] **Decide whether the joining month should be prorated.** A 28 February move-in is charged a full ₹8,000 for 1 February. That is current behaviour, not a defect, but it is the first number a claiming tenant sees. **why:** it reads as an overcharge on a trust-critical screen — **related:** [[Decisions#ADR-149|ADR-149]], [[Business-Rules]].
- [ ] **Make the "+ Invite" refusal actionable.** When an owner invites someone who already has an owner-managed tenancy *at their own hostel*, the 409 says "This person is already a tenant at your hostel X" and stops. It should offer their real activation link instead ([[Decisions#ADR-150|ADR-150]], [[Decisions#ADR-163|ADR-163]]) — that is what the owner was trying to do, and (since 2026-09-01) is exactly what `TenantDetailPage.tsx`'s share-link card already does elsewhere, just not surfaced from this specific refusal. Left alone because that path runs through the invite wizard `main` rewrote on 2026-08-29. **why:** it is the exact dead end that produced the bug report — **related:** [[Decisions#ADR-150|ADR-150]].

