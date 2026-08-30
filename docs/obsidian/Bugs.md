---
tags: [bugs]
---

# Bugs

Related: [[Features]] · [[Changelog]] · [[TODO]] · [[Business-Rules]]

Log of significant bugs — open and fixed. Not meant to replace an issue tracker for every minor bug; use this for anything that revealed a real architectural/business-rule gap (the kind of thing worth remembering months later), matching the bar already used in `docs/known-issues.md` and `docs/business-logic/*-investigation-report.md`.

## 2026-08-30 — Two configuration links pointed at routes that did not exist (fixed)

**Symptom.** Tapping "Room configuration" in the Hostel module did nothing. The row showed a real room and bed count and rendered as *configured*, so nothing suggested it was broken. Separately, the "Check payout account" button on the failed-payout alert also did nothing — and that alert appears **only** when an owner has just been told money did not reach their bank.

**Root cause.** Both targets were never registered as routes. `/owner/more/configuration/hostel/rooms` never existed; the hostel drilldown's Rooms tab (`/owner/hostels/:hostelId/rooms`) has always owned rooms. `/owner/more/payout-account` never existed either — although its API (`GET/PATCH /api/owner/payout-account`) does exist and works, and the owner's bank details have been on `profiles` since migration 070. The configuration section simply had no screen for them, so the link was written against a page nobody built.

**Fix.** The rooms row points at the drilldown tab, and returns no route at all when the hostel id is unknown rather than a broken one. The payout button is removed until Piece B of the configuration redesign builds its destination — a missing button is honest; a button that does nothing at that moment is not.

**What made it findable.** Diffing every `/owner/more/...` path linked anywhere in the source against every path actually registered in the router. Neither link was reachable by any test, because the frontend suite renders no components. A second pass caught six pages using `/owner/more/configuration` — a route being deleted in the same change — as their back destination; the first grep had missed them by quoting style alone, which is worth remembering: search for both quote forms when auditing routes.

## 2026-08-30 — Claiming an owner-managed account skipped tenant onboarding entirely (fixed)

**Symptom.** A tenant who claimed their tenancy landed on the dashboard as a fully active resident having never been asked for their identity details, ID documents, guardian contacts, or a signature on the residency agreement — all of which every self-serve tenant provides before activating. The tenancy read as complete; the paperwork behind it did not exist.

**Root cause — two fields that had quietly changed meaning.**

`resolveInvitation` refused any `ACTIVE` tenancy, and `computeState` derived `activationCompleted` from `status === "ACTIVE"`. That is right for a tenant who activated themselves — they became `ACTIVE` by finishing — and wrong for an owner-managed tenancy, which is `ACTIVE` from the moment the owner creates it. [[Decisions#ADR-133|ADR-133]] had already said access is a second axis and not a redefinition of `ACTIVE`; activation was the place that did not follow it.

The obvious replacement was also wrong, and only surfaced when the fix was checked against live data rather than typechecked. `owner-managed-tenancy-service.ts` stamps `activation_completed_at: new Date()` **at adoption**, so the field is already set for precisely the population that has onboarded nothing. It records "this tenancy is set up", not "this person went through onboarding". A first implementation built on it was inert — it locked out exactly the tenants it was written to admit, and `activation_required` computed `false` for all of them.

A third instance sat one level down and would have been worse: `completeActivation`'s idempotency guard returned silently on `status ∈ (ACTIVE, …)`. A claiming tenant would have completed every step and had the final write skipped without a word — no invitation flip, no agreement finalisation — leaving them permanently unfinished and looped back into onboarding on every visit.

**Fix.** Completion is read off the invitation reaching `ACTIVATED` — the only write in the system that fires when a *tenant* finishes the ceremony — falling back to the timestamp only for a tenancy that was never invited and carries no owner attestation. Adoption writes `SUPERSEDED` plus a `tenant_owner_attestations` row, so the two populations separate cleanly. `completeActivation` keeps its original status skip list and carves out only the adopted-and-unfinished case, so every existing caller behaves exactly as before. `activation_completed_at` is deliberately left stamped at adoption: `residency-history-service`, `tenancy-eligibility-service` and the owner WhatsApp assistant all read it, and the new predicate is additive.

**What made it findable.** Resolving the real tenancy read-only, rather than trusting the types — the same probe also caught an include using the table name `tenant_owner_attestations` where the Prisma relation on `tenants` is `owner_attestations`, which `strict: false` and `any`-typed rows had hidden from `tsc`. See [[Decisions#ADR-155|ADR-155]], [[Business-Rules]].

## 2026-08-30 — The Explore tab sat off the right edge of every phone (fixed)

**Symptom.** On the tenant bottom nav, the sixth tab (Explore) was not visible on any handset. The bar scrolled horizontally, but nothing indicated that it did, so an entire primary destination was reachable only by swiping a nav bar — a gesture almost no mobile app asks for, and one nobody thinks to try.

**Root cause — arithmetic, not a rendering fault.** `AppBottomNav` gave every tab a fixed `w-[76px]` in an `overflow-x-auto` row. Six tabs therefore needed `6×76 + 5×4 gap + 16 padding ≈ 472px`, against 360-414px on the common Android and iPhone widths. The doc comment described this as deliberate ("six comfortable tabs don't squeeze onto a narrow phone width, so on mobile the row scrolls instead") — the overflow was known, but the consequence, that the last tab is never on screen, was not followed through. The bar went from two tabs to six when the old two-layer nav (an Explore/Dashboard/Profile outer bar plus a Home/Money/Room/Food/Complaints inner strip, cited in `appNavConfig.ts` as ADR-078 — **not recorded as a heading in [[Decisions]]**) was collapsed into one single-level bar. At two tabs the fixed 76px width was correct and nothing overflowed; the regression arrived with the sixth tab, not with the width.

**Fix.** Items are now `flex-1 basis-0` capped at `max-w-[76px]`, so six tabs divide the available width and two tabs still cap at 76px and centre exactly as before. Measured in a real browser against the built CSS at four widths: no overflow and no clipped tab at 320/360/390/414px; tab widths 47/54/59/63px respectively. At 320px the "Payments" label ellipsises, which is accepted — a shortened label is strictly better than an unreachable destination. From `lg` up items return to fixed width, since the floating dock is shrink-to-fit and has no width to divide. See [[Decisions#ADR-154|ADR-154]], [[Features]].

## 2026-08-30 — Every tenancy claim failed at the last step, blocked by the tenancy being claimed (fixed)

**Symptom.** `POST /api/tenancy-claim/confirm` returned `409 TENANT_HAS_ACTIVE_TENANCY` — "This person already has an active tenancy" — after the tenant had verified their phone, reviewed their statement and pressed "This looks right". The `tenantId` in the error payload was the id of the tenancy they were claiming.

**Root cause — an interaction between two correct changes.** `tenancyClaimService.confirm` guards with `assertCanStartNewTenancy(profile.id, …)`, deliberately, so a claimant who already lives elsewhere gets a real explanation instead of an opaque unique-index violation. That worked while an owner-managed tenancy had `profile_id: null`. [[Decisions#ADR-136|ADR-136]] then bound a `profile_id` to every owner-managed tenancy — the right fix for a real duplicate-invite bug — which means the claimant's profile now *already holds the tenancy being claimed*. The guard asks "may this profile start a **new** tenancy?", finds that tenancy, sees it live, and refuses. The claim flow rejected exactly the tenancies it exists to serve, from the moment ADR-136 shipped.

**A wrong first diagnosis, worth recording.** From the error payload alone this was attributed to the owner pressing "+ Invite", since `createInvitation` produces an identical error. Only the DevTools network trace — showing the failing request as `confirm`, after `lookup` and `statement` succeeded — placed it in the claim flow. Two paths sharing one rule produce indistinguishable errors; the request name was the only thing that separated them.

**Fix.** `evaluateTenancyEligibility` takes an optional `ignoreTenancyId`, and the claim path passes the tenancy being claimed. Only that one is excused — a live tenancy elsewhere, or an unsettled previous stay, still blocks. Every other caller passes nothing and is unchanged, which a test asserts. See [[Decisions#ADR-153|ADR-153]].

**Verified read-only against the reporting tenancy:** ineligible before, eligible after.

## 2026-08-30 — A tenant adopted mid-year was billed twice for the same month (fixed for new tenancies)

**Symptom.** A real tenancy showed two identical `RENT` obligations for `2026-08`, ₹8,000 each, both `PENDING`. The tenant's claim screen — the first thing they ever see of Stayo — listed "1 Aug 2026" twice and an outstanding balance ₹8,000 higher than they owed.

**Root cause.** `createInvitation` writes the tenancy's obligations while only a *reservation* exists, and converts that reservation into a room allocation afterwards. The obligations are therefore written with `allocation_id: null` — correct at that moment, never corrected later.

Every duplicate guard downstream is allocation-scoped: `rent-generation-service.ts` loads existing rows with `allocation_id: { in: allocationIds }`, and `obligationEngine.upsertObligation` matches on `allocation_id + rent_month + obligation_type`. **`NULL IN (...)` is never true**, so both are blind to every backfilled row by construction. The monthly rent cron duly raised August a second time, keyed to the allocation.

**Fix.** `ensureActiveAllocation` returns the allocation id rather than discarding it, and `finalizeOwnerManagedTenancy` binds the tenancy's unallocated obligations to it in the same transaction. The existing checks and the `(allocation_id, rent_month, obligation_type)` unique index then cover these rows. `planObligationLinking` (pure, 9 tests) decides what binds; an orphan whose slot is already taken is **skipped and logged**, not forced, so historical duplicates cannot fail an invitation.

**Verified read-only against the reporting tenancy:** 8 orphans, 7 would bind, 1 skipped — exactly the duplicate August row.

**Not fixed by this:** tenancies that already carry a duplicate. Obligations are audit-first, so the extra row is cancelled deliberately through `POST /api/payments/obligations/[id]/cancel`, which writes a ledger correction — not deleted, and not as a side effect of this change. See [[Decisions#ADR-149|ADR-149]].

## 2026-08-29 — The printable menu failed on every request: a `YYYY-MM` string sent to a `Date` column (fixed)

**Symptom.** Every call to `GET /api/food/menu-pdf` returned `Invalid value for argument 'month': premature end of input. Expected ISO-8601 DateTime`. No owner could print a menu at all — the feature was broken for its entire, brief life.

**Root cause.** The route takes `month` as `YYYY-MM`, which is the API's shape, and passed that string straight into `food_schedules.findUnique`. The column is `month DateTime @db.Date`. The sibling route `app/api/food/schedules/route.ts` had a local `firstOfMonth()` doing exactly this conversion; the new route was written without noticing it, because the query *reads* as though `month` were a string.

**Why nothing caught it.** The content model (`lib/pdf/menu-content.ts`) is pure and knows nothing of Prisma. The renderer was verified by actually rendering a page and looking at it — which is why the layout was right — but rendering takes content, not a database. **The route itself was never run against a database before shipping.** `tsc` cannot help either: Prisma's generated `where` type accepts `string | Date` for a date field.

**Fix.** The route converts through its own `firstOfMonth()`, mirroring the sibling route, and answers `400` when the month cannot be read. Verified against the real database — reproducing the exact reported error with the string form, then rendering the reporting owner's actual August menu (28 cells) with the fixed form.

**Regression test.** `tests/menu-pdf-month-key.test.ts` asserts both directions: a converted `Date` finds the row, and the raw `YYYY-MM` string still throws. It asserts the *failure* deliberately — if `month` ever became a string column, that test should be re-read rather than silently keep passing. See [[Decisions#ADR-144|ADR-144]].

## 2026-08-29 — A new owner could not create a hostel at all; the only two buttons that did it were both hidden (fixed)

**Symptom.** A freshly signed-up owner's Home showed a greeting, a search bar, "Collect Rent ₹0", three zero tiles and a month card of "₹0 of ₹0" — and no way whatsoever to add a hostel. No hostels section, no `+ Add hostel` button, no getting-started checklist. The FAB's Quick Actions offered Collect Payment, Add Tenant, Add Expense and Food menu, all four of which require a hostel to exist. The account was a complete dead end.

**Root cause — two independent defects that only bite together.** There are exactly two routes to `/owner/hostels/new` in the whole application, and both were hidden.

1. **`OwnerHomeDashboard.tsx` rendered the property list only when `properties.length > 0`** — and that list carries the app's only `+ Add hostel` button. The walkthrough commit (`73e9e47`) had changed `properties.length === 0 ? <FirstHostelCard/> : <PropertyList/>` into a bare `properties.length > 0 &&`, deleting `FirstHostelCard` on the reasoning that the new checklist told a new owner to add a hostel. Sound reasoning, but it made the checklist load-bearing.
2. **The checklist then hid itself.** `useGettingStarted` latched a one-way `graduated` flag into `localStorage` under **`stayo_owner_getting_started_done` — a browser-global key with no owner id in it**. Once any owner on that browser completed setup, the flag was set forever, and every account signed in afterwards on that device was permanently denied the checklist, brand-new accounts included. Triggered here by `chore(scripts): reset every owner and tenant` (`73464a9`): the database rows went, the browser flag did not.

**Confirmed from the screenshots, not inferred.** The one-time spotlight rendered **2 stops instead of 3**, starting at "Your daily view". `Spotlight` filters out stops whose ref is empty (`stops.filter((stop) => stop.ref.current)`), so the missing first stop is direct evidence the checklist was not in the DOM — while the tour running at all proves `roomCapacity === 0 && tenantCount === 0`, i.e. a genuinely empty account that should have been showing it.

**Why the latch existed.** Steps one and two read lifetime facts; step three read `rent_collected_this_month`, which resets on the 1st. Without the latch the card would reappear every month to tell an established hostel it had never taken rent. The latch was a workaround for one signal having the wrong time scale — and the workaround, not the signal, is what broke the screen.

**Fix.** The hostels section is now unconditional and gains a first-run empty state with its own primary button; `Add Hostel` also joins the FAB sheet, where actions needing a hostel are dimmed rather than offered; and completion is derived from a new lifetime `has_ever_collected` signal so **no completion state is stored anywhere** and the `graduated` flag is deleted outright. Three independent paths into hostel creation, none of which browser state can hide. Separately, Home now renders each card only once it has something true to say, so a new owner is no longer shown a dashboard of zeros. See [[Decisions#ADR-139|ADR-139]], [[Features]], [[Changelog]].

**Also fixed in passing:** the spotlight pointed at an Action Center and a search bar that Home no longer renders for an empty account, so its stops were being silently filtered away. It now runs once the first hostel is built, and its dismissal flag is keyed per owner.
## 2026-08-29 — Owner login had no working "Forgot password?" link (fixed)

**Symptom:** an owner who forgot their password had no self-serve way to reset it — the login popup showed no "Forgot password?" link at all, only a dead-end sentence: "Owner accounts are created during onboarding — contact Stayo support if you need help accessing yours."

**Root cause:** `apps/frontend/src/shared/ui-patterns/LoginModal.tsx` is the single login surface for both owner and tenant modes (per [[Decisions#ADR-035|ADR-035]]). The "Forgot password?" link was gated behind `{!isOwner && (...)}`, so it only ever rendered for tenants. This predates [[Decisions#ADR-054|ADR-054]] (2026-08-08), which made password reset role-agnostic end to end — the backend (`authService.requestPasswordReset`) resolves by email/phone with no role filter, and `/forgot-password` + `/reset-password` were already built role-neutral. The frontend gate on `LoginModal.tsx` was simply never updated to match, so the entire working reset flow was unreachable from the owner login form for three weeks.

**Fix:** removed the `!isOwner` condition on the "Forgot password?" link and deleted the owner-only "contact support" fallback paragraph. No backend or route changes were needed — the flow was fully built, just unlinked from owner mode.

**Lesson:** when a business rule (here, "reset works the same for every role") changes, every UI surface that hard-codes the old per-role behavior needs an audit, not just the ones the change was written for — this gate was untouched by the ADR-054 change because that work focused on the backend/route layer, not the modal that gated access to it.

**See:** [[Decisions#ADR-054|ADR-054]], [[Features]], [[Changelog]].

## 2026-08-28 — Adopting a tenancy orphaned it from its person; two minutes later a duplicate invite sailed through (fixed)

**Symptom, observed in production:** a tenancy was adopted (`ownerManagedTenancyService.adopt`) at 16:31:56. At 16:34:09 — under three minutes later — `checkEligibilityByContact` answered "eligible" for the **same phone number**, and a second invitation was accepted for it. That phone ended up holding three tenancies in a single hostel: `FORMER_TENANT`, `ACTIVE`/`OWNER_MANAGED` (the adoption), and `INVITED` (the duplicate) — one person, one real identity, and a `profiles` row that nothing linked to two of the three.

**Root cause.** Adoption (as shipped in [[Decisions#ADR-133|ADR-133]], Phase 1) stored the person's name on `tenants.display_name` and left `tenants.profile_id` `NULL` — that was the entire meaning of "owner-managed" at the time (see [[Database#Owner-managed tenants — access_mode, display_name, tenant_owner_attestations (2026-08-27, Phase 1, migration 20260827100000, NOT applied to any database)|Database]]). But **every duplicate guard in this system resolves a phone or email to a *profile* first, then inspects that profile's tenancies** — `TenancyEligibilityService.checkEligibilityByContact`/`previewEligibilityByContact` both `resolveProfileIdByContact` and returned `{ eligible: true }` immediately when nothing matched. An adopted tenancy had no profile to be found by, so it was structurally invisible to the one check whose entire job was to prevent exactly this: a second tenancy for the same person.

**Fix — identity is now centralised on `profiles`, keyed by canonical phone, closing the gap at three independent layers so no one of them has to be perfect:**

1. **Adoption links or creates a profile instead of leaving `profile_id` null** (`owner-managed-tenancy-service.ts`). It looks up an existing profile by the tenant's canonical phone and reuses it verbatim (credentials, email, role untouched) if found; otherwise it creates a new one with `password_hash: null` and `auth_user_id: null` — a login-less shell. `display_name` is kept as a display fallback, but a `profile_id` is now set unconditionally. See the ADR below for why this, not the earlier design, is now the definition of "owner-managed."
2. **Eligibility checks also look for live tenancies by phone directly, independent of any profile link** (`tenancy-eligibility-service.ts`'s new `loadLiveTenanciesByPhone`/`loadTenanciesForContact`). This is deliberately not made redundant by fix 1 — it exists specifically to catch rows *already* orphaned in a database before this fix ships, and to not depend on some future code path remembering to set `profile_id` correctly. Only `ACTIVE`/`INVITED` count; a closed tenancy must never block a returning resident.
3. **A partial unique index enforces it at the database**, independent of both application-layer fixes — see [[Database]] and [[TODO]] for why it is not yet applied.

**A second bug this fix had to solve to avoid breaking the feature it was fixing:** once adoption links a profile unconditionally, *every* `OWNER_MANAGED` tenancy carries a non-null `profile_id`. The pre-existing `isClaimable` rule (`lib/tenants/claim-eligibility.ts`) read a null `profile_id` as "unclaimed, therefore claimable" and a non-null one as "claimed, therefore not" — so this fix would otherwise have made every owner-managed tenancy permanently unclaimable the moment it shipped. `isClaimable` now checks whether the *bound profile can sign in* (`profile_has_login`, derived from `profiles.auth_user_id != null` in `tenancy-claim-service.ts`'s `withLoginFlag`) rather than whether a `profile_id` is set at all: a login-less shell stays claimable by whoever proves the number, a profile that can already sign in does not (claiming it would be an account takeover). A missing/undefined flag fails closed — refused, not claimable — so a caller that forgets to select `profiles.auth_user_id` cannot accidentally open every bound tenancy to claiming.

**Also removed as part of closing this gap:** the invite wizard's pre-send "Just add to my records" exit (`isOwnerManagedValid`/`submitAsOwnerManaged`/`ownerManagedMutation`) is gone. The owner is now asked to keep the records **after** the invitation is sent — "Wait for them to activate" or "Keep the records myself meanwhile" on `InviteDeliveryResult` — because whether a tenant ends up using the app is the tenant's decision, not something the owner should have to predict on the form. See [[Decisions#ADR-136|ADR-136]] for the full reasoning and [[Features]] for the current invite flow.

**Lesson:** a check that resolves identity through a join is only as strong as the guarantee that the join was populated. `profile_id` being nullable-by-design (a real, load-bearing part of the original owner-managed-tenants design) was exactly what let one write path — adoption — silently produce rows every downstream guard was blind to. The fix does not just patch the one call site that broke in production; it makes the missing link impossible to create at all (fix 1), gives the existing guards a second, independent path to the same fact (fix 2), and backstops both with a constraint the database itself enforces (fix 3) — so a future write path that forgets to link a profile fails at the database rather than months later in production telemetry.

**See:** [[Decisions#ADR-136|ADR-136]], [[Business-Rules]], [[Database]], [[Changelog]], [[TODO]].
## 2026-08-28 — A hostel's tenant agreement could silently ship with no owner signature at all (fixed)

**Found** while implementing the Add Hostel builder's new agreement step ([[Decisions#ADR-135|ADR-135]]), not reported — nothing surfaced this to anyone, which is the actual finding.

**Area:** [[Backend]] — `apps/backend/src/utils/default-rules.ts`'s `getActiveTemplateAndSyncRuleVersion`, and the frontend, which had no caller for the two routes that would have prevented it (`apps/frontend/src/features/owner-more/api/configApi.ts`).

**Symptom:** None visible to the owner. A hostel left on the default `preferences_config.tenant_rules.agreement_required: true` — i.e. every hostel that never visited Configuration › Agreements — would have a tenant complete the Rules + Agreement onboarding steps, sign, and receive a generated agreement whose "Owner signature" was blank.

**Root cause.** `AgreementTemplate.owner_signature_url` is set two ways: the owner draws a signature (`POST /owner/hostels/[id]/agreement-template/signature`), or the template is published carrying whatever `owner_signature_url` the caller passed (`POST .../agreement-template`, `action: publish`). Neither route was ever called by any live page — `configApi.ts` only wired the template's `save_draft` action, and no owner-facing UI drew a signature or published anything. The first time *anything* touched a hostel's agreement with no published template yet — the first tenant reaching the AGREEMENT onboarding step, or the first read of Configuration › Agreements — `getActiveTemplateAndSyncRuleVersion`'s fallback auto-created one: `status: "PUBLISHED"`, `is_active: true`, and no `owner_signature_url` field at all, defaulting to `null`. From that point every tenant of that hostel signed against a real, active, otherwise-normal agreement that simply had no owner signature on it.

**Why it survived:** the backend behaved exactly as designed — an agreement must exist the moment one is needed, so the fallback creating one is correct. The gap was entirely upstream: nothing in the product ever asked the owner to make the "does this hostel use an agreement" decision or capture a signature, so the fallback's blank default was the *only* path every hostel that didn't independently discover Configuration › Agreements ever went through.

**Fix:** [[Decisions#ADR-135|ADR-135]] — a new Add Hostel builder step makes the decision explicit and, when "Yes," runs `publish` then the signature upload in the same action, before the hostel's rooms are even reachable. No backend change; the two existing routes just finally have a caller.

**Not fixed:** a hostel that already has a blank-signature auto-created template from before this shipped stays as-is — this closes the gap for hostels going through Add Hostel from now on, not a backfill of existing rows. A hostel that turns `agreement_required` back on later from Configuration › Agreements, without a signature configured, can still reach the same state through that separate surface.

**See:** [[Decisions#ADR-135|ADR-135]], [[Features]], [[Changelog]]

## 2026-08-27 — An owner-managed tenant was adopted, then invisible to the system that was supposed to chase them (fixed)

An owner can now adopt a tenant who ignored their invitation (`POST /api/tenants/:id/adopt`, `ownerManagedTenancyService.adopt` — see [[Features]]/[[APIs]] for the full capability): the tenancy flips to `ACTIVE` with `access_mode = 'OWNER_MANAGED'` and `profile_id = NULL` — the person has no login, no `profiles` row, and their name/phone live on `tenants.display_name`/`tenants.phone_1` instead. The entire point of adopting them is that the system keeps chasing rent on their behalf, exactly as it would for a self-serve tenant.

It did not. Four raw-SQL queries across the operational/reporting surface joined `tenants` to `profiles` with an **inner join** (`JOIN profiles p ON p.id = t.profile_id`) purely to read the tenant's name/phone for display — and an inner join silently drops any row where that join can't match, which is every owner-managed tenant, unconditionally:

- `billingRepository.getOperationalOverdueObligations` (`apps/backend/src/repositories/billingRepository.ts`) — the query behind `processDailyReminders`. An owner-managed tenant's overdue rent obligations never appeared in the sweep, so they got **no automated reminders**, and since the late-fee engine rides the same loop (`reminder-service.ts`), **no late fees ever accrued** either. This is the one that matters most — it defeated the feature's stated purpose.
- `billingRepository.getOperationalDefaulters` — the owner dashboard's top-defaulters widget. Owner-managed tenants could never appear in it, however overdue.
- `lib/services/analytics-service.ts`'s risky-tenants query (`getTenantIntelligenceDashboard`) — owner-managed tenants were invisible to owner analytics, undercutting the promise that occupancy/revenue dashboards read true.
- `app/api/dashboard/portfolio-shell/route.ts`'s `getOverduePreview` — the dashboard's overdue-preview widget, same pattern, found in a follow-up review pass rather than the original fix.

**Fix.** All four became `LEFT JOIN profiles p ON p.id = t.profile_id`, following the idiom already established at `dashboard-service.ts:669/693/707` for this exact relationship. Every `p.*` column is now read through `CASE WHEN t.profile_id IS NULL THEN <tenant-owned fallback> ELSE p.<column> END` rather than a bare `COALESCE(p.col, fallback)` — the stricter guarded form matters because `profiles.phone` is nullable, so a plain `COALESCE` could have changed an *existing* self-serve tenant's output (null → `tenants.phone_1`, which is a general-purpose field populated during ordinary onboarding, not exclusive to owner-managed tenants) rather than only adding rows. The guarded CASE instead guarantees the `p.<column>` branch fires unconditionally for every row that matched before (`t.profile_id IS NOT NULL`), so no existing row's name, phone, amount, ordering, or grouping changes — proved column-by-column, not asserted.

**A follow-on, deliberate, non-bug consequence:** three of the four queries (`getOperationalDefaulters`, the analytics risky-tenants query, and `getOverduePreview`) are ranked and `LIMIT`-bound. Newly-visible owner-managed tenants can now displace a self-serve tenant out of a fixed-size window if they rank higher (worse overdue amount / risk score) — not because the displaced tenant's own numbers changed, but because the candidate pool grew. Intended. The unlimited sweep query (`getOperationalOverdueObligations`, the one that actually drives late fees) has no such window, so no row can be displaced there at all.

See [[Business-Rules]] for the domain model this closes a gap in (Obligation as source of truth, `access_mode`), [[Changelog]] for the shipped entry, and [[Database]] for `tenants.access_mode`/`display_name`/`phone_1`.

## 2026-08-27 — An owner-managed tenant could climb to FINAL_NOTICE and go permanently silent, while the owner saw "final notice sent" (fixed)

Same feature, an earlier link in the same chain: before an owner-managed tenant can be chased, `reminder-service.ts`'s `triggerNotification` has to record what actually happened to each reminder attempt — and what it recorded was wrong for exactly this tenant shape.

**The in-app channel wrote a `reminder_logs` row unconditionally, on every trigger, whether or not anything was actually delivered.** `reminder_logs` is not a plain audit trail — escalation reads the most recent row for an obligation to decide the next reminder's type (`DUE_SOON → WARNING → FINAL_NOTICE`, never repeating a type, terminal once `FINAL_NOTICE` is reached). For a `SELF_SERVE` tenant this was harmless, because in-app was in practice always "sent." For an `OWNER_MANAGED` tenant — no `profiles` row, so no in-app surface exists for them to open — every trigger still wrote an in-app row and counted as a delivery for escalation purposes, even though nothing had reached anyone: WhatsApp defaults off per hostel and frequently has no valid number besides, and email requires `personal_email`, which an owner-managed tenant often has none of either. The tenant would climb the entire ladder to `FINAL_NOTICE` — the terminal state, after which nothing sends again — while having received precisely zero messages, and the owner's dashboard would report "final notice sent" against someone who was never contacted once.

**Fix.** Two changes to `triggerNotification` (`apps/backend/src/services/payments/reminder-service.ts`): (1) the in-app channel now marks itself `{ attempted: false, sent: false, skipped: true, reason: "NO_TENANT_ACCOUNT" }` for an `OWNER_MANAGED` tenant, before the ordinary on/off preference check even runs — there is nothing for them to open. (2) A `reminder_logs` row is now written **only when a channel actually delivered** — `deliveredChannel` resolves to `IN_APP` if `result.in_app.sent`, else `WHATSAPP` if `result.whatsapp.sent`, else `EMAIL` if `result.email.sent`, else `null`, and the write is skipped entirely when `null`. Escalation therefore only ever advances on a reminder that actually reached somewhere, for every tenant, not just owner-managed ones.

See [[Business-Rules#Notification triggers|Business-Rules]] for the escalation rule this now enforces, [[Decisions#ADR-133|ADR-133]] for the design decision, and the entry above for the related inner-join defect this feature also had to fix before an owner-managed tenant's obligations were even visible to the sweep that calls this function.

## 2026-08-27 — Create Charge asked for a password that protected nothing (fixed)

`CreateObligationModal` required the owner's login password on every manual charge. It called `identityService.confirmIdentity(password)`, read the returned `identity_token` — and then never sent it. The request it made was:

```ts
await api.post('/payments/obligations', {
  tenant_id, obligation_type, amount, due_date, rent_month, description, notes,
});
```

No token. `POST /api/payments/obligations` accepts none: it is owner-scoped by session (`tenant.owner_id !== ownerId` → 403) and has no identity guard. So the prompt added a step to a routine action and guarded nothing — anyone holding the session could post directly without it.

Worse, `confirmIdentity` was called with **no purpose**, so it defaulted to `OFFLINE_PAYMENT` — minting a single-use token bound to *recording a payment* as a side effect of filling in a charge form, then abandoning it to expire in `identity_tokens`.

The contrast is in the same directory: `CancelObligationModal` and `WaiveObligationModal` both pass their token through to `onConfirm` and on to the backend, which does verify it. Those two forgive money; creating a charge raises a debt and is undone by cancelling it. Only the first kind warrants the step.

**Fix.** The password field is gone. `CreateChargeSheet` posts the charge directly. Cancel and Waive are untouched.

**Second defect in the same form: the type defaulted to `RENT`.** Rent is generated every month by `rentGenerationService`, so a manual rent installment double-bills the tenant for a month they already owe — and it was the preselected value, reachable by an owner who filled in an amount and a date without touching the dropdown. There is no default now; the type is an explicit choice, `RENT` is ordered away from the top, and choosing it shows a caution saying why.

**Third: the billing month drifted west of UTC.** `new Date(dueDate)` parsed `YYYY-MM-DD` as a UTC instant, then `.getFullYear()`/`.getMonth()` read it in local time — so a charge due on the 1st filed under the *previous* month for any viewer in a negative offset. `resolveBillingMonth` computes entirely in UTC and is tested for that case.

## 2026-08-26 — Any owner could transfer any other owner's tenant (fixed)

Found while wiring hostel transfer into the owner's Move flow, which is what made the endpoint reachable.

`POST /api/tenants/transfer` gated on the session role alone:

```ts
if (!session || !["OWNER", "ADMIN"].includes(session.role)) return 403;
```

and `tenantTransferService.transferTenant` validated only that the **target room and the tenant share an owner**:

```ts
if (targetRoom.hostel.owner_id !== tenant.owner_id) throw FORBIDDEN;
```

Neither checked that this owner is the **caller**. So any authenticated owner could move any other owner's tenant between that owner's hostels — closing an allocation, opening another, rewriting `tenants.hostel_id` — and `tenant_transfer_logs.transferred_by` would record the caller's id, so an audit trail built precisely to answer "who did this" would name the wrong person while looking correct.

`GET /api/tenants/transfer?tenantId=…` had the same shape: any owner could read any tenant's movement history between properties.

**Why it went unnoticed:** nothing in the app called either handler. `grep` across `apps/frontend/src` returned zero callers, so the hole was real but unreachable through the UI.

**Fix.** A new pure module, `tenant-transfer-authorization.ts`, exporting `assertTransferActorOwnsTenant(actorOwnerId, tenantOwnerId)`. The route passes `resolveOwnerScope(session).owner_id` for an OWNER and `undefined` for an ADMIN, who operates across owners by design. Both the POST and the GET now assert before doing anything.

An **empty string** scope is refused rather than treated as an admin — a failed scope resolution must not become privilege escalation. That is a named test case.

Kept as its own import-free module because the service it guards imports Prisma, and a security rule needs to be unit-testable without a database (see `vitest.pure.config.ts`).

## 2026-08-26 — A rent change never repriced cron-generated obligations (fixed)

Found while fixing the DRAFT-agreement bug above, and the more consequential half of it.

`applyRentChangeInTx` selected the obligations to reprice with `agreement_id: agreementId`. **Two paths generate rent obligations and only one sets that column:**

| Path | Sets `agreement_id`? | Fires when |
|---|---|---|
| `agreement-rent-schedule-service` | **yes** | an agreement is signed — writes the whole installment schedule |
| `rentGenerationService.generateMonthlyRent` (the monthly cron) | **no** — the field is absent from `rentRows`/`maintRows` entirely | every month, for every active allocation |

A hostel with `agreement_required = false` ([[Decisions#ADR-059|ADR-059]]) never signs, so its tenants are fed entirely by the cron and **every obligation they hold is unlinked**. Changing their rent updated `agreement.contract_rent` and `tenants.monthly_rent` — so future months generated correctly — while every already-generated unpaid obligation silently kept the old amount. The owner sees "Rent updated", the charges say otherwise.

The live database showed the split exactly: the two tenants with `SIGNED` agreements had 11 linked obligations each (all carrying `installment_sequence`, the schedule service's signature); the one on a `DRAFT` agreement had a single unlinked row with no sequence.

**Fix.** The selector gains a second branch:

```ts
OR: [
  { agreement_id: agreementId },
  { agreement_id: null, tenant_id: agreement.tenant_id, hostel_id: hostelId },
]
```

The unlinked branch is scoped by tenant **and** hostel, because an unlinked row carries no agreement and those two columns are the only thing keeping one tenant's rent change out of another's charges — or out of charges this tenant ran up at a hostel they have since transferred away from. A legacy row with no `hostel_id` is skipped rather than guessed at: for a rent change, under-repricing is the safe direction to fail.

**Why not link `agreement_id` at generation time instead** (the other option considered): the cron would have to attach the tenant's `DRAFT` agreement, and `@@unique([agreement_id, rent_month, obligation_type])` would then collide with the schedule service's rows if that tenant later signs — the same `Agreement` row flips `DRAFT → SIGNED` and `createMany({ skipDuplicates: true })` would **silently skip** creating the real installment schedule. Widening the read is reversible and touches no write path; changing the cron is neither. It also fixes existing rows with no migration.

Tested against a stub transaction (10 cases, `test:pure`) covering both kinds together, the cross-tenant and cross-hostel refusals, the missing-hostel skip, and the pre-existing guards — zero-payment-only, month scoping, lifecycle/settlement filters, and the contract/tenant rent sync.

> **The integration tests for this service were not run.** `tests/integration/rent-change-service.test.ts` requires `DATABASE_URL_TEST`, which is not provisioned (ADR-043). Reading them, all three build their obligations *with* `agreement_id` set, so the added OR branch cannot change their outcomes — but that is inspection, not execution.

## 2026-08-26 — Change rent was impossible for any hostel that doesn't require agreements (fixed)

`POST /api/tenants/:id/change-rent` looked for the tenant's agreement in the **current** set:

```ts
status: { in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"] }
```

and answered `404 "No active agreement found for this tenant"` when it found none.

A hostel with `tenant_rules.agreement_required = false` ([[Decisions#ADR-059|ADR-059]]) never has its tenants sign — onboarding is `ACCOUNT → PROFILE → ACTIVATE`, and `AGREEMENT` is an invalid transition. The `Agreement` row is still created, deliberately, because as [[Business-Rules]] puts it, signing "governs the signing ceremony only — `Agreement` rows are created either way, because `contract_rent` on that record is what rent changes, obligation generation, renewals and move-out settlement key to." That row therefore stays **`DRAFT`** for the entire tenancy.

`DRAFT` is in no "current" set. So rent could never be changed for **any** tenant of **any** such hostel — the endpoint's own precondition contradicted the rule that its agreement row is what rent changes key to.

**Evidence.** On the live database, the tenant this was reported against (`Sri Adithya Boys Hostel`, `agreement_required: false`) is `ACTIVE` with a single `DRAFT` agreement. Across the whole database, `DRAFT` accounted for **8 of 10** agreements.

**The failure was also reported late.** The owner fills in the new rent, the effective month and a reason, taps Continue, types their **account password**, and only then sees the error — `ChangeRentModal` renders `mutation.isError` in the password step, and the mutation is the first thing that touches the endpoint. So it read as "Change rent doesn't work" rather than "this tenant has no signed agreement".

**Fix.** A new `RENT_CHANGEABLE_AGREEMENT_STATUSES` in `agreement-status.ts` — the current set **plus `DRAFT`** — with `rentChangeableAgreementWhere()` used by the change-rent route. `RENEWED` and `TERMINATED` stay excluded: a later agreement governs, or none does, and repricing either would rewrite a contract no longer in force.

Kept deliberately separate from `CURRENT_AGREEMENT_STATUSES` rather than widening it. That constant drives `has_active_agreement` on the owner overview, the Documents tab's agreement card and the renewal queue; widening it would tell owners a never-signed draft is an "Active Contract". A test asserts `currentAgreementWhere()` still excludes `DRAFT`.

`applyRentChangeInTx` already writes **both** `agreement.contract_rent` and `tenants.monthly_rent`, so the fix is complete for these tenants: rent generation reads `tenants.monthly_rent` for anyone without a signed-agreement schedule, and now sees the new figure.

**Follow-up, fixed the same day — see the next entry.** The repricing step filtered unpaid obligations by `agreement_id`, which the monthly cron never sets.

## 2026-08-26 — The owner tenant profile rendered controls that did nothing (fixed)

Five separate defects on `/owner/tenants/:tenantId`, one shared cause: the routed page (`features/owner-tenants/pages/TenantDetailPage.tsx`) was a Stayo-styled re-implementation of a second, *unrouted* tenant-profile tree (`features/tenants/components/profile/`, ~700 lines, zero importers) — and it copied the appearance of that tree's sections without their handlers. Work had landed in the dead tree; the live page looked finished.

- **The Communication Center was decorative.** `CommRowActions()` rendered four `<span>` elements — not buttons, no `onClick`, no `aria-label`. One of the four (a document icon) mapped to no action in either tree. Meanwhile the wired `CommunicationCenter`, with call/WhatsApp/copy/history, rendered nowhere. Emergency contact was never shown at all despite `phone_3` and `profile.emergency_contact` being on the response.
- **Private Notes discarded what the owner typed.** `useTenantNotes` (GET/POST/DELETE `/api/tenants/:id/notes`) was fully wired and called only by `InvitedTenantProfileView`. On this page the `+` button had no `onClick` and *"No private notes yet."* was a hardcoded string beneath it.
- **Room change was impossible.** The Stay tab's "Change room" called `setActionsOpen(true)`, and the Actions sheet had no room row. The only other route was Request Change → Transfer Room, whose room field was `{ key: 'room_id', type: 'text' }` — a free-text box for a UUID — submitted through the change-management facade, which drops it, because `room_id` is not a `tenant_profile` field. Three working backends existed and none were reachable: `POST /api/allocations/shift`, `POST /api/tenants/transfer`, and a wired-but-dead `TransferRoomSheet`.
- **"+ Add Charge" had no `onClick`.** `CreateObligationModal` was mounted and reachable only from the Actions sheet.
- **A change request awaiting tenant approval was reported as applied.** `PUT /api/tenants/:id` answers **200 + the tenant** when a change applies and **202 + the change request** when it needs tenant consent. Neither body carries an `applied` field, and `ChangeRequestDrawer` inferred one with `data?.applied !== false` — `undefined !== false` is `true`, so *both* outcomes rendered "Changes applied successfully." An owner who submitted a Category C contractual change was told it was done and had no reason to follow it up.

**Fix.** The pieces the dead tree got right were rebuilt as tested pure modules (`contactChannels`, `roomOptions`, `documentGroups`, `overdueDisplay`, `amendmentOutcome`) with thin components over them, and the dead tree was deleted — 13 files under `features/tenants/components/{profile,allocation}`, plus `ChangeRequestDrawer`/`ChangePreview`/`PendingBanner`. Room change is now a two-tap sheet on `/api/allocations/shift`. See [[Decisions#ADR-131|ADR-131]], [[Decisions#ADR-132|ADR-132]], [[Features]], [[Changelog]].

## 2026-08-26 — The OVERDUE tile showed a boolean wearing a unit (fixed)

`useTenantDetail` computed `overdueMonths: Number(o.overdue_amount ?? 0) > 0 ? 1 : 0` and the profile rendered it as `{tenant.overdueMonths} days`. The value was neither months nor days: a tenant one day late and a tenant three months late both read **"1 days"**, and everyone else read **"0 days"** — a number that looked precise, was never right, and gave an owner no way to tell an urgent case from a routine one.

The field name said months, the label said days, and the value was a flag. Nothing in between checked.

**Fix.** `overdueDisplay.ts` derives real days from the oldest still-unpaid obligation's due date, keeping `overdue_amount` (from `FinancialReadModelService`) as the authority on *whether* the tenant is overdue and using due dates only for *how long*. When no due date can answer, the tile shows the tone and label with no number rather than inventing one. 13 tests, including the original bug as a named case.

Related: `advance_balance` (rent paid ahead) was computed on every response and dropped by the same mapper — now a Future credit tile.

## 2026-08-26 — Document View and Download sent no authentication (fixed)

`DocumentReviewCard` opened a tenant's KYC document with `window.open(doc.downloadUrl)` and offered `<a href={downloadUrl} download>`. Both are bare cross-origin browser requests carrying **no `Authorization` header**. `middleware.ts` accepts a bearer token, then the `hms_session` cookie, then a query token (SSE only) — so these fell through to the cookie, which is written once at `/api/auth/login` and **never refreshed** (under ADR-031 Supabase refreshes into localStorage, not that cookie). The links therefore work for roughly one access-token lifetime after sign-in and 401 afterwards; under Safari/ITP cross-site cookie blocking, never. The failure is silent — a blank tab.

Independently, `<a download>` is ignored by browsers for cross-origin URLs: it navigates instead of downloading.

**Fix.** `useDocumentBlob` fetches through the authenticated API client (`responseType: 'blob'`), so the request carries the same live token as every other call, and `DocumentPreviewSheet` renders the document in-app — images inline, PDFs in an `<object>` with a download fallback for browsers that refuse to embed them. Download is a blob-anchor click, which works cross-origin. Failures are distinguished and named: 401/403 as an expired session, 404 as a missing document, 502 as an unreachable stored file.

> **Not reproduced against a running instance.** The mechanism is traced from `middleware.ts`, `lib/auth.ts` and the login route; no session was exercised to confirm the exact expiry behaviour. The fix is correct regardless — it removes the cookie dependency and adds the in-app preview — but the severity of the original defect is inferred, not measured.

## 2026-08-28 — Move-out offered a form that could never succeed (fixed)

**Symptom.** Opening *Move out* for a tenant whose tenancy was `CANCELLED` presented the full exit form — date, reason, notes, and a primary button — above the server's raw refusal: `VALIDATION: Only ACTIVE tenants can request move-out. Current: CANCELLED`.

**Cause.** Two gaps, one on each side of the call. `move-out-service.ts:226` correctly refuses a non-ACTIVE tenancy, but **nothing on the frontend knew that rule**: `moveOutPlan.ts` — the pure module that owns every other decision in this flow — had no eligibility function, so the sheet rendered for any tenant and let the server refuse on submit. Separately, `getErrorMessage` surfaced the message verbatim, including the `VALIDATION:` prefix that is an internal convention and means nothing to an owner.

**Fix.** `moveOutBlock({ tenantStatus, activeRequest })` returns the reason an exit cannot start, or `null`. The sheet renders that explanation instead of the form, and the copy says what to do instead — reactivate a cancelled tenancy, cancel an invitation rather than move out an invited tenant. `humaniseServerError` strips the prefix. Both are pure and covered by 12 new tests.

**An exit already in flight always opens**, whatever the tenant's status: a tenancy legitimately leaves ACTIVE mid-exit while its settlement is still being worked through, and locking the owner out at that point would strand the money. A *terminal* request does not count, so a COMPLETED exit cannot re-open the form for a cancelled tenancy.

**Note on the union.** `moveOutBlock` returns a nullable reason rather than a discriminated union because `apps/frontend/tsconfig.json` sets `"strict": false` — `canStart ? … : …` does not narrow without `strictNullChecks`, and every call site would have needed a cast.

**Still open, seen in the same screenshot:** the tenant header showed a `Docs Pending` badge on a `CANCELLED` tenancy, which is a separate presentation inconsistency, and the settlement preview reported it could not be calculated. Neither is addressed here. Tracked in [[TODO]].

## 2026-08-28 — The agreement printed every clause title twice, and no amounts (fixed)

**Symptoms.** Clause 4 read *"Notice Period: Notice Period: Either party must provide…"* and clause 5 the same way. Money appeared as `Rs. 8,500`, and — once that substitution was removed — as a bare `8,500` with no symbol at all.

**Causes.** The renderer prints `"{n}. {title}: {content}"` while the stored content of several seed terms *begins with its own title*. Separately, `sanitizeText` rewrote `₹` to `Rs. ` **and** stripped every character above `U+00FF`; removing only the first left the second to delete the rupee sign outright.

**Fix.** `clauseBody` strips a title the content repeats — done at render time, not by correcting the seed rows, because owners can save custom terms with the same shape. `sanitizeText` now only trims: the document embeds Inter, so neither of its original jobs applies.

## 2026-08-28 — The agreement was missing the parts that make it an instrument (fixed)

**What was absent.** No page numbering, on a multi-page contract — so a page could be removed or substituted with neither party able to show it. No agreement reference on the page. No preamble naming the parties and the date. No execution statement, so signature images sat under no record of *when and where* the parties signed. No governing-law or jurisdiction clause. No note on stamp duty, on an instrument that generally attracts it in India.

**Fix.** `lib/pdf/agreement-content.ts` (pure, tested) supplies the preamble, five standard clauses (entire agreement, amendment, severability, governing law, stamp duty), the `IN WITNESS WHEREOF` statement, and per-page footers carrying `{reference} · Page N of M` plus an initials line. The hostel's own terms still lead; the structural clauses follow.

**A forum is not guessed.** `placeFromAddress` returns the **city**, not the state — an Indian address ends `"<City>, <State> <PIN>"`, so a naive last-part read produced "the courts at Telangana". Where the address cannot be parsed it returns `null` and the clause falls back to "the courts having jurisdiction over the location of the hostel", because a wrong forum is worse than an unstated one.

**Deliberately not branded.** Unlike the receipt, this document carries no Stayo watermark and no wordmark. A tenancy agreement is between the hostel and the resident; **Stayo is not a party**, and branding a contract like a marketing surface risks implying the platform is a party, licensor or guarantor. Stayo appears in one footer line stating what it actually did — generated and can authenticate the record. A test asserts Stayo appears nowhere in the operative text.

**NOT LEGAL ADVICE.** The added boilerplate is conventional neutral wording to make the document structurally complete. It has not been reviewed by a lawyer. Tracked in [[TODO]].

## 2026-08-28 — WhatsApp receipt delivery depended on an unconfigured CDN (fixed)

**Symptom.** None yet in production — found while sending a test receipt, because there is no `IMAGEKIT_PRIVATE_KEY` in `.env` at all.

**Cause.** `sendDocumentMessage` only supported `document.link`, which Meta fetches server-side and therefore must be publicly reachable. The only URL available was `receipts.receipt_pdf_url`, written by `receiptService` after an ImageKit upload — and `lib/imagekit.ts` silently substitutes a **mock uploader** when the key is absent, storing `https://ik.imagekit.io/dummy/mock_upload.png`. Meta would have been handed a link to a non-existent PNG on every `RECEIPT`.

**Fix.** `MetaWhatsAppProvider.uploadMedia` posts the bytes to Meta's media store and the document is sent by `id`, removing the CDN from the path entirely. `ensureReceiptDocument` now returns the buffer that `generatePdfBuffer` already produced and that the previous version discarded — so this is also one fewer render/round-trip. The mock URL is recognised and treated as absent; a genuine CDN URL is still used as a fallback. Shared by both the `RECEIPT` command and payment confirmations via `command-center/receipt-delivery.ts`.

**Unverified:** whether production has `IMAGEKIT_PRIVATE_KEY` set is not visible from this environment. The fix makes it not matter.

## 2026-08-28 — Every receipt was signed by a different, retired business (fixed)

**Symptom.** A receipt headed *Shoeb's Mansion* carried a footer reading a retired single-hostel brand and its Gmail address, plus that brand in the PDF's title and author metadata.

**Cause.** The identity was hardcoded in five places in `lib/pdf/receipt-template-pdf-lib.ts` — `setTitle`, `setAuthor`, the monogram fallback, the hostel-name fallback, and the footer band.

**Why the guardrail missed it.** `scripts/check-production-branding.mjs` forbids exactly these strings. It was only ever invoked as `check-production-branding.mjs dist` from `apps/frontend`'s build, and its `textFilePattern` did not match `.ts` at all — so backend source was both out of scope and unmatchable. The backend produces no bundled artefact for it to scan.

**Fix.** The template takes its issuer entirely from data; there is no default identity. The guardrail now matches `.ts`/`.tsx`/`.mjs`, skips `node_modules`/`.next`, and excludes itself (its own rule list contains the strings). `apps/backend` gains `npm run check:branding`.

**Three backend files still carry it and are NOT fixed** — deliberately, as each needs a different judgement: `lib/sanity/landingContent.ts` (a full legacy hostel identity used as fallback landing content — a genuine public leak), `lib/security/owner-integrity-guard.ts:24` (the address appears in what looks like a security allowlist — **do not change blind**), and `lib/services/notifications/owner-whatsapp-assistant.ts` (owner-facing copy, 3 sites). Tracked in [[TODO]]; the guardrail is not wired into a build until they are cleared.

## 2026-08-28 — The receipt printed "Rs.", ", Hyderabad" and "N/A" (fixed)

**Symptoms, all on the same document.** `Rs. 16,000` instead of `₹16,000`. A city line beginning with a stray comma. `TRANSACTION ID: N/A` on a cash payment, which has no transaction id by definition. `RECEIPT VERSION v4.0.0` on the face of the document. `SETTLEMENT BREAKDOWN` / `ALLOCATED AMOUNT` as headings, and `Secure HMAC` beside the QR.

**Causes.** The rupee sign was actively rewritten to `Rs. ` by a `sanitizeText` helper, because pdf-lib's built-in fonts are WinAnsi-encoded and have no `₹` glyph. The comma came from joining an empty street line to a city. The rest was internal vocabulary and absent-value handling leaking onto a customer-facing document.

**Fix.** Content moved into `lib/pdf/receipt-content.ts`, a pure module with no pdf-lib and no I/O, so each of these is now a unit test rather than a thing to notice by eye. Fields with no value are dropped rather than printed as "N/A"; a literal upstream `"N/A"` is treated as absent. The renderer embeds Inter, which carries `₹`.

**A trap for anyone editing the fonts:** pdf-lib's subsetter drops most Latin glyphs from these Inter builds — the first render came out as `raba T a a 32` where `Hyderabad, Telangana 500032` belonged. Inter is embedded with `subset: false` on purpose. DM Mono subsets correctly.

## 2026-08-27 — Every inbound WhatsApp message failed on `prisma.profiles` (fixed)

**Symptom.** Sending anything to the WhatsApp number — `Help`, `RENT`, a tapped button — returned only the generic failure notice. Logs showed `Cannot read properties of undefined (reading 'findFirst')` for every message, with `processed_commands: 0`.

**Cause.** `identity-resolver.ts::findAdminProfile` called `prisma.profiles.findFirst`. The Prisma model is **`profile`** (singular); `@@map("profiles")` names the *table*, not the client delegate. `prisma.profiles` is `undefined`. Because identity resolution runs first for every inbound message, nothing downstream ever ran.

**Why nothing caught it.** `lib/db` exports `export const prisma: any` ([db.ts:83](../../apps/backend/lib/db.ts)), so **every** `prisma.<model>` typo in this repo is invisible to `tsc` and to `next build`. The DB-backed suite does not run without `DATABASE_URL_TEST`, and the pure suite touches no client. There was no layer left to catch it.

**Predates the command-center rebuild.** The routing pipeline on `main` already called `resolveSenderIdentity` before [[Decisions#ADR-128|ADR-128]] shipped, so inbound WhatsApp had been failing since that pipeline landed — the rebuild only changed the wording of the notice the sender receives.

**Fix.** `prisma.profile`. Plus `tests/whatsapp-prisma-accessors.test.ts`, which parses `schema.prisma` and the WhatsApp source as text — no client, no database — and fails on any `prisma.<name>` that is not a declared model. Verified to fail on the original bug before passing on the fix.

**18 more of these exist elsewhere and are NOT fixed** — confirmed against a freshly generated client, not just a regex: `prisma.visitorLead` (should be `visitor_leads`, 6 files incl. `discovery-service`), `prisma.paymentWebhookEvent` (`payment_webhook_events`, 4 files), `prisma.paymentReconciliationRun`/`Item`, `prisma.paymentOperationalAnomaly`, `prisma.paymentAttemptStatusEvent`, `prisma.paymentProviderVerificationSnapshot`, `prisma.leadActivity`/`leadNote`, `prisma.roomReservation`, `prisma.ownerOnboardingState`, `prisma.messageLog`/`messagePack`, `prisma.migrationAuditRun`, `prisma.financialInvariantFailure`, `prisma.rentGenerationLedger`, `prisma.tenant_advance_ledger`, `prisma.leads`. Each throws the same way the moment its line is reached. Tracked in [[TODO]] — the guard above is scoped to the WhatsApp tree only because widening it now would fail the suite on all 18.

## 2026-08-27 — Template quick-reply buttons were dropped on the floor (fixed)

**Symptom.** Any quick-reply button on an approved template would do nothing when tapped. Surfaced while wiring `stayo_guardian_whatsapp_activated`, whose **[Help]** button is a guardian's very first interaction with the product.

**Cause.** `extractMessageEvents` handled `text`, `interactive.button_reply` and `interactive.list_reply` — but a *template* quick reply is none of those. Meta delivers it as `type: "button"` with `button.payload`, and that type sat on `findUnhandledMessageTypes`' deliberately-dropped list, complete with a comment naming it. The webhook was marked PROCESSED with zero events and the sender heard nothing back.

**Fix.** Extracted as **text** carrying the payload word, so it resolves through the ordinary command vocabulary — a template quick reply is semantically the reader *saying* that word, and its payload is a plain keyword (`Help`) rather than one of our `CC:` payload ids. A stale assertion in `whatsapp-webhook-interactive.test.ts` that expected `button` to be *unhandled* was updated, and positive coverage added.

## 2026-08-27 — WhatsApp quoted a guardian two different debts, seconds apart (fixed)

**Symptom.** A guardian sent `DUES` and read `Total Due: ₹24,000`. They sent `PAY` and were offered a link for `₹8,000`, with no explanation.

**Cause.** The two commands answered from different sources. `handleDuesCommand` summed up to ten outstanding items from `financialService.getTenantDues()`. `handlePayCommand` called `getNextBillingInfo()` — which returns the **single oldest unpaid obligation** — and minted a `payment_link_tokens` row bound to it, bypassing `PaymentLinkService` entirely.

**Why it mattered.** This is a rent-collection channel. The one moment it has to be trustworthy is the moment it asks for money, and it contradicted itself there. A parent reasonably concludes the system does not know what they owe.

**Fix.** `RENT` and `PAY` both read `current_payable_amount` from `financialReadModelService`, and `PAY` issues a **tenant-scoped** token through `PaymentLinkService.getOrCreateToken({ tenantId })` — which prices the account at payment time and FIFO-allocates across it. Where the payable sum has more than one component, the message itemises it. See [[Decisions#ADR-128|ADR-128]].

## 2026-08-27 — A 30-minute invisible mode could answer a guardian about the wrong child (fixed)

**Symptom.** A guardian with two children in the same hostel asked about one, waited half an hour, asked again — and got the other child's figures, correctly formatted, with no indication anything had changed.

**Cause.** `whatsapp-resident-context.ts` stored an "active resident" in Redis with a 30-minute TTL that every successful command silently refreshed. The sender could not see which resident they were in, and `SWITCH` — a command whose entire purpose was escaping this — was the only way out. Same failure class as the "first hostel as fallback" bug `architectural-invariants-check.ts` exists to catch: a silent wrong-subject answer.

**Fix.** The mode is deleted rather than fixed. Which resident an action concerns rides in the interactive payload (`CC:<COMMAND>:<tenantId>`), re-authorised against the sender's own residents on arrival; every answer names the resident in its first line. `SWITCH` went with it. See [[Decisions#ADR-128|ADR-128]].

## 2026-08-27 — Every live rent template was signed by a product that no longer exists (open — needs Meta approval)

**Symptom.** All three approved rent templates end `- HMS`, and `rent_due_today_v1` instructs the reader to *"pay using the app"*.

**Why it mattered.** A message about money, from an unrecognised number, signed by an unrecognised brand, asking the reader to tap a payment link, is indistinguishable from a scam — and guardians, the readers most likely to be paying, have no app to pay in.

**Status.** *Partially fixed, blocked on Meta.* A template's body is approved server-side at Meta; `templateBody` in `templates.ts` is a local preview only, so this cannot be fixed by editing a string. `providers/whatsapp/rent-reminder-template-contract.ts` now defines **generation 2** — `stayo_rent_due_soon`, `stayo_rent_due_today`, `stayo_rent_overdue` — each naming the **hostel** in the body, footed `Sent via Stayo on behalf of your hostel`, with no app instruction. Rollout is per-template and env-driven (`WHATSAPP_RENT_DUE_SOON_TEMPLATE`, `WHATSAPP_RENT_DUE_TODAY_TEMPLATE`, `WHATSAPP_RENT_OVERDUE_TEMPLATE`): name, language **and** parameter shape switch together, so an approval landing alone can never send v2 parameters at a v1 template. **Until the three are submitted and approved, v1 keeps sending and readers still see `- HMS`.** Tracked in [[TODO]].

## 2026-08-27 — The guardian role was computed four times and used for nothing (fixed)

**Symptom.** No guardian anywhere ever received guardian-appropriate treatment, despite the system knowing exactly who was a guardian.

**Cause.** `whatsapp-webhook-event-service.ts` derived `senderRole: "TENANT" | "GUARDIAN"` at four separate call sites (`:641`, `:844`, `:1203`, `:1651`) and passed it to `sendV2BalanceForTenant`, which used it **solely as an audit-log column value**. `identity-resolver.ts` likewise classified `GUARDIAN_PHONE` matches and dropped the distinction into a `TENANT` role. Guardians were addressed as though the debt were their own, and — per the reminder rule below — contacted only once it was three days late.

**Fix.** `GUARDIAN` is a real `SenderRole` with its own permissions, OTP verification, third-person copy, and a reminder schedule that reaches them **before** the due date. See [[Decisions#ADR-127|ADR-127]] and [[Business-Rules#Guardian reminder escalation|Business-Rules]].
## 2026-08-26 — `visitor_leads.status` could never actually reach JOINED (fixed)

**Found** during a UI redesign of the Leads tab's filter tabs — defining a new "Accepted" tab meaning "tenant joined" required tracing what actually sets that status, and the answer was nothing. `admissionsService.markJoinedForTenant(tenantId)` existed (`admissions-service.ts`) with a correct, tested-looking implementation, but grepping the entire codebase turned up zero callers.

**Area:** [[Backend]] — `apps/backend/src/services/admissions/admissions-service.ts`, `apps/backend/src/services/tenants/tenant-invitation-lifecycle-service.ts`

**Root cause:** several places already read `visitor_leads.status === "JOINED"` as if it were a real, populated value — funnel/stats aggregations in `admissions-service.ts` (today's-joins counter, QR-source revenue, per-source funnel breakdown), `lead-transition-guards.ts`'s terminal-status check (refuses re-accepting/holding/rejecting a `JOINED` lead), and `discovery-service.ts`'s seeker-facing `toEnquiryStage()` (maps `JOINED`/`INVITED` to `"ACCEPTED"` for the enquirer's own 3-step view). None of them ever wrote it. The tenant-activation-completion flow (`TenantInvitationLifecycleService.completeActivation()`) flips the tenant's own status to `ACTIVE` but never touched the lead that led to that tenant — `markJoinedForTenant` had presumably been written in anticipation of a call site that was never added.

**Fix:** wired `completeActivation()` to call the (renamed/relocated) `markLeadJoinedForTenant(tenant.id, tx)` inside its own `prisma.$transaction`, immediately after the tenant's `ACTIVE` flip, so a lead's `JOINED` status and its tenant's `ACTIVE` status can never diverge across a crash between the two writes. Moved to a small leaf module (`lead-joined-transition.ts`) rather than called directly from `admissions-service.ts`, to avoid a real import cycle (`admissions-service.ts` → `invitation-service.ts` → `tenant-invitation-lifecycle-service.ts` → back to `admissions-service.ts`) that a naive direct call would have created — see [[Decisions#ADR-122|ADR-122]].

**Lesson:** several independent readers agreeing on what a status *should* mean is not evidence anything writes it — the only way this surfaced was tracing the producer/consumer relationship directly (grep for callers), not by reading any one call site in isolation. Worth grepping for zero-caller service methods generally when a status enum has a value nothing seems to reach in practice.

**See:** [[Business-Rules]], [[Features]], [[Decisions#ADR-122|ADR-122]], [[Changelog]]

## 2026-08-26 — Discover listing's "Starting from" price could show a number matching none of the bed tiers below it (fixed)

**Found** live-testing the same Discover listing page (`Sri Adithya Boys Hostel`, hostel id `79ba709b-fc27-42bd-9d7b-02bac79431b5`) while verifying an unrelated layout change — the sticky price card read "Starting from ₹8,000" while "Choose your bed" below listed tiers at ₹12,000, ₹7,000, and ₹8,500. None of the three matched the advertised "starting" price, and the true minimum (₹7,000) was understated by ₹1,000.

**Area:** [[Frontend]] — `apps/frontend/src/app/pages/discover/ListingPage.tsx` (`displayPrice` computation, read by both the desktop `<aside>` and the mobile sticky bar)

**Root cause:** `displayPrice` fell back to `hostel.starting_price` — a separate field returned by the Discover search/detail API — whenever no bed tier was explicitly selected (the default, unselected state most visitors see). Nothing cross-checked that field against `bedOptions`, the same array "Choose your bed" renders from, so the two could disagree with no code path forcing them back into sync.

**Fix:** `displayPrice` now computes `Math.min()` over `bedOptions` directly — preferring tiers with `availableBeds > 0` (so the advertised price is never one a visitor can't actually book), falling back to the true minimum only if every tier is full, and to `hostel.starting_price` only if `bedOptions` has no priced tiers at all. Both surfaces that read `displayPrice` (desktop aside, mobile sticky bar) picked up the fix automatically since neither computes price independently.

**Lesson:** the same "two surfaces derive the same number independently and drift" pattern documented for financial data in [[Business-Rules]] (`financial-read-model-service.ts`'s compose-don't-recalculate rule) applies just as much to marketing/pricing fields — `starting_price` and `bedOptions` are two paths to the same fact with no shared source, and only one of them is the one already rendered on screen.

**See:** [[Frontend]], [[Changelog]]

## 2026-08-26 — Two same-capacity bed tiers on the Discover listing page couldn't be told apart (fixed)

**Found** live-testing the Discover listing page against production data (`Sri Adithya Boys Hostel`, hostel id `79ba709b-fc27-42bd-9d7b-02bac79431b5`) — the browser console logged "Encountered two children with the same key, `4`" on page load, which turned out to be the visible edge of a real selection bug, not just a lint-level warning.

**Area:** [[Frontend]] — `apps/frontend/src/app/pages/discover/ListingPage.tsx` (`bedOptions` derivation, the "Choose your bed" section)

**Symptom:** The hostel had published three marketing bed tiers via `data.bed_tiers` — "2-bed", "4 Sharing" (₹7,000), and "Ground floor 4-bed" (₹8,500) — the latter two both `sharing: 4`. Both buttons rendered fine individually, but clicking either one lit up **both** as active simultaneously, and the resolved `selectedOption` (price, label) always came from whichever of the two came first in the array — the ₹8,500 tier was functionally unselectable.

**Root cause:** `bedOptions` derived from `bed_tiers` mapped each tier to `{ capacity: tier.sharing, ... }`, and the JSX keyed/selected buttons purely by `option.capacity` (`key={option.capacity}`, `selected: number | null` holding the capacity, `bedOptions.find(option => option.capacity === selected)`). `capacity` alone was never a unique identity — the bug only surfaces on a hostel with two real tiers of the same bed count, which no dev/test fixture happened to have.

**Fix:** Selection changed from "by capacity" to "by array position": `selected` now holds the tier's index into `bedOptions`, the button key is `` `${option.capacity}-${index}` ``, and `selectedOption` is a direct `bedOptions[selected]` lookup instead of a `.find()` by capacity. Downstream consumers (`selectedOption.price/label/capacity`, the enquiry navigation state) were untouched since they already read off the resolved `selectedOption` object, not the index.

**Lesson:** a derived list's "obvious" natural key (here, bed count) is only safe when the source guarantees uniqueness — the backend never promised distinct `sharing` values across tiers, and nothing before now had exercised a hostel that used that freedom.

**See:** [[Frontend]], [[Changelog]]

## 2026-08-26 — Every brand-new Meal Plan cell 400'd on its first-ever edit, invisibly (fixed)

**Found** while live-verifying [[Decisions#ADR-121|ADR-121]]'s multi-zone grid against the real dev backend — a tap-to-add that visibly placed a dish and never reverted, yet a direct database check moments later showed the cell untouched (`updated_at: null`, no items). Not a symptom anyone had reported; the optimistic UI hid it completely.

**Area:** [[APIs]] — `PATCH /api/food/schedules/[id]/meals/[mealId]` (`apps/backend/app/api/food/schedules/[id]/meals/[mealId]/route.ts`), plus the frontend types that had been quietly lying about it (`useFoodSchedule.ts`'s `ScheduleMealCell.updated_at`, `features/food/api/index.ts`'s `updateScheduleMeal`).

**Root cause:** the route's optimistic-concurrency guard ([[Decisions#ADR-114|ADR-114]]) required `typeof body.expectedUpdatedAt === "string"`, rejecting anything else with `400 VALIDATION_ERROR`. But `food_schedule_meals.updated_at` is `null` until a cell's first-ever edit — every one of the 28 cells `POST /api/food/schedules` creates starts that way — so the honest, correct payload for a first edit is `expectedUpdatedAt: null`, and the route refused it every time. **Every first edit to any never-before-touched cell, in any newly-created schedule, has 400'd since the day this guard shipped.**

**Why it was invisible:** `useFoodSchedule.ts`'s `setCellItems` is optimistic — `onMutate` writes the new selection into the React Query cache *before* the request resolves, so the dish appeared instantly regardless of what the server said. The frontend types claimed `updated_at: string` (non-nullable) everywhere this value is threaded through, so nothing here — not `tsc`, not a code review — would have flagged the mismatch between what the type promised and what the API actually returns. The rollback path (`onError`) is real and does correctly revert on a genuine `400`/`409`, but only after the round trip completes; a screenshot or a `waitForTimeout` shorter than that window reads as a clean success.

**Live cost:** this is the underlying "add a dish" mechanism [[Food]] §18's Timetable and §19's Meal Plan both use — meaning it was very likely already broken in production for exactly the case that matters most: a hostel owner opening a fresh month for the first time and adding its very first dish. It would only ever have appeared to work once a cell had somehow already been edited once (impossible from a clean state, since that edit is the thing being blocked).

**Fix:** the guard now accepts `null` explicitly (`body.expectedUpdatedAt !== null && typeof body.expectedUpdatedAt !== "string"`), and the conditional `updateMany`'s `where: { updated_at: expectedUpdatedAt }` already handles a `null` comparison correctly via Prisma (translates to `IS NULL`) — no change needed there. `ScheduleMealCell.updated_at` and `updateScheduleMeal`'s parameter are now correctly typed `string | null`, closing the type-level lie that let this hide.

**Verified:** a real tap-to-add against the running dev backend, confirmed via direct query against the schedule row before and after — `updated_at` moved from `null` to a real timestamp, `food_schedule_meal_items` populated correctly. Frontend suite 90/90 files, 1410/1410 tests passing after the type fix (backend pure suite verification in progress at time of writing — see [[Changelog]]).

**Lesson:** an optimistic mutation's `onMutate` can make a completely-failing write look successful for as long as anyone's watching a screenshot instead of a network tab — and a type annotation that's wrong in the "value is never actually null" direction is exactly the kind of lie `tsc` can't catch, because nothing contradicts it until the real API response does.

**See:** [[Decisions#ADR-121|ADR-121]], [[Decisions#ADR-114|ADR-114]], [[Food]] §19, [[APIs]], [[Changelog]]

## 2026-08-25 — "+ Add hostel" resumed an old hostel instead of adding one (fixed)

**Reported as** the wizard skipping its first two steps: tapping **+ Add hostel** landed straight on the Rooms screen, already showing "Ground floor" and "First floor", without ever asking for a name.

**It was not skipping steps.** It was not creating a hostel at all — it was *resuming* one. `onAddHostel` navigated to `/owner/hostels/:id/build` whenever `hostelInProgress` existed, and `hostelInProgress` is **any hostel in the account with zero rooms**. Resuming deliberately starts at the Rooms stage (`useHostelBuilder.ts:43`), because Name and Floors are already done — for that old hostel. The floor chips on screen were that abandoned hostel's real floors, read back from the server.

**Not an edge case:** while any zero-room hostel existed, a new hostel could never be created from Home. The button was permanently hijacked. And zero-room hostels are exactly what the incremental-write builder leaves behind, so one bad build disabled the button for good.

**Fix:** Add means add — `onAddHostel` always goes to `/owner/hostels/new`. Resuming keeps its honest home on the getting-started card, which says "finish setting up your hostel", and a half-built hostel is editable from its own Rooms tab either way.

**Found alongside:** `hostelInProgress` is a **dead prop** on `OwnerHomeDashboard` — declared, destructured, never rendered. So the "continue building" card that would have made resume reachable does not exist, which is why the hijacked button was the only route to it. Left in place pending a decision on whether it becomes a real card or is deleted.

**The real cure is [the draft-then-create spec](../superpowers/specs/2026-08-24-add-hostel-draft-then-create-design.md)** — with no half-built hostels on the server, this ambiguity cannot arise. This fix stops the bleeding until then.

**Not verified in a browser.**

**Related:** [[Features]], [[Decisions#ADR-108|ADR-108]]

## 2026-08-24 — The room-numbering picker renumbered nothing (fixed)

**Found** auditing the Add Hostel Rooms step for layout, not for correctness.

**The bug:** `onPatternChange` was `setPattern` — a bare state setter. The pattern only ever reached `resizeFloorRooms`, which assigns numbers *as it creates rooms*. So it applied to rooms added after the change and to nothing else. Set the count to 3 with `101, 102…` selected, tap `G-01, G-02…`, and the chip highlights while the list below keeps `101, 102, 103`. A control that appears broken.

**The second-order bug:** the pattern is a single value on the builder, but rooms are numbered per floor at generation time. Changing the scheme on the second floor left the first floor on the old one — one building numbered two ways, no warning, and it would have been saved that way.

**Fix:** `renumberBuilding` across every floor, renumbering only rooms whose current number is exactly what the old scheme would have produced for their position. A room the owner renamed keeps its name. See [[Decisions#ADR-109|ADR-109]].

**Not verified in a browser** — the renumber is covered by pure tests only.

**Related:** [[Decisions#ADR-109|ADR-109]], [[Features]]

## 2026-08-24 — Leads marked Accepted with no invitation behind them (fixed)

**Reported** with a screenshot of the Alerts tab: four enquiries, all reading **Accepted**, none of whom had been invited.

**Cause:** Accept was two writes pretending to be one act. The button PATCHed the lead to `ACCEPTED` and then navigated to the pre-filled Add Tenant wizard — it had to, because `convertToInvitation` hard-required `status === "ACCEPTED"`. If the owner closed the wizard instead of submitting, the first write stood alone. Nothing in the product distinguishes "accepted, invitation pending" from "accepted and invited", so the Leads tab read as four completed handovers that had never happened.

**Fix:** Accept writes nothing — see [[Decisions#ADR-104|ADR-104]]. The lead advances to `INVITED` inside the conversion endpoint, when the invitation actually goes out.

**The shape worth remembering:** a status that means "this thing happened" must be written by the code that makes it happen, not by the code that opens the screen where it might. The same pattern would bite any "mark X, then navigate somewhere the user can abandon".

**Not verified in a browser** — no invitation was driven end to end against a running stack.

**Related:** [[Decisions#ADR-104|ADR-104]], [[Decisions#ADR-087|ADR-087]], [[Features]]

## 2026-08-24 — A signed-in resident was told to sign in to write a review (fixed)

**Reported** with a screenshot: the Profile tab showed the account signed in, and the same session's listing page showed *"Lived at this hostel? Sign in to write a review"* with a Sign in button.

**Cause:** `PUBLIC_ROUTES` in `middleware.ts` is prefix-matched, and its public branch **strips every identity header**. `/api/discover/hostels` is on that list, so `GET /api/discover/hostels/:slug/reviews` short-circuited there — `getSession()` saw nothing, `getSeeker()` returned null, and `reviewsService.eligibility(null, slug)` correctly answered `SIGNED_OUT`. The backend was right at every step; it was simply never told who was asking.

**Why it went unnoticed:** the same trap had already been hit and fixed for the *write* (`requiresSessionDespitePublicPrefix`, added for `POST .../reviews`, whose own doc comment describes "a signed-in person submitting a review got 'Sign in to continue' with a perfectly good session in hand"). The read needed the opposite exception — accept a session if offered — and no category expressed that, so the fix for one half left the other half broken in the same way.

**Fix:** a third category, `allowsOptionalIdentity` — see [[Decisions#ADR-101|ADR-101]]. Same verification as any authenticated route, including the revocation deny-list and idle timeout; only the *failure mode* changes, from 401 to "continue anonymously".

**Not verified in a browser** — no signed-in session was driven against a running stack.

**Related:** [[Decisions#ADR-101|ADR-101]], [[Decisions#ADR-086|ADR-086]], [[APIs]]

## 2026-08-24 — Add Hostel: four ways the wizard could not be completed or understood (fixed)

Found by auditing all four builder screens after an owner reported "the fields to enter are not appearing".

**1. The Review screen's edit pencil could never succeed.** It offers a pencil on every floor; taking it led back to "Save floor & finish", which re-posted rooms that already existed and got `CONFLICT: Room 101 already exists in this hostel`. Pressing Back into an already-saved floor did the same. **Every backward move past a saved floor dead-ended**, escapable only by abandoning the wizard. Fixed by making the save idempotent — [[Decisions#ADR-097|ADR-097]].

**2. Back from Floors → "Create hostel" created a second hostel.** `createHostel` had no guard for an existing `hostelId`, so pressing the button again POSTed a fresh hostel and overwrote the id — leaving the first one in the account, floorless, forever. The same was true of "Raise the floors", which created a **duplicate set of floors** on every press. Both are now idempotent: the name step continues instead of creating, and floor creation makes only what is missing (renaming the rest, refusing to silently drop floors that exist).

**3. The inputs were invisible as inputs.** `--border` is 1.12:1 against the page — fainter than the decorative graph-paper grid at 1.21:1 — so a transparent field with one underline read as body text. See [[Decisions#ADR-098|ADR-098]].

**4. Copy described an illustration that had been deleted.** The Floors step said "Watch it go up" and "(only 5 fit in the picture)" — the animated building was removed from this page in Aug 2026 and now renders only in the onboarding wizard. The copy outlived it by nine months.

**Also fixed in the same pass:** Enter did nothing on any step (no `<form>` anywhere); the Rooms step greeted the owner with an orange "Add at least one room" before they had done anything; the disabled primary button never said why (the message written for it lived inside a click handler a disabled button never reaches); floor names could not be renamed after creation (`renameFloor` was wired up in the page and passed to nothing); the rent field was `type="number"` with a placeholder — `6,000` — that the field itself rejected, and which a stray scroll would silently change; two `autoFocus` inputs fought on the Name step; and a single room could not be deleted, only lopped off the end.

**Related:** [[Features]], [[APIs]], [[Business-Rules]]

## 2026-08-25 — Resuming a half-built hostel opened on "What's on ground floor?" with no floors (fixed)

**Reported:** clicking through to Add Hostel landed on the floor-filling screen for a hostel whose name and floor count had never been set, and stepping back showed both fields empty.

**Cause — the step was assumed, not derived.** `useHostelBuilder` did `useState<BuilderStage>(existingHostelId ? 'fill' : 'name')`: the presence of an id decided the step **before a single byte had loaded**. That is only right for a hostel that already has floors. Worse, the hydration effect set a stage **only inside `if (restored.length > 0)`**, so a hostel with zero floors kept the assumed `'fill'` forever and rendered a floor-filling screen with nothing to fill.

**Two further gaps behind it:**

- **The name was never restored.** The resume read is `roomService.getAll(hostelId, { grouped: true })`, which returns floors and rooms, not the hostel — so `hostelName` stayed `''` and the Name step looked blank on a hostel that plainly had one.
- **`isRestoring` was `existing.isLoading`**, which goes false one render *before* the hydration effect runs. Even with data, the assumed stage rendered in that gap.

**Confirmed against live data**, not just read from code: `Test1` had a **name and zero floors** — exactly the reported state — and `Test` had 2 floors with 0 rooms. Both are now ARCHIVED, which reads like the builds were abandoned because of this.

**Fix:** a pure `resumeStage()` derives the step from what the hostel actually has (no floors → `floors`; floors with gaps → `fill` on the first unfilled one; all filled → `review`), called on **every** resume including the zero-floor case; the name is restored from the owner's hostel list; and `isRestoring` now holds until hydration has genuinely finished.

**The design gap: a step counter derived from an id is not derived from anything.** The module's own docblock says progress is "derived from which floors have rooms rather than from a stored step counter that could disagree with the data" — the initial state was the one place that did not honour it.

**Related:** [[Frontend]], [[Changelog]]

## 2026-08-25 — "Activation link expired or already used" on a link that had not expired (fixed)

**Reported** with a screenshot of the Set Password step and a toast reading *Activation link expired or already used*. The link had six days left.

**It had not expired, and the message had nothing to do with expiry.** The invitation row was `OPENED`, `expires_at` 31 Aug, tenant `INVITED`; `GET /api/tenants/activate/context` returned **HTTP 200** with `token_status: VALID`. The string is `activate()`'s guard when it cannot find a tenancy *through the profile* — a wording that assumes the only reason for that is a dead link.

**Cause — a regression from [[Decisions#ADR-110|ADR-110]], visible only against a real Discover tenant.** `computeState` derived `account_setup_completed` from `profile?.phone_verified && tenant.phone_1`. That was only ever correct because `profile` was **null** for an unbound tenancy, so it fell through to `tenant.mobile_verified`, which only `saveAccount` sets. ADR-110 made activation resolve the invitee's existing account — and a Discover seeker's account already carries `phone_verified: true` from their enquiry OTP. So the same expression began reporting account setup complete **before it had run**:

1. `current_step` jumped to `ACTIVATE`.
2. `startActivation` — the only code that writes `tenants.profile_id` — never ran.
3. `activate()` looks the tenancy up via `profile.tenants`, found none, and threw.

The tenant was hard-stuck: every step looked done, and the last one could never succeed.

**Fix:** the rule now tests `tenant.profile_id` — matching a profile is a guess until it is written down — extracted to `activation-account-state.ts` with the regression pinned as a test. No data repair needed: affected tenancies simply return to the ACCOUNT step, where the phone is already trusted (no OTP) and one tap binds them.

**The design gap worth remembering: a predicate can change meaning without being edited.** Those three lines were untouched; what changed was that one of their inputs stopped being null. Nothing failed in CI because every fixture shared the old assumption. **A rule whose correctness depends on another value being absent should say so, or test the thing it actually means.**

**Second-order lesson: the error message cost more than the bug.** "Expired or already used" sent the investigation at the invitation table, which was healthy. `activate()`'s guard should name the real condition — an unbound tenancy — rather than guessing at a cause.

**Related:** [[Decisions#ADR-110|ADR-110]], [[Business-Rules]], [[Changelog]]

## 2026-08-26 — Two sections of the tenant Room tab were showing invented data (fixed)

**Found while** redesigning the Room tab, by checking each section against production rather than reading the components.

**Living status** — water, Wi-Fi, electricity, cleaning — read `hostel_utility_status`. That table has **0 rows across the entire product**, and the only frontend references to it are tenant-side *readers*: **no owner UI has ever written to it**. Every screen therefore fell through to its `?? 'OK'` default and told the tenant *"Available · Running normally"* about a hostel nobody had ever reported on. Not "hard for owners to maintain" — impossible, because there was no screen on which to maintain it.

**Room facilities** were six hardcoded literals — "Hot water 6–10 AM · 6–10 PM", "Laundry · Shared · ground floor", "Drinking water · RO purifier · corridor" — written into the component. `roomDetailConfigs.ts` admitted it in a comment: *"content matches Stayo Tenant.dc.html verbatim"*. Design-mock copy, shipped as fact about every hostel on the platform.

**Two smaller ones alongside:** every facility row rendered the **same Wi-Fi icon**, so Hot water and Laundry appeared with a wifi glyph; and `wifi_name` — the one real field — was unset on **all 70 production rooms**, because no owner screen existed to set it, so every tenant read "Ask the front desk".

**Fix:** [[Decisions#ADR-116|ADR-116]]. Living status deleted; facilities sourced from the approved marketing revision with owner-written detail and timings; Wi-Fi given an owner editor; per-kind icons; an empty list renders an empty state rather than six invented rows.

**The pattern worth naming:** all four were *plausible*. A screen full of green "Normal" badges and specific-sounding timings looks more finished than a blank one, which is exactly why nobody questioned it. **A default that renders as a fact is worse than a gap** — a gap prompts someone to fill it, and a confident default never does.

**Related:** [[Decisions#ADR-116|ADR-116]], [[Features]], [[Changelog]]

## 2026-08-25 — Onboarding met an invited tenant as a stranger and rejected their own email (fixed)

**Reported** with a screenshot: the Identity step of `/activate/<token>`, an OTP box, a "Gmail ID" field, and a red banner reading *"An account with this email address already exists. Please use a different email address."* — on an address belonging to the person filling the form in. `PATCH /api/tenants/activate` 400.

**The dropped link.** `admissionsService.convertToInvitation` reads the lead, forwards `email`/`name`/`phone`/`room_id`/money to `inviteTenant`, and **never passes `lead.seeker_profile_id`**; `createInvitation` then writes `profile_id: null`. So `resolveByToken` reported `profile: null` for someone who demonstrably had an account.

**Everything downstream was correct, on wrong inputs.** `saveAccount`'s `isAlreadyVerified` already tested "has this account verified this number" — it returned false only because there was no account, so an OTP was demanded for a number the invitation had just been WhatsApp'd to. Then `startActivation` looked the email up, found the invitee's own profile, and — since none was attached to the tenancy — concluded it belonged to somebody else.

**Worth stating plainly: the intended behaviour was already documented.** `authService.selfSignUpTenant`'s docblock ([[Decisions#ADR-035|ADR-035]]) says a marketplace account "become[s] a tenant *of a hostel* only when an owner invites them and they activate, **which reuses this same profile**". The reuse branch existed in `startActivation` and was unreachable, because nothing ever told it which profile.

**Fix:** [[Decisions#ADR-110|ADR-110]] — resolve the invitee's account (bound → enquiry's `seeker_profile_id` → guarded contact match), trust a number already proven, stop collecting the email. No new column for the link: `visitor_leads.converted_tenant_id` was already written and already indexed.

**Near-miss caught while building it.** Resolving the profile made `saveAccount`'s `if (!profile && invitation)` branch stop firing — and that branch is the *only* path that binds `tenants.profile_id`, which is what runs `assertCanStartNewTenancy`. Left as-is, tenancies would have activated unbound with the one-live-tenancy rule unchecked. The condition is now `!tenant.profile_id`: "is this tenancy bound" and "did we find an account" were the same question before this change and are not any more.

**Follow-up the same day — the fix was inert, and only live data showed it.** Applying migration `20260825090000` and then inspecting the one real Discover tenancy (`speakcode01@gmail.com`, the tenancy from the original screenshot) revealed that **`profiles.phone` stores `7013216327` while `tenant_invitations.phone` stores `+917013216327`**, and `normalizeIndianPhone` returns E.164. Both `isPhoneAlreadyProven` and `canAdoptByContact` compared with `===`, so for the same number they returned false — the trust check failed closed and would have demanded an OTP exactly as before. **Every unit test passed throughout**, because the fixtures used one format consistently. Both now compare on the last 10 digits (`samePhone`), matching what the frontend's `isSamePhone` already did, with tests pinned to the two real production formats.

**The lesson is the standing one:** unit tests written from the same assumption as the code cannot catch a wrong assumption about the *data*. The mismatch was invisible in code and obvious in one `psql` row.

**Related:** [[Decisions#ADR-110|ADR-110]], [[Business-Rules]], [[APIs]], [[Database]], [[Changelog]]

## 2026-08-24 — An enquiry's phone number is gated only by the UI (fixed)

**Found while** restoring email+password signup ([[Decisions#ADR-096|ADR-096]]) and tracing where a *verified* phone actually enters the system.

**The gap:** `POST /api/discover/enquiries` validates `{slug, room_capacity, move_in_date, duration_months, message}` and nothing else. `discoveryService.createEnquiry()` then writes `student_phone: seeker.phone` — whatever that happens to be, including `null`. The `phone_verified` gate lives entirely in `EnquiryPage` (`needsPhoneVerification()` → inline confirm → OTP → submit). A request made outside that screen creates a real `visitor_leads` row in an owner's inbox with **no phone**, and the owner's whole reason for receiving a lead is being able to call back.

**Not caused by, but exposed by, this change.** It has been reachable since [[Decisions#ADR-078|ADR-078]] made `phone: null` the normal shape of a new account (Google provisioning) — before that, every account had a phone by the time it existed, so the missing server-side check had nothing to catch.

**Fix (applied 2026-08-24):** `createEnquiry` now refuses a seeker with no phone on file, before any database work, with a 422 `VALIDATION_ERROR` ("Add your mobile number before sending an enquiry"). It is placed in the **service**, not the route, so the single caller (`POST /api/discover/enquiries`) cannot be bypassed by a future second one. As predicted above the rule is **`phone` present, not `phone_verified` true** — [[Decisions#ADR-034|ADR-034]] lets signup through with a `SKIPPED` row when WhatsApp cannot deliver, and gating on the flag would refuse those seekers outright. The now-dead `seeker.phone ?? existing.student_phone` fallback on the re-enquiry path was removed with it.

**Found while fixing it — `tests/discovery-service.test.ts` had not run in some time.** It is in the `test:pure` allowlist, but `discovery-service.ts` imports `whatsapp-template-delivery`, which constructs a `MetaWhatsAppProvider` at *module scope*; without `WHATSAPP_ACCESS_TOKEN` that throws `WhatsAppConfigError` at import, so the file failed to load and reported **zero tests** rather than failing loudly. Mocking that module restored it, which then exposed a second staleness — `hostel_marketing_revisions.findMany` (added to the service by `fillCoverPhotos`) was missing from the prisma mock, breaking 10 further tests. Both are fixed; the file went from 0 to 23 running tests.

**Worth generalising:** a suite in the allowlist that dies at import is indistinguishable from a suite that passes, in any summary that only counts failures. Any service pulled into a pure test must be import-safe or mocked at the module boundary.

**Related:** [[Features]], [[APIs]], [[Business-Rules]], [[Changelog]]

## 2026-08-22 — A one-field Prisma schema addition took down every listing detail page

**Symptom.** `GET /api/discover/hostels/:slug` returned 500 in production with
`Invalid prisma.hostels.findFirst() invocation: The column t1.navigation does not exist in
the current database.` Every hostel listing detail page showed "This hostel isn't listed".

**Cause, and it is not the obvious one.** Migration 074 adds `hostels.navigation`, and the
code shipped ahead of the migration — expected, and flagged before the push. What was *not*
anticipated is the blast radius. The obvious culprit, an explicit `navigation: true` in
`discoveryService.getListing`'s select, was only one of the callers. **Declaring
`navigation Json?` on the `hostels` model in `schema.prisma` makes Prisma request that column
on every query that does not pass an explicit `select`** — and this codebase has ~10
`include:`-only reads of `hostels` among 147 total. `admissionsService.getPublicHostel` is one
of them, which is why the page died in a service that never asked for navigation at all.

**Fix.** `navigation` is **deliberately not declared on the Prisma model**. It is read and
written exclusively through raw SQL: `readNavigationSafely()` on the read path (which swallows
a missing column and returns `null`), `$executeRaw` on the admin write path (which detects the
missing column and returns a 503 naming migration 074). The app now works on a database whether
or not 074 has run, and the directions block appears by itself the moment the column exists —
no redeploy, no flag. `schema.prisma` carries a comment at the field's would-be position saying
why it is absent and to fold it back in once 074 is applied everywhere.

**Verified** against the live production database with the column still missing:
`/api/discover/hostels/:slug` → 200 with `navigation: null` and `places` intact, plus the
Explore list, both live hostels and the share route all 200.

**The general lesson, worth more than this fix:** adding a field to a Prisma model is not an
additive change to the queries that name their columns — it is a change to every query that
*doesn't*. Deploy-before-migrate is only safe for a new column if no unselected read of that
table can reach production first.

Related: [[Database#`hostels.navigation`]] · [[Decisions#ADR-088|ADR-088]] · [[Changelog]]

## Bug report template

Copy this block for each new entry:

```markdown
### <Short title>

- **Status:** open / investigating / fixed
- **Found:** YYYY-MM-DD
- **Area:** [[Backend]] / [[Frontend]] / [[Database]]
- **Symptom:** What did the user/system observe?
- **Root cause:** Once known — the actual mechanism, not just the symptom.
- **Fix:** What changed, and where (file/commit).
- **Related:** [[links]]
```

---

## Fixed

### Onboarding Step 4 told tenants they had signed an agreement that was never required and never signed

- **Status:** fixed 2026-08-15
- **Found:** 2026-08-15, owner-reported with side-by-side design/production screenshots
- **Area:** [[Frontend]]
- **Symptom:** on a hostel with `agreement_required: false`, the journey track correctly read "Step 3 of 4" with the Agreement node dropped — and Step 4 then showed a checklist row "3. Hostel Agreement Signed — Signed as *Prakash*" plus a "Signed Rental Agreement / Digitally Signed" card offering a PDF. No agreement stage had run and no signature existed. *Prakash* was the tenant's profile name, rendered as though it were their signature.
- **Root cause:** neither surface tested for a signature. The checklist row was static markup with a hardcoded green tick and `ctx.agreement?.tenant_signature_name || ctx.profile?.name` as its subtitle — so the absence of a signature silently became the tenant's own name. The preview card's guard was `ctx?.agreement`, which is truthy whenever an agreement *record* exists, independent of whether signing was required or done; its label fell back to the literal string "Digitally Signed".
- **The pattern worth remembering:** both were "summary" surfaces that restated state from elsewhere in the flow instead of reading it. A summary that renders a fallback when its source is empty stops being a summary and starts being an assertion. The same shape appeared twice more in the same audit — a hardcoded "Step 1 of 5" that contradicted the 4-stage track, and guardian copy crediting an Agreement step that [[Decisions#ADR-070|ADR-070]] had moved to *after* the screen showing it.
- **Fix:** both Step 4 surfaces removed rather than re-gated — the approved design has neither (`PasswordActivateStep.tsx`), which also removed the fallbacks that caused it. `AgreementPreviewModal` deleted from `steps/shared.tsx` with its last consumer. Step 1's stage count now derives from `agreement_required`; the guardian copy now names the invitation as the source.
- **Related:** [[Changelog]], [[Decisions#ADR-072|ADR-072]], [[Decisions#ADR-070|ADR-070]]

### Tenant activation's primary button sat below the fold on every step, and its keyframes were reachable only by accident

- **Status:** fixed 2026-08-15
- **Found:** 2026-08-15, while diffing the shipped flow against the approved `Stayo Onboarding.dc.html` (Claude Design project `3f2fbde6`)
- **Area:** [[Frontend]]
- **Symptom:** two defects, both invisible in a short-content screenshot and both consequences of porting the design's *layout* without its *behaviour*.
  1. On Identity, Agreement and Set Password — every step long enough to scroll, which is all of them on a phone — Continue / Submit / Create Account was only reachable by scrolling to the very bottom of the page.
  2. Step bodies animated in via inline `animation: 'obFade .25s ease'` / `'obUp .3s ease'`, but the only file defining those keyframes was `ActivationIntroScreen.css`, imported by the intro screen alone. Any render path that reached a step without the intro screen ever mounting — a resumed activation link, which lands mid-flow by design — had no keyframe to run, and the step appeared with no transition.
- **Root cause:** the design pins the primary action in a glass bar at the bottom of the flow over a gradient scrim. That bar reads as chrome in a static mockup, so each step had reimplemented it as a plain `mt-5` row at the end of its own content — four copies, none of them pinned. The keyframe problem was the same shape: the CSS was co-located with the *first* component that used it rather than with the flow, and the coupling between "these steps animate" and "the intro screen happens to be imported" was never expressed anywhere.
- **Fix:** `StepActionBar` + `PrimaryActionButton` in `platforms/tenant/onboarding/steps/shared.tsx`, used by all four steps, with `ActivationLayout` reserving the design's 108px of bottom padding. Keyframes consolidated into `platforms/tenant/onboarding/onboarding.css`, imported by both `ActivationIntroScreen` and `ActivationLayout` (which always wraps a step); `ActivationIntroScreen.css` and `ActivationProgress.css` deleted — they had additionally redefined the same walk-cycle keyframes under two different name sets.
- **Worth noting:** nothing fails if a future step stops using `StepActionBar`, or if `onboarding.css` is dropped from `ActivationLayout`. There is no frontend test suite to pin either. See [[Decisions#ADR-072|ADR-072]].
- **Related:** [[Changelog]], [[Features]], [[Decisions#ADR-072|ADR-072]]

### An unapplied `tenants` migration 500'd *every* authenticated request in production

- **Status:** fixed 2026-08-14 — code fix deployed and the production database migration applied by hand (owner ran the `ALTER TABLE` below via the Supabase SQL editor)
- **Found:** 2026-08-14 (owner-reported: "why am I getting these errors while logging in", with a DevTools console screenshot)
- **Area:** [[Database]] / [[Backend]]
- **Symptom:** login appeared to fail and dropped the user back on the marketing page. The console showed `GET /api/auth/me` **500** (×3), `GET /api/owner/hostels?include_archived=false` **500**, `POST /api/auth/activity` **500**. Nothing pointed at the database.
- **How it was narrowed without production access.** Probing prod directly: unauthenticated `/api/auth/me` → clean **401**; a garbage bearer token → clean **401**; `/api/health` → `database: connected`, `project_ref: xhoqkhwsnqfwhjsffybs`, `jwks: ok`. So token verification was *fine* — this was not a repeat of the 2026-08-08 Supabase project mismatch. The decisive read was the routes' own null-session branches: `/api/owner/hostels` returns **403** and `/api/auth/activity` returns **401** when `getSession()` returns `null`. Both returned 500, so `getSession()` was **throwing**, not returning null. `POST /api/auth/onboarding-login` with a bogus phone returned a clean 401, which exercises a full-model `profiles` select — narrowing the drift to `tenants`.
- **Root cause:** commit `7682562` (deployed as `ea0cccb`) added `blood_group`, `nationality`, `pan_number` and `expected_completion_date` to the `tenants` model with three hand-written migrations. `postinstall` runs `prisma generate`, so the deployed client asked for the new columns; nothing ran the migrations against production, so Postgres didn't have them (`42703`). The blast radius came from `getActiveTenancy()` (`lib/tenancy/active-tenancy.ts`), which does `tenants.findMany({ where })` with **no `select`** — Prisma therefore selects every column in the model — and which `resolveSupabaseSession()` calls **unconditionally, before the role check**, on every authenticated request. A tenant-Profile-tab column broke the owner dashboard.
- **The design gap this revealed:** `schema.prisma` is a deploy artifact, the database is not. The Vercel build is `"build": "next build"` with no `prisma migrate deploy` anywhere in the repo, and `docs/README.md` documents migrations as hand-applied via the Supabase SQL editor. So any merge that adds a column is a production outage waiting on the next authenticated request, with no check that fails first — `next build` has `ignoreBuildErrors: true`, and `/api/health` only runs `SELECT 1`, which cannot see column-level drift.
- **Fix:** `blood_group` removed entirely (it came from the design mockup, not from an operational need) — `schema.prisma`, `TenantProfileUpdateSchema`, `tenant-service`'s `tenantFields` allowlist, `getTenantPortalProfile()`, the tenant Profile tab's view + edit configs, plus migration `20260814180000_drop_tenant_blood_group` (`DROP COLUMN IF EXISTS`, because only the databases that ran `20260814120000` ever had it). The other three columns were then created directly in production by hand, via the Supabase SQL editor (not through this repo's migration pipeline, which still has no automated apply step):
  ```sql
  ALTER TABLE public.tenants
    ADD COLUMN IF NOT EXISTS nationality TEXT,
    ADD COLUMN IF NOT EXISTS pan_number TEXT,
    ADD COLUMN IF NOT EXISTS expected_completion_date DATE;
  ```
- **Still open — worth fixing so this can't recur:** (1) no drift detection between `schema.prisma` and the deployed database; (2) `.env` and `.env.test` currently carry an **identical** `DATABASE_URL`, so the DB-backed suite truncates whatever that host is; (3) that host is in `ap-northeast-2` while the canonical Supabase project is `ap-south-1` — the unresolved question from 2026-08-09 about which database production actually writes to.
- **Related:** [[Database]], [[Changelog]], [[Architecture]]

### Food Polls 500'd in production — `food_polls` migration was never applied there

- **Status:** fixed 2026-08-15 — migration applied directly to production
- **Found:** 2026-08-15, owner-reported via console screenshot on `yourstayo.com/owner/food/polls`: `GET`/`POST /api/food/polls` all **500**, dialog showing `Invalid prisma.food_polls.create() invocation: The table public.food_polls does not exist in the current database.`
- **Area:** [[Database]] / [[Backend]]
- **Symptom:** Food Polls tab entirely broken in production — listing and creating both failed.
- **Root cause:** same class of gap as the `tenants`-migration outage earlier the same day (see above): `food_polls`/`food_poll_options`/`food_poll_votes` (migration `20260808130000_add_food_polls`, added 2026-08-08) had only ever been applied by hand to the **dev** database (`qsjrazcbtpmubclkevwi`, `ap-northeast-2`) — see [[Food]] §16. Nothing ever ran the same SQL against the production database (`xhoqkhwsnqfwhjsffybs`, `ap-south-1`), and there is still no automated `prisma migrate deploy` step in the build to catch this.
- **Fix:** the migration's SQL (two enum types, three tables, four indexes, five FKs) applied directly to production via the `DIRECT_URL` (non-pooled) connection, statement-by-statement — `$executeRawUnsafe` on the pgbouncer pooled `DATABASE_URL` rejects multi-statement bodies (`42601`), and a first attempt at manual statement-splitting glued a leading SQL comment block onto the first `CREATE TYPE`, causing it to be skipped as "just a comment" and created only `FoodPollStatus` on that pass; the stray type was dropped and the corrected split (strip full-line comments before splitting on `;`) reapplied everything cleanly. Verified via `information_schema.tables` and `pg_constraint` post-apply.
- **Still open — same unresolved gap as the `tenants` incident above:** no drift detection between `schema.prisma`/`prisma/migrations` and what's actually deployed to production; every hand-applied migration since (`20260810120000_room_sort_order`, `20260814120000_add_tenant_identity_fields`, etc.) needs the same production-vs-dev check before being trusted as "done."
- **Related:** [[Database]], [[Changelog]], [[Food]]

### Tenant activation's journey-track avatar stayed on "Welcome" while the Identity screen was already showing

- **Status:** fixed 2026-08-14
- **Found:** 2026-08-14, owner reported via screenshot: "Step 1 of 5" and the walking avatar still over the Welcome node, while the card below already read "Identity Profile."
- **Area:** [[Frontend]]
- **Symptom:** `WelcomeIdentityStep.tsx` (the merged Welcome+Identity component from ADR-070) switches from its Welcome screen to its Identity screen via **local component state** (`localPhase`) — no backend call happens until the tenant actually submits, so `activation_state.current_step` stays `ACCOUNT` throughout. `ActivationProgress.tsx`'s journey track only ever reads the backend step, so it had no way to know the screen underneath it had already moved on — the track (and the bobbing avatar sprite) stayed parked on node 1 while the visible content was node 2's.
- **Root cause:** the one-component-two-backend-steps pattern (`ACCOUNT`+`PROFILE` merged into one component, `RULES`+`AGREEMENT` merged into `AgreementStep.tsx` the same way) works for the *step nodes themselves* — those are keyed off the real backend step and don't need to distinguish — but breaks for the *sub-phase within* `ACCOUNT`, which has no backend representation at all.
- **Fix:** `localPhase` lifted out of `WelcomeIdentityStep.tsx` into `ActivationPage.tsx` (passed down as `localPhase`/`setLocalPhase` props instead of local `useState`), so the page can compute the progress track's visual step as `PROFILE` (not `ACCOUNT`) whenever `activeStep === 'ACCOUNT' && localPhase === 'identity'`. `ActivationProgress.tsx` itself is unchanged — it already correctly derives everything from whatever `activeStep` it's given.
- **Related:** [[Features]], [[Changelog]]

### Tenant activation was permanently blocked for every tenant — two stale "emergency contact required" gates left behind by the ADR-070 amendment

- **Status:** fixed 2026-08-14
- **Found:** 2026-08-14, owner reported the activation link "isn't good at all" and flags emergency contact as required even though it was explicitly removed from the Identity screen earlier the same day.
- **Area:** [[Backend]]
- **Symptom:** no tenant could complete activation. The Identity step itself submitted fine (its own validation, `saveProfile()`, was correctly relaxed in the same-day ADR-070 amendment), but `profile_completed` could never become `true`, and the final `ACTIVATE` submission hard-failed with `VALIDATION_ERROR: Emergency contact phone number is required`.
- **Root cause:** the amendment that dropped Emergency Contact from the Identity screen (see [[Decisions#ADR-070|ADR-070]]) only updated `saveProfile()`. Two other, independent gates in `activation-workflow-service.ts` still required `tenant.phone_3` (emergency phone): `computeState()`'s `missingTier1` list (line ~251, drives `profile_completed` and therefore `blocked_steps`/`current_step` for every tenant) and `activate()`'s own direct check (line ~1307) before finalizing activation. Since nothing in the current flow ever populates `phone_3` anymore, both gates failed unconditionally, for every tenant, permanently.
- **Fix:** removed both gates. `phone_3` is no longer in `missingTier1` (it already exists in `optionalMissingFields()`/tier 3, which is where ADR-070 intended it) and the hard throw in `activate()` was deleted outright — emergency contact is now optional everywhere, matching `saveProfile()`'s existing behavior.
- **The design gap this revealed:** a business-rule change (a field going from required→optional) had three separate enforcement points across one service file, and only one was updated. No test or invariant check caught it because `check:activation-invariants` uses real dev-DB tenants that predate the change; a check against a *fresh* activation flow would have caught this immediately.
- **Related:** [[Decisions#ADR-070|ADR-070]], [[Business-Rules]], [[Changelog]]

### Every WhatsApp OTP was being rejected by Meta — owner signup hid it, tenant onboarding surfaced it

- **Status:** fixed 2026-08-13
- **Found:** 2026-08-13 (owner-reported: guardian mobile verification returned `OTP_SEND_FAILED`)
- **Area:** [[Backend]]
- **Symptom:** the tenant activation wizard's guardian-phone step returned `{"success": false, "error": {"message": "Failed to send OTP", "code": "OTP_SEND_FAILED"}}`. Owner signup appeared to work.
- **Root cause:** the approved `otp` template is category **AUTHENTICATION**, and Meta caps *every body parameter* on an authentication template at **15 characters**. `{{2}}` carries a human-readable purpose label, and two shipped labels were over it — `"phone verification"` (18) and `"parent verification"` (19). Meta rejected both with `(#132018) body: Parameter at index 1 exceeds the parameter length limit 15`. **No OTP was being delivered for any purpose using those labels.**
- **Why it looked like two different things.** `PHONE_VERIFICATION` is in `SKIPPABLE_OTP_PURPOSES`, so owner signup caught the rejection and degraded to `verification_required: false` — proceeding **without verifying anyone's phone**, silently. `ParentVerify` is not skippable, so tenant onboarding raised it as a hard error. One bug, two faces; the visible half was the *less* serious one.
- **What it was not:** config was correct throughout — token valid, `otp` template APPROVED in `en_US` matching `OTP_TEMPLATE_LANGUAGE`, all four env vars set, WABA `account_review_status: APPROVED` and `business_verification_status: verified`, number `CONNECTED`/`GREEN`. The payload shape also already matched the template contract (2 body params + a `sub_type: url, index: 0` button), and `assertTemplateMatchesContract` passed — it checks parameter *counts*, which were right, and has no notion of parameter *length*.
- **Fix:** `OTP_AUTH_PARAMETER_MAX_LENGTH = 15` is now explicit; the labels are shortened (`"verification"`, `"parent verify"`) and `REGISTRATION`/`PROFILEUPDATE` added; and the humanised fallback for unmapped purposes is capped by `capOtpParameter()`, which drops whole words so the result still reads as language. Without capping the fallback, the next purpose anyone adds would silently reintroduce #132018 for that flow alone.
- **Verified against the live Graph API**, not just in tests: the old payload reproduced `#132018`, the fixed payload returned `message_status: "accepted"`, and the owner confirmed the OTP arrived on the handset.
- **Diagnostic gap this exposed:** the API returns a generic `"Failed to send OTP"`; Meta's actual code and `error_data.details` are logged server-side but never surfaced, so an operator seeing this cannot distinguish a misconfiguration from a template rejection from a rate limit. Worth surfacing the provider code on admin-triggered sends.
- **Related:** [[Business-Rules]], [[APIs]]

### Every tenant-facing `/api/tenants/me/*` route using `findUnique({ where: { profile_id } })` 500'd, for every tenant

- **Status:** partially fixed 2026-08-14 (10 of ~20 known occurrences — the original 8, plus `lib/auth/resolve-operational-scope.ts`'s `resolveTenantScope()` and its own callers, fixed the same day once the tenant profile-change-request feature started depending on it)
- **Found:** 2026-08-14, while verifying the tenant dashboard rebuild live against a real dev-DB tenant
- **Area:** [[Backend]]
- **Symptom:** `GET /api/tenants/me/room`, `/billing-frequency`, `/payments/history` (and others) returned 500 with `Argument 'where' of type tenantsWhereUniqueInput needs at least one of 'id' arguments`, for every tenant, not just the test fixture used to find it — the tenant Room tab and parts of Money never worked.
- **Root cause:** `prisma.tenants.findUnique({ where: { profile_id: session.sub } })` — but `profile_id` is not a `@unique` column on `tenants` in `prisma/schema.prisma` (a profile accumulates one `tenants` row per hostel it has ever stayed in; at most one is "live" at a time, enforced by a partial unique index, not a plain column constraint). `findUnique` requires a field Prisma's generated types recognize as unique; `lib/tenancy/active-tenancy.ts`'s `liveTenancyWhere(profileId)` + `findFirst` exists specifically to replace this exact pattern (its own doc comment names the bug class), but several routes predate that helper and were never migrated.
- **Fix:** changed `findUnique({ where: { profile_id } })` → `findFirst({ where: liveTenancyWhere(profileId) })` in the 8 occurrences reachable from the tenant dashboard's real flows (`app/api/tenants/me/{room,billing-frequency,payments/history,documents,photo,complete-profile,onboarding-settings}/route.ts`, `app/api/payments/{create-intent,verify}/route.ts`), plus `lib/auth/resolve-operational-scope.ts`'s `resolveTenantScope()` — used by the new tenant profile-change-request endpoints (see [[Features]]) and by `payments/pay-dues`/`payments/preview` (fixed as a side effect, since they call this shared helper).
- **Not fixed — same pattern still present, not reachable from any flow built so far, left for a follow-up:** `app/api/payments/{tenant-dues,attempts/[id]}/route.ts`, `app/api/tenants/[id]/documents/route.ts`, `app/api/allocations/tenant/[id]/route.ts`, `app/api/move-out/requests/route.ts`, `lib/services/dashboard-service.ts` (`getTenantStats`, line ~1626). Grep `findUnique` + `profile_id` in the same file to find any of these before relying on them.
- **Related:** [[Features#Tenant dashboard — pixel-fidelity rebuild (2026-08-14)|Features]], [[Changelog]]

### Tenant overlay panels (Room/Profile drill-ins, request forms) rendered blank when opened after scrolling

- **Status:** fixed 2026-08-14
- **Found:** 2026-08-14, live Playwright walkthrough of the rebuilt tenant dashboard
- **Area:** [[Frontend]]
- **Symptom:** Opening a Room service tile (e.g. "Lost key") or any Room/Profile detail card after scrolling down the tab rendered an almost-blank screen — header and body content invisible, only the submit button visible, with the bottom tab-nav bar bleeding through underneath it.
- **Root cause:** `DetailScreen`/`FormPanel`/`SuccessPanel` (and the Food tab's inline meal-detail overlay) used `position: absolute; inset: 0` relative to the tab page's own `position: relative` wrapper — but that wrapper is normal scrolling document content, not a fixed-size frame (unlike `Stayo Tenant.dc.html`'s source, which lives inside a non-scrolling 402×874 device frame where `absolute` was already viewport-equivalent). If the underlying page had scrolled before the overlay opened, the overlay rendered at the top of its (taller-than-viewport) positioning context, which was scrolled out of view — only whatever happened to land at the current scroll position was visible.
- **Fix:** changed all four overlay root elements from `absolute inset-0` to `fixed inset-0`, so they always cover the viewport regardless of the underlying page's scroll position. Removed the now-unnecessary `relative overflow-hidden` wrapper classes from the three tab pages that had them.
- **Related:** [[Features#Tenant dashboard — pixel-fidelity rebuild (2026-08-14)|Features]], [[Changelog]]

### Room/Food/Profile tab headers had a large dead-space gap at the top, exposing the shell's background grid pattern

- **Status:** fixed 2026-08-14
- **Found:** 2026-08-14, user-reported screenshots of the live app (Room/Food/Profile all showing a large blank grid-patterned area above the page title before content started)
- **Area:** [[Frontend]]
- **Symptom:** `My Room`/`My Menu`/`Profile` headers sat ~60px below the top of the content area with nothing filling that space except `TenantAppShell`'s graph-paper grid background — visually reading as a layout bug, especially since Home and Money's headers sit flush at the top with no such gap.
- **Root cause:** same category of bug as the overlay `absolute`/`fixed` issue above — `Stayo Tenant.dc.html`'s source reserves `padding: 60px ...` at the top of literally every screen's header (Money/Room/Profile/Food all use the identical value in the source), because every screen renders inside the mockup's fixed-size device frame with a simulated phone status-bar area baked into that padding. `TenantHomePage.tsx` and `TenantMoneyPage.tsx` had already been adapted to `pt-6` for the real (frame-less) app when they were built; `TenantRoomPage.tsx`, `TenantFoodPage.tsx`, and `TenantProfilePage.tsx` still had the raw, unmodified `pt-[60px]` value copied from the mockup, and — unlike the full-screen overlays, which paint their own opaque `bg-background` over the shell's grid pattern — these tab pages render directly on top of the shell's grid background with no page-level fill of their own, so the unnecessary top padding fully exposed the grid pattern beneath it.
- **Fix:** changed all three pages' top-level content wrapper from `pt-[60px]` to `pt-6`, matching the convention `TenantHomePage.tsx`/`TenantMoneyPage.tsx` already established. Verified live via Playwright — all 5 tab headers now sit at consistent top spacing with no exposed gap.
- **Related:** [[Features#Tenant dashboard — pixel-fidelity rebuild (2026-08-14)|Features]], [[Changelog]]

### The Add Hostel builder rendered in the legacy pre-StayO theme — the second time this trap has been hit

- **Status:** fixed 2026-08-12
- **Found:** 2026-08-12 (owner-reported: "entirely off branded")
- **Area:** [[Frontend]]
- **Symptom:** `/owner/hostels/new` rendered with a serif display face and a navy `#1B2D5B` primary button instead of StayO's Manrope and terracotta `#b46a55`.
- **Root cause:** identical to the `PendingActivationsPage` entry below. `HostelBuilderPage` is mounted as a **sibling** of `<OwnerAppShell>` — deliberately, since it is a full-screen takeover rather than a bottom-nav tab — so it never inherits the shell's `<ThemeProvider theme="product">` and fell through to `theme.css`'s unscoped legacy `:root` tokens.
- **Fix:** wrapped the page in `<ThemeProvider theme="product">`, matching every other sibling route.
- **This is the design gap the previous entry predicted, realised within a day.** Any route added outside `OwnerAppShell` silently loses StayO theming with **no build-time, lint-time or test-time signal** — it is only visible in a browser. Two occurrences now. Worth a `check:architecture` rule asserting that every element rendered by a `<Route>` outside `OwnerAppShell` mounts a `ThemeProvider`, rather than waiting for a third.
- **Related:** [[Decisions#ADR-066|ADR-066]], [[Frontend]]

### The Add Hostel builder could not create a second hostel — 403 with no way forward

- **Status:** fixed 2026-08-12
- **Found:** 2026-08-12 (owner-reported)
- **Area:** [[Frontend]] / [[Backend]]
- **Symptom:** `POST /api/owner/hostels` returned **403 IDENTITY_REQUIRED** ("Identity verification required. Please confirm your password first.") and the builder simply showed the error — there was no password field anywhere in the flow, so the owner was stuck.
- **Root cause:** a gap opened by [[Decisions#ADR-066|ADR-066]] itself. Step-up confirmation was narrowed to apply only from the owner's *second* hostel onward, and `+ Add hostel` was re-pointed from `AddHostelModal` (which had a password step) to the builder (which had none). A first hostel worked; every subsequent one dead-ended.
- **Fix:** the builder now treats the 403 as the prompt it is — `IDENTITY_REQUIRED`/`IDENTITY_EXPIRED` reveals a password field on the Name step, mints the token via `confirmIdentity(password, 'CREATE_HOSTEL')`, and retries. Because step-up depends on how many hostels the owner already has, this is discovered from the response rather than pre-fetched, and a first hostel still never sees a password prompt. The raw error is withheld until a password has actually been tried and rejected.
- **Related:** [[Decisions#ADR-066|ADR-066]], [[APIs]]

### The hostel scene cropped to the owner figure on phones, hiding the building entirely

- **Status:** fixed 2026-08-12
- **Area:** [[Frontend]]
- **Symptom:** on a 430px viewport the Add Hostel background showed a giant owner figure and no building — so the rising-tower animation, the whole point of the flow, was invisible on the device most owners use.
- **Root cause:** `HostelScene` draws on a wide 1200×820 stage with the building at x≈820 and uses `preserveAspectRatio="…slice"`. On a phone-shaped viewport `slice` crops to the stage's **centre**, which is the owner at x≈540 — the building falls outside the visible slice.
- **Fix:** the stage is re-framed on narrow viewports, and the frame follows what there is to see: a building-centred box when storeys exist, an owner-centred one when none do (onboarding, which no longer raises a building at all, would otherwise crop to empty ground).
- **Moot for this screen as of 2026-08-15** — Add Hostel no longer renders `HostelScene` at all; it uses the standard owner graph-paper grid (see [[Features]]). The re-framing fix still matters, because the onboarding wizard is now this component's only caller and it is the owner-centred case described above.
- **Related:** [[Decisions#ADR-066|ADR-066]]


### Activate Tenants queue rendered in the legacy pre-StayO theme (navy/serif) instead of StayO branding

- **Status:** fixed 2026-08-12
- **Area:** [[Frontend]]
- **Symptom:** the owner Home dashboard's "Activate Tenants" card opened `/owner/tenants/activations` looking like a completely different, unbranded app — a navy `#1B2D5B` primary button and a serif display font, instead of StayO's terracotta `#b46a55` primary and Manrope. Initially reported as if it were showing a different hostel's/project's UI entirely ("Siri Aditya Boys Hostel").
- **Root cause:** `PendingActivationsPage` (`features/owner-tenants/pages/PendingActivationsPage.tsx`) is registered as a sibling route outside `<OwnerAppShell>` in `platforms/owner/router/OwnerRoutes.tsx` (alongside `/owner/tenants/verifications` and `/owner/tenants/:tenantId`), because it's a deep-link-style route, not a shell tab. `OwnerAppShell` is what mounts `<ThemeProvider theme="product">`, which sets `data-app-theme="product"` and scopes the actual StayO CSS tokens (`src/styles/tokens/product.css`). Per `ThemeProvider`'s own doc comment, "screens that haven't migrated yet simply render outside any ThemeProvider and keep resolving `theme.css`'s unscoped `:root` tokens" — and that unscoped `:root` block (`src/styles/theme.css`) is the **legacy Shri Adithya theme** ("Siri Aditya," misheard) that predates the StayO rebrand, still present on purpose per `stayo-theme.css`'s migration-coexistence comment. `PendingActivationsPage` never mounted its own `ThemeProvider`, so it fell straight through to those legacy tokens. Its two sibling routes at the exact same nesting level (`PendingVerificationsPage`, `TenantDetailPage`) already self-wrap in `<ThemeProvider theme="product">` for this exact reason — this page was the one instance missed.
- **Fix:** wrapped `PendingActivationsPage`'s return in `<ThemeProvider theme="product">`, matching its siblings' existing pattern.
- **Design gap it revealed:** any future route added as a sibling of `OwnerAppShell` (rather than nested inside it) silently loses StayO theming with no build-time or lint-time signal — it only shows up as a visual bug in the browser. Worth a `check:architecture`-style lint rule if this class of route keeps recurring.
- **Related:** [[Features]], [[Frontend]], [[Changelog]]
### Cancelling an invitation failed with "Transaction not found… old closed transaction" — a ledger write escaped its own transaction

- **Status:** fixed 2026-08-11
- **Found:** 2026-08-11 (owner-reported)
- **Area:** [[Backend]]
- **Symptom:** `POST /api/tenants/[id]/cancel-invitation` returned `{"success": false, "error": {"message": "Invalid prisma.tenant_financial_ledger.create() invocation: Transaction API error: Transaction not found. Transaction ID is invalid, refers to an old closed transaction Prisma doesn't have information about anymore, or was obtained before disconnecting."}}`. The invitation was not cancelled.
- **Root cause:** `tenantFinancialLedgerService.debitInTx(tx, …)` — a method whose entire contract is "run inside the caller's transaction" — called `this._assertOwnership()`, which reads through the **global** Prisma client. That opened a *second* connection while the caller's interactive transaction was still holding one. The call chain reaching it is `cancelInvitation` → `$transaction` → `obligationEngine.bulkWaiveInTx` → `waiveObligationInTx` → `financialCorrectionGateway.applyCorrection` → `debitInTx`, i.e. cancelling waives the tenant's pending obligations, and waiving debits the ledger. Against a pooled/remote database (Supabase's pooler) the nested global read waits for a free connection, the interactive transaction blows past its **5 s default timeout** and closes, and the next `tx.*` call — `tenant_financial_ledger.create()` — fails with exactly this error. Only `debitInTx` had this escape; `credit()` and `debit()` assert ownership *before* opening their own transaction, which is fine.
- **Fix:** the ownership check now runs on `tx`, reading `owner_id` alongside `hostel_id` in the tenant lookup `debitInTx` was already doing — same error strings (`NOT_FOUND:` / `FORBIDDEN:`), one fewer round trip, nothing leaving the transaction. `tests/ledger-debit-in-tx-scope.test.ts` (3 DB-backed tests) pins it: it debits a tenant **created inside the same uncommitted transaction**, which a global-client read cannot see — verified to fail with `NOT_FOUND: Tenant not found` against the old code, and pass against the fixed one.
- **Note:** the pool stall itself is timing- and load-dependent, so the 500 will not necessarily reproduce on a fast local connection even with the defect present. The structural defect is fixed; **worth re-testing the cancel flow live** against the environment where it was seen.
- **Related:** [[Backend]], [[Business-Rules]], [[Decisions#ADR-065|ADR-065]]

### Phone numbers rendered with the country code twice — "+91 +918008046952"

- **Status:** fixed 2026-08-11
- **Found:** 2026-08-11 (owner-reported, on the invited-tenant workspace)
- **Area:** [[Frontend]]
- **Symptom:** the tenant's phone displayed as `+91 +918008046952`. Editing it and saving *without* the `+91` didn't help — it came back doubled again, which made it look like the save was broken.
- **Root cause:** display only; the save was always correct. `normalizeIndianPhone` stores every phone in E.164 (`+91XXXXXXXXXX`), so the country code is already in the value — and the UI rendered it inside a `+91 {phone}` template. Whatever the owner typed was normalized back to E.164 on save and then re-prefixed on render, which is exactly why correcting it appeared to do nothing.
- **Fix:** new `shared/lib/phone.ts` (`toLocalPhone` / `canonicalPhone` / `formatIndianPhone` / `isSamePhone`, 11 tests). Display goes through `formatIndianPhone` (`+91 80080 46952`) which is idempotent — formatting already-formatted output does not accumulate prefixes. The edit field shows the 10 local digits and stores back E.164, and `diffTerms` compares phones by digits, so re-typing the same number in a different notation is not reported as a change worth re-issuing the tenant's link for.
- **Still present elsewhere — deliberately not fixed:** `portal/pages/ActivateAccountPage.tsx` (~lines 1380, 2094) renders a phone with the same `+91 {…}` template and is likely affected. It lives in the **frozen** `src/portal` tree, so it was left alone rather than swept into an unrelated change; whether those specific values are stored or user-typed is **unverified**. Call sites that render a *user-typed* form value (`AddTenantModal` / `EditInviteModal` success toasts, `invite/steps/VerifyStep.tsx`) are correct as they are — the owner types 10 digits there.
- **Related:** [[Decisions#ADR-065|ADR-065]], [[Frontend]]

### The invited-tenant "Configure" form opened completely blank, because the tenant overview never returned a hostel id

- **Status:** fixed 2026-08-11
- **Found:** 2026-08-11
- **Area:** [[Backend]] / [[Frontend]]
- **Symptom:** on an invited tenant's owner-side profile, every route into editing — the "Configure" link, all eight tappable rows, and all three items in the "Manage invitation" sheet — opened `EditInviteModal` with **no data**: empty name/phone, "Select a hostel…", "Select a hostel first…" for the room, placeholder amounts, and today's date instead of the real move-in date. The same screen showed the tenant's hostel as "—". The screen's entire purpose (fix a mistake before activation) was unreachable.
- **Root cause:** `getOwnerTenantOverview` returned no `hostel_id` at any level. `useTenantDetail` read `o.tenant?.hostel_id ?? o.hostel_id`, got `undefined`, and set `hostelId: ''`. `EditInviteModal`'s prefill query is `enabled: Boolean(tenantId && hostelId)` — so it never ran, and since a *disabled* React Query is `pending` but not `isLoading`, the modal skipped its loading branch and rendered the empty form as if that were the loaded state. The same empty id made `hostelName` fail its `session.hostels.find()` lookup, producing the "—".
- **Fix:** `hostel_id` is now returned by the overview endpoint, with the invitation's own `hostel_id` as a frontend fallback (`tenant-service.ts`, `useTenantDetail.ts`). The modal is no longer used on this screen at all (see [[Decisions#ADR-065|ADR-065]]). Regression test: `tests/tenant-overview-invitation.test.ts`.
- **Related:** [[Decisions#ADR-065|ADR-065]], [[APIs]]

### Every invited tenant showed "⚠ Assign room", permanently blocking the screen's primary action

- **Status:** fixed 2026-08-11
- **Found:** 2026-08-11
- **Area:** [[Frontend]]
- **Symptom:** an invited tenant's Room/Bed row read "⚠ Assign room" and the agreement summary showed "—", even though a room is **mandatory** at invite time. The primary button was therefore stuck on "Complete setup (1)" and its "Activate tenant" state could never be reached by any tenant, ever.
- **Root cause:** the UI derived the room from `room_allocations`, but `tenant_invitation_lifecycle-service` only creates an allocation **at activation**. Before that the bed is held by an `ACTIVE` `tenant_invitation_reservations` row. So the readiness check `hasRoom = tenant.room !== '—'` was false for 100% of invited tenants by construction.
- **Fix:** the overview's new `invitation.reserved_room` is used as the room for invited tenants, and `missingTerms()` (pure, tested) replaced the inline readiness check. The owner-side activate button was removed outright for unrelated and more important reasons — see [[Decisions#ADR-065|ADR-065]].
- **Related:** [[Decisions#ADR-065|ADR-065]], [[Database]]

### Owner-private notes were never saved — the notes API had no frontend caller at all

- **Status:** fixed 2026-08-11
- **Found:** 2026-08-11
- **Area:** [[Frontend]]
- **Symptom:** the Private Notes card on an invited tenant showed two notes — "Student requested lower-floor room." and "Parent will pay deposit on move-in." — for **every** tenant, and anything an owner typed vanished on refresh.
- **Root cause:** the card was `useState` seeded with two hardcoded example strings. `tenant_notes` and `GET/POST/DELETE /api/tenants/[id]/notes` have existed the whole time, and `tenantService.getNotes/addNote/deleteNote` wrappers were already written — nothing had ever called them.
- **Fix:** new `useTenantNotes` hook; the card now reads, adds and deletes real notes.
- **Related:** [[APIs]], [[Decisions#ADR-065|ADR-065]]

### "Copy link" copied a link that could never work, and two other actions on the same screen were stubs

- **Status:** fixed 2026-08-11
- **Found:** 2026-08-11
- **Area:** [[Frontend]]
- **Symptom:** "Copy invitation link" reported success and put `<origin>/activate?token=<tenant uuid>` on the clipboard. An owner sending that to a tenant sends a dead link: the tenant's id is not an invitation token, and the real route is `/activate/<token>`. Separately, "Preview agreement" was a `toast.info` and the Agreement card's "Send link" was a second, differently-labelled resend button.
- **Root cause:** the link was string-built on the client from data the client had, because the real token was never exposed. Rather than ship the token to the browser, the backend now builds the link.
- **Fix:** `invitation.activation_link` (server-built, token stays server-side) is what gets copied, and Copy is disabled with an explicit error when there is no live invitation. The two stub actions were deleted along with the Agreement card.
- **Related:** [[Decisions#ADR-065|ADR-065]], [[APIs]]

### The cancel-invitation dialog promised a 30-day retention that no code implements

- **Status:** fixed 2026-08-11
- **Found:** 2026-08-11
- **Area:** [[Frontend]]
- **Symptom:** the confirmation said "Their pending tenancy configuration will be retained for 30 days so you can re-invite them anytime." Nothing in `cancelInvitation` retains anything for 30 days — it sets the invitation `CANCELLED`, releases the reservation, ends the allocation, waives pending obligations through `ObligationEngine`, and sets the tenant `CANCELLED`, all permanently.
- **Fix:** copy rewritten to describe what the code actually does. No behaviour change.
- **Related:** [[Business-Rules]], [[Decisions#ADR-065|ADR-065]]

### Every Supabase-side login failure surfaced as an opaque 500 "Something went wrong", hiding the fact that the server simply couldn't reach Supabase

- **Status:** fixed 2026-08-09
- **Symptom:** `POST /api/auth/login` returned **500** and the login modal said "Something went wrong. Please try again." Intermittent — the same credentials succeeded a minute later. A wrong password correctly returned 401, which made it look like the *correct* password was what broke.
- **Root cause, two layers.** The trigger was environmental: `login_attempts` recorded `INTERNAL: Supabase sign-in failed: fetch failed` — Node's network-level error, i.e. the backend could not reach `<project>.supabase.co` at all. Attempts one minute apart alternated `fetch failed` / success, and `/api/health` reported `jwks: ok` throughout, so connectivity was flapping rather than down. **The bug proper** was that `app/api/auth/login/route.ts`'s catch branched on `UNAUTHORIZED:`, `FORBIDDEN:`, `PASSWORD_RESET_REQUIRED:`, `ONBOARDING_EXPIRED:` and `VALIDATION_ERROR:` but had **no branch for `INTERNAL:`** — the prefix every failure in `lib/auth/supabase-identity.ts` uses. So all of them fell through to the generic 500.
- **Why the message was useless too:** that fallback returned `{ success: false, error: "Internal Server Error" }` — `error` as a **string**. The frontend's `getApiErrorMessage` only reads `error.message` when `error` is an *object*, so it discarded the body entirely and printed its own generic fallback. Two independent generic-isations stacked.
- **Fix:** an `INTERNAL:` branch returning **503 `AUTH_PROVIDER_UNAVAILABLE`** via `apiError` (object shape, so the message actually reaches the UI), with connection-level causes (`fetch failed`, `ETIMEDOUT`, `ECONNREFUSED`, `ENOTFOUND`, `EAI_AGAIN`) worded as "Couldn't reach the sign-in service. Check your connection and try again." 503 rather than 500 because the request was well-formed and the password was right — retrying is genuinely correct advice here.
- **Design gap it revealed:** the route enumerates *expected* error prefixes and treats everything else as a bug in our own code. Any new prefix thrown by a service is silently degraded to an opaque 500. Worth auditing the other auth routes for the same shape.
- **Note:** the underlying flaky connectivity is environmental and unfixed — this change makes it legible, not impossible.
- **Related:** [[APIs]], [[Decisions#ADR-031|ADR-031]]
### Hostel Drill-down's Rooms/Tenants tabs silently rendered a genuinely-empty look-alike on any fetch error — plus the page header was reading from hardcoded mock data

- **Status:** fixed (header + error visibility only — see the open item below for the still-unresolved question of whether STARLINK's empty tabs are a genuine data mismatch)
- **Found:** 2026-08-09, reported by the user: a test tenant ("Sharan", `INVITED`, hostel "STARLINK") correctly appeared in the owner's global "All Tenants" dashboard tagged STARLINK, but STARLINK's own Rooms/Tenants tabs (`/owner/hostels/:hostelId/{rooms,tenants}`) showed empty states ("No tenants match" / 0 rooms), and the property header showed a generic "Hostel" title instead of "STARLINK".
- **Area:** [[Frontend]] (`features/hostel-drilldown/layout/HostelDrilldownLayout.tsx`, `features/hostel-drilldown/hooks/{useHostelTenants,useHostelRooms}.ts`, `features/hostel-drilldown/pages/{HostelTenantsPage,HostelRoomsPage}.tsx`)
- **Symptom / investigation:** three rounds of tracing confirmed the global "All Tenants" view and the per-hostel Tenants tab call the *identical* backend query (`GET /api/tenants?hostelId=X`, plain `WHERE hostel_id = X`, no join or status filter difference) — ruling out a filtering-logic bug. Two independent, confirmed bugs surfaced along the way instead:
  1. `HostelDrilldownLayout.tsx` resolved the header's name/city/status from hardcoded `mockProperties` (`@shared/mocks/dashboard`) rather than the real hostel, so it fell back to generic "Hostel" for any hostel not in that mock list — meaning the header could not be trusted to confirm which hostel record was actually being viewed while debugging this exact issue.
  2. `useHostelTenants`/`useHostelRooms` never surfaced `isError`/`error` from their `useQuery` calls — any request failure (a 403 `FORBIDDEN`/`HOSTEL_SCOPE_VIOLATION`, `HOSTEL_CONTEXT_REQUIRED`, or a transient 5xx) silently rendered `[]`, pixel-identical to a hostel that genuinely has no tenants/rooms. There was no way, from the UI, to distinguish a real data mismatch from a swallowed request error.
- **Fix:** `HostelDrilldownLayout.tsx` now queries `portfolioService.getSummary()` (`queryKeys.portfolio.summary()` — the same warm query `HostelOverviewPage` already uses, so no extra network round-trip) and renders the real `name`/`city`/`status` for the matched hostel card instead of the mock lookup. `useHostelTenants`/`useHostelRooms` now return `isError`/`error`/`refetch`; `HostelTenantsPage`/`HostelRoomsPage` render `ErrorCard` (compact, `shared/ui/error/ErrorCard.tsx` — an existing shared component, not new) with a retry action instead of falling through to the empty-state UI when a fetch actually fails.
- **Related:** [[Frontend]], [[Changelog]], the open item below

### Every tenant's very first authenticated request after login 500'd — Prisma's `relationJoins` preview feature flattened a filtered to-many `include` into a single object

- **Status:** fixed
- **Found:** 2026-08-08, while creating a fresh test tenant end-to-end (invite → activate → log in) to check the Food feature — the crash reproduces for any tenant with exactly one live tenancy, so this was not specific to the test fixture.
- **Area:** [[Backend]] (`lib/auth/supabase-session.ts`, `lib/services/user-service.ts`, `src/services/tenants/activation-workflow-service.ts`), [[Database]] (`prisma/schema.prisma` — `relationJoins` preview feature)
- **Symptom:** logging in as a tenant succeeded (`POST /api/auth/login` returns 200 with real tokens), but every subsequent authenticated request — `/api/auth/me`, `/api/food/tenant/schedule`, effectively the whole tenant portal — 500'd with `TypeError: (tenancies || []).filter is not a function` inside `selectLiveTenancy`.
- **Root cause:** `resolveSupabaseSession()` (`getSession()`'s implementation for every route, per [[Decisions]] ADR-031) resolves the caller's profile via `prisma.profile.findUnique({ include: { tenants: liveTenancyInclude } })`, where `liveTenancyInclude` is a **filtered** to-many include (`where: { status: { in: [...] } }`). With `relationJoins` enabled in `schema.prisma`, Prisma generated `LEFT JOIN LATERAL (SELECT JSONB_BUILD_OBJECT(...) ... LIMIT 1) ... ON true` for that relation instead of a `JSONB_AGG` — producing a single JSON object instead of an array whenever exactly one row matched, which `selectLiveTenancy()` then called `.filter()` on. The same `liveTenancyInclude` pattern (and the same crash) was also present in `user-service.ts#getProfile` (backs `/api/profile/me`) and in the real `ACTIVATE` step's post-activation auto-login in `activation-workflow-service.ts` — so this would have broken the normal owner-facing activation flow too, not just already-active tenants logging back in. An **unfiltered** to-many include (e.g. `activate()`'s own `tenants: { include: {...} } }` a few hundred lines below, no `where`) was not affected — the bug is specific to combining `relationJoins` with a `where`-filtered to-many `include`.
- **Fix:** all three call sites stopped relying on the filtered `include` and instead fetch the profile plain, then resolve the live tenancy via a separate `getActiveTenancy(profileId)` query (`lib/tenancy/active-tenancy.ts`, already existed, unaffected because it queries `tenants` directly rather than through a nested `include`). `user-service.ts#getProfile` preserves its previous response shape (`{ ...profile, tenants: [...] }`) for any caller still expecting an array field. `liveTenancyInclude`/`selectLiveTenancy` remain exported from `lib/tenancy/active-tenancy.ts` for any future unfiltered use, just no longer consumed anywhere in this filtered shape.
- **Verified:** live against the `Stayo tester` Supabase project — created a real tenant via `POST /api/tenants/invite` + the real activation-workflow endpoints, logged in, and confirmed `/api/auth/me`, `/api/food/tenant/schedule`, `/api/food/tenant/voting-period` all return 200 post-fix (were 500 pre-fix on the same account). Not run through `vitest` — this environment has no `apps/backend/.env.test` / `DATABASE_URL_TEST` configured, so the test suite doesn't run here at all (pre-existing, unrelated to this change).
- **Related:** [[Changelog]], [[Decisions]] ADR-031, [[Database]]

### "+ Add hostel" still opened the 12-step onboarding wizard — the purpose-built popup existed but was never actually wired in, and its password step-up was decorative

- **Status:** fixed
- **Found:** 2026-08-08, reported directly by the user with a screenshot of the wizard's location step opening instead of a popup.
- **Area:** [[Frontend]] (`features/owner-onboarding/pages/OwnerDashboardPreviewPage.tsx`), [[Backend]] (`app/api/owner/hostels/route.ts`)
- **Symptom:** clicking "+ Add hostel" on the owner dashboard navigated to `/onboarding`, the full account/KYC/location/floors/rooms/beds/review/publish wizard — the wrong flow for an owner who already has an account and just wants a 2nd/3rd hostel.
- **Root cause:** the 2026-08-02 dead-button pass (see the entry below, and [[Changelog]]/[[Features]]) built exactly the right component for this — `AddHostelModal.tsx`, a bottom-sheet with Basic Info/Location/Contact fields — but `OwnerDashboardPreviewPage.tsx`'s `onAddHostel` callback was left calling `navigate('/onboarding')` (that file's own Bugs.md fix description at the time literally says so) rather than opening the new modal; the modal was built but its one call site was never updated, so it sat unimported and unreachable. Separately, `AddHostelModal` fetched a `CREATE_HOSTEL` identity token via `identityService.confirmIdentity(password, ...)` but never included it in the `ownerService.createHostel(...)` payload, and `POST /api/owner/hostels` never read or verified an `identity_token` at all — [[APIs]] had already flagged this exact gap ("its token is a local password gate only, never consumed against `POST /owner/hostels`"). Net effect: even once wired up, the password step would have been UI theater — any authenticated owner session could call the endpoint directly and skip it.
- **Fix:** `OwnerDashboardPreviewPage.tsx` now opens `AddHostelModal` (local `addHostelOpen` state) instead of navigating. `AddHostelModal.tsx`'s mutation now sends `identity_token` in the create-hostel payload. `POST /api/owner/hostels` now calls `verifyIdentityConfirmation(identity_token, "CREATE_HOSTEL", "create_hostel", session.sub)` before creating the hostel, and wraps the duplicate-name check + `hostels.create` + `consumeIdentityTokenInTx` in one `prisma.$transaction` (same guard module `payments/record-offline` uses) so the token is atomically single-use with hostel creation and a failed create leaves it unconsumed for retry. Missing/expired/mismatched tokens now return `403 IDENTITY_REQUIRED`/`IDENTITY_EXPIRED`/`FORBIDDEN` instead of silently creating the hostel.
- **Related:** [[Features]], [[Changelog]], [[APIs]], the entry below (original build of `AddHostelModal`, 2026-08-02)

### Owner "Sign out" never ended the session — it reset mock onboarding state and redirected, leaving the account fully logged in

- **Status:** fixed
- **Found:** 2026-08-08, reported by the user: "i was logined then i loged out, so i thought of login again but i wanted to try the reset pass — when i clicked forgot pass and then back to login it directly opend the owner dashboard"
- **Severity:** high — an owner who signed out on a shared or public computer remained authenticated, and the next person reaching `/login` was dropped into the dashboard.
- **Area:** [[Frontend]] (`features/owner-more/hooks/useMoreNav.ts`)
- **Symptom:** signing out *looked* correct — you land on the marketing page, exactly as a real sign-out does. Only returning to `/login` revealed it: the owner dashboard opened immediately, with no credentials.
- **Root cause:** the owner's sign-out control (both `MoreSettingsPage` and `MoreConfigurationHubPage`) was wired to `useMoreNav().signOut`, which called `journey.reset()` — clearing **mock onboarding state** — and `navigate('/')`. Nothing else. No `POST /api/auth/logout`, so no Postgres revocation and no Redis deny-list entry; no `supabase.auth.signOut()`, so the Supabase session survived in storage. The hook's own doc comment asserted the opposite ("clears the session ... a real action, not a placeholder"), which is presumably why it went unquestioned. Tenant, admin and the legacy portal were never affected — they call `useAuth().logout()`.
- **Why it then re-entered the dashboard:** the app mounts **four separate `AuthProvider` instances** (public shell, auth shell, protected shell, owner-journey routes), each with its own `user` state. Navigating to `/login` mounts the public shell's provider fresh; it hydrates from `GET /auth/me`, which still succeeded because the token was never revoked, and `AuthContext`'s redirect effect (`AuthContext.tsx:163-173`) sends an authenticated owner from `/login` to `/owner/home`.
- **Fix:** `useMoreNav().signOut` now awaits `useAuth().logout()` — server revocation, Supabase sign-out, query-cache and storage teardown, redirect. `journey.reset()` is kept for the in-memory mock state; its persisted copy lives in `sessionStorage`, which `logout()` already wipes.
- **Regression guard:** `apps/frontend/src/context/logoutIntegrity.test.ts` enumerates every file rendering a sign-out control and asserts each reaches `logout`, following the file's own imports one level (so a page delegating to a hook still counts). It failed on exactly the two owner pages before the fix and passes on all six after. Rendering isn't available in this suite (node environment, no jsdom), so it asserts on source text — the same style as `apps/backend/tests/auth-hardening-security.test.ts`.
- **Note for future work:** `features/owner-session/useOwnerSession.ts` also delegates to a self-described "dev/integration-only" legacy adapter. It supplies `ownerId`/`hostels` to owner data hooks rather than gating routes, so it is not an auth bypass — but it is the same class of scaffolding-left-in-production and deserves its own review.
- **Related:** [[Changelog]], [[Frontend]]

### Three security controls were silently inert because Redis was never configured — and the docs claimed they were protecting things

- **Status:** fixed (Upstash provisioned 2026-08-08); Edge-side verification added, browser verification still outstanding
- **Found:** 2026-08-08, while answering the user's question "what about the ratelimiting"
- **Area:** [[Backend]] (`lib/redis/*`, `middleware.ts`)
- **Symptom:** none visible. Everything appeared to work, which is what made it dangerous.
- **Root cause:** every rate limiter routes through `checkFixedWindowLimit`, which is Redis-backed with **no database fallback**, and `checkStatelessLimit` is called with `failOpen: true`. With no `UPSTASH_REDIS_REST_URL`/`_TOKEN` set, each call returned `available: false, allowed: true`. Measured directly: a 6th request to a 5-per-15-min endpoint returned `200`. The same absence disabled `checkSessionRevocationEdge` (so **logout did not revoke an access token** — the Redis deny-list is the only way to kill a stateless Supabase JWT before `exp`), `checkIdleTimeoutEdge` (**no 30-minute idle timeout**), and `setOneTimeLock`, which falls back to `true` = "lock acquired", meaning a **password-reset token could be redeemed more than once** inside its validity window and OTP verification had no replay lock.
- **Not affected:** login brute-force (`checkRateLimit` falls back to `checkDatabaseRateLimit` on `login_attempts`) and OTP code guessing (attempt counters live in Postgres).
- **Fix:** Upstash Redis provisioned in Mumbai and wired to `stayo-testing`; verified by the rate-limit boundary flipping from `200` to `429` exactly at the configured `maxAttempts`. `GET /api/health/redis-edge` added because `/api/health` is `runtime = "nodejs"` and structurally cannot test the Edge client that enforces revocation and idle timeout.
- **Documentation defect fixed alongside:** [[Decisions#ADR-055|ADR-055]] and [[Business-Rules]] asserted that rate limits meant the phone endpoint "cannot sweep a number range." That was wrong twice over — the per-identifier limit does nothing against enumeration (each probe uses a new identifier and gets a fresh budget), and the limits were inert anyway. Docs that overstate a protection are worse than silent ones, because someone relies on them.
- **Latent hazard found while fixing:** `session-revocation-edge.ts` reimplements the Redis key format (its own `clean()`, `"v1"`, `"hms"`) since it cannot import Node-only code. Node writes those keys and Edge reads them, so a one-sided change to either file would break revocation **open and silent**. Now enforced by `tests/redis-key-parity.test.ts`.
- **Related:** [[Decisions#ADR-055|ADR-055]], [[APIs]], [[Changelog]]


### Every Supabase session rejected with "Invalid session" — backend and frontend were on different Supabase projects, and nothing in the system could say so

- **Status:** fixed in code (diagnosability + honest errors); **the production environment variable itself is an operator action** — see below
- **Found:** 2026-08-08, reported by the user ("I am not being able to use continue with Google at all")
- **Area:** [[Backend]] (`middleware.ts`, `lib/auth/supabase-jwt-edge.ts`), [[Frontend]] (`context/AuthContext.tsx`)
- **Symptom:** three failures that looked unrelated. Google sign-in reached Google's account chooser, returned to `/auth/callback`, and died showing `Invalid session` with repeated 401s on `/api/auth/me`. Email + password login showed `Unable to connect. Check your internet.` while the console showed `POST /api/auth/login → 401` *and* `GET https://<ref>.supabase.co/auth/v1/user → 403`. Password reset emails never arrived (separate root cause, below).
- **Root cause:** the production backend verified access tokens against a different Supabase project than the one the frontend minted them with. `Invalid session` is reachable from exactly one line (`middleware.ts:194`), only when Supabase ES256 verification *and* the legacy HS256 fallback both reject the token — and `verifySupabaseAccessToken` verifies `issuer: ${SUPABASE_URL}/auth/v1`. The login symptom is the same fault mirrored: `createSessionAndTokens` always mints via `signInWithSupabasePassword` against the *backend's* project (there is no legacy-token fallback), so `setSession()` handed a foreign token to the frontend's project and got 403. A trailing slash on `SUPABASE_URL` produces the identical outcome (`…supabase.co//auth/v1`).
- **Why it took hours to find:** nothing reported the issuer either side derived. Establishing the frontend's project ref required downloading the deployed JS bundle; the backend's was not observable at all. Compounding it, two error messages actively pointed the wrong way — `AuthContext.tsx` printed "check your internet" for any error lacking `.response`, which includes a `setSession` failure, and `/api/auth/me` collapsed every Supabase rejection reason to a flat `Unauthorized` even though `lib/auth/supabase-session.ts` computed specific codes and its own header comment claimed `/auth/me` consumed them. That wiring was never done, so "no Stayo account for this email" and "the deployment is misconfigured" were indistinguishable.
- **Fix:** `/api/health` gained an `auth.supabase` block (`project_ref`, `expected_issuer`, `jwks_reachable`) so the mismatch is a single `curl`; `SUPABASE_URL` is normalized through `lib/config/supabase-auth-config.ts` so a trailing slash can no longer break every session silently; `/api/auth/me` returns the specific reason with 403; `AuthContext` distinguishes a session-establishment failure from a network failure; `AuthCallbackPage` distinguishes 403 (your account cannot sign in this way) from 401 (deployment misconfigured, retrying will not help). **The environment variable must still be corrected in Vercel** on the backend project: `SUPABASE_URL` = `https://xhoqkhwsnqfwhjsffybs.supabase.co` (no trailing slash) and `SUPABASE_ANON_KEY` = the key whose `ref` claim matches. That project is canonical — `DATABASE_URL`'s user is `postgres.xhoqkhwsnqfwhjsffybs`.
- **Linkage integrity — checked, clean:** the worry was that `ensureSupabaseIdentity` had been writing foreign-project UUIDs into `profiles.auth_user_id` on every attempt. `npm run reconcile:supabase-identities` (dry run) reported 3 linked, 0 dangling, 0 ambiguous. It returns early for an already-linked profile, so the wrong-project path never reached a write. No data cleanup needed.
- **Related:** [[Decisions#ADR-031|ADR-031]], [[APIs]], `docs/superpowers/specs/2026-08-08-auth-recovery-design.md`

### Password reset emails silently never sent — provider failure reported as success

- **Status:** fixed in code; **verifying the sending domain is an operator action**
- **Found:** 2026-08-08
- **Area:** [[Backend]] (`lib/services/auth-service.ts`, `lib/services/email-service.ts`)
- **Symptom:** "Forgot password" always answered with its reassuring generic message and no email ever arrived. Indistinguishable from success for users *and* operators.
- **Root cause:** two layers. `EmailService` falls back to Resend's sandbox sender (`onboarding@resend.dev`) when no verified domain exists, and Resend only delivers that to the account owner's own address — the code comment documented this, but nothing acted on it. Then `requestPasswordReset` wrapped the send in a `try/catch` that logged and returned the success message regardless, discarding `sendEmail`'s `{ sent: false, error }` result entirely.
- **Fix:** send failures are now logged at error level and event-logged as `PASSWORD_RESET_EMAIL_FAILED`. The response carries `delivery_degraded`, derived from **provider configuration only** (`lib/services/email-delivery.ts`) — a recipient-dependent flag would have turned the deliberately generic response into an account-enumeration oracle. The reset UI offers the WhatsApp channel when delivery is degraded rather than claiming an email was sent. The email itself was also still branded **"Sri Adithya Boys Hostel"** and now uses the existing Stayo `emailShell`. **Operator action:** verify `yourstayo.com` at resend.com/domains.
- **Related:** [[Decisions#ADR-055|ADR-055]], [[APIs]], [[Features]]

### Owner Leads dashboard card: one mutation shared across the whole list, and no status gating — clicking Approve disabled every card, and approved leads never visibly changed

- **Status:** fixed
- **Found:** 2026-08-07, reported by the user testing the admin dashboard directly ("when I click Approve, it's loading for all... if I approve, it should show Pending or Not Pending, but it's showing the same again").
- **Area:** [[Frontend]] (`platforms/admin/pages/AdminDashboardPage.tsx`)
- **Symptom:** two compounding bugs on the "Owner Leads" preview widget on `/admin` (distinct from the earlier stale-enum Approve bug below, which this widget also had history with):
  1. Clicking Approve on one lead card put *every* lead card's Approve/Reject buttons into the disabled "Sending…" state, not just the clicked one.
  2. After a successful approve, the same lead reappeared in the preview looking identical and still fully actionable — no visible status change at all.
- **Root cause:** `leadApproveMutation` is a single `useMutation()` instance created once per page render but reused across `d.leads_preview.map(...)` — `mutation.isPending` is global to the mutation object, not per-invocation, so it was read directly as each card's `disabled`/label state. Separately, the card never rendered `l.status` at all and unconditionally rendered Approve/Reject regardless of it, and `GET /api/platform-admin/dashboard`'s `leads_preview` query took the 3 most recent leads with no status filter, so an already-approved lead stayed in the preview by recency alone.
- **Fix:** landed in two independent, parallel changes that turned out to fully cover both symptoms once merged: this fix scoped the per-lead pending check via `mutation.variables === l.id` and added a status badge, reusing `canApprove`/`canReject`/`STATUS_LABEL`/`STATUS_TONE` from `platforms/admin/leads/leadQueue.ts`; commit `8f77ff9` ("rebuild the lead queue for volume, fix four dashboard inconsistencies", landed on `dev` first) independently introduced `leadQueue.ts` itself, rebuilt `AdminLeadsPage.tsx` around it, moved the dashboard's Reject to deep-link into the full Leads page (capturing a reason instead of a silent `status: LOST`), and filtered `leads_preview` server-side to `NEW`/`UNDER_REVIEW`/`APPROVED` only — so an approved lead now actually leaves the preview. Resolved by rebasing this branch onto `8f77ff9` and reworking the per-row-loading-state fix against the new `leadQueue.ts` exports instead of the now-superseded `leadStatus.tsx` this entry originally introduced (deleted).
- **Related:** [[Frontend]], [[Changelog]], the entry below (same widget, different bug, 2026-08-01)

### Recent Activity feed labeled every hostel row "Onboarded" regardless of actual status, and test-suite writes were indistinguishable from real onboarding events

- **Status:** fixed
- **Found:** 2026-08-07, user noticed the admin dashboard's Recent Activity panel flooded with `Test Hostel <hex>` entries all labeled "Onboarded" within the same minute.
- **Area:** [[Backend]] (`lib/services/platform-admin-activity-service.ts`)
- **Symptom:** every `hostels` row creation was rendered as `"New hostel: <name>" / "Onboarded"`, with no distinction between a draft/unverified hostel and a fully live one — and no way to tell real onboarding from noise.
- **Root cause:** `composeRecentActivity()`'s hostel branch only ever selected `id, name, created_at` and hardcoded `sub: "Onboarded"`, never reading the `verification_status`/`listing_status` columns that already exist and are used elsewhere on the same dashboard route (`pending_approvals` KPI). Separately (data hygiene, not a code bug): `apps/backend/.env.test` and the dev root `.env` point at the **same** Supabase project, so every `npm test` run's `createTestHostel()` factory calls (`Test Hostel ${uuid.slice(0,5)}`) wrote directly into the dev DB the admin dashboard reads from.
- **Fix:** `composeRecentActivity` now selects `verification_status`/`listing_status` and labels each hostel entry accordingly (`Onboarded` only for `listing_status: LIVE`; `Suspended`; `Verified — pending listing`; or `Pending verification`), reusing the same status vocabulary as `AdminHostelsPage.tsx`'s chips. Separately purged ~700 stray test-data rows (134 `Test Hostel *` hostels and everything hanging off them — tenants, rent_obligations, payments, agreements, etc. — plus 1 orphaned non-pattern-matching test hostel) from the dev DB via a dependency-graph-driven cleanup script (introspected `information_schema` FK constraints, deleted children-first). The `.env.test`/dev-DB collision itself was **not** fixed — flagged as a follow-up, since it will keep recurring on every test run until the environments are actually separated. (It recurred once more the same day — a different test file's fixtures this time, names like `A`/`B`/`AAA`/`Alpha`/`Zulu` — and was cleaned up again the same way.)
- **Follow-up, same day:** the dashboard's inline "Recent Activity" card was removed outright rather than kept accurate — it duplicated the header notification bell (same `composeRecentActivity()` feed) with a different interaction model, so fixing the labels here didn't fix the deeper redundancy. The bell is now the sole surface for this feed, and the composition itself was narrowed to exclude leads (they already have a dedicated place — the Owner Leads card / `/admin/leads` — so a lead update appearing as a generic notification too was a second, drifting path to the same information). See [[APIs]], [[Changelog]].
- **Related:** [[Backend]], [[Database]], [[Changelog]], [[APIs]]

### The frontend's CSP `connect-src` hardcoded a single backend origin, silently blocking any dev-environment frontend from reaching its own backend

- **Status:** fixed
- **Found:** 2026-08-07, while standing up a separate dev/testing Vercel deployment (`dev` branch → `stayo-testing.vercel.app` backend project) alongside the existing production one.
- **Area:** [[Frontend]] (`apps/frontend/vercel.json`)
- **Symptom:** the frontend's own `axios` client already builds its API base URL correctly and exclusively from `VITE_API_URL` (`apps/frontend/src/lib/api-client.ts` — no hardcoded host, no silent fallback, by design), so pointing a new dev frontend deployment's `VITE_API_URL` at the dev backend (`https://stayo-testing.vercel.app/api`) should have been sufficient. But `apps/frontend/vercel.json`'s CSP `connect-src` directive only allowlisted the production backend origin (`https://stayo-backend-stayo-devs-projects.vercel.app`) — the browser would block every XHR/fetch to any other origin regardless of what `VITE_API_URL` said, with no indication in application code that this was the cause.
- **Root cause:** `vercel.json` is static JSON parsed by the Vercel platform before/independent of the app build — it cannot read `process.env` or be templated per-environment the way Vite's `import.meta.env.VITE_*` substitution can. The CSP header (and the `/pay/:token` WhatsApp-payment-link rewrites, same file) were written assuming a single backend ever existed, which was true until a second (dev) backend project was introduced.
- **Fix:** added the dev backend origin (`https://stayo-testing.vercel.app`) alongside the existing prod origin in `connect-src`, as a static multi-origin allowlist — both environments' frontends can build against the same `vercel.json` and reach either backend, since the actual routing decision is already made correctly at build time via `VITE_API_URL`. The `/pay/:token` rewrites were deliberately left pointed at prod only, since WhatsApp payment deep links aren't part of dev/testing flows; a true per-environment dynamic config (Vercel's Build Output API generating `.vercel/output/config.json`) was considered and rejected for now as disproportionate to the actual need.
- **Related:** [[Frontend]], [[Changelog]]

### Owner lead funnel notifications branch — a silent data-loss path, a runtime-only Prisma miss, and an unrecoverable failed-approval dead end

- **Status:** fixed
- **Found:** 2026-08-06, in the final whole-branch review of `feat/owner-lead-funnel-notifications`. Three Important, four Minor, no Critical.
- **Area:** [[Frontend]] (`platforms/admin/pages/AdminLeadsPage.tsx`, `app/pages/public/EnquiryStatusPage.tsx`), [[Backend]] (`app/api/platform-admin/leads/*`, `app/api/leads/track/[token]/route.ts`, `src/services/platform-leads/*`, `scripts/seed-uat-demo-chain.ts`, `prisma/migrations/20260806120000_platform_lead_tracking`)
- **Symptom / root cause, most severe first:**
  1. **Data loss.** `AdminLeadsPage.tsx` opened its drawer immediately from a list-row fallback while a separate detail query was still loading, but seeded the "Message to applicant" textarea only from the (still-undefined) detail query's data — so an admin opening a lead with an existing message briefly saw an empty box, and clicking "Save message" in that window PATCHed `applicant_message: ''`, permanently wiping the message the applicant was reading.
  2. **Runtime-only, compiler-blind.** `platform_leads.create` at the admin-create route and the UAT seed script both omitted the now-required, unique `tracking_token` column — `prisma` is typed `any` and `next.config.js` sets `ignoreBuildErrors: true`, so nothing caught this until it threw `PrismaClientValidationError` at runtime.
  3. **Migration safety.** `20260806120000_platform_lead_tracking/migration.sql` called `gen_random_bytes()` to backfill `tracking_token` without `CREATE EXTENSION IF NOT EXISTS pgcrypto;` first — on any DB where pgcrypto isn't already enabled (the Supabase-realistic case), the three `ADD COLUMN`s would commit and the backfill `UPDATE` would then throw, leaving a half-applied migration that blocks every later one. The repo's own `20260514134500_whatsapp_logs_id_default` migration already established the correct pattern; this one just didn't follow it.
  4. **No recovery path.** `stayo_owner_invitation` is unapproved in Meta, and admin-created leads never collect a `google_email` — so when both delivery channels failed on approve, the generated activation link existed only in the DB, retrievable by nobody short of a manual query. The lead stayed correctly at `APPROVED` (by design, for retry), but the admin had no way to hand the applicant their link in the meantime.
  5. **Minor — reachability.** `rejection_reason` was written by the reject endpoint but never selected or returned by any route, so an applicant whose rejection WhatsApp send failed (template ⑤, also unapproved) saw "Not proceeding" on their tracking page with no explanation, forever — despite the reject endpoint's own validation message promising the reason would reach them.
  6. **Minor — consistency.** `sendAccountActivated` logged lowercase event types (`owner_account_activated_notified`/`_failed`) while its four sibling sends all log SCREAMING_SNAKE; `AdminLeadsPage.tsx`'s `TIMELINE_LABEL` map had no entries for seven of the newer event types, so the admin drawer rendered raw enum strings for them.
  7. **Minor.** `EnquiryStatusPage.tsx` treated `isError` uniformly, so a transient 500 rendered the same "we couldn't find that enquiry" copy as a genuinely unknown token.
- **Fix:** seed the applicant-message textarea from `openLead` (the same list-row fallback the drawer already renders from), and disable Save while the detail query is loading. Both create call sites now mint `tracking_token` via `crypto.randomBytes(32).toString("hex")`, matching `leads/self-serve/route.ts`. The migration now opens with `CREATE EXTENSION IF NOT EXISTS pgcrypto;`. `approveLead()` returns the `activationLink` it already builds; the approve route and the admin API wrapper thread it through; the drawer renders it as a copyable field, shown only when `!whatsapp_sent && !email_sent`. `GET /api/leads/track/[token]` now selects and returns `rejection_reason`, but only when `status === 'LOST'` — the response stays an explicit allowlist, `notes` still never appears — and the tracking page renders it like the existing "Message from our team" block. The two lowercase event types were renamed to match their siblings (nothing else referenced the old strings); the seven missing timeline labels were added. The tracking page now distinguishes a 404 (via the error's `response?.status`, duck-typed rather than importing `AxiosError` from `axios` — the architecture check forbids any `from 'axios'` import in UI code, types included) from any other failure, showing a distinct "something went wrong" state for the latter.
- **Verification:** backend `test:pure` 13 files / 209 tests pass; frontend `test` 13 files / 250 tests pass; frontend `build` (architecture + branding checks) passes; backend `tsc --noEmit` shows zero errors in any file this wave touched (pre-existing repo-wide error count unaffected).
- **Related:** [[Changelog]], [[APIs]], [[Database]], [[Features]]

### A round trip through a `datetime-local` input walked the voting window backwards, and a live drag had no way back

- **Status:** fixed
- **Found:** 2026-08-06, in the final whole-branch review of `feat/food-ux-pass` (`.superpowers/sdd/2026-08-05-food-ux-pass/final-review.md`). Three Important and eight Minor findings, no Critical. The review verified the drag's coordinate maths and the three-way same-meal-type enforcement as **correct**; every finding was at an edge around them.
- **Area:** [[Frontend]] (`features/owner-food`), [[Backend]] (`app/api/food/voting-periods`, `app/api/food/schedules/[id]/meals/swap`)
- **Symptom:** three that mattered. (1) An owner opening *Edit window* and saving without touching anything moved the voting deadline **5h30m earlier** in IST, and again on every save — a window ending within 5h30m landed in the past, so every tenant got `409 VOTING_CLOSED` while the panel still showed the green OPEN badge. The same screen showed "11:00 pm" in its header and "17:30" in its field. (2) A mis-aimed drag on a PUBLISHED week changed two weekdays' meals for the rest of the month, live, with no toast and no undo — while the *smaller* tap-to-edit path had all three. (3) A drag released over a day that was not on screen did nothing and said nothing, which is the common case, because the week is ~766px against ~590px of usable phone height and motion does not auto-scroll.
- **Root cause:** (1) a `datetime-local` value carries **no offset**, so the browser reads it back as local time; the prefill wrote UTC (`toISOString().slice(0,16)`). The two halves disagreed by exactly the zone offset, and the edit path was the first place the value made a **round trip** — which is what turned a cosmetic offset into cumulative data drift. The in-code comment justified the UTC prefill as matching `defaultStart`/`defaultEnd`, which carried the same bug latently; consistency with a latent bug is not a reason to make it load-bearing. (2) and (3) are the same root: the drag was built as a *mechanism* and the affordances the equivalent tap path already had — announcement, recovery, refusal feedback, a non-pointer route — were never carried across to it.
- **Fix:** one wave, four commits on `feat/food-ux-pass`. Both directions of the date round trip now go through the pure `features/owner-food/votingWindow.ts` (9 tests, and they pin no timezone — the drift is asserted as `getTimezoneOffset()` so it holds in every zone). A swap on a published week fires `stayoToast.undo` naming both weekdays, undone by re-issuing the same call since **a swap is its own inverse**. Drops that land on nothing, and drops refused for meal type, now speak. The picker sheet gained **"Move to another day"**, which makes Monday↔Sunday reachable, supplies the non-pointer path [[Decisions#ADR-042|ADR-042]] point 6 requires, and lets the hint line stop advertising the pointer-only path first. Backend: both swap writes are conditional on the cell still holding the item the transaction read (`swapWritesLanded`, 4 tests) so two overlapping swaps cannot duplicate one item and lose another; the swap route maps `FORBIDDEN:` to 403 instead of a 500 quoting an internal string; and `voting-periods` claims a new round with a conditional update rather than a read-before-write, and counts `notified` from fulfilled results rather than attempts. Plus four small ones: the grip is disabled rather than unmounted mid-swap (it was shifting all 28 chips), is `aria-hidden` rather than carrying an inert label on a role-less span, no longer lets a cancelled mouse drag open the picker, and the hostel trigger's cap is px rather than `46vw` — which stopped binding above ~1043px, since the shell is capped at 480px.
- **Worth remembering:** the two most consequential defects were both *asymmetries with an existing path* rather than broken logic. The edit-window prefill was the first **round trip** through a formatter that had been wrong-but-harmless for as long as it existed; the drag was a new way to reach an edit the module already knew how to announce, undo and warn about, and simply did not reuse any of it. Both are invisible to a test suite that can only see pure functions, and both were found by reading the two paths side by side.
- **Related:** [[Food]] §7.2, [[Decisions#ADR-042|ADR-042]], [[Changelog]], [[Features]], [[APIs]]

### The Food module's pure cores were right and every edge around them was unfinished

- **Status:** fixed
- **Found:** 2026-08-05, in the final whole-branch review of `feat/food-phase-0-1` (`.superpowers/sdd/2026-08-05-food-phase-0-1/final-review.md`). Six Important and seven Minor findings, no Critical.
- **Area:** [[Backend]] (`app/api/food/schedules/generate`, `app/api/cron/food-carry-forward`), [[Frontend]] (`features/owner-food`, `features/owner-dashboard`)
- **Symptom:** individually small, but they shared one shape — *the tested pure function was correct and the wiring around it was not*, which is exactly the class a pure-function-only test suite cannot catch. The four worth naming: (1) a hostel with **no schedule row** — a new hostel, or any hostel on the 1st before the carry-forward cron runs — rendered the Today card's four *Fix* buttons over a null grid, so every tap found no cell and returned silently: four dead primary buttons at the top of the module's busiest screen, and the same on every first paint while loading. (2) The **Kitchen sheet ignored the selected hostel**: a two-property owner reading Sri Lakshmi's week and tapping *Send to kitchen* got Sri Adithya's menu, under Sri Adithya's name, pre-filled into a `wa.me` share — wrong-hostel data leaving the product to a third party, with no picker on the screen and no route to the other property's sheet at all. (3) The publish checklist reported **"5 student votes used"** above the Publish button for a week assembled from zero votes. (4) **Inline add-item failed silently and destroyed the typed name**: a duplicate item name returns 409, the hook swallowed it, and the sheet cleared the input before checking the result — the seven-interaction dead-end the feature removed, replaced by a two-interaction one that said less than the message it deleted.
- **Root cause:** every defect lived in the *wiring* around a well-tested pure function. `toWeekGrid` handles a null grid gracefully; the component consuming that empty grid shipped four dead buttons. `buildPublishChecks` was thoroughly tested and two of its three inputs were wrong at the call site — `votesConsidered={Boolean(voting.period)}` answers "does a voting period exist for this month", not "was this schedule built from votes", and `voterCount` was a sum of `food_votes` rows, which one tenant may hold several of. `decideRebuild` was exhaustively tested and its call site's TOCTOU was not: the status read sat 5–9 generator round-trips ahead of the `$transaction` that acted on its decision, so a concurrent publish could have its month deleted — the Phase 0 failure narrowed to a race window rather than removed. `createAndReturn` had no test at all. Separately, `FILL_GAPS` rewrote `source` and `generated_from_voting_period_id` unconditionally, so a purely additive fill made a carried-forward month claim it was built from student votes — which would in turn have corrupted the honest signal the votes check was fixed to read.
- **Fix:** one wave, four commits. Backend: `rewritesProvenance` on `RebuildDecision` (expressed on the policy object, since that is the surface with tests) so only a full replace may claim authorship; the published-status guard re-asserted **inside** the transaction, aborting with the same `409 SCHEDULE_PUBLISHED`; the cron's voting-expiry sweep pushed into SQL (`voting_ends_at: { lte: now }`) instead of scanning every OPEN period in the system, keeping `shouldAutoClose` as the tested unit. Frontend: `hasVotesApplied(schedule)` as a **pure, tested predicate** over `generated_from_voting_period_id` rather than an inline boolean in JSX — the point being that the finding becomes a test failure next time; `voterCount` → `voteCount`; the consecutive-days scan wrapped Sunday→Monday; variety reporting every dominated meal type rather than only the worst. Plus the empty/loading states, the `?hostelId=` thread-through with a switcher on the kitchen sheet, the spoken add-item failure, the hostel name on the Home row, and the undo toast's no-op and failed-revert cases. The `WeekGrid` contract's bypass in its own largest consumer was closed by deleting the duplicate projection that made it invisible — see [[Food]] §6.
- **Related:** [[Food]], [[Decisions#ADR-048|ADR-048]], [[Changelog]], [[Features]]

### "Regenerate" silently unpublished the live menu and destroyed every manual edit

- **Status:** fixed — see [[Decisions#ADR-048|ADR-048]]
- **Found:** 2026-08-05, during the Food module audit (`docs/audits/food-module-audit.md` §0.2).
- **Area:** [[Backend]] (`app/api/food/schedules/generate`), [[Frontend]] (owner Food tab)
- **Symptom:** tapping **Regenerate** — a plain text button sitting directly beside the green **PUBLISHED** badge — emptied every tenant's Food tab instantly, with no warning to the owner that it had happened.
- **Root cause:** the generate route's upsert `update` branch set `status: "DRAFT"` unconditionally and then `deleteMany`'d all 28 `food_schedule_meals` rows. Since `GET /api/food/tenant/schedule` filters on `status: "PUBLISHED"`, the tenant read went empty; every manual correction the owner had made was also gone, and `published_at` stayed populated so the row claimed a publish timestamp it no longer honoured. Unlike first-time Generate, the button was **not** gated by `canGenerate`, had no confirmation and no undo. The route's own doc comment asserted the opposite — *"Re-running overwrites the previous generation — always safe since nothing is published until the owner explicitly publishes"* — which is true only for a schedule that has never been published, i.e. false in exactly the case the button is most likely to be pressed.
- **Fix:** the decision moved into a pure, testable function rather than a dialog — a dialog is a plea, not an invariant. `decideRebuild` (`lib/services/food/schedule-rebuild-policy.ts`) gates the route: `BUILD`/`START_OVER` are draft-only and answer **`409 SCHEDULE_PUBLISHED`** against a published month; `FILL_GAPS` is additive (writes only `menu_item_id: null` cells), leaves `status` untouched, and is the only mode allowed there. A test enumerates every `(mode × currentStatus)` pair and asserts no combination can write `status: "PUBLISHED"`. The owner control now reads **Rebuild** on a draft and **Fill gaps** on a published month.
- **Related:** [[Food]], [[Decisions#ADR-048|ADR-048]], [[APIs]], [[Changelog]]

### A correct, transactional, idempotent cron had never once run — `vercel.json` never scheduled it

- **Status:** fixed — see [[Decisions#ADR-048|ADR-048]]
- **Found:** 2026-08-05, during the Food module audit (§3.1). **Only visible from live data.**
- **Area:** [[Backend]] (`app/api/cron/food-carry-forward`, `apps/backend/vercel.json`)
- **Symptom:** on the 1st of every month a hostel had no schedule, so the owner regenerated and republished from scratch, and tenants meanwhile saw the *previous* month's pattern labelled "Current".
- **Root cause:** `vercel.json` registered exactly two crons (`generate-rent`, `rent-reminders`). `food-carry-forward` — 95 lines of correct, transactional, idempotent, `CRON_SECRET`-protected code that clones last month's published 28 cells into a new `DRAFT`/`CARRIED_FORWARD` row — was not among them. Reading the code alone would not have caught this: it looked complete and behaved correctly. **The live `FoodScheduleSource.CARRIED_FORWARD` count was 0 across all 3 schedules**, which is what proved it had never executed. [[Changelog]]'s 2026-07-26 entry had explicitly claimed it was registered at `0 4 * * *`; that claim was simply wrong, and the same page's cron inventory repeated it.
- **Fix:** one line — registered at `"0 1 * * *"`. The same daily loop was also given a second, closely-related responsibility: closing any `food_voting_periods` row still `OPEN` past its `voting_ends_at` (`shouldAutoClose`, pure, tested). Nothing could close a period before, which **dead-ended the owner permanently** — the Generate button is gated on `!period || period.status === 'CLOSED'`, while the Close button only rendered while `isOpen`.
- **Broader finding, not fixed here:** 16 cron routes exist in this backend and only a handful are scheduled. Worth its own sweep — a route being written is not evidence it runs. Logged in [[TODO]].
- **Related:** [[Food]], [[Decisions#ADR-048|ADR-048]], [[APIs]], [[Changelog]]

### The Food tab's most discoverable feature was a mock that wrote nothing

- **Status:** fixed by deletion — see [[Decisions#ADR-048|ADR-048]]
- **Found:** 2026-08-05, during the Food module audit (§0.3).
- **Area:** [[Frontend]] (`features/owner-food`, owner Home Quick Actions)
- **Symptom:** an owner could create a "Food Poll", watch it appear, close it, see a winner announced and a toast reading *"…added to menu · edit before publishing"* — and nothing was ever written anywhere. Everything evaporated on refresh.
- **Root cause:** `useFoodPolls` was `useState(mockFoodPolls)` and never touched the network. `totalTenants: 180` was hardcoded in the mock *and* in `useCreatePollDraft.buildPoll()`; the Date and Closing-time fields were rendered as `<div>`s rather than inputs, so they were unchangeable; "Edit" was `stayoToast.info('Opening poll editor…')` for an editor that did not exist; four hardcoded strings were presented as "Smart Insights" analytics. **And `useHomeQuickActions` routed the Home FAB straight into it**, so the most discoverable food feature in the product was the one that did nothing — while the real, working voting system (`VotingPanel` + `useFoodVoting` against `/api/food/voting-periods`) sat on the other tab under a different name.
- **Fix:** deleted, ~842 lines net, with the Home Quick Action repointed at `/owner/food` and relabelled *"Food menu"* rather than left advertising a removed feature. **No capability was lost, because there was none.** `FOOD_SLOTS`, `MEAL_CATEGORY_META`, `MealSlotKey` and `mealIcons.ts` were kept — real design tokens used by ~20 files that merely happened to live under `shared/mocks/`. This reverses [[Decisions#ADR-029|ADR-029]] point (3)'s "keep both", per explicit user direction.
- **Related:** [[Food]], [[Decisions#ADR-048|ADR-048]], [[Features]], [[Changelog]]

### The Food tab silently served `hostels[0]`, with no route to any other property's food

- **Status:** fixed — see [[Decisions#ADR-048|ADR-048]]
- **Found:** 2026-08-05, during the Food module audit (§2.7).
- **Area:** [[Frontend]] (owner Food tab)
- **Symptom:** a two-property owner saw property #1's library, votes and menu, with nothing on screen naming the hostel, and **no way at all** to reach property #2's food.
- **Root cause:** `FoodPage.tsx` passed `session.primaryHostelId` to every hook and had no picker. That value is `hostels[0]?.id ?? null`, and `legacyAuthAdapter.ts`'s own comment names this as the thing not to do, citing the `CLAUDE.md` "must not fall back to first hostel" invariant ([[Decisions#ADR-003|ADR-003]]). `architectural-invariants-check.ts` enforces that rule — but **it scans the backend only**, so a frontend violation of a backend-enforced invariant went uncaught. Live data confirmed it bit: 2 active hostels, both with libraries and published schedules, one reachable.
- **Fix:** `HostelSwitcher` in the Food tab header, rendering nothing for a single-hostel owner (zero friction where there is no choice) and mandatory for everyone else. Note the Kitchen sheet at `/owner/food/kitchen` still reads `primaryHostelId` directly — deliberate for now and flagged in [[Food]], not silently inherited.
- **Related:** [[Food]], [[Decisions#ADR-048|ADR-048]], [[Decisions#ADR-003|ADR-003]], [[Changelog]]

### Expense suggestions were built end-to-end, wrappers and all, and never called

- **Status:** fixed — see [[Decisions#ADR-047|ADR-047]]
- **Found:** 2026-08-05, during the Expenses Phase 1 audit.
- **Area:** [[Frontend]] (Add Expense), [[Backend]] (expense service)
- **Symptom:** the Add Expense form said *"Suggestions come from your past entries."* and never showed any.
- **Root cause:** `expenseService.getFrequentExpenses` and `getExpenseTitleSummary` were fully implemented, routed (`mode=suggestions`, `mode=title_summary`) **and** wrapped on the frontend (`getSuggestions`, `getTitleSummary`) — with **zero callers** in `src/`. A complete vertical slice connected to nothing. The **tenth** instance of this pattern found in this codebase, and the most misleading: the UI explicitly advertised the missing behaviour.
- **Fix:** the first wizard step now consumes expense memory (an extension of the same service, on the same route), so the promise the copy made is kept.
- **Related:** [[Decisions#ADR-047|ADR-047]], [[Features]], [[Changelog]]

### The other three Action Center tiles could not be tapped at all

- **Status:** fixed — see [[Decisions#ADR-046|ADR-046]]
- **Found:** 2026-08-05, while establishing the shared interaction model.
- **Area:** [[Frontend]] (owner Home)
- **Symptom:** Review Agreements, Activate Tenants and Fill Vacant Beds showed real counts and captions but did nothing when tapped.
- **Root cause:** `StatCard` exposed no `onClick` prop — the tiles were not "unwired", they were **structurally incapable** of interaction. Affordances six, seven and eight of this class, and the most misleading yet: all three sat in a row beside the Collect Rent hero card, which by then did navigate.
- **Fix:** `StatCard` now renders as a `<button>` when given an `onClick` and stays a `<div>` otherwise, so an informational tile never advertises an interaction it lacks. Each card opens its own work queue built on the shared `WorkQueue` component.
- **Related:** [[Decisions#ADR-046|ADR-046]], [[Features]], [[Changelog]]

### "Collect Rent" showed a chevron and went nowhere

- **Status:** fixed — see [[Decisions#ADR-045|ADR-045]]
- **Found:** 2026-08-05, during the Phase 2 audit.
- **Area:** [[Frontend]] (owner Home)
- **Symptom:** the Action Center's Collect Rent hero card displayed the total owed and a `›`, but tapping it did nothing.
- **Root cause:** `DarkHeroCard` was rendered with no `onClick` and no wrapping control — the `›` was decoration. The **fifth** affordance of this class in this codebase, after the property drag handle, the partial-payments toggle, three dead rows on the old billing screen, and the Home search bar.
- **Fix:** the card is now a real button opening today's prioritised collection queue. "Collect Rent" in the All Actions sheet routes to the same place, so both entry points lead to one workflow.
- **Related:** [[Decisions#ADR-045|ADR-045]], [[Features]], [[Changelog]]

### The Home search bar was not a search bar, and the endpoint behind it had no callers

- **Status:** fixed — see [[Decisions#ADR-044|ADR-044]]
- **Found:** 2026-08-05, during the Universal Search audit.
- **Area:** [[Frontend]] (owner Home), [[APIs]]
- **Symptom:** the "Search tenant, room.." field on Home could not be typed into.
- **Root cause:** it was a `<div>` containing a `<span>` — no `<input>`, no `onClick`, no handler of any kind. The **fourth** affordance of this class found in this codebase, after the property drag handle, the partial-payments toggle that never existed, and three dead rows on the old billing screen. Separately, `/api/owner/search` existed and was documented as powering "the global navbar", and `ownerService.searchTenants` wrapped it — but **nothing in `src/` called either**. A working endpoint and a working client wrapper, connected to nothing.
- **Fix:** the bar is now a real button opening Universal Search; the orphaned endpoint was rebuilt as the universal, provider-based one behind it.
- **Related:** [[Decisions#ADR-044|ADR-044]], [[Features]], [[Changelog]]

### Partial payments were enforced but unconfigurable, and three screens fought over the same billing settings

- **Status:** fixed (full-stack) — see [[Decisions#ADR-043|ADR-043]]
- **Found:** 2026-08-05, reported directly by the user: "when marking a payment it shows partial payments are not allowed and if i check settings i dont find any option to toggle it or manage it".
- **Area:** [[Frontend]] (owner Configure + collect flow), [[Backend]] (settlement planner, hostel policy)
- **Symptom:** collecting ₹100 against ₹8,000 of rent was refused with *"Full payment required. Minimum: ₹8,000 (Rent)"*, and no screen anywhere offered a way to change that.
- **Root cause — four separate defects behind one symptom:**
  1. **A shipped enforcement with no control.** `partial_payments.enabled` existed in the hostel policy, was read by `settlement-planner.ts`, was writable through `PATCH /hostels/:id/preferences` — and defaulted to `false`. `allow_partial_payments` appeared **nowhere** in `apps/frontend/src`. The rule was enforced; the switch was never built.
  2. **The review sheet contradicted itself.** The "After confirming" block rendered unconditionally from the allocation preview, so a refused payment still displayed "1 installment left part-paid", "₹7,900 still outstanding" and "a receipt is generated and the tenant is notified" — an outcome that could not occur — while Confirm sat disabled.
  3. **Silent data loss between duplicate screens.** `MoreBillingPage` (Settings → "Rent and billing") and `MoreConfigLateFeesPage` (Configure → Finance) both wrote `billing.late_fee`. The former always wrote `type: 'FLAT'` and **omitted `max_amount`**, so configuring a PERCENTAGE fee with a cap and then pressing Save on the older screen rewrote it to FLAT and dropped the cap, with no warning. [[Changelog]] had claimed the old screen was "kept, unlinked" — it was still linked from `MoreSettingsPage`.
  4. **Save buttons under the bottom nav.** `MoreConfigTenantDefaultsPage`, `MoreConfigLateFeesPage` and `MoreConfigReceiptFooterPage` used `fixed bottom-0` with no nav offset, z-index or max-width, unlike the older screens which used `bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-20`. Every save action in the new Configure hub was partly obscured.
- **Fix:** one canonical Billing policy screen owning all five billing concepts; the three duplicates deleted and their routes redirected; a new `minimum_percentage` floor; the collect flow states the policy up front and, at review, explains the block *or* the outcome but never both. Full reasoning in ADR-043.
- **Also uncovered:** the backend test suite is entirely unrunnable without `DATABASE_URL_TEST` — *including tests of pure functions*, because the shared setup file imports `lib/db`. A `test:pure` runner was added so the financially sensitive allocation logic could actually be verified (56 tests). Provisioning a real test database is still open work.
- **Related:** [[Decisions#ADR-043|ADR-043]], [[Business-Rules]], [[Features]], [[Changelog]]

### The hostel cards' drag handle was decoration — reordering had never been implemented at all

- **Status:** fixed (full-stack: new column, new endpoint, real drag)
- **Found:** 2026-08-04, reported directly by the user: "i am not able to drag hostels card".
- **Area:** [[Frontend]] (owner Home), [[Database]], [[APIs]]
- **Symptom:** every Property card on owner Home rendered a `⠿` drag handle. Dragging did nothing, on desktop or on a phone.
- **Root cause:** the feature had **never been built** — this was not a regression. `react-dnd` and `react-dnd-html5-backend` were listed in `apps/frontend/package.json` but **imported nowhere** in `src/`; no `DndProvider` was mounted anywhere in the app; and `DragHandle` was a decorative `<span aria-hidden="true">` rendering six dots with no event handlers of any kind. `hostels` also had no ordering column, so no order could have been persisted even if the drag had worked. The handle was a visual affordance carried over from the Figma design source — its own doc comment says the glyph was "confirmed reused across every drag-and-drop list in the design source", which is what it was copied from. Three other call sites (floor groups, room layout, food-poll options) have the same decorative handle and the same non-existent reorder behaviour. **A second latent cause sat behind the first:** even fully wired, `react-dnd-html5-backend` uses the HTML5 drag-and-drop API, which does not fire on touch devices — so the mobile-first owner app could never have dragged anything with that backend.
- **Fix:** see [[Decisions#ADR-042|ADR-042]]. Real handle-only drag via `motion`'s `Reorder`/`useDragControls` (already a dependency — no new package; `react-dnd` and `react-dnd-html5-backend` removed), persisted to a new nullable `hostels.display_order` through `PATCH /api/owner/hostels/reorder`. Drag is deliberately scoped to a "My order" sort mode and the handle is **hidden** in the four metric sort modes, so a handle that can't be dragged never appears again. `DragHandle` is now dual-mode and stays decorative at the three call sites whose reorder behaviour still doesn't exist — making those interactive would have recreated this exact bug elsewhere.
- **Caveat:** the backend tests for this are written but were **never executed** — `DATABASE_URL_TEST` is defined nowhere and `.env.test` doesn't exist, so the backend suite can't run in this environment at all (pre-existing; an untouched existing test fails identically). Verified live against the real API instead.
- **Related:** [[Decisions#ADR-042|ADR-042]], [[Features]], [[Database]], [[APIs]], [[Changelog]]

### Owner couldn't add a hostel, and a swathe of owner-app buttons were dead ends

- **Status:** fixed (frontend only, no backend changes needed — every backend route these now call already existed and worked)
- **Found:** 2026-08-02, reported directly by the user: "I can't add a hostel", "I couldn't click the card option on the owner side", and "so many things open the Coming Soon section."
- **Area:** [[Frontend]] (owner app)
- **Symptom:** the dashboard's **"+ Add hostel"** button did nothing but show a toast — a brand-new owner with zero hostels (real: `/owner/*` never required an owner to have one to reach the dashboard) had no way to create one at all. The property card's **kebab "⋮" menu** was the same dead stub — the card body itself navigated fine, but its one discrete "options" affordance did not, which is plausibly what read as "can't click the card." Beyond those two, roughly a dozen more owner-facing rows/buttons (`TenantActionsSheet`'s Share Payment Link/Create Charge/View Receipts/Request Change/Change Billing Frequency, the Room Sheet's "Edit room details", Settings' Tenant Defaults row, About's Privacy/Terms/Licenses, Help's Email us, the dashboard's "View Leads") all showed `stayoToast.info('Coming soon')` even though the backend route or an equivalent working UI already existed elsewhere in the app — they had simply never been wired to it.
- **Root cause:** not a backend gap anywhere — an owner-app "dead button" pattern accumulated across several earlier sessions (see the 2026-07-27 UI-fidelity pass and the Tenants-tab entry in [[Features]]), each individually flagged honestly as `stayoToast.info('Coming soon')` at the time rather than silently no-op'd, but never circled back to once the real backend/UI it stood in for shipped elsewhere.
- **Fix:** "+ Add hostel" now navigates to the real `/onboarding` wizard; for an already-authenticated owner it skips straight to the hostel-naming step instead of re-asking for account credentials (`useOwnerOnboardingState`/`OwnerOnboardingWizard` gained an `initialStep` floor). The kebab menu opens a new `HostelOptionsSheet` with a real "Edit hostel details" (routes to `MoreHostelIdentityPage`, now also mountable at `/owner/more/hostel/:hostelId` so it edits the specific card's hostel, not always the primary one) and a real "Archive hostel" (`useArchiveHostel` → `DELETE /hostels/:id`, blocked server-side if the hostel still has active allocations). `TenantActionsSheet` now calls `ChangeFrequencyModal`, `CreateObligationModal`, `useTenantActions().sharePaymentLink`, the tenant's own Activity tab, and `ChangeRequestDrawer` — all pre-existing components/hooks used elsewhere in the app, cloned or reused rather than rebuilt. Room details editing reuses the existing `roomService.update` (`PATCH /rooms/:id`), deliberately excluding bed-count changes since capacity can't safely drop below occupied beds. Left as honest `stayoToast.info('Coming soon')`, not force-fixed: Alerts tab's Leads/Renewals/Requests actions (that tab's own list is still mock data, a bigger fix), Contact Support/Report a Bug (no ticketing backend exists), and Food Polls (no persistence layer exists).
- **Related:** [[Features]], [[Changelog]]

### "Security check failed" when an owner sent a tenant invitation

- **Status:** fixed
- **Found:** 2026-08-01, reported from the live app.
- **Area:** [[Backend]] (middleware/CSRF) / [[Frontend]] (api-client)
- **Symptom:** an owner completed the Invite Tenant wizard, pressed **Send invitation**, and got *"Security check failed. Refresh the page and try again."* The tenant was never invited. Refreshing sometimes helped and sometimes did not.
- **Root cause:** not one bug — the double-submit mechanism itself was verified **correct** against production first (`POST` with no pair → 403, with a matching pair → 200, both direct and through the Vercel `/api` rewrite). Three separate fragilities around it produced the failure. (1) **`GET /api/auth/me` minted a brand-new CSRF token on every call.** `AuthContext` calls it on every Supabase auth-state change — mount, tab focus, token refresh — so the token was a moving target, and an unsafe request prepared moments earlier could arrive carrying one that had just been replaced. (2) **A browser can hold more than one `hms_csrf` cookie** — a host-only one plus a `Domain=.yourstayo.com` one left behind by an earlier deploy configuration (`sharedCookieDomain()` returns a domain only when both URL env vars are set, and the root `.env` sets neither). Both are sent; the server read exactly one via `req.cookies.get()` and compared it against a header derived from the other, giving that browser a **permanent** 403 until its cookies were cleared. (3) **`secure` was derived from `NODE_ENV`, not the request protocol**, so a production build served over plain http sets a `Secure` cookie the browser silently discards — leaving the client with a header and no cookie, unrecoverably.
- **Fix:** `/auth/me` no longer rotates the token (rotation now happens only at auth boundaries — login, logout, signup, activation, password reset — where it means something); the CSRF check compares the header against **every** `hms_csrf` the browser sent rather than the first, which does not weaken double-submit since every candidate was issued by us and the guarantee rests on a cross-site attacker being unable to read or set the *header*; `getCsrfCookieOptions` takes the real protocol; and the client now treats a `CSRF_VALIDATION_FAILED` 403 as **recoverable** — it re-bootstraps a fresh pair and replays the request once, so a stale token heals invisibly instead of surfacing as a dead end on a deliberate, authenticated action. The Edge-runtime constraint is respected: middleware keeps its own copy of the cookie parsing rather than importing `lib/security/csrf.ts`, which pulls in `node:crypto`. 17 new tests.
- **Related:** [[APIs]], [[Changelog]], [[Decisions#ADR-031|ADR-031]]

### Tenants could upload KYC documents that no owner had any way to approve

- **Status:** fixed (frontend only — every endpoint already existed and was correct)
- **Found:** 2026-08-01, by the owner product integration audit (P0-4).
- **Area:** [[Frontend]]
- **Symptom:** a tenant completed activation, uploaded their Aadhaar and College ID, and then waited forever. The owner could see the documents listed as "PENDING" on Tenant Detail → Documents and had no control of any kind to act on them — no approve, no reject, no way to open the file. `tenants.document_verified` could therefore never become true through the product, so the tenant stayed permanently "Docs Pending" in the list, the Home "Verify KYC" count only ever went up, and onboarding had no end state.
- **Root cause:** **not** a missing backend, which is what made it easy to mis-diagnose. `PATCH /api/tenants/:id/documents/:docId/verify`, `…/reject` (reason-required), `GET …/download` and `GET /api/tenants/pending-documents` all existed, were owner-scoped, and were already wrapped correctly by `tenantService`. The frontend components that used them — `VerificationPanel.tsx`, `DocumentsTab.tsx` — were left **orphaned** by the 2026-07-26 salvage pass that moved 8 flows into `/owner/*` and deleted the old tree's routes. The new `TenantDetailPage`'s Documents tab was written as a display-only list, so the capability existed on both sides of the wire with nothing joining them. A second contributor: Home's "Verify Pending KYC" card computed a **real** count and had `onClick={soon}`, so the one signpost pointing at the problem was itself a dead end.
- **Fix:** a real review surface on Tenant Detail (View · Download · Approve · Reject) plus a new `/owner/tenants/verifications` queue grouped by tenant and ordered oldest-wait-first, wired to Home's card. Decision logic extracted to a pure, tested `kycDocuments.ts` that mirrors the route guards rather than restating them loosely, so the UI can't offer a button that returns 409/400. Rejection requires a reason, matching both the route's 400 and the fact that the reason is the only thing the tenant is shown. Approval invalidates all four surfaces that derive from `document_verified` at once. The routes themselves gained their first tests (17, characterisation) since they were about to carry real traffic.
- **Related:** [[Features]], [[Changelog]], [[APIs]]

### The invite wizard reported "Invitation sent!" on every 2xx, including the 202 that means nothing was delivered

- **Status:** fixed (frontend only — the backend was already correct)
- **Found:** 2026-08-01, by the owner product integration audit (P0-1).
- **Area:** [[Frontend]]
- **Symptom:** an owner could send twenty tenant invitations, see twenty green "Invitation sent! {name} will get a text to complete KYC." screens, and have **zero** of them reach anyone — with no indication anywhere in the UI that delivery had failed, and no way to recover short of guessing.
- **Root cause:** three compounding gaps. (1) `useInviteWizard.onSuccess` was `() => { setSubmitted(true); … }` — it discarded the response entirely, while the backend had been carefully reporting `whatsapp_sent`, `whatsapp_error`, `email_sent`, `needs_email` and returning the `activation_link` needed to recover. (2) The wizard collected **no email address** (`TenantStep` had name + phone only), so `dispatchInvitationNotification`'s email fallback could never fire — `needs_email` was true by construction for every invite. (3) The structural trap that made (1) easy to write and easy to repeat: **both invitation endpoints report delivery failure with a 2xx status.** `POST /api/owners/invitations` returns `202` when neither channel sent, and `POST /api/tenants/resend-invitation` returns `202` with an *error-shaped* body. Axios resolves on 2xx, so neither ever rejects — a `try`/`catch` around either call sees only success. Given the WhatsApp template drift this repo had been fighting the same week (`bd3d1e9`, `3b0fb6b`), the failing path was the *likely* one, not the edge case.
- **Fix:** new pure `features/owner-tenants/invite/inviteDelivery.ts` reads delivery state from the body and treats anything unrecognised as **undelivered** rather than delivered (`whatsapp_sent: "false"` as a string does not count as sent). `InviteDeliveryResult.tsx` renders three honest states, and in the failure state always shows the activation link with Copy / Share so the workflow is never stranded. `needs_email` prompts for an address inline and re-dispatches through the existing resend route rather than making the owner start over; the resend's error body has no `activation_link`, so the original is carried forward. An optional Email field was added to step 1 and is echoed on the review step as "None — no fallback" when blank, making the risk visible *before* sending. 30 tests, on the first test suite `apps/frontend` has ever had.
- **Related:** [[Features]], [[Changelog]], [[APIs]]

### The WhatsApp bot answered only messages that were *exactly* a command, and stayed silent for everything else

- **Status:** fixed
- **Found:** 2026-08-01, first real inbound message after webhook delivery started working: "test help" produced `unauthorized_owner` and `processed_commands: 0`, and the sender got no reply at all.
- **Area:** [[Backend]]
- **Symptom:** a real tenant message reached the handler, was logged, and then vanished — no command ran, no reply was sent, and the event was recorded as `{status_events: 0, updated_logs: 0}` as if nothing had arrived.
- **Root cause:** two independent gaps that only combine into silence. (1) Command lookup was `COMMAND_HANDLERS[msg.body.trim().toUpperCase()]` — an exact match on the **entire** message, so "test help" looked up the key `"TEST HELP"` and missed; only a bare "help" ever matched. (2) The `else` branch checked for a pending selection state and, finding none, did nothing — there was no default reply, and because `processedCommands` stayed `0` the code fell through to the *status* branch and reported a status-event result for what was actually an inbound message. `unauthorized_owner` was a red herring: it returns `null` and correctly lets the message continue to the tenant handlers.
- **Fix:** `resolveCommandKey()` (whole message → first word → single unambiguous command token, punctuation stripped) replaces the exact lookup; an unrecognised message now gets "Sorry — I didn't understand that." plus the help text, rate-limited 3 / 10 min per sender; each message is wrapped in its own `try/catch` so a throwing handler neither abandons the rest of the batch nor leaves the sender hanging; and the result shape gained `fallback_replies` / `failed_messages` so a delivery that produced no *command* is no longer indistinguishable from one that produced nothing. Fixed in passing: the no-resident help text still said "Welcome to Sri Adithya Hostels", a retired identity ([[Decisions#ADR-033|ADR-033]]).
- **Related:** [[Business-Rules]], [[Features]], [[Changelog]]

### Any `/api/…` URL with a trailing slash was silently served the SPA's `index.html` instead of reaching the backend

- **Status:** fixed in config (`apps/frontend/vercel.json`); **needs a frontend redeploy to take effect**
- **Found:** 2026-08-01, auditing the request path after a WhatsApp webhook verification failure.
- **Area:** [[Frontend]] (deploy config) / [[Backend]]
- **Symptom:** `https://yourstayo.com/api/webhooks/whatsapp?hub.…` → 200 with the challenge echoed (correct), but `https://yourstayo.com/api/webhooks/whatsapp/` (one trailing slash) → **200 `text/html`, the SPA shell**. Confirmed generic, not webhook-specific: `/api/health` → `application/json`, `/api/health/` → `text/html`. A caller pasting a URL with a trailing slash gets a `200 OK` full of HTML — Meta reads that as a failed verification, and nothing appears in the backend logs because the request never reaches the backend.
- **Root cause:** the Vercel rewrite `"/api/:path*"` does not match a trailing slash, so the request fell through to the SPA catch-all `"/((?!.*\\.[a-zA-Z0-9]{1,5}$).*)" → "/index.html"`, which matched *everything* without an extension — including API paths. The `200` is what made it invisible: a 404 would have been noticed immediately.
- **Fix:** added a `"/api/:path*/"` rewrite alongside the existing one, and excluded `api/` from the SPA catch-all (`"/((?!api/)(?!.*\\.…$).*)"`) so any future unmatched `/api/…` request fails loudly with a 404 instead of impersonating a page. The exclusion is the important half — it holds even if the trailing-slash rewrite pattern doesn't match on Vercel's router.
- **Note:** on `api.yourstayo.com` the same URL behaves differently — Next.js answers a trailing slash with a `308` to the canonical path (query string preserved). Safe for browsers, not something a webhook sender should be relied on to follow.
- **Related:** [[APIs#Notifications & WhatsApp|APIs]], [[Decisions#ADR-037|ADR-037]], [[Changelog]]

### A Meta webhook retry could re-run inbound-command handlers and send a tenant the same reply twice

- **Status:** fixed
- **Found:** 2026-08-01, auditing the WhatsApp webhook ahead of Meta Cloud API integration.
- **Area:** [[Backend]]
- **Symptom:** never reproduced in production (inbound volume is still low), found by reading the delivery path against Meta's retry contract. A retried delivery of an inbound command (`DUES`, `PAY`, a button reply) could execute the handler a second time — a second WhatsApp reply to the tenant, a second set of Graph API sends.
- **Root cause:** two compounding gaps. (1) The route awaited the *whole* pipeline — DB reads, dues computation, outbound sends — before answering 200, so a slow Graph API call could push Meta past its acknowledgement window and provoke a retry. (2) The duplicate guard read the stored status and only short-circuited on `PROCESSED`; a retry landing while the first delivery was still `PROCESSING` (exactly the case a slow send creates) fell straight through to the handlers. The raw-body hash made the *row* unique, but nothing made the *processing* exclusive.
- **Fix:** the route now records the event, answers 200, and processes after the response (`lib/services/notifications/whatsapp-webhook-handler.ts`), so slowness no longer provokes retries; and `whatsappWebhookEventService.claimForProcessing()` (`whatsapp-webhook-event-service.ts`) makes the claim a conditional `UPDATE … RETURNING` that exactly one delivery wins — `RECEIVED`/`FAILED` are claimable, `PROCESSING` only after a 10-minute stale window so a crashed process can't wedge an event forever. The insert also became `ON CONFLICT (event_hash) DO NOTHING` + re-select, since two simultaneous deliveries could both pass the pre-check and turn a duplicate into a unique-violation 500 (which Meta would then retry again).
- **Related:** [[Decisions#ADR-037|ADR-037]], [[APIs]], [[Changelog]]

### Landing nav's "About" pointed at a section that doesn't exist, and cross-route hash links never scrolled

- **Status:** fixed
- **Found:** 2026-07-31, while rebuilding `/contact` in the marketing theme — the new page copies the landing page's nav, which surfaced both problems.
- **Area:** [[Frontend]]
- **Symptom:** (1) Clicking "About" in the landing-page nav did nothing — it targeted `#vision`, but `LandingPage.tsx` only defines `top`, `whatis`, `why`, `journey` and `search`. (2) Any hash link arriving from another route (e.g. `/contact` → `/#search`) landed at the top of the landing page instead of the requested section.
- **Root cause:** (1) a stale anchor left behind when the section was renamed/restructured — nothing validates that in-page anchors resolve. (2) React Router does not scroll to `#anchor` on navigation; the browser only does it for same-document anchor clicks, which is why in-page nav clicks always looked fine and the bug stayed invisible until a second page linked in.
- **Fix:** repointed "About" to `#whatis` in both `LandingPage.tsx` and the new `ContactPage.tsx` nav; added a small mount effect in `LandingPage.tsx` that reads `window.location.hash` and `scrollIntoView`s the target on the next animation frame (after the section has rendered). In-page clicks are untouched.
- **Related:** [[Features]], [[Changelog]]

### A half-configured WhatsApp environment hard-500'd every route importing the notification service, at module import

- **Status:** fixed
- **Found:** 2026-07-31, during live end-to-end verification of the signup phone-verification fallback ([[Decisions#ADR-034|ADR-034]]) — setting `OTP_PROVIDER=whatsapp` with credentials but **without** `WHATSAPP_BUSINESS_ACCOUNT_ID` made `POST /api/auth/send-phone-otp` return a Next.js HTML 500 error page instead of the new graceful-degradation JSON.
- **Area:** [[Backend]]
- **Symptom:** every request to any route that transitively imports `lib/services/notification-service.ts` (or the Meta provider) failed with `CRITICAL CONFIGURATION ERROR: OTP_PROVIDER is set to 'whatsapp' but the following required environment variable(s) are missing: WHATSAPP_BUSINESS_ACCOUNT_ID` — a 500 HTML page, not a handled API error. Notably this is precisely the "WhatsApp half-configured" state the fallback exists to survive, and the fallback could never run.
- **Root cause:** `validateWhatsAppConfiguration()` was invoked at **module top level** in two places — `notification-service.ts:5` and the bottom of `meta-provider.ts` — and throws. Because it runs at import time, it fired before any route handler, service method, or try/catch in the request path. It was written as a deploy-time fail-fast guard, but Next.js compiles route modules lazily, so in practice it fails at *request* time and takes the request down. The second call site (in `meta-provider.ts`) is the one that actually fired and was easy to miss — patching only `notification-service.ts` changed nothing.
- **Fix:** both import-time invocations now `try`/`catch` and log loudly (`logger.error("whatsapp.configuration_invalid", …)` / `console.error`) instead of throwing. `validateWhatsAppConfiguration()` itself still throws for callers that want to assert on it, so `tests/whatsapp-provider.test.ts`'s expectations are unchanged. Verified live afterwards: the same half-configured environment now returns `{"success":true,"verification_required":false,"reason":"PROVIDER_SEND_FAILED"}` and, after three failures, `"PROVIDER_UNAVAILABLE"` from the circuit breaker.
- **Related:** [[Decisions#ADR-034|ADR-034]], [[Business-Rules#Signup phone verification|Business-Rules]], [[Changelog]]

### `platform_leads.converted_owner_id` was schema-only dead code — no code ever wrote it

- **Status:** fixed
- **Found:** 2026-07-29, while researching the owner-acquisition funnel phase-2 plan — grepped the whole repo for `converted_owner_id` and found only the schema field definition and a one-off UAT seed script, no application code.
- **Area:** [[Backend]], [[Database]]
- **Symptom:** none observed directly — the column existed, presumably designed for exactly "which owner did this lead become," but nothing ever populated it, so any future feature relying on it (like this one) would have silently found every lead unconverted.
- **Root cause:** the column was added when `platform_leads` itself was designed, ahead of the feature that would actually write it — the admin approval/activation pipeline didn't exist yet.
- **Fix:** now written by `POST /api/auth/owner-signup`'s optional `lead_token` handling, at the moment a lead's owner-signup completes (`leadInvitationService.activateInvitationForOwner()`), and read back by `POST /api/owner/hostels` to advance the lead to `HOSTEL_CREATED`. See [[Decisions#ADR-032|ADR-032]].
- **Related:** [[Decisions]] ADR-032, [[APIs]], [[Changelog]]

### Owner-activation links resolved to the old production domain instead of local dev

- **Status:** fixed
- **Found:** 2026-07-30, user reported that clicking the activation link in the approval email landed on the old `sriadithyahostels.in` site instead of the onboarding wizard.
- **Area:** [[Backend]], [[Decisions#ADR-032|ADR-032]]
- **Symptom:** every link built via `frontendUrl()` (`lib/config/domains.ts`) — including the owner-activation email from [[Decisions#ADR-032|ADR-032]] — pointed at `https://sriadithyahostels.in/...` even in local dev.
- **Root cause:** `getFrontendUrl()` falls back to the hardcoded `PRODUCTION_FRONTEND_URL` constant whenever neither `NEXT_PUBLIC_FRONTEND_URL` nor `FRONTEND_URL` is set — both were unset in the working `.env`, so every environment silently got the production fallback, not just real production.
- **Fix:** set `FRONTEND_URL="http://localhost:5174"` in `.env`. `getFrontendUrl()` itself was not changed — its production-runtime guard (`isProductionRuntime()`) is correct as-is; the bug was a missing local env var, not faulty fallback logic. Verified live: a fresh lead approved after the fix produced an email with a correctly-built `localhost:5174/owner-invite/...` link.
- **Related:** [[Changelog]], [[Decisions#ADR-032|ADR-032]]

### Admin Lead drawer showed stale status after approve/status mutations, letting a second click 409

- **Status:** fixed
- **Found:** 2026-07-30, user reported the dashboard kept saying "Link is already sent to you" and an error occurred while sending, despite no email having arrived.
- **Area:** [[Frontend]], [[Decisions#ADR-032|ADR-032]]
- **Symptom:** after approving a lead (or changing its status) from the open detail drawer, the drawer kept rendering the pre-mutation status and an active "Approve Lead" button. Clicking it again hit the now-stale button and the backend correctly rejected it with a 409 (`INVALID_TRANSITION`) — confirmed via backend log timestamps showing an initial `200` followed by two `409`s for the same lead.
- **Root cause:** `AdminLeadsPage.tsx`'s `statusMutation`/`approveMutation` only invalidated the list query (`['admin','leads']`) on success — the drawer reads from a separate query key, `['admin','lead-detail', id]`, which was never invalidated.
- **Fix:** both mutations now also invalidate `['admin','lead-detail', variables.id]`. Also added the success/error toasts the approve flow was missing entirely, and made `APPROVED` (send failed, not yet delivered) retryable via the same button, relabeled "Retry Send" for that state, instead of getting permanently stuck.
- **Related:** [[Changelog]], [[Decisions#ADR-032|ADR-032]]

### Onboarding wizard's publish step silently dropped `city` even though the backend always accepted it

- **Status:** fixed
- **Found:** 2026-07-29, while wiring lead-prefill data into the onboarding wizard for the owner-acquisition funnel phase-2 work.
- **Area:** [[Frontend]]
- **Symptom:** none observed as a user-facing complaint — `useOnboardingSubmission.ts`'s `submitPublish()` called `onboardingApi.createHostel({ name, address })`, never `city`, even though both the frontend API wrapper's type signature and the backend route (`POST /api/owner/hostels`) already accepted it. Every hostel created through the wizard had `city: null` regardless of what an owner might have entered anywhere.
- **Root cause:** `OwnerOnboardingData` never had a `city` field in the first place — `LocationStep.tsx` only ever had an `address` free-text input — so there was nothing to send. Not caused by this change, but left dropped by every prior pass that touched this step.
- **Fix:** added a real `city` field to `OwnerOnboardingData` (and a new input in `LocationStep.tsx`), and threaded it into `createHostel(...)`'s payload. Directly motivated by lead-prefill needing a real place to put a lead's `city` — leaving it prefilled-but-silently-dropped would have defeated the point.
- **Related:** [[Decisions]] ADR-032, [[Frontend]], [[Changelog]]

### `changePassword` 500'd for any profile not 1:1-linked to its Supabase identity

- **Status:** fixed
- **Found:** 2026-07-28, during the Supabase Auth migration (ADR-031) — while auditing every code path that calls into `supabase.auth.admin.*`.
- **Area:** [[Backend]]
- **Symptom:** `authService.changePassword()` would 500 (or silently update the wrong Supabase user) for any profile whose Supabase `auth.users.id` differs from its local `profiles.id` — which is most TENANT/ADMIN profiles and any OWNER profile born before this migration existed.
- **Root cause:** the call passed the local `profile.id` directly to `supabase.auth.admin.updateUserById()`, implicitly assuming the two id spaces are always equal. They're only guaranteed equal for accounts created after ADR-031 (which creates the Supabase user first); every pre-migration profile is a different UUID, linked (if at all) only via the new `profiles.auth_user_id` column.
- **Fix:** now checks `profile.auth_user_id` first; if unset, calls `ensureSupabaseIdentity(profile, newPassword)` (the same JIT-link-or-create helper login uses) instead of guessing an id.
- **Related:** [[Decisions]] ADR-031, [[Database]], [[Changelog]]

### `completePasswordReset` silently missed users past page 1 of Supabase's user list

- **Status:** fixed
- **Found:** 2026-07-28, during the Supabase Auth migration (ADR-031).
- **Area:** [[Backend]]
- **Symptom:** a password-reset completion could silently fail to find/update the matching Supabase identity once the project's `auth.users` table grew past one page.
- **Root cause:** the private `ensureSupabaseResetIdentity()` helper called `supabase.auth.admin.listUsers()` (unpaginated) and searched only the first page's results for a matching email — a Supabase Admin API footgun (default page size, no automatic iteration).
- **Fix:** `completePasswordReset()` now goes through the shared `ensureSupabaseIdentity()` helper, which looks up `auth.users` by email via `prisma.$queryRaw` against the same Postgres instance instead of the paginated Admin API. The old `ensureSupabaseResetIdentity()` (confirmed to have zero other callers) was deleted rather than kept as dead code.
- **Related:** [[Decisions]] ADR-031, [[Changelog]]

### `/api/auth/onboarding-login` unreachable — missing from the public-route allowlist

- **Status:** fixed
- **Found:** 2026-07-28, during the Supabase Auth migration (ADR-031), while re-verifying `middleware.ts`'s `PUBLIC_ROUTES` list against every route file that itself expects no session.
- **Area:** [[Backend]]
- **Symptom:** bulk-imported tenants' phone+password login route (`/api/auth/onboarding-login`) would 401 at the middleware layer before ever reaching its own handler, for any caller without an existing session — i.e. always, since logging in is exactly the case where no session exists yet.
- **Root cause:** the route was never added to `middleware.ts`'s `PUBLIC_ROUTES` array, a pre-existing gap unrelated to anything this migration changed — just never previously noticed since grep confirmed there's no live frontend caller wired up for this route yet.
- **Fix:** added `/api/auth/onboarding-login` to `PUBLIC_ROUTES`. Fixed regardless of the missing frontend caller, since it's a correctness bug in its own right and this migration was already touching the exact list it belongs in.
- **Related:** [[APIs]], [[Decisions]] ADR-031

### `middleware.ts` never cleared identity headers it had previously set

- **Status:** fixed
- **Found:** 2026-07-28, during the Supabase Auth migration (ADR-031), while rewriting `middleware.ts`'s verification block.
- **Area:** [[Backend]]
- **Symptom:** a header-hygiene gap, not observed to have been exploited: `x-owner-id`/`x-tenant-id`/`x-session-id` (and the other identity headers) were only ever conditionally *set* by `middleware.ts` when present on a resolved session, never explicitly cleared on paths where they shouldn't apply (e.g. public/CSRF-exempt paths) — meaning a client-supplied header of the same name could theoretically pass through unmodified on a code path that never overwrote it.
- **Root cause:** the original per-header `if (value) headers.set(...)` pattern had no corresponding `else headers.delete(...)`.
- **Fix:** added an `IDENTITY_HEADERS` array and a `stripIdentityHeaders()` helper called unconditionally at the start of request processing, so every request either gets a fresh, server-computed value for each identity header or has it explicitly removed — never a passthrough of whatever the client sent.
- **Related:** [[Decisions]] ADR-031, [[Architecture]]

### Two `createSessionAndTokens()` callers would have thrown once a plaintext password became required

- **Status:** fixed
- **Found:** 2026-07-28, during the Supabase Auth migration (ADR-031), via a full-codebase grep for every `createSessionAndTokens` call site after the Supabase migration made a 5th `plaintextPassword` parameter mandatory (needed for the new JIT `ensureSupabaseIdentity()` step, which requires the plaintext password to create/update the matching Supabase user).
- **Area:** [[Backend]]
- **Symptom:** would have been a regression, not a pre-existing bug — caught before shipping. `app/api/auth/owner-signup/route.ts` and `src/services/tenants/activation-workflow-service.ts`'s tenant-activation `ACTIVATE` step both called `createSessionAndTokens()` without the new password argument, which throws `"INTERNAL: createSessionAndTokens requires a plaintext password..."`.
- **Root cause:** `login()` and `loginWithPhone()` were updated first (the two call sites the initial pass focused on); a follow-up grep for all remaining call sites of the same function found these two.
- **Fix:** `owner-signup/route.ts` now passes the already-destructured `password` from the request body. `activation-workflow-service.ts` now extracts `activationPassword` from the activation payload and passes it through, preserving the existing "no auto-login if no password given" fallback behavior for that edge case.
- **Related:** [[Decisions]] ADR-031, [[APIs]]

### `refresh_token` stripped from 4 auth response bodies, breaking the new Supabase-session frontend flow

- **Status:** fixed
- **Found:** 2026-07-28, during the Supabase Auth migration (ADR-031) frontend integration pass.
- **Area:** [[Backend]]
- **Symptom:** the frontend's new `supabase.auth.setSession({access_token, refresh_token})` call had no `refresh_token` to use — every auth response that should have carried one had it removed before the response was sent.
- **Root cause:** a leftover pattern from the old httpOnly-cookie-only session design, where deliberately excluding `refresh_token` from the JSON body (destructuring it out before responding) was a real security measure — the refresh token only ever lived in the httpOnly cookie. That pattern no longer fits: the frontend now needs the raw refresh token to hand to the Supabase client directly. Present in 4 places: `/api/auth/login`, `/api/auth/owner-signup`, `/api/auth/onboarding-login`, and `/api/tenants/activate`'s `createActivationResponse()` helper.
- **Fix:** all 4 now include `refresh_token` (and `expires_in`) in the response body, with a comment at each site explaining why this is no longer a leak — the Supabase-issued refresh token is inherently client-visible by design once handed to the SDK, unlike the old system's cookie-only token.
- **Related:** [[Decisions]] ADR-031, [[APIs]]

### `/auth/me` and `/auth/activity` would false-401 every fresh Supabase-mode session

- **Status:** fixed
- **Found:** 2026-07-28, during the Supabase Auth migration (ADR-031) live verification pass — the first real Supabase login round-tripped correctly, but the very next `/auth/me` call 401'd.
- **Area:** [[Backend]]
- **Symptom:** logging in successfully with a real Supabase session, then immediately calling `GET /api/auth/me` (as the frontend does to hydrate the user), returned a session-expired 401.
- **Root cause:** both routes unconditionally called `sessionLifecycleService.touchSession()`, which checks liveness against a `refresh_tokens` table row — but Supabase-minted sessions never write one (session minting moved entirely to Supabase, see [[Database]]'s `refresh_tokens` note). `touchSession()` correctly reported "not found" and both routes treated that as an expired session.
- **Fix:** the `touchSession()` call in both routes is now gated behind `req.headers.get("x-auth-mode") === "legacy"` — Supabase-mode sessions already get an equivalent idle/liveness check earlier, in `middleware.ts` via `checkIdleTimeoutEdge()` against Redis.
- **Related:** [[Decisions]] ADR-031, [[Architecture#Auth flow|Architecture]]

### `getTenantHistory` had a dead, always-false localStorage branch (found, not a live regression)

- **Status:** fixed
- **Found:** 2026-07-28, during the Supabase Auth migration (ADR-031), while sweeping the entire frontend for remaining `ownerUser`/`tenantUser` localStorage references to remove.
- **Area:** [[Frontend]]
- **Symptom:** none observed in production — confirmed via grep that `paymentService.getTenantHistory()` has zero live callers today, so this branch never actually ran with real traffic.
- **Root cause:** `features/payments/api/index.js`'s `getTenantHistory(tenantId, hostelId)` had a pre-migration `isTenantSession` pre-check reading `localStorage.getItem('tenantUser')` to decide whether to short-circuit into the self-service fallback path slightly earlier. Once those localStorage keys were removed as part of this migration, the check became permanently `false` — but the function's existing `if (tenantId) {...} else {fallback}` logic already covered both cases correctly without it.
- **Fix:** removed the dead branch entirely rather than updating it to read Supabase session state, since the existing fallback logic already handled both cases.
- **Related:** [[Decisions]] ADR-031, [[Frontend]]

### Admin login landed on the Owner dashboard instead of the Admin console

- **Status:** fixed (previously diagnosed but left unfixed earlier in the same session — see [[Changelog]] for the original diagnosis)
- **Found:** originally noticed by the user as "no tenant dashboard link" confusion; root-caused and fixed 2026-07-28.
- **Area:** [[Frontend]]
- **Symptom:** logging in as an `ADMIN`-role user landed on `/owner/home` (the Owner dashboard) rather than `/admin` (the real Admin console), which then rendered broken/empty since an admin session has no `owner_id`-scoped hostels.
- **Root cause:** two separate bugs compounding:
  1. `context/AuthContext.tsx`'s "already-authenticated user visits `/login`" effect lumped `role === 'owner' || role === 'admin'` together and always navigated to `/owner/home`.
  2. `app/pages/LoginPage.tsx`'s own fresh-login submit handler (`navigateForUser`) sent `owner` role to `/dashboard` — a route that was never actually registered anywhere in the router. In practice this fell through to the catch-all route (`→ /`), which happened to work out for real owners only because the public landing page has its own separate, unrelated "already have a session + a hostel → skip to `/owner/home`" click-handler — a fragile, accidental two-hop path, not a deliberate one.
  3. Additionally, `platforms/owner/router/OwnerProviderShell.tsx`'s `ProtectedRoute` explicitly allow-listed `['owner', 'admin']`, so even after the redirect were fixed, an admin session that ended up on `/owner/*` (e.g. by directly typing the URL) would not have been bounced back out.
- **Fix:** `AuthContext.tsx`'s effect now branches `admin` → `/admin`, `owner` → `/owner/home`. `LoginPage.tsx`'s `navigateForUser` now sends `owner` directly to `/owner/home` instead of the dead `/dashboard` route. `OwnerProviderShell.tsx`'s `allowedRoles` narrowed to `['owner']` only — `/admin/*` itself was already correctly guarded by `RequireAdminSession` (role === admin only), that part was never broken.
- **Related:** [[Changelog]], [[Frontend]]

### Dev-mode login CORS-blocked whenever Vite's frontend port isn't exactly 5173 or 5174

- **Status:** fixed
- **Found:** 2026-07-27 — owner login failed with a browser CORS error ("No connection / Unable to reach the server") while the backend was demonstrably up and reachable.
- **Area:** [[Backend]]
- **Symptom:** `Access-Control-Allow-Origin` on `/api/auth/login`'s response was `https://sriadithyahostels.in` (the production frontend) instead of the request's actual origin, so the browser's preflight check failed and blocked the request.
- **Root cause:** `lib/config/domains.ts`'s `getCorsAllowOrigin()` only ever allow-listed an exact-match set of origins (`CORS_ALLOWED_ORIGINS` env — `http://localhost:5173,http://localhost:5174` in this repo's `.env`) plus the production domains, falling back to the production origin for anything else. Vite auto-increments past its default port whenever that port is already bound (in this case, a second dev-server instance left running from earlier in the session had 5174 held, so the active browser tab's dev server came up on 5175) — a normal, common occurrence, not a misconfiguration — and 5175 was never in the allow-list.
- **Fix:** `getCorsAllowOrigin()` now reflects back any `localhost`/`127.0.0.1` origin verbatim when not running in production (`isProductionRuntime()` still gates this — production CORS behavior is unchanged, exact-match only).
- **Related:** [[Changelog]], [[Backend]]

### Owner portfolio/dashboard revenue+dues KPIs silently read as ₹0 for any hostel without a same-day snapshot row

- **Status:** fixed
- **Found:** 2026-07-27, during manual UAT click-through — the owner reported the Home/Money dashboard showing no revenue and no dues for a hostel whose Tenants list clearly showed real per-tenant dues, i.e. two surfaces disagreeing about the same underlying money.
- **Area:** [[Backend]]
- **Root cause:** three compounding bugs in the daily-snapshot caching layer (`lib/services/hostel-daily-snapshot-service.ts`), previously invisible because production hostels had already accumulated a same-day snapshot row by the time anyone looked:
  1. `previewLive()` — the fallback used whenever no `hostel_daily_snapshots` row exists yet for today (true for any freshly-created hostel before the nightly cron runs) — hardcoded every money field (`expected_revenue`, `collected_revenue`, `pending_dues`, `overdue_count`, `expenses`, `profit`) to `0` instead of actually querying `rent_obligations`/`payments`/`expenses`, even though `createSnapshot()` a few lines below it already had the real query.
  2. `createSnapshot()`'s `hostel_daily_snapshots.create()` call never supplied an `id` — the column has no Prisma/DB default (`id String @id @db.Uuid`, no `@default(...)`) — so writing a real snapshot row had, in fact, never once succeeded; every call silently threw and was swallowed by the caller's `Promise.allSettled`. This is why `previewLive()`'s bug (above) was the *only* code path ever actually reached.
  3. Once (1) and (2) were fixed and a real snapshot row could finally persist, a third bug surfaced: `portfolio-service.ts`'s per-hostel card mapping read `s.capacity` off the snapshot row to compute `total_capacity`/`occupancy_rate` — but `hostel_daily_snapshots` has no `capacity` column at all (only the previously-unreachable `previewLive()` object shape happened to carry one), so real snapshot rows always yielded `total_capacity: 0`.
- **Fix:** `computeLiveStats()` extracted once and shared by both `createSnapshot()` and `previewLive()`, so the fallback path is a real read, not a stub; `createSnapshot()` now supplies `id: crypto.randomUUID()` and upserts on `(hostel_id, snapshot_date)` instead of a bare `.create()` (idempotent — safe for cron retries/manual force-refresh); `portfolio-service.ts` now sources `total_capacity` from a live `rooms.groupBy` query (cheap, doesn't need daily caching) instead of the nonexistent snapshot field, matching the pattern `dashboard-snapshot-service.ts`'s aggregate path already used correctly.
- **Related:** [[Changelog]], [[Backend]]

### Owner Tenants tab's "All Hostels" view gave no way to tell which hostel a tenant belonged to

- **Status:** fixed
- **Found:** 2026-07-27, same UAT pass — a multi-hostel owner asked "which hostel is this tenant in?" while looking at the combined tenant list.
- **Area:** [[Frontend]]
- **Symptom:** `TenantRow.tsx` never rendered `tenant.hostelName` (a field `useRealTenantList.ts` already populated) — invisible for a single-hostel owner, but ambiguous the moment an owner has 2+ hostels and views them combined via the "All Hostels" filter.
- **Fix:** `TenantRow` gained an optional `showHostel` prop (a small uppercase hostel-name label above the tenant's name); `TenantsPage.tsx` passes `showHostel={filters.hostelId === 'all'}` down through `TenantList` so the label only appears when it's actually needed to disambiguate.
- **Related:** [[Changelog]], [[Frontend]]

### Tenant score endpoint 500'd for any tenant without a profile yet (i.e. every non-activated invited tenant)

- **Status:** fixed
- **Found:** 2026-07-26 (real end-to-end testing while wiring the owner-app Invite flow to real data — sent a real invite via `POST /owners/invitations`, then hit `GET /api/tenants/:id/score` for the resulting tenant)
- **Area:** [[Backend]]
- **Symptom:** `GET /api/tenants/:id/score` returned a 500 with `Argument profile_id must not be null` for any `INVITED` tenant who hadn't completed activation yet.
- **Root cause:** `app/api/tenants/[id]/score/route.ts` fetched `tenant.profile_id` and passed it straight into `tenantScoreService.getTenantScoreSummary(profileId)`, which does `prisma.tenants.findUnique({ where: { profile_id: profileId } })`. A tenant created via the real invite flow has `profile_id: null` until they activate their own account — a normal, common state, not an edge case — and Prisma rejects `null` for that where-clause.
- **Fix:** the route now short-circuits before calling the service when `tenant.profile_id` is null, returning a neutral default score (`100`/`EXCELLENT`/`STABLE`, matching `tenant_behavior_scores.score`'s own schema default) instead — an invited tenant with no profile genuinely has no behavior history to score yet, so this is a real answer, not a workaround.
- **Related:** [[Changelog]], [[Frontend]] (StayO Tenants real-data wiring)

### `apps/frontend` has no `typescript` devDependency, so a plain `npx tsc` silently resolves to an unrelated decoy npm package

- **Status:** open (workaround documented, not fixed)
- **Found:** 2026-07-26, during verification of the tenant-app and admin-console work — a plain `npx tsc --noEmit -p tsconfig.json` in `apps/frontend` returned an empty, error-free result for every check run across this session, which in retrospect was a false negative every time.
- **Area:** [[Frontend]]
- **Symptom:** `npx tsc ...` prints a banner ("This is not the tsc command you are looking for") and exits — it isn't running TypeScript's compiler at all. Because the banner text doesn't match component-name greps used to scan for errors, this reads as "zero errors" rather than "check didn't run."
- **Root cause:** `apps/frontend/package.json` has no `typescript` dependency and no typecheck script at all (only `dev`/`build`/`check:architecture`/`check:branding` — `build` runs `vite build` directly, which transpiles via esbuild and never runs `tsc`). `npx tsc` with no local `typescript` install falls back to npx's global package cache (`~/.npm/_npx/`), which — in this environment — has an unrelated npm package literally named `tsc` (a redirect/joke package, v2.0.4) cached from an earlier, unrelated session. npx silently prefers that cached match over fetching real `typescript` fresh.
- **Workaround used this session:** `npx --yes --package typescript@5.4.5 -- tsc --noEmit -p tsconfig.json` (explicit `--package` forces npx to resolve the real `typescript` package by name, matching the version already used in `apps/backend`). Running this for the first time surfaced dozens of pre-existing, unrelated errors across the codebase (missing `@types/node`, `ImportMeta.env` typing, `lib` target too old for `replaceAll`, etc.) — none introduced this session, confirmed by diffing before/after this session's own new files, all of which come back clean under the real compiler.
- **Not fixed:** adding `typescript`/`@types/node` as real devDependencies and fixing the pre-existing error backlog is a repo-hygiene change well outside the scope of the tenant-app/admin-console work that surfaced this, and risks unrelated churn — left as a known gap rather than fixed opportunistically.
- **Related:** [[Features]] (StayO tenant app, Platform Admin Console) — both verified against the real compiler once this was discovered.

### `notifications.id` had no schema default — every call to `NotificationService.createNotification()` had always silently failed, codebase-wide

- **Status:** fixed
- **Found:** 2026-07-26, while building the Platform Admin Console's Broadcast Notice feature (`POST /api/platform-admin/broadcast`) — the endpoint reported `{sent: 0, total: 2}` for 2 real active owner profiles.
- **Area:** [[Database]]
- **Symptom:** No exception surfaced to the caller (the fan-out uses `Promise.allSettled`), but `sent` was silently `0`. Backend logs showed `Invalid prisma.notifications.create() invocation ... Argument id is missing` for every attempted insert.
- **Root cause:** `model notifications { id String @id @db.Uuid ... }` — no `@default(...)` on `id`, unlike every other id column in the schema (`@default(dbgenerated("gen_random_uuid()"))` is the universal house style). `NotificationService.createNotification()` (`lib/services/notification-service.ts`) never supplied an `id` itself, so every call anywhere in the codebase has always failed at the Prisma layer. This was never noticed before because every existing call site (e.g. Food's publish-notification fan-out to tenants) also uses `Promise.allSettled` or an equivalent swallow-the-error pattern, so the failure was silent rather than crashing the request.
- **Fix:** added `@default(dbgenerated("gen_random_uuid()"))` to `notifications.id`, matching the rest of the schema.
- **Consequences worth knowing:** any in-app notification this codebase believed it was sending via `NotificationService.createNotification()` before this fix — including the Food feature's publish-time tenant notifications, built earlier this session — never actually landed. Not re-verified retroactively for Food; worth a spot-check if in-app notification delivery for that feature is ever in question.
- **Related:** [[Decisions]] ADR-030, [[Features]] (Platform Admin Console), [[Changelog]]

### `GET /api/auth/me`'s `is_admin` field was hardcoded `false`, and the owner login redirect sent `role === 'admin'` to the owner dashboard

- **Status:** fixed
- **Found:** 2026-07-26, while wiring real login for the Platform Admin Console's first bootstrapped admin account.
- **Area:** [[Backend]], [[Frontend]]
- **Symptom:** A real `ADMIN`-role session's `/api/auth/me` response reported `is_admin: false`. Separately, `LoginPage.tsx`'s post-login redirect sent any `role === 'admin'` user to `/dashboard` (the OWNER app), not an admin console.
- **Root cause:** Both were dead code from before `ADMIN` was ever a real, assignable `Role` value (see [[Decisions]] ADR-030) — `is_admin: false` was a literal hardcoded value in the response object, seemingly written defensively for a role that could never actually occur; the login redirect's `role === 'owner' || role === 'admin'` branch predates any admin persona existing to route to.
- **Fix:** `is_admin` now reads `profile.role === "ADMIN"`; the login redirect gained a distinct `role === 'admin' → /admin` branch ahead of the owner check.
- **Related:** [[Decisions]] ADR-030, [[Features]] (Platform Admin Console)

### Every tenant login/activation redirected to a route that no longer existed, silently dead-ending at the public landing page

- **Status:** fixed
- **Found:** 2026-07-26, while wiring the real StayO tenant app (Home/Money/Room/Profile tabs) — reading through `LoginPage.tsx`'s post-login tenant branch to understand the existing redirect flow.
- **Area:** [[Frontend]]
- **Symptom:** After a tenant logged in, or completed activation/profile-completion, the app navigated to `/tenant/dashboard` — a route with no matching `<Route>` anywhere in the current tree, so React Router's catchall (`<Route path="*" element={<Navigate to="/" replace />} />`) silently bounced them to the public marketing landing page instead of their dashboard. Easy to miss without a real tenant session to click through, which no earlier phase of this rebuild had (see the testing-gap notes on the Food feature and elsewhere).
- **Root cause:** `TenantRoutes.tsx` was rebuilt around `TenantAppShell` with a flat `/tenant/{home,money,room,food,profile}` tab structure at some earlier point in this rebuild, replacing the older `TenantPortalLayout`-based tree that registered `/tenant/dashboard`. Three call sites — `LoginPage.tsx`, `CompleteProfilePage.tsx`, `ActivateAccountPage.tsx` — still hardcoded the old path and were never updated to match, since nothing had exercised a real tenant login end-to-end since the router was rebuilt.
- **Fix:** all three redirect targets changed from `/tenant/dashboard` to `/tenant/home`.
- **Related:** [[Changelog]], [[Features]] (StayO tenant app)

### Repeated frequency switches crashed with a unique-constraint error, and (once fixed) could leave a mixed-cadence schedule live

- **Status:** fixed
- **Found:** 2026-07-22 (direct user report, live testing on tenant "shiva": switching Quarterly → Monthly → Quarterly again crashed with `Unique constraint failed on the fields: (agreement_id, rent_month, obligation_type)`)
- **Area:** [[Backend]] — `billing-transition-service.ts::ownerInitiateChange`
- **Symptom:** A third frequency switch on the same tenant, landing back on a `rent_month` already used by an earlier (now superseded) switch, threw a raw Prisma constraint error instead of succeeding.
- **Root cause:** `(agreement_id, rent_month, obligation_type)` is a hard unique index with no `is_superseded` filter — a dead, already-superseded row still permanently blocks a fresh `create()` for that same month. Once fixed by reviving the stale row instead of inserting a new one, a second latent bug surfaced: the supersede step only cleared obligations with `due_date >= effectiveFrom`, so a prior switch to a shorter cadence (with an earlier `effectiveFrom`) could leave its earliest rows un-superseded when switching to a longer cadence — live obligations ended up mixing two different cadences' amounts.
- **Fix:** See ADR-027 — check for and revive (not blindly insert over) an existing row at each target `rent_month`; and supersede every live `UPCOMING` `RENT` row unconditionally (not filtered by `due_date`) before regenerating, since `UPCOMING` rows can never have real payments against them. New regression test exercises the exact reported 3-switch sequence.
- **Related:** [[Backend]], [[Changelog]], ADR-027

### Switching a tenant's billing frequency back to a shorter cadence failed with UNCLEAN_BILLING_PERIOD even when a later period was clean

- **Status:** fixed
- **Found:** 2026-07-22 (direct user report: switching tenant "shiva" (Sri Adithya Boys Hostel-1) from Quarterly back to Monthly failed — DevTools showed `UNCLEAN_BILLING_PERIOD` from `POST /tenants/:id/change-frequency`)
- **Area:** [[Backend]] — `billing-transition-service.ts::ownerInitiateChange`
- **Symptom:** The frequency change failed outright with no way to retry successfully, even though the underlying conflict (this month's rent already activated) would resolve itself the following month.
- **Root cause:** `getNextCleanBillingPeriodDate` computes exactly one candidate effective date — the next calendar boundary aligned to the requested frequency — with zero awareness of the tenant's actual obligations. `ownerInitiateChange` checked only that single candidate for overlap (ADR-023) and gave up immediately if it collided, even though later candidates might easily be clean.
- **Fix:** New `findCleanEffectiveFrom()` walks forward (same 36-month horizon as the existing date-picker) and actually tests each candidate period start against the real overlap check, returning the first one that's genuinely clean instead of just the first one chronologically. See ADR-026. New test confirms a colliding first candidate no longer fails the whole operation — it resolves to a later period instead.
- **Related:** [[Backend]], [[Changelog]], ADR-026

### Owner changed a tenant's billing frequency to Quarterly but the Charges tab kept showing unchanged monthly obligations

- **Status:** fixed
- **Found:** 2026-07-22 (direct user report with a screenshot: owner Tenant Profile Charges tab still listing "Jul 2026 rent (2)", "Aug 2026 rent (3)", "Sept 2026 rent (4)"... individually, ₹8,500 each, after the billing frequency had been changed to Quarterly)
- **Area:** [[Backend]] — `billing-transition-service.ts::ownerInitiateChange`
- **Symptom:** ADR-021 shipped owner-direct frequency changes with a disclosed limitation for agreement-based tenants (the change updates a setting but the already-generated monthly `rent_obligations` don't regroup). This report is that limitation actually being hit in practice — confusing, since the modal reported success.
- **Root cause:** `agreement-rent-schedule-service.ts::generateForAgreementInTx` pre-generates one `RENT` obligation per month for the tenant's full agreement duration, all at once, at signing time — `ownerInitiateChange` only updated `tenants.payment_frequency`/`tenant_billing_plans`, never touching those already-created rows.
- **Fix:** `ownerInitiateChange` now checks for an active agreement; if found, computes enough of the new frequency's periods to cover the remaining agreement term (`agreement.agreement_end_date`), and in the same transaction supersedes the not-yet-due `UPCOMING` `RENT` obligations and creates the new grouped ones — see ADR-024 for why this is safe (the generator it bypasses never re-runs for an already-signed agreement). New tests in `tests/billing-frequency-owner-initiate.test.ts` cover both the regrouping (6 monthly rows → grouped quarterly rows, old ones superseded) and the non-agreement no-op case (rolling generator already handles it, nothing to supersede).
- **Related:** [[Backend]], [[Changelog]], ADR-024

### Waive button silently disappeared (and Cancel wrongly appeared) for partially-paid obligations on the owner Tenant Profile

- **Status:** fixed
- **Found:** 2026-07-22 (direct user report with a screenshot: clicking Cancel on a `PARTIAL` ₹8,500 obligation with ₹5,000 remaining failed with "Cannot cancel an obligation that has payments. Use waiver instead" — but no Waive button was visible to use instead)
- **Area:** [[Frontend]] — `ObligationCard.tsx`
- **Symptom:** A regression introduced by the same-day Cancel/Waive dedup fix (see the changelog entry "stop showing both Cancel and Waive on the same obligation"). That fix made `canCancel`/`canWaive` mutually exclusive based on a computed `hasPayments` flag. On the owner Tenant Profile's Charges tab specifically, `hasPayments` always evaluated `false` regardless of the obligation's real payment history — so every `PARTIAL` obligation showed Cancel (wrong — it has payments, the backend correctly rejects it) and hid Waive (wrong — Waive was exactly the right, and only, valid action).
- **Root cause:** `hasPayments` was computed purely from `Boolean(o.payments && o.payments.length > 0)`. That's correct wherever the obligation object carries a full `payments[]` array — but the Charges tab's obligations come from `financial-service.ts::getTenantDues()`'s `TenantDueItem`, which only ever exposed an aggregate `paid: number`, never a raw `payments` array. `o.payments` was `undefined` on this data path from the start, silently defaulting `hasPayments` to `false` regardless of the obligation's actual state.
- **Fix:** `hasPayments` now falls back to `Number(o.paid_amount ?? o.paid ?? 0) > 0` when no `payments[]` array is present — the same signal the backend itself effectively uses (a `PARTIAL` obligation is definitionally one with `paid > 0`). No backend change needed; this was purely a frontend data-shape assumption that didn't hold across all of `ObligationCard`'s call sites.
- **Related:** [[Frontend]], [[Changelog]]

### Settlement allocation could pay a superseded (dead) obligation — real money, not just a display glitch

- **Status:** fixed
- **Found:** 2026-07-22 (direct user report: tenant "Harsha" at Sri Adithya Boys Hostel-1 showed two separate "Jun 2026 Rent" line items — ₹5,000 and ₹8,500 — in the Collect Now settlement preview; confirmed via psql against `rent_obligations`)
- **Area:** [[Backend]] — `financial-payment-facade.ts` (`receivePayment`, `applyAvailableCredits`, `previewSettlement`)
- **Symptom:** The settlement preview for a real payment showed two "Jun 2026 Rent" rows for the same tenant/month with different outstanding amounts, both being allocated toward and marked "Fully Paid." Only one of these represented real, current debt.
- **Root cause:** The tenant's June obligation had previously been corrected via the "Edit" flow (create replacement, mark original `is_superseded: true` — see [[Business-Rules]], Obligation Lifecycle). The replacement (`ee55a30e…`, ₹8,500, partially paid down to ₹5,000 outstanding) is the real, current obligation. The superseded original (`0dc30b10…`, ₹8,500, zero payments, `is_superseded: true`) should be permanently inert. Every other obligation-fetching query in the codebase filters `is_superseded: false` (13+ call sites across `billingRepository.ts`, `financial-service.ts`, `payment-service.ts`, `rent-change-service.ts`, `agreement-rent-schedule-service.ts`, `onboarding-financials-service.ts`, `onboarding-maintenance-repair-service.ts`) — but `financial-payment-facade.ts`'s three `rent_obligations.findMany` calls never did. Owner-facing totals (Outstanding/Overdue on the profile header) were unaffected — those go through `financialService.getTenantDues`, which does filter correctly — but **`receivePayment`, the function that actually executes a real payment allocation inside the transaction, did not**, meaning a real collected payment could be split across the live obligation and the dead superseded one, or the superseded one could independently be marked "PAID" for money that was never truly owed against it.
- **Fix:** Added `is_superseded: false` to all three `financial-payment-facade.ts` obligation queries, matching the established invariant everywhere else. New regression test in `tests/financial-engine-stabilization.test.ts` ("never allocates to a superseded obligation") creates exactly this fixture (a superseded PENDING obligation alongside a live one, both outstanding) and asserts a credit application allocates only to the live obligation. Ran `check:invariants` and `check:payment-production` (both clean) plus the full backend suite given this touches the core payment-allocation path.
- **Related:** [[Backend]], [[Business-Rules]], [[Changelog]]

### Public payment link pre-filled the entire remaining lease total (₹93,500 for 11 months) instead of what's actually due

- **Status:** fixed
- **Found:** 2026-07-22 (direct user report with a live screenshot of `sriadithyahostels.in/pay/<token>` showing "AMOUNT TO PAY ₹93500" with a breakdown listing all 11 remaining months of rent, Jul 2026 through May 2027)
- **Area:** [[Backend]] — `app/api/payments/pay/[token]/route.ts`
- **Symptom:** Opening a generic (not obligation-specific) payment link pre-filled the amount field with the tenant's entire remaining-lease rent total rather than what they actually owed right now, and the live "Payment Breakdown" preview then dutifully allocated that huge number across every future month, making the link look like it was demanding the whole lease paid upfront.
- **Root cause:** When the link wasn't hinted to one specific obligation (or that obligation was already `PAID`), the route fell back to `financialPaymentFacade.previewSettlement({..., amountRupees: 0}).total_outstanding` — which sums every obligation in `settlement-planner.ts`'s `PAYABLE_STATUSES` (`OVERDUE, PENDING, PARTIAL, UPCOMING`), i.e. literally every future month of rent through lease end, not just what's currently owed. This is the correct meaning for planner-internal use (settlement allocation needs to see everything payable) but wrong to pre-fill as "the amount you owe" on a payer-facing page.
- **Fix:** Replaced the fallback with `financialService.getTenantDues()`'s `items`, summing only obligations that are non-`UPCOMING` **and** due today or earlier — the same due-date-aware pattern used for the tenant portal's own "amount due now" fixes (see the two entries above). When nothing is actually due, the field now defaults to 0 instead of falling back to monthly rent, letting the payer type in whatever amount they intend to pay ahead. Added a regression test (`tests/payment-link-flow.test.ts`) asserting a tenant with one overdue and one early-activated-future obligation pre-fills only the overdue amount.
- **Related:** [[Backend]], [[Changelog]]

### Tenant Home page showed "Total to pay ₹17,000" while only one ₹8,500 rent installment was actually due

- **Status:** fixed
- **Found:** 2026-07-22 (direct user report against a live tenant: "shiva", Sri Adithya Boys Hostel-1 — verified against `rent_obligations` directly via psql)
- **Area:** [[Frontend]] — `TenantPriorityStrip.tsx`, `TenantFinancialsPage.tsx`
- **Symptom:** The Home page's red "Overdue by 17 days" card showed "Total to pay ₹17,000" and a "Pay ₹17,000" button, while the Money tab's own "Current Installment" section showed only one PENDING installment (Jul 2026 rent, ₹8,500) with the rest listed under "Upcoming Payments" as a future forecast, not something due now. A first attempted fix (same day, see [[Changelog]]) treated this as a copy/labeling problem and added an explanatory sentence — but the underlying ₹17,000 figure was itself wrong for the "how urgent is this" framing, so the explanation was confabulated on top of a bad number.
- **Root cause:** Confirmed against the live DB — the tenant had *two* non-UPCOMING rent obligations: Jul 2026 (due 5 Jul, genuinely 17 days overdue) and Aug 2026 (due 5 Aug, but already `PENDING` rather than `UPCOMING` — activated roughly a month early so the tenant *can* prepay it if they want). `financial-service.ts::getTenantDues`'s `current_payable_amount` is deliberately due-date-agnostic ("everything already activated, regardless of due date" — correct for owner-side "how much could I collect from this tenant" use cases) and sums both obligations to ₹17,000. The tenant Home page presented that figure as an urgent "Total to pay" under an overdue banner, which reads as "you're 17 days late on ₹17,000" when only ₹8,500 was actually late — the other ₹8,500 isn't due for another two weeks and was only "payable" in the sense of being available early.
- **Fix:** `TenantPriorityStrip.tsx` (Home) and `TenantFinancialsPage.tsx`'s `financialHealth` orange state (Money tab) now compute a due-date-aware `dueNowAmount`/`dueSoonAmount` from the read model's own `items[]` (which carries per-obligation `due_date`), summing only obligations that are non-upcoming **and** due today or earlier. The headline figure and Pay button on Home now reflect this corrected amount; any additional already-activated-but-not-yet-due balance is shown separately as a low-key "Plus ₹X for next month, already available if you'd like to pay ahead" note instead of being silently folded into the urgent total. The category breakdown (rent/deposit/maintenance/late fee) on Home is now also computed from the same due-now-filtered item set, so it can no longer disagree with the headline number the way "Rent ₹17,000" once did next to "Total to pay ₹17,000" while only ₹8,500 was actually overdue.
- **Related:** [[Frontend]], [[Business-Rules]], [[Changelog]]

### Tenant portal Payment History showed reversed payments as "Payment received" with a raw negative amount, and raw method enums like "ADVANCE_ADJUSTMENT"

- **Status:** fixed
- **Found:** 2026-07-22
- **Area:** [[Backend]] — `payment-service.ts::getTenantPaymentHistory` / [[Frontend]] — `TenantFinancialsPage.tsx`, `TenantPaymentDetailModal.tsx`
- **Symptom:** A tenant's Payment History list showed rows like "₹-1 · Payment received · UPI" and "₹-8,500 · Payment received · ADVANCE_ADJUSTMENT" — a reversal (negative `amount_paid`, the only source of negative amounts in this system) rendered with the same green "Payment received" label as a real incoming payment, with the currency formatter printing the raw negative number (`₹-1`) rather than a clearly-signed reversal. Payment method also rendered as the raw backend enum string instead of a readable label.
- **Root cause:** `getTenantPaymentHistory` passed `amount_paid`/`payment_method` straight through from the `payments` table with no reversal detection and no label mapping. The owner-side activity feed had already solved the identical problem (`financial-timeline-service.ts::describePaymentReversal`, shipped in commit `9fe984d2`) but that helper wasn't exported and wasn't reused by the tenant-facing payment-history path — same underlying data, two different code paths, only one of them fixed.
- **Fix:** Exported `describePaymentReversal` from `financial-timeline-service.ts` and reused it in `getTenantPaymentHistory` to set `is_reversal` on every payment row; added `apps/backend/lib/payment-method-labels.ts` (`paymentMethodLabel()`) mapping known `payment_method` values (CASH/UPI/BANK_TRANSFER/CARD/CHEQUE/ONLINE/ADVANCE_ADJUSTMENT/etc.) to readable copy, with a title-cased fallback for anything unmapped. `TenantFinancialsPage.tsx` now shows reversals as "Payment Reversed" in red with an explicit `−` prefix (amount itself is `Math.abs`'d, so the currency formatter never prints a raw negative sign), and `TenantPaymentDetailModal.tsx` mirrors this in its detail view ("PAYMENT REVERSED" badge instead of "PAID SUCCESS"). Also fixed the advance-credit history entries, which showed "Future rent credit" as both the label and the method on the same row — method now reads "Advance Balance" for non-gateway credit.
- **Related:** [[Backend]], [[Frontend]], [[Changelog]]

### Owner Tenant Profile contradicted itself: "Agreement: Signed" next to "No active agreement", plus a hardcoded hostel name

- **Status:** fixed
- **Found:** 2026-07-22
- **Area:** [[Frontend]] — `TenantProfilePage.tsx`
- **Symptom:** On the owner-facing Tenant Profile page, the Risk & Compliance card's "Agreement" field said "Signed" while the page's own "Rent Agreement" summary chip (right next to "Hostel Location") said "No Active Contract" and the Financial Strip's Agreement card said "No active agreement" — three places on the *same page* disagreeing about the same fact. Separately, "Hostel Location" showed the literal hardcoded string "Hostel 2" for every tenant, regardless of which hostel they actually belonged to.
- **Root cause (initial pass):** Three different UI spots computed "does this tenant have an agreement" from `Boolean(allocations?.length > 0)` — i.e. "has this tenant ever been allocated a room" — a different fact from "does this tenant have a current signed agreement." The "Hostel Location" chip was never wired to real data at all — literally `<span>Hostel 2</span>`.
- **Root cause (real, found via a second live report — tenant BOJJA KAPIL, an independently-verified "Hostel Residency Agreement" document, still showed "Missing"/"No Active Contract"):** The first-pass fix unified all three spots onto `Boolean(agreementMonthsTotal)`, itself computed from `tenant?.agreement_duration_months ?? overview?.agreement_duration_months`. Neither field was ever actually present on `getOwnerTenantOverview`'s response — the function never queried the `agreement` table at all, only `tenant_invitations` (nested, not flattened) and `room_allocations`. So the "consistent" fix was consistently wrong: **every** tenant showed "no agreement," even ones with a real `SIGNED` agreement and a verified document, because the underlying field the whole page relied on genuinely didn't exist in the payload. Confirmed onboarding itself is not at fault — `activation-workflow-service.ts` correctly creates the `DRAFT` agreement and transitions it to `SIGNED` with real duration/start-date/contract terms on activation (`tests/activation-workflow.test.ts`, 6/6 passing); this was purely a read-side gap.
- **Fix:** `getOwnerTenantOverview` (`tenant-service.ts`) now queries the tenant's real current agreement (`prisma.agreement.findFirst({ status: currentAgreementWhere() })`, the same `SIGNED`/`EXPIRING_SOON`/`AGREEMENT_EXPIRED` set the renewal system already uses) and returns `has_active_agreement`, `current_agreement` (id/status/dates/contract terms/pdf_url), plus top-level `agreement_duration_months`/`agreement_start_date` sourced from it (falling back to the invitation snapshot only if no agreement exists). The frontend's three "has agreement" checks now read the new `has_active_agreement` boolean directly instead of inferring from duration presence. New tests: `tests/tenant-overview-agreement.test.ts` (3/3 — signed agreement reports true with real contract terms, no agreement reports false, a `TERMINATED` historical agreement correctly does not count as current). "Hostel Location" now resolves the real hostel name via the owner's hostels list (`ownerService.getHostels()`, matched by the route's `hostelId`).
- **Related:** [[Frontend]], [[Backend]], [[Changelog]]

### Expense/activity-log timestamps could silently show the wrong time on a non-IST server or browser

- **Status:** fixed
- **Found:** 2026-07-22
- **Area:** [[Backend]] — `expense-export-service.ts`, `activity-logs/route.ts` / [[Frontend]] — `ActivityLogsView.tsx`, expense components
- **Symptom:** Expense export "Generated at" timestamps (CSV/XLSX/PDF) and Activity Log entries were formatted with `.toLocaleString("en-IN")`/`.toLocaleDateString("en-IN")` but no explicit timezone. On the backend this resolves to the *server process's* timezone (commonly UTC on cloud hosts) — an export generated at 1:00 AM IST could show "Generated at: 7:30 PM" the previous day, correctly Indian-*formatted* (commas, DD/MM order) but not actually IST-*converted*. On the frontend the same issue depends on the viewer's device clock/timezone rather than true IST. Separately, editing or deleting an expense produced no visible trail in the Activity Log at all — the log only ever showed a live reconstruction of *current* expense rows, so an update silently changed the entry in place and a delete made it disappear entirely.
- **Root cause:** (1) `Intl`/`toLocaleString` defaults to the runtime's own timezone when none is passed — true both in Node (export service) and in a browser set to a non-IST timezone (activity log view). (2) The Activity Logs route's `activity_logs` query filtered `entity_type: { in: ['HOSTEL_POLICY', 'RENT'] }`, silently excluding `EXPENSE` rows (written correctly by `activityService.log()` on update/delete) and `AGREEMENT_TEMPLATE` rows (despite the mapper below already handling that type) — logs were being written but never read back.
- **Fix:** New `formatIST()` helper (`lib/timezone.ts`) used throughout `expense-export-service.ts`; `reportDateLabel()`'s month-range check switched from server-local to UTC date getters (matching the underlying `@db.Date` UTC-midnight encoding). `ActivityLogsView.tsx`'s three formatters gained explicit `timeZone: 'Asia/Kolkata'`, and "Today"/"Yesterday" grouping now compares IST calendar-day keys rather than the browser's local `toDateString()`. The activity-logs route's query was broadened to include `EXPENSE` (scoped to `UPDATE`/`DELETE` only — `CREATE` is already covered by the richer live-table reconstruction) and `AGREEMENT_TEMPLATE`. `ExpenseDetailsModal.tsx` gained a new "Added on" row (`created_at`, IST-formatted) alongside the existing expense-date row.
- **Related:** [[Backend]], [[Frontend]], [[Changelog]]

### Pausing a hostel gave no warning it stops rent generation for active tenants

- **Status:** fixed
- **Found:** 2026-07-22
- **Area:** [[Frontend]] — `PauseHostelModal.tsx`, `CloseHostelModal.tsx`
- **Symptom:** The "Temporarily Close" confirmation modal's own copy says "No new rent will be generated" once paused, but showed no indication of *how many* active tenants that affects, or their outstanding dues — an owner could pause a hostel with dozens of paying tenants with zero visibility into the impact. Separately, "Close Hostel" would let the owner fill in a reason and submit, only to be told by a backend trigger (`prevent_archive_with_active_allocations`) that active tenants block the close — a wasted round trip the frontend could have prevented from the start.
- **Root cause:** Both modals only ever received `{id, name}` for the hostel being acted on, even though the exact stats (`active_tenants`, `occupied_beds`, `pending_dues`) were already fetched and displayed on the hostel's own portfolio/list card one component up — they just weren't threaded through the click handlers into modal state.
- **Fix:** New shared `HostelImpactSummary.tsx` renders the real tenant/dues numbers in both modals, threaded through from the existing card data (no new fetch). `CloseHostelModal` now disables its submit button and shows "Move tenants out first" up front whenever active tenants exist, pointing the owner at "Temporarily Close" as the non-destructive alternative, instead of waiting for the backend to reject the request.
- **Related:** [[Frontend]], [[Changelog]]

### iPhone Safari auto-zoomed into every form field (Add Expense / Add Tenant / others)

- **Status:** fixed
- **Found:** 2026-07-21
- **Area:** [[Frontend]] — `src/styles/globals.css`
- **Symptom:** On an iPhone, tapping any input in Add Expense / Add Tenant (and other forms) zoomed the page in and would not zoom back out, so every field entry left the owner pinch-zooming out repeatedly and the mobile layout felt broken.
- **Root cause:** iOS Safari auto-zooms into any focused `input`/`select`/`textarea` whose *computed* font-size is below 16px, and does not restore the zoom afterward. Our form fields default to Tailwind `text-sm` (14px), so every field triggered it. (The modal being a bottom-sheet vs full-screen is unrelated — the trigger is font-size, not modal size.)
- **Fix:** An **unlayered** `@media (max-width: 639.98px)` rule in `globals.css` forces `input`/`select`/`textarea` (except checkbox/radio/range) to 16px below the `sm` breakpoint. Being unlayered, it outranks Tailwind's layered `text-sm`/`text-xs` utilities without `!important`. Fixes every form app-wide; desktop keeps its denser 14px.
- **Related:** [[Frontend]], [[Changelog]]

### Tenant had no way to actually finalize an accepted renewal

- **Status:** fixed
- **Found:** 2026-07-22
- **Area:** [[Frontend]] — `TenantDashboardPage.tsx` / [[Backend]] — `agreement-renewal-signing-service.ts`
- **Symptom:** After a tenant tapped "Accept Offer" on a renewal, nothing further happened in the UI. The tenant dashboard's two renewal cards both `return null` once a successor agreement exists (`TenantRenewalOfferCard` because the offer's status is no longer `SENT`/`DRAFT`; `TenantRenewalCard` because `evaluateAgreement()` resolves `decision_state` back to `"CURRENT"` once a successor exists) — so the tenant saw no indication a signature was still needed, and had no way to provide one. Backend support (`agreement-renewal-signing-service.ts`, `POST /api/agreements/[id]/sign-renewal`, already accepts `session.role === "TENANT"`) existed with zero frontend consumer.
- **Root cause:** The renewal UI was built around "offer accepted ⇒ done," but accept only creates a `DRAFT` successor agreement (`createRenewalDraft`) — activation still requires an explicit signature (`signRenewalAgreement`), which nothing in the frontend ever called for a tenant.
- **Fix:** New dedicated page `src/platforms/tenant/pages/TenantRenewalPage.tsx` (route `/tenant/renewal`) adds a "Sign Your Renewed Agreement" stage using the existing `SignaturePad` component plus a new session-authenticated upload route (`POST /api/tenants/me/renewal-signature`, mirrors the activation-token-based signature upload but resolves the tenant from session) and `agreementService.signRenewalAgreement()`. The dashboard's two large inline cards were replaced with one slim `TenantRenewalBanner` that correctly surfaces the previously-invisible "awaiting signature" and "signed" states. See [[Decisions]] ADR-019.
- **Related:** [[Backend]], [[Frontend]], [[Changelog]]

### Renewal queue always showed room type as "N/A"

- **Status:** fixed
- **Found:** 2026-07-21
- **Area:** [[Backend]] — `renewal-decision-service.ts`
- **Symptom:** Every row on the Renewal Pipeline queue showed `Room 401 (N/A)` — the room number was correct but the category in parentheses was always "N/A", visible in real device screenshots of the mobile rebuild.
- **Root cause:** `agreementDecisionInclude()`'s Prisma `room_allocations.room` select only listed `{ id: true, room_no: true }`, and `tenantPayload()`'s returned `room` object only echoed `id`/`room_no` — `room_type` was never fetched from the database in the first place, so the frontend's `tenant.room?.room_type` was always `undefined`. This was already flagged as a known gap in this session's earlier UX audit (it also blocks the Renewal Campaigns Wizard's per-category pricing strategy from auto-populating categories) but not yet fixed until real screenshots made the impact concrete.
- **Fix:** Added `room_type: true` to the Prisma select and to `tenantPayload()`'s returned shape. `tests/renewal-decision-service.test.ts` (10/10) still passes unchanged.
- **Related:** [[Backend]], [[Changelog]]

### Payment reversals were tagged "Payment Received" in the activity feed

- **Status:** fixed
- **Found:** 2026-07-21
- **Area:** [[Backend]] — `financial-timeline-service.ts` / [[Frontend]] — `financialColors.ts`, `FinancialActivityCard.tsx`
- **Symptom:** After reversing a payment (Correct Payment → Reverse), the reversal showed in the tenant Activity feed with the same "Payment Received" tag (green, banknote icon) as a real payment, and its body read `₹-8,500 paid via ADVANCE_ADJUSTMENT` — a negative amount next to the word "paid." A reversal was visually indistinguishable from money coming in.
- **Root cause:** A reversal is written as a `payments` row with negative `amount_paid` and `reference_number = "REVERSAL:<originalId>"`, but the timeline emitted it as an ordinary `PAYMENT_RECORDED` event carrying no reversal signal, and `getEventDisplay` mapped every `PAYMENT_RECORDED` → "Payment Received" regardless of sign. The card also showed `Math.abs(amount)`, hiding the negative.
- **Fix:** `financial-timeline-service.ts` now classifies reversal rows (via the `REVERSAL:` reference / negative amount) and emits `metadata.is_reversal` + `reverses_payment_id` with a "Reversal of ₹X payment" summary, on both the tenant and obligation timelines. `getEventDisplay` branches to a distinct "Payment Reversed" tag (red tone, `RotateCcw` undo icon) and `FinancialActivityCard.tsx` renders the amount as signed `-₹X`. New test `tests/integration/timeline-reversal-tag.test.ts`.
- **Related:** [[Features]] (Correct Payment (Reverse / Transfer)), [[Changelog]]

### Change Rent left `tenants.monthly_rent` stale after a successful change

- **Status:** fixed
- **Found:** 2026-07-21 (task review of the Change Rent feature)
- **Area:** [[Backend]] — `rent-change-service.ts` / [[Frontend]] — `ChangeRentModal.tsx`
- **Symptom:** After a successful Change Rent, reopening the modal showed the OLD rent as "Current rent" even though the change had succeeded server-side (agreement was correctly repriced).
- **Root cause:** `applyRentChangeInTx` updated `agreement.contract_rent` but never touched `tenants.monthly_rent`, and the frontend's "Current rent" display is sourced from `tenant.monthly_rent` (the page never loads `agreement.contract_rent`).
- **Fix:** `applyRentChangeInTx` now also updates `tenants.monthly_rent` in the same transaction, reusing the `tenantContractSync` pattern already established by renewal activation (`renewal-activation-engine.ts`). New test in `tests/integration/rent-change-service.test.ts` asserts `tenants.monthly_rent` reflects the new rent after the call.
- **Related:** [[Features]] (Change Rent), [[Business-Rules]]

### Change Rent's frontend affected-count preview can silently diverge from the backend's real repricing count

- **Status:** fixed (surfaced, not prevented — see note)
- **Found:** 2026-07-21 (task review of the Change Rent feature)
- **Area:** [[Frontend]] — `ChangeRentModal.tsx`
- **Symptom:** None directly observable pre-fix — a silent undercount. The modal's pre-submit "N installments will change" preview is computed client-side by filtering `upcomingObligations` on net `paid === 0`. The backend's actual safety guard is stricter: zero payment *records* (`payments.length === 0`), not net-zero-paid. After a Payment Reversal correction (a different, already-shipped feature — reverses a payment via an offsetting second payment row, netting paid back to 0), an obligation can have net `paid === 0` while still carrying 2 payment rows. Such an obligation still shows up in the frontend's dropdown/preview count, but the backend correctly skips it — undercounting relative to what the owner was shown, with no visible discrepancy.
- **Root cause:** `getTenantDues()` (the source of `upcomingObligations`) only exposes net paid/outstanding, not raw payment-row counts, so the frontend cannot replicate the backend's exact guard.
- **Fix (scoped):** `ChangeRentModal.tsx` now captures the `RentChangeResult` returned by `tenantService.changeRent(...)` and shows the real server-reported `obligationsUpdated` count on its success screen, instead of only ever showing the pre-submit client-computed preview. This does not prevent the discrepancy (would require exposing raw payment-row counts through `getTenantDues()`, out of scope) — it makes any divergence visible to the owner after the fact.
- **Related:** [[Features]] (Change Rent, Correct Payment (Reverse / Transfer)), [[Business-Rules]]

### Change Rent modal was unsubmittable whenever a tenant had zero upcoming unpaid rent installments

- **Status:** fixed
- **Found:** 2026-07-21 (final whole-branch review)
- **Area:** [[Frontend]] — `ChangeRentModal.tsx`
- **Symptom:** For an ACTIVE tenant with zero upcoming, zero-payment RENT obligations, the modal's empty-state copy told the owner "Rent will still be updated on the agreement," but `effectiveFromMonth` initialized to `''` and there was no UI to set it in that case. `handleContinue`'s `if (!effectiveFromMonth)` guard (and the backend route's own required-field validation) meant the modal could never actually be submitted — a dead end that contradicted its own reassuring copy.
- **Root cause:** `effectiveFromMonth` was only ever derived from `upcomingObligations[0]?.rent_month`; when that list was empty there was no fallback, even though the backend (`applyRentChangeInTx`) always accepts a real month and is perfectly willing to update `agreement.contract_rent`/`tenants.monthly_rent` with zero obligations in scope.
- **Fix:** Added a `nextMonthStartIso()` helper that defaults `effectiveFromMonth` to the first day of next calendar month (UTC) when there are no upcoming obligations to derive it from, and corrected the empty-state copy to name that actual month instead of a vague promise. No new month-picker UI was added — the modal still always derives the month from a real obligation when one exists.
- **Related:** [[Features]] (Change Rent), [[Business-Rules]]

### Ledger `entry_type` vs `type` field mismatch crashed tenant financial timeline

- **Status:** fixed
- **Found:** 2026-07 (during Owner Financial Workspace redesign)
- **Area:** [[Backend]] — `financial-timeline-service.ts`
- **Symptom:** Runtime throw whenever a tenant had any `tenant_financial_ledger` rows.
- **Root cause:** Service referenced `entry_type`, but the actual Prisma field on `tenant_financial_ledger` is `type`.
- **Fix:** Corrected field reference in `apps/backend/src/services/payments/financial-timeline-service.ts`.
- **Related:** [[Features]] (Owner financial workspace)

### Raw SQL calculators used `o.amount` instead of `o.total_amount`, silently dropping late fees

- **Status:** fixed
- **Found:** 2026-07
- **Area:** [[Database]] / [[Backend]]
- **Symptom:** Owner and tenant surfaces showed different Outstanding/Overdue/Future Credit for the same tenant.
- **Root cause:** ~6 independently duplicated outstanding/overdue calculators across surfaces; two used the wrong column in raw SQL.
- **Fix:** Introduced `financial-read-model-service.ts` composing existing services; migrated consumers. See `docs/business-logic/financial-consistency-investigation-report.md` and [[Decisions]] ADR-001.
- **Related:** [[Business-Rules]], [[Decisions]]

### Typing in the Expenses Workspace search box unmounted the whole tab (looked like a full page reload)

- **Status:** fixed
- **Found:** 2026-07-18
- **Area:** [[Frontend]] — `ExpensesTab.tsx`
- **Symptom:** Every keystroke in the expense search box blanked the entire tab (dashboard, filter bar, the search input itself) into a loading skeleton, dropping input focus.
- **Root cause:** `search` was part of the React Query key, so every keystroke produced a brand-new, never-cached query key; React Query v5's `isLoading` is `true` whenever there's no cached data for the *current* key, and `ExpensesTab.tsx` gated its entire render on `isLoading`.
- **Fix:** Added `placeholderData: keepPreviousData` to the list query so the previous result set stays mounted while a new key fetches in the background, instead of unmounting into `TabSkeleton`.
- **Related:** [[Features]] (Expenses)

### "Correct Payment" button could reverse only a fraction of a grouped settlement card's amount

- **Status:** fixed
- **Found:** 2026-07-20 (task review of the new Correct Payment (Reverse) UI)
- **Area:** [[Frontend]] — `FinancialActivityCard.tsx`, `groupFinancialActivity.ts`
- **Symptom:** For a `PAYMENT_GROUP_SETTLED` Financial Activity card (one tenant payment/settlement split across several obligations via FIFO allocation, folded into a single card), clicking "Correct Payment" would reverse only the first underlying `payments` row, while the modal's copy ("Reverses this payment and re-opens the obligation it settled") implied the whole amount shown on the card was undone.
- **Root cause:** `groupFinancialActivity.ts` sets a grouped entry's `receiptPaymentId` to `payments[0]?.references.payment_id` — an arbitrary first payment id, used so "View Receipt" has *some* valid receipt to open. The "Correct Payment" button reused the same `receiptPaymentId` truthiness check as "View Receipt," but the backend's `PAYMENT_REVERSAL` handler operates on exactly one `payments.id` and its one `obligation_id` — it has no concept of "the whole group." Traced the settlement path (`apps/backend/src/services/payments/settlement-engine.ts`, `financial-timeline-service.ts`) and confirmed a FIFO settlement across N obligations creates N genuinely distinct `payments` rows sharing one `payment_group_id`, so `payments.length > 1` reliably means `receiptPaymentId` covers only part of the card's total.
- **Fix:** Gated the "Correct Payment" button on a new `canCorrectPayment = payments.length <= 1` condition (in addition to the existing `receiptPaymentId && onCorrectPayment` check) in `apps/frontend/src/features/tenants/components/financial/FinancialActivityCard.tsx`. "View Receipt" is unchanged — a receipt for any one payment id in the group remains valid to view. Correcting a multi-payment/grouped settlement (whole-group or per-row) is out of scope for this fix and remains a fast-follow; there is currently no UI path to correct such a card at all (by design — no misleading partial reversal is offered in its place).
- **Related:** [[Features]] (Correct Payment (Reverse / Transfer)), [[Business-Rules]]

### Export button threw "Cannot read properties of undefined (reading 'export')" in production only

- **Status:** fixed
- **Found:** 2026-07-18
- **Area:** [[Frontend]] — `ExpensesTab.tsx`
- **Symptom:** Clicking Export in the deployed app threw immediately; worked fine in `vite dev`.
- **Root cause:** Not a stale deploy (verified by diffing the live production chunk against a fresh local build — identical). Vite's production bundler mis-transforms `const { blob, filename } = await import(...).then((m) => m.expenseService.export(...))` — its chunk-preload wrapper ends up destructuring `blob`/`filename` off the *module namespace* (which only has `expenseService` on it) instead of the `.then()` result, so `.expenseService` reads as `undefined` before `.export` is ever reached.
- **Fix:** Split the import resolution from the destructuring (`const { expenseService } = await import(...); const { blob, filename } = await expenseService.export(...)`) — verified by inspecting the compiled bundle before/after.
- **Related:** [[Features]] (Expenses)

### Cron renewal activation produced SIGNED agreements with no rent obligations

- **Status:** fixed
- **Found:** 2026-07-19
- **Area:** [[Backend]] — `agreement-lifecycle-service.ts` (`AgreementLifecycleService.activateScheduledRenewals`)
- **Symptom:** A renewal agreement activated by the daily lifecycle cron (effective-date-triggered, as opposed to tenant-signed) ended up `SIGNED` with zero `rent_obligations` rows — no rent was ever billed for that agreement until someone noticed and ran a manual repair script.
- **Root cause:** Two independent paths can transition a renewal draft `DRAFT → SIGNED`: `AgreementRenewalSigningService.signRenewalAgreement` (manual, tenant e-signs) and `AgreementLifecycleService.activateScheduledRenewals` (cron, effective-date arrives with no signature required). Only the manual path called `agreementRentScheduleService.generateForAgreementInTx` after marking the agreement `SIGNED`; the cron path never did, so it silently produced an agreement with no billing schedule.
- **Fix:** `activateScheduledRenewals` now calls `agreementRentScheduleService.generateForAgreementInTx(tx, draft.id)` inside the same transaction as the status transition (mirroring the manual path exactly), and calls `financialLifecycleService.notifyActivated(...)` post-commit for cache/SSE parity. The class-level doc-comment claiming the cron "must never create obligations" was narrowed to describe only the expiry-tracking walk, not `activateScheduledRenewals`, which intentionally mirrors manual signing's financial writes.
- **Tests:** `tests/agreement-renewal-activation.test.ts` — new case `"generates the rent schedule for the activated draft inside the same transaction"`.
- **Related:** [[Business-Rules]], [[Decisions]]

### Manual renewal signing did not enforce the unpaid security deposit check that cron activation already had

- **Status:** fixed
- **Found:** 2026-07-19
- **Area:** [[Backend]] — `agreement-renewal-signing-service.ts` (`AgreementRenewalSigningService.signRenewalAgreement`)
- **Symptom:** A tenant could e-sign a renewal agreement (manual path) even when the renewal's `SECURITY_DEPOSIT` top-up obligation was still `PENDING`/`PARTIAL` — the cron activation path already blocked this exact scenario (`RENEWAL_ACTIVATION_BLOCKED` event), but the manual signing path had no equivalent check.
- **Root cause:** The two activation paths (manual signing vs. cron) were built with different validation coverage — cron's `activateScheduledRenewals` queries for an unpaid `SECURITY_DEPOSIT` obligation on the draft before activating; `signRenewalAgreement` never did the equivalent query.
- **Fix:** Added the same `rent_obligations.findFirst({ obligation_type: "SECURITY_DEPOSIT", status: {in:["PENDING","PARTIAL"]}, is_superseded:false, agreement_id })` check inside `signRenewalAgreement`'s transaction, right after the existing move-out check. Throws a new `SECURITY_DEPOSIT_UNPAID` (409) `AgreementRenewalSigningError` before any status mutation, matching the structured-error pattern already used for the other five precondition checks in this method.
- **Tests:** `tests/agreement-renewal-signing-service.test.ts` — new cases `"blocks signing when an unpaid security deposit obligation exists..."` and `"allows signing when there is no unpaid security deposit obligation"`. Also fixed a latent gap in `tests/agreement-rules-snapshot.test.ts`'s separate `mockPrisma` (missing a `rent_obligations` mock entirely — surfaced by this change since it's the first test to exercise that code path against that particular mock).
- **Related:** [[Business-Rules]], [[Decisions]]

### Cron renewal activation had no transition safeguards, and two renewal chain-mutation call sites could race into an inconsistent state

- **Status:** fixed
- **Found:** 2026-07-19
- **Area:** [[Backend]] — `agreement-lifecycle-service.ts` (`activateScheduledRenewals`), `renewal-offer-service.ts` (`acceptOffer`)
- **Symptom:** Cron activation (`activateScheduledRenewals`) could activate a renewal draft even when its predecessor was no longer in a renewable status (e.g. `TERMINATED`/`VOID`), even when the tenant had an active move-out request in progress, or even when the draft's own lifecycle metadata (rent/duration/dates) was incomplete — none of these were checked, even though the sibling manual-signing and manual-draft-creation services already enforce all three. Separately, `RenewalOfferService.acceptOffer` checked `offer.status !== "SENT"` *before* opening its transaction (a stale read) and linked the predecessor → successor via an `updateMany` whose `.count` was never checked — a losing concurrent acceptance would silently create an orphaned, unlinked successor `Agreement` instead of failing.
- **Root cause:** Both `activateScheduledRenewals` and `acceptOffer` were the two remaining call sites in this subsystem that predate the locked-read + conditional-`updateMany`-with-count-check pattern already established by `agreement-renewal-signing-service.ts` and `agreement-renewal-service.ts` (`SELECT ... FOR UPDATE`, then a conditional `updateMany`, then a count check that throws on mismatch). Both used unconditional `update()` calls or an unchecked `updateMany()`, so a concurrent writer touching the same predecessor/draft pair between the initial read and the write could silently corrupt the renewal chain.
- **Fix:** `activateScheduledRenewals` now checks (in order) predecessor renewability (`isCurrentAgreementStatus`), an active move-out request, and `assertAgreementLifecycleComplete` on the draft — logging `RENEWAL_ACTIVATION_BLOCKED` and skipping, same as the existing unpaid-deposit block, rather than throwing. Its transaction now acquires `SELECT ... FOR UPDATE` locks on both the predecessor and draft rows, and both status-mutating writes became conditional `updateMany` calls with a `.count !== 1` check that throws (rolling back the transaction) if the chain changed since the pre-transaction read. `RenewalOfferService.acceptOffer` now acquires the same lock on the predecessor, re-reads the offer status fresh inside the transaction (closing the TOCTOU window), and checks the predecessor-link `updateMany`'s count, throwing `CONFLICT: A renewal was already accepted for this agreement` on a losing race instead of silently proceeding.
- **Tests:** `tests/agreement-renewal-activation.test.ts` — new cases for predecessor-not-renewable, active-move-out, and concurrent-chain-change (updateMany count 0). `tests/renewal-offer-service.test.ts` — new cases for the orphaned-successor race and the in-transaction status re-check.
- **Related:** [[Business-Rules]], [[Decisions]]

### `RenewalOfferService.expireStaleOffers()` was fully implemented but never called from anywhere

- **Status:** fixed
- **Found:** 2026-07-19
- **Area:** [[Backend]] — `renewal-offer-service.ts` (`expireStaleOffers`), `agreement-lifecycle-service.ts` (`processDailyLifecycle`)
- **Symptom:** Renewal offers past their `offer_expires_at` never transitioned to `EXPIRED` — they stayed `DRAFT`/`SENT` indefinitely. The method's own docstring claimed "Called by lifecycle cron," but grep confirmed zero callers anywhere in the codebase.
- **Root cause:** The method was implemented (bulk `updateMany` marking stale `DRAFT`/`SENT` offers `EXPIRED`) but never wired into `AgreementLifecycleService.processDailyLifecycle`, the one cron entry point this subsystem has.
- **Fix:** `processDailyLifecycle` now calls `renewalOfferService.expireStaleOffers()` once per run (wrapped in try/catch, non-fatal, consistent with the existing WhatsApp-template-health-check error handling in the same method), and records the count on a new `AgreementLifecycleSummary.offers_expired` field.
- **Also fixed while touching this test file:** `tests/agreement-renewal-activation.test.ts` had two `vi.mock(...)` calls using paths relative to the *test* file (`"./agreement-renewal-notification-service"`) instead of the actual module's location (`src/services/tenants/`) — Vitest resolves relative mock paths against the file calling `vi.mock`, so neither mock ever intercepted the real module. `processDailyLifecycle` tests were silently making real WhatsApp Business API calls (visible as `whatsapp.template_health.fetch_failed` errors in stderr, swallowed by the method's own try/catch) instead of using the mocked no-op. Fixed both to use the `@/src/services/tenants/...` path alias, matching every other correctly-working mock in the same file.
- **Tests:** `tests/agreement-renewal-activation.test.ts` — new case `"expires stale renewal offers as part of the daily lifecycle run"`.
- **Related:** [[Business-Rules]]

### Renewal WhatsApp reminders permanently skip a stage if the daily cron misses its exact trigger day

- **Status:** fixed
- **Found:** 2026-07-19
- **Area:** [[Backend]] — `renewal-status-service.ts` (`determineRenewalStage`)
- **Symptom:** If the daily lifecycle cron didn't run on the exact day an agreement hit 30/15 days-until-expiry or 7/`grace_period_days` days-overdue (an outage, a deploy window, a transient failure), that reminder stage was never sent for that agreement — by the next cron run, the day counter had moved past the exact value the equality check required.
- **Root cause:** `determineRenewalStage` used `===` exact-day matching for all four milestone stages, with no notion of "already past this point but haven't sent it yet."
- **Fix:** Converted the four milestone checks to inclusive threshold bands (`30_DAY_REMINDER`: 16-30 days left, `15_DAY_REMINDER`: 1-15, `7_DAY_OVERDUE`: ≥7 days overdue, `30_DAY_CRITICAL`: ≥grace-period days overdue, checked first). Safe because delivery-layer idempotency (`whatsapp_logs.idempotency_key`, unique per `(stage, agreementId)`) already guarantees exactly-once send even if a stage matches on several consecutive runs. `EXPIRY_DAY_ALERT` and `EXPIRED_RENT_OVERDUE` were deliberately left as exact/state checks — see [[Decisions]] ADR-014 for why broadening them would have collided with the existing `EXPIRED_RENT_OVERDUE` fallback.
- **Tests:** `tests/whatsapp-renewal-notification.test.ts` — new cases for a caught-up 30-day reminder, 15-day-over-30-day priority once inside the tighter window, and a caught-up 7-day-overdue alert.
- **Related:** [[Business-Rules]], [[Decisions]]

### Tenant Financials "Payment Due Soon" card showed the amount from one obligation and the due date from a different, already-paid one

- **Status:** fixed
- **Found:** 2026-07-20
- **Area:** [[Frontend]] — `apps/frontend/src/portal/pages/TenantFinancialsPage.tsx` (`financialHealth` useMemo, ORANGE state)
- **Symptom:** A tenant whose current billing cycle was fully paid, but who had a small early/extra payment land on a *future*, not-yet-due obligation (flipping it from `UPCOMING` to `PARTIAL`), saw the home dashboard's Rent Status card and the Financials page's hero card both report "payment pending" with an amount — expected, since that obligation genuinely has an outstanding balance — but the Financials page's due-date subtext ("Due 5 Jul 2026") referenced the already-fully-paid current cycle, not the obligation the displayed amount actually came from (which was due 5 Aug 2026). Confirmed against live data: `rent_obligations` showed June and July rent `PAID` in full, and August rent `PARTIAL` (₹1 of ₹8,500 paid, due 2026-08-05) — the ₹8,499 "Amount Due" was correctly August's, but the date shown belonged to July.
- **Root cause:** The ORANGE-state subtext sourced its due date from `currentInstallment` — a locally-computed match for "the installment whose `period_start`/`period_end` contains today" — while the amount above it came from `readModel.current_payable_amount` (the canonical `FinancialReadModelService` sum of all non-`UPCOMING` outstanding obligations, regardless of due date). These two are not the same obligation whenever today falls inside an already-settled cycle but a *different*, later obligation is the one actually carrying the outstanding balance — the code's own comment stated the card should be "sourced from the canonical FinancialReadModel... not recomputed from local due-date math," but the subtext line did exactly that.
- **Fix:** The subtext now finds the earliest `due_date` among `readModel.items` filtered to the same condition `current_payable_amount` itself is summed over (`legacy_status !== 'UPCOMING' && outstanding > 0`) — the date now always belongs to the same obligation(s) the displayed amount is drawn from.
- **Note:** The underlying "why is anything pending at all" business question — a `PARTIAL` obligation counts toward `current_payable_amount` "regardless of due date" per that field's own documented contract, even when the payment landing on it was for a small/incidental amount well before the obligation's due date — was left as-is; changing that semantic is a deliberate financial-logic call (it's a shared field consumed by both owner and tenant surfaces) and was out of scope for this display-only fix.
- **Related:** [[Business-Rules]]

### Gateway rent payments that allocate into a SECURITY_DEPOSIT/ADVANCE obligation false-positive a settlement invariant violation and roll back despite the provider having captured the charge

- **Status:** fixed
- **Found:** 2026-07-20
- **Area:** [[Backend]] — `payment-service.ts` (`validatePaymentAttemptSettlementInTx`), `settlement-engine.ts`
- **Symptom:** A tenant paid via Razorpay; Razorpay confirmed the charge (payment ID present, funds captured), but `POST /api/payments/verify` returned 500, and neither the tenant nor owner UI showed any record of the payment — because there genuinely was none: the settlement transaction had rolled back in full. Confirmed against live data (`payment_attempts` table): two attempts stuck in `PROCESSING` with real `provider_transaction_id`s and no corresponding `payments` or `tenant_financial_ledger` rows. Production runtime error logs (Vercel) pinpointed the exact exception both times: `INVARIANT_VIOLATION: Ledger balance inconsistency. ... Expected Ledger Change: ₹0.00, Actual Ledger Change: ₹100.00`.
- **Root cause:** `settlement-engine.ts` writes a ledger `CREDIT` in two structurally different situations that both count as "money credited for this attempt," but the transaction's own post-settlement self-check (`validatePaymentAttemptSettlementInTx`) only recognized one of them: (1) a future-rent-credit topup, keyed directly by `attemptId` (the `futureCredit > 0` branch) — the one the validator's query (`reference_id: attemptId`) actually found; and (2) a security-deposit/advance "collected" marker, deliberately keyed by the individual `payments` row it accompanies (`referenceType: "PAYMENT"`, `referenceId: payment.id`) — by design (per that branch's own comment: "the obligation being marked PAID/PARTIAL tracks that it was billed, while this credit tracks that it was collected"). The validator's single shared `totalLedgerCredited` sum only ever found shape (1), so shape (2) was invisible to it — a gateway payment that allocated into a deposit/advance obligation always produced `totalLedgerCredited = 0`, even though the tenant's real ledger balance had genuinely moved by the full captured amount, tripping invariant #3 and rolling back an otherwise entirely correct settlement.
- **Fix:** Split the single shared ledger-credit sum into two: `unallocatedLedgerCredited` (shape 1 only, `reference_id: attemptId`) feeds invariant #1 ("captured = obligation allocations + *unallocated* ledger credit" — shape 2 must NOT be added here, since it mirrors money already counted in `totalAllocated` via the same `payments` row, and adding both would double-count the same rupee), while `totalLedgerBalanceMovement` (shape 1 + shape 2) feeds invariant #3 ("ledger balance actually moved by X" — this one needs the deposit "collected" marker too, since it genuinely does move the real balance).
- **Tests:** `tests/payment-allocation-invariant.test.ts` — new case `"settles a gateway Rent payment that fully allocates into a SECURITY_DEPOSIT obligation without a false invariant violation"`; confirmed it fails with the pre-fix code (same `INVARIANT_VIOLATION: Ledger balance inconsistency` as production) and passes after. Also hardened the test file's `tenant_financial_ledger.findMany` mock to understand `OR`/`reference_id: { in: [...] }`, which the fixed query now uses.
- **Not yet done — needs a deliberate follow-up, not silently retried:** two real production attempts (₹100 each, `a59b3ab5-...` and `74b7a5e3-...` on tenant `f73ad88d-...`) are stuck `PROCESSING` with real Razorpay charges and zero internal record. `POST /api/payments/reconcile` (owner-only, `paymentService.reconcilePendingAttempts`) already has a "release stale PROCESSING lock" pass designed for exactly this — once this fix is deployed, an owner should trigger reconciliation for these two attempt IDs so they settle correctly instead of remaining stuck.
- **Related:** [[Business-Rules]]

### `reverseObligationPayment` (Reverse/Transfer Payment corrections) wrote a `LEDGER_CORRECTION` debit for RENT reversals with no matching original credit, eating into unrelated future-rent-credit

- **Status:** fixed
- **Found:** 2026-07-20 (final whole-branch review of the payment-corrections work)
- **Area:** [[Backend]] — `payment-correction-shared.ts` (`reverseObligationPayment`), used by both `payment-reversal-handler.ts` and `payment-transfer-handler.ts`
- **Symptom:** Reversing an ordinary RENT payment via the Reverse Payment or Transfer Payment correction handlers silently reduced the tenant's `tenant_financial_ledger` balance (and therefore `future_rent_credit`/`available_rent_advance`, see `tenant-financial-ledger-service.ts`'s `_buildBalanceResponse`) by the reversed amount — even when that RENT payment had never itself produced a ledger credit. A tenant who separately held real future-rent-credit from an unrelated transaction had that credit silently eaten into by the reversal.
- **Root cause:** `reverseObligationPayment` unconditionally wrote a `LEDGER_CORRECTION` debit for the full reversed amount regardless of the obligation's type. Per `settlement-engine.ts` (~line 332), a payment allocation only writes a ledger CREDIT (`reason: "DEPOSIT"`, `referenceType: "PAYMENT"`) when `obligation_type === "ADVANCE" || obligation_type === "SECURITY_DEPOSIT"` — a RENT (or any other type) allocation writes no ledger entry at all. So reversing a RENT payment had no matching original credit to undo; the debit was pure corruption of an unrelated balance.
- **Fix:** Added the identical `obligation_type === "ADVANCE" || obligation_type === "SECURITY_DEPOSIT"` gate around the debit in `reverseObligationPayment` (`obligation` was already loaded in-function, no new query needed) — RENT/other reversals now skip the ledger debit entirely, restoring only the obligation's outstanding balance. Also updated `computeImpact()` in both `payment-reversal-handler.ts` and `payment-transfer-handler.ts` with the same condition, so the correction preview no longer promises a ledger entry that execute won't actually create.
- **Tests:** `tests/integration/payment-reversal-handler.test.ts` — new/updated cases: RENT reversal asserts no ledger row is created; a SECURITY_DEPOSIT reversal still asserts the debit fires; a dedicated test credits a tenant with an unrelated future-rent-credit TOPUP, reverses an unrelated RENT payment, and asserts the balance is untouched. `tests/integration/payment-transfer-handler.test.ts`'s preview assertion updated to match (its test obligation is RENT-type, so the preview's `ledgerEntries` is now empty rather than length 1).
- **Related:** [[Business-Rules]] (Correction Cases — Payment corrections), [[Changelog]]

### Stabilization pass (post Tenant App + Platform Admin Console build): dead code, broken auth guards, a dead-value pricing ternary, stale ADR references, silent-failure mutations

- **Status:** fixed
- **Found:** 2026-07-27, during an explicit full stabilization pass over the Tenant App + Platform Admin Console work (see [[Changelog]])
- **Area:** [[Frontend]] (`src/portal`, `platforms/tenant`, `platforms/admin`), [[Backend]] (`app/api/{announcements,hostel-events,service-requests,utility-status,hostels/[id]/house-rules}`, `app/api/platform-admin/hostels/[id]/subscription`), [[Database]] (`prisma/schema.prisma` comment only), [[Decisions]]
- **Findings and fixes:**
  1. **Dead legacy tenant-portal code.** Once Home/Money/Room were rebuilt for real under `platforms/tenant`, 11 files under the frozen `src/portal` tree became fully unreferenced: `TenantPortalLayout.tsx`, `pages/{TenantDashboardPage,TenantFinancialsPage,TenantPaymentsPage,TenantRoomPage}.tsx`, `components/{TenantActionCenter,TenantAnnouncements,TenantDocumentStatus,TenantPaymentModal,TenantPriorityStrip,TenantScorePanel}.tsx`. Deleted; `scripts/check-architecture.mjs`'s `legacyPortalAllowlist` and `src/portal/README.md` updated to match (the allowlist is exhaustive/whitelist-only, so any file not on it now fails the build — verified by re-running `check:architecture` clean after the deletion).
  2. **`/payment-return` was a non-functional `RouteScaffold` stub**, even though the tenant Pay flow (`useTenantFinancials`'s `payMutation`) does a real `window.location.href = intent.checkout_url` gateway redirect and a real, working `TenantPaymentReturnPage.tsx` already existed, just never routed (pre-dates this session's plan — it wasn't even in the original orphaned-pages inventory). A tenant completing a real payment would have landed on a placeholder with no confirmation. Wired it at `/payment-return`, fixing its two stale internal `/tenant/financials` links to `/tenant/money`.
  3. **Broken `["OWNER", "ADMIN"]` auth-guard pattern, copied into 8 new owner-scoped routes** (`announcements`, `hostel-events`, `service-requests` incl. `[id]/status`, `utility-status`, `hostels/[id]/house-rules` — 12 occurrences). Each allowed the `ADMIN` role past the initial gate but then unconditionally called `resolveOwnerScope(session)`, which throws `FORBIDDEN` for any non-`OWNER` role — so the `ADMIN` allowance could never actually succeed; it was dead, misleading surface, not a working capability. (This exact pattern turns out to be a pre-existing, much wider convention across ~100 pre-existing owner routes — see Open issues below; it was harmless there only because `ADMIN` wasn't a real assignable role until this session's ADR-030.) Fixed by removing `ADMIN` from the guard in the 8 new routes (restoring to the only configuration that ever worked); the platform-admin persona's actual entry point for these domains is deliberately the separate `/api/platform-admin/*` namespace, not owner-scoped routes.
  4. **Dead-value ternary in the Revenue "assign subscription" endpoint**: `const amount = cycle === plan.billing_cycle ? plan.price_amount : plan.price_amount;` — both branches returned the same value, so the `billingCycle` the frontend sent (always hardcoded `'MONTHLY'`, regardless of which plan was actually selected) had no real effect on the stored amount, only on `hostel_subscriptions.billing_cycle` disagreeing with the plan actually assigned. Fixed by deriving `cycle`/`amount` directly from the selected plan (`plan.billing_cycle`/`plan.price_amount` — a plan has exactly one price at exactly one cycle) and dropping the now-meaningless client-supplied `billingCycle` param from both the route and `platformAdminService.assignSubscription()`'s signature.
  5. **Silent-failure mutations** (no `onError`, so a failed request left the user with zero feedback): `AdminHostelsPage`'s approve/suspend/reactivate-listing mutations, `AdminSettingsPage`'s save-settings/toggle-plan/toggle-template mutations, `MoreServiceRequestsPage`'s reject mutation, `MoreNoticesPage`'s delete-announcement/delete-event mutations. All given `stayoToast.error(...)` handlers matching the pattern already used by every other mutation in the same files.
  6. **Stale ADR cross-references**: an earlier part of this session renumbered the Platform Admin ADR from a draft "ADR-018" to the correct ADR-030 (ADR-018 was already taken by an unrelated, pre-existing ADR) but missed updating four in-code doc comments that still cited ADR-018 — `platforms/admin/router/AdminRoutes.tsx`, `app/api/platform-admin/{dashboard,admins}/route.ts`, and a `schema.prisma` section comment. Fixed all four; confirmed (grep) no other stale ADR-018 references remain outside `docs/obsidian/Decisions.md`'s own legitimate ADR-018 section and its correct backlinks.
- **Verification:** backend `check:invariants` + real `tsc` clean; frontend `check:architecture` + `vite build` + real `tsc` (pinned `typescript@5.4.5`, see the tooling-gap entry above) clean, before and after every fix in this pass.
- **Related:** [[Changelog]], [[Decisions]] (ADR-030), [[Database]]

### Admin console had no mobile layout at all — full desktop sidebar rendered squeezed into any narrow viewport, no nav reachable

- **Status:** fixed
- **Found:** 2026-07-27, by the user testing `/admin`/`/admin/leads` in Chrome's mobile device emulation (iPhone 14 Pro Max, 430×932) and reporting the sidebar squeezed into the viewport with no bottom nav or hamburger
- **Area:** [[Frontend]] — `app/layouts/AdminAppShell.tsx`
- **Symptom:** Below the shell's fixed 246px sidebar width, the sidebar didn't hide — it just rendered squeezed into whatever viewport width was available, consuming nearly the entire screen on a phone and leaving no way to reach page content or switch tabs.
- **Root cause:** `AdminAppShell.tsx` had zero responsive classes at all (`flex h-screen w-full` with a bare `w-[246px]` aside, no `md:`/breakpoint handling anywhere) — and its own doc comment incorrectly claimed this was deliberate ("no bottom nav — this persona is desktop-first"). Re-checking the actual design source, `Stayo Admin Dashboard/Stayo Admin.dc.html`, disproved that: it defines a complete mobile layout via `@media (max-width:900px)` — sidebar hidden, a floating pill-shaped bottom-nav (`.sc-bottom-nav`, `border-radius:24px`, `12px` inset from the edges, `66px` tall, driven off the same 5-tab list as the sidebar) shown instead, plus corresponding grid/padding adjustments. This mobile treatment was simply never built, and the shell's comment asserted it was intentional rather than missing — a documentation claim that was never actually verified against the design source.
- **Fix:** `AdminAppShell.tsx` now hides the sidebar below 900px (`min-[900px]:flex`, matching the mockup's exact breakpoint via Tailwind arbitrary-value syntax rather than rounding to a stock breakpoint), adds a floating bottom-nav pill below 900px reusing the same `ADMIN_TABS` array the sidebar uses (one source of truth for both), with the same active-state visual treatment (pill highlight, `var(--primary)` icon color, bold label) already established by `OwnerAppShell.tsx`/`TenantAppShell.tsx`'s bottom navs — shaped as the admin mockup's floating "island" rather than those two apps' flush edge-to-edge bar, since that's what this specific design source calls for. Main content gets bottom padding below 900px so it clears the floating nav. The stale "desktop-first, no bottom nav" doc comment was corrected in the same change.
- **Also checked and confirmed NOT the cause of the user's broader "wrong colors/fonts" impression**: all 6 admin pages' own grid classes (`AdminLeadsPage`, `AdminDashboardPage`, `AdminHostelsPage`, `AdminRevenuePage`) were already correctly mobile-first (`grid-cols-1 ... md:grid-cols-N`); the color-token chain (`ThemeProvider` → `stayo-theme.css` → `tokens/product.css`) and the Manrope/Inter font loading were both traced end-to-end and confirmed correctly wired and near-exact matches to the mockup's palette. The "wrong colors/fonts" impression was almost certainly a side-effect of the sidebar bug alone — a phone screen almost entirely filled with tiny desktop-scale sidebar nav text reads as visually broken even when the underlying tokens are correct.
- **Related:** [[Frontend]], [[Features]] (StayO Platform Admin Console)

### Admin console deep audit vs. mockup: extensive component/grid/data gaps across all 6 screens, found and fixed (Photos/Documents + Revenue Analytics deliberately deferred)

- **Status:** fixed (except two explicitly deferred sub-scopes, see below)
- **Found:** 2026-07-27, user asked for a full "deep check" comparing the built admin console against `Stayo Admin Dashboard/Stayo Admin.dc.html` line-by-line, explicitly wanting real data (not fake/placeholder) and full component/grid parity
- **Area:** [[Frontend]] — all 6 `platforms/admin/pages/*.tsx` — and [[Backend]] — `app/api/platform-admin/{dashboard,revenue}/route.ts`
- **Method:** three parallel exhaustive comparisons (one per page-group) against the mockup's actual markup/CSS-grid rules, cross-checked against real backend routes for every "real data" claim. Findings below, grouped by page:
  1. **Hostels** (`AdminHostelsPage.tsx`): status filter chips (All/Live/Pending/Suspended) were entirely missing from the UI despite the backend already supporting `verification`/`listing` params — added. List cards were missing the subscription chip + "Open Hostel" affix (data — `subscription_status` — was already returned, just unrendered) — added. Dues figure was hardcoded amber always; now conditionally red only when `dues > 0`, matching the mockup's logic, fixed in both the list card and detail view. Grid jumped straight from 1 to 3 columns with no 1100px-equivalent middle tier — added (`sm:grid-cols-2 lg:grid-cols-3`). Detail view was missing the 56×56 icon avatar next to the hostel name — added. Detail action buttons (Approve/Suspend/Reactivate) were conditionally shown/hidden; changed to always-visible-but-individually-disabled (e.g. "Approve" reads "Verified" and disables once already verified) rather than disappearing, closer to the mockup's always-three-buttons intent without making already-completed actions look re-triggerable. Subscription card's status line now shows a proper Active/Trial-"Xd left"/Renewal-due/Overdue/Cancelled chip (`subscriptionLabel()` helper) instead of raw `plan · cycle · amount · status` text.
  2. **Leads** (`AdminLeadsPage.tsx`): grid cards were missing the submitted timestamp (`created_at` was already returned by the API, just unrendered) — added. Cards were missing inline Call/WhatsApp/open-chevron actions (previously only available inside the drawer) — added (required restructuring the card from a `<button>` wrapper to a `<div role="button">`, since nesting real `<a>`/`<button>` elements inside a `<button>` is invalid HTML). Drawer was missing the "Lead Details" eyebrow label and the avatar+status-chip header block — added. Drawer's details box was missing an explicit "Owner Name" row — added (kept the existing City/Notes rows too, since they're real data the mockup's own logic computes but never renders — more complete than the mockup, not a deviation to remove). Avatar color was one hardcoded color for every lead; added a per-name hashed 6-color palette matching the mockup's `avatar()` helper.
  3. **Revenue** (`AdminRevenuePage.tsx` + `app/api/platform-admin/revenue/route.ts`): the platform-metrics bar showed a 6-item set (Active Hostels/Active Paying/Trial/**Renewal Due**/**Payment Failed**/Cancelled) instead of the mockup's 5 (…/**Active Tenants**/…) — `active_tenants` didn't exist in the backend response at all, added a real `tenants.count({status:"ACTIVE"})` query; also caught and fixed `active_hostels` itself, which was computed as *all* hostels regardless of listing status (`prisma.hostels.count()`, no filter) despite being labeled "Active" — now correctly scoped to `listing_status: "LIVE"`. Status filter chips (All/Active/Trial/Renewal Due/Payment Failed/Cancelled) were entirely missing from the UI despite the backend already supporting a `status` param — added. Monthly/Yearly billing-cycle toggle was missing — added as a client-side filter over the already-fetched list (no backend change needed). Hostel-subscription-card grid capped at 2 columns instead of the mockup's 3 — added the missing tier. Cards had no click-through to a detail view at all (mockup's `onClick={{h.open}}`) — added, navigating to `/admin/hostels?open=<id>` (see below) while keeping the existing "Record subscription payment" button as a real, additional action the mockup doesn't have.
  4. **Dashboard** (`AdminDashboardPage.tsx` + `app/api/platform-admin/dashboard/route.ts`) — the largest gap: the mockup's asymmetric 2-column grid (KPI/Revenue-Summary/Hostel-Health in a narrow 380px right sidebar, Leads-preview/Recent-Activity in the wide left column) had been built instead as a full-width KPI banner + a symmetric 2-up card row — rebuilt to match (`grid-cols-[1fr_380px]` at `lg:`). KPI list only had 5 of the mockup's 8 items (Total Hostels/Open Leads/Pending Verification/Active Subscriptions/Collected This Month, none matching the mockup's actual labels except loosely) — backend extended to compute all 8 (New Leads/Pending Approvals/Active Hostels/Total Tenants/Active Tenants/Platform Revenue/Collections/Pending Dues), each row now clickable (navigates to the relevant page). **Caught a real domain-modeling mistake while building this**: my first pass computed "Pending Dues" from `rent_obligations` (tenant-owed rent — a completely different revenue stream, hostel-to-tenant, not platform-to-owner) — caught before shipping and corrected to mean unpaid *platform subscription invoices* (`platform_invoices` PENDING/FAILED), the same domain as Revenue's own `pending_collections`, since this is a platform-admin console monitoring hostels-as-customers, not a hostel's own tenant ledger. Leads preview cards were missing Approve/Reject/Details actions and the phone/timestamp fields (all real, already-returned data, just unrendered) — added, reusing the same status-mutation pattern as the standalone Leads page. Hostel Health preview only showed name + tenant count; added the full 4-stat grid (Tenants/Occupancy/Revenue/Dues) by composing the *same* per-hostel aggregation `/api/platform-admin/hostels` already does (scoped down to the 3 preview IDs, not reimplemented) plus an "Open Hostel" click-through. Revenue Summary card (Total Revenue/Platform Earnings/Pending Collections/This Month) was missing entirely on both frontend and backend — added, composing the same MRR/lifetime/pending/collected-this-month calculations `/api/platform-admin/revenue` already does rather than duplicating the logic differently.
  5. **More** (`AdminMorePage.tsx`): the settings-list was missing a "Profile" row (mockup has Settings/Profile/Support/Broadcast Notice/Log Out, built only had 4) — added, opening a small real-data modal (name/email/role from the existing `useAdminSession()`) since there was no dedicated profile page/route to link to and building one was out of scope for a UI-fidelity pass. Avatar showed one initial instead of two; email line was missing the "· Platform Admin" suffix — both fixed.
  6. **Settings** (`AdminSettingsPage.tsx`): all 4 cards (General/Plans/Admin Users/Notification Templates) were wrapped in a `md:grid-cols-2` 2-up grid; the mockup always stacks them full-width, one per row — fixed. All 4 cards were missing their one-line subtitle copy — added verbatim from the mockup. General card was a single-column field stack with placeholder-only inputs; rebuilt as the mockup's 2-col grid (Support Email | Support Phone, Business Address spanning both) with persistent labels above each field. Plans card rows were missing the colored active/inactive status dot and combined name+price into one string instead of the mockup's name/desc-left vs. price+"/mo"-right layout — fixed. Admin Users rows were missing the colored avatar/initials swatch per row — added (small 4-color hash palette, same pattern as the Leads page avatars). Notification Templates rows were missing the per-channel icon square (WhatsApp/Email) — added.
- **New capability, not in the mockup**: `AdminHostelsPage.tsx` now reads an `?open=<hostelId>` query param on mount (via `useSearchParams`) to auto-open a specific hostel's detail view — added so Revenue's and Dashboard's new "click a card to see the hostel" affordances have somewhere real to navigate to, rather than inventing a second, separate hostel-detail UI.
- **Explicitly deferred, not built** (user asked to pause on these specifically): the Hostels detail page's "Uploaded Photos"/"Uploaded Documents" sections — confirmed via `prisma/schema.prisma` that no backing data model exists anywhere for either (only a single `hostels.logo_url` field), so building this for real needs new schema + storage + an **owner-side** upload flow, not just an admin-side display — a genuinely new feature, not a UI-fidelity fix. Also deferred: Revenue's "Analytics" stats block (churn rate, ARPU, ARPT, new subscriptions, renewals, failed payments) and its date-range filter (This Month/Last Month/etc.) — both need new backend time-windowed/derived calculations that don't exist yet.
- **Verification:** backend `check:invariants` + real `tsc` clean; frontend `check:architecture` + `vite build` + real `tsc` clean, after every phase.
- **Related:** [[Features]] (StayO Platform Admin Console), [[APIs]], [[Changelog]]

### Admin Dashboard's "Approve" lead button silently always failed — reused a stale pre-ADR-032 enum value

- **Status:** fixed, 2026-08-01
- **Symptom:** clicking "Approve" on a lead card in the Dashboard's Owner Leads preview widget (`AdminDashboardPage.tsx`) never did anything visible — the standalone Leads page's own "Approve Lead" button worked fine (modulo WhatsApp/email delivery actually succeeding — see [[Business-Rules]] on the WhatsApp-unavailable fallback).
- **Cause:** the Dashboard's Approve button called `platformAdminService.updateLeadStatus(id, 'CONTACTED')` — `'CONTACTED'` was a value from the *original* `PlatformLeadStatus` enum, replaced outright by ADR-032's lifecycle rewrite (`NEW/UNDER_REVIEW/APPROVED/INVITE_SENT/OWNER_ACTIVATED/HOSTEL_CREATED/LIVE/LOST`). `PATCH /api/platform-admin/leads/[id]` only ever accepted `NEW`/`UNDER_REVIEW`/`LOST` (`MANUALLY_SETTABLE_STATUSES`) — every other value 400s with `VALIDATION_ERROR`, by design: the real "approve" action is `POST .../approve`, not a status PATCH. The Dashboard's Approve button was added reusing "the same status-mutation pattern as the standalone Leads page" (see the deep-audit entry above), but in fact reused the *older, generic* status-PATCH mutation with a stale enum value rather than the *dedicated* approve mutation the standalone page actually uses.
- **Fix:** `AdminDashboardPage.tsx` now has its own `leadApproveMutation` calling `platformAdminService.approveLead(id)` → `POST /api/platform-admin/leads/[id]/approve` — the same real accept flow (generates activation token, sends via WhatsApp/email, only advances to `INVITE_SENT` on a successful send) already used by `AdminLeadsPage.tsx`. The Reject button (`status: 'LOST'`) was unaffected — `LOST` is in `MANUALLY_SETTABLE_STATUSES`, so it worked correctly all along.
- **Related:** [[APIs]], [[Frontend]]

### `TenantProfileUpdateSchema` was silently `undefined` at runtime for every tenant-profile-update route — direct-save profile edits have likely never worked

- **Status:** fixed, 2026-08-14
- **Symptom:** every `PATCH` to a tenant-profile-update endpoint (`/api/tenants/me/profile`, `/api/tenants/profile`, `/api/tenants/me/complete-profile`, `/api/tenants/[id]`, `/api/profile/me`) 500'd with `"Cannot read properties of undefined (reading 'safeParse')"`. Found live while Playwright-verifying the Profile tab's new direct-save fields (see [[Business-Rules]], "Tenant self-service profile edits") — a filled-in Academic details form appeared to save, but a page reload showed the old, unsaved values.
- **Cause:** all 5 routes import `TenantProfileUpdateSchema` from `@/lib/validators` → `apps/backend/lib/validators/index.ts`, which re-exports it `from "../../src/validators/tenants"` — that path resolves to the *directory* `src/validators/tenants/index.ts` (only `InvitationSchema`/`InvitationUpdateSchema`/`ActivationSchema` live there), not the *file* `src/validators/index.ts` (a separate, similarly-named top-level file that **did** have a `TenantProfileUpdateSchema`, including this session's earlier `blood_group`/`nationality`/`pan_number` additions). Nothing ever imported that top-level file's copy for tenant-profile updates — it was silently dead code, giving the false impression that editing it had any runtime effect. `tsc --noEmit` (not run as part of `next build`, which has `ignoreBuildErrors: true`) surfaces this immediately as `TS2305: Module has no exported member`, so this was catchable by a type-check that the project's own build pipeline skips.
- **Fix:** moved `TenantProfileUpdateSchema`/`ReactivationRequestSchema` (plus `SHORT_TEXT`/`LONG_TEXT`/`URL_MAX` constants) into `src/validators/tenants/index.ts` — the file the working import chain actually resolves to — and deleted the dead duplicate from the top-level `src/validators/index.ts`. Verified live via Playwright: direct-field PATCHes now return 200 and persist (academic details, guardian name/relation, DOB/gender/blood group/nationality all confirmed round-tripping correctly after this fix).
- **Scope note:** this predates the 2026-08-14 profile-edit work — it's a pre-existing wiring bug this session happened to trip over while verifying a change to one of the affected routes, not something introduced by that change. Worth a quick audit of other `@/lib/validators` re-exports (`../../src/validators/rooms`, `../../src/validators/payments`, `../../src/validators/hostels`) for the same directory-vs-file resolution mistake, though none were confirmed broken here.
- **Related:** [[Business-Rules]], [[APIs]]

### `getTenantPortalProfile` never returned several tenant fields the Profile tab needed to display — saves worked, reads silently came back blank

- **Status:** fixed, 2026-08-14
- **Symptom:** after saving Personal information's blood group/nationality/PAN, or Emergency contact's guardian name/relation/phone, or Academic details' expected-exit date, the Profile tab's read-only view kept showing "—" for those fields even though the PATCH had succeeded and the DB held the new value.
- **Cause:** `getTenantPortalProfile()` (`lib/services/tenant-profile-portal-service.ts`, backing `GET /api/tenants/me/profile` — the query the whole Profile tab reads) built its returned `tenant: {...}` object as an explicit field allowlist that predated `blood_group`/`nationality`/`pan_number` (added earlier the same session) and `guardian_name`/`guardian_relation`/`guardian_phone`/`expected_completion_date` (added this pass) — none of the seven were ever added to that allowlist, so they were always `undefined` in the response regardless of what was actually in the row.
- **Fix:** added all seven fields to the returned `tenant` object. Verified live — Personal information/Emergency contact/Academic details view mode now correctly reflect saved values after a reload.
- **Related:** [[Business-Rules]], [[Database]]

### Emergency Contact's "Contact name" field was silently editing a phone number, not a person's name

- **Status:** fixed, 2026-08-14
- **Symptom:** the Profile tab's Emergency contact screen had a "Contact name" text field bound to `profile.emergency_contact` — but that column is actually a **phone number**, synced with `tenants.phone_3` (confirmed via the `updateTenantSelfProfile` sync block: `syncedEmergency = data.phone_3 || data.emergency_contact`). Typing a person's name into it and saving would have corrupted the phone sync.
- **Cause:** an earlier pass building this screen assumed `emergency_contact` meant what its name suggests (a contact's name) without checking how the field was actually used elsewhere in the service. The real guardian-name/relationship columns (`tenants.guardian_name`, `tenants.guardian_relation`) existed all along but were never added to this screen or to `updateTenantSelfProfile`'s field lists.
- **Fix:** Emergency contact now uses the real fields — `guardian_name` ("Contact person's name"), `guardian_relation` ("Relationship"), `guardian_phone`/`phone_2` ("Phone"), `phone_3`/`emergency_contact` ("Alternate phone") — matching `Stayo Tenant.dc.html`'s actual DETAIL entry. Added `guardian_name`/`guardian_relation` to `updateTenantSelfProfile`'s `tenantFields` and to `TenantProfileUpdateSchema`.
- **Related:** [[Business-Rules]]

### `GET /api/auth/me` left `is_profile_completed` undefined for any TENANT with no tenancy

- **Status:** fixed, 2026-08-15
- **Found:** while building Stayo Discover ([[Decisions#ADR-073|ADR-073]]).
- **Area:** [[Backend]]
- **Symptom:** a signed-in marketplace account (`role = TENANT`, no `tenants` row) reloads the page and any guard reading `is_profile_completed` treats their complete profile as incomplete — `ProtectedTenantRoute` redirects them to `/complete-profile`, a page they have no reason to see.
- **Cause:** the route builds an `extra` object and sets `extra.is_profile_completed` in two places: inside `if (tenant)`, and in the `else` branch for non-TENANT roles. **A TENANT with no tenancy hit neither** — it entered the TENANT branch, found no tenant row, and fell through with `extra` untouched, so the field was simply absent from the response. `authService.selfSignUpTenant()` has always written `is_profile_completed: true` on the profile itself, so the data was right and only the read was wrong.
- **Why it was invisible until now:** `selfSignUpTenant` existed but had no surface. Every TENANT who could actually log in had been through activation and therefore had a tenancy, so the empty branch was unreachable in practice. Discovery is the first feature to give tenancy-less accounts somewhere to go.
- **Fix:** the `if (tenant)` block gained an `else` that falls back to `profile.is_profile_completed`.
- **Adjacent, deliberately not fixed:** the same lookup uses `prisma.tenants.findFirst({ where: { profile_id } })` rather than the live-tenancy helper in `lib/tenancy/active-tenancy.ts`, contrary to the rule in [[Database]] — so for anyone who has stayed in more than one hostel it returns an arbitrary tenancy. Real, pre-existing, and out of that phase's scope; worth its own change.
- **Related:** [[APIs]], [[Database]]

### Discovery's shared visibility predicate overwrote the slug it was looking up

- **Status:** fixed before shipping, 2026-08-15
- **Found:** by `tsc --noEmit` (TS2783, "`public_slug` is specified more than once") while building Stayo Discover.
- **Area:** [[Backend]]
- **Symptom:** would have been severe and quiet — `GET /api/discover/hostels/[slug]` returning an arbitrary listed hostel for *every* slug, and an enquiry sent to a hostel the seeker never chose.
- **Cause:** the shared predicate `DISCOVERABLE` includes `public_slug: { not: null }`. Both call sites were written `where: { public_slug: slug, ...DISCOVERABLE }` — and a spread that comes *second* wins, so `{ not: null }` clobbered the actual slug and the query degraded to "any discoverable hostel".
- **Fix:** spread first at both sites (`{ ...DISCOVERABLE, public_slug: slug }`), with a comment at each explaining the ordering, plus a regression test asserting the emitted `where.public_slug` is the requested slug.
- **Worth remembering:** a constant that carries a *loosening* clause for a field a caller also narrows is a trap that only object-spread order decides. The compiler caught this one because both keys were literal; it would not have if either side were computed.
- **Related:** [[Decisions#ADR-073|ADR-073]], [[APIs]]

## Open / known issues

> See also `docs/known-issues.md` for the maintained list of known drift/gaps in `docs/`.

- **Whether the STARLINK Rooms/Tenants empty-tab report (see the Fixed entry above) has a real underlying data mismatch is still unconfirmed.** Both `session.hostels`/`ownerService.getHostels()` (`GET /api/owner/hostels`) and the Properties list/`portfolioService.getSummary()` (`GET /api/owner/portfolio/summary`) run the identical `prisma.hostels.findMany({ where: { owner_id, status: { in: ["ACTIVE","INACTIVE"] } } })` query, so under normal conditions they must return the same hostel id for "STARLINK" — but this wasn't verified against the live DB (no Supabase access in that session). With the header/error-visibility fixes above shipped, the next load of STARLINK's Rooms/Tenants tabs will either show a genuine error (pointing at an ownership/scope-check bug) or a correctly-labeled genuine empty state (pointing at a real `tenants.hostel_id` / hostel-id mismatch, worth checking directly: `SELECT id, hostel_id, status FROM tenants WHERE ...` for Sharan vs. the `hostels.id` the URL resolves to). Also noted in passing: `lib/security/scoped-query.ts`'s `requireHostelBelongsToOwner` allows `ARCHIVED` hostels in addition to `ACTIVE`/`INACTIVE`, while both list endpoints above exclude `ARCHIVED` — a minor inconsistency, not confirmed as the cause here, but worth aligning if it ever causes a hostel to be reachable by direct URL but absent from every list.

- **`apps/backend/.env.test` points at the same Supabase project as the dev root `.env`.** Confirmed 2026-08-07 while tracing the Recent Activity test-data-pollution bug above: both resolve to project ref `qsjrazcbtpmubclkevwi`, so every `npm test` run writes real rows (test hostels, tenants, obligations, payments, etc.) directly into the dev DB the admin dashboard reads from. Cleaned up the resulting rows once as a one-off; the underlying collision is unfixed and will recur on the next test run. See [[Database]].

- **The 90-day frequency-change cooldown and minimum-commitment checks are currently disabled for the owner-direct path.** `ownerInitiateChange` no longer calls `validateCooldown()` or `validateCommitment()`; `ownerSetCustomSchedule` no longer calls `validateCooldown()` — all commented out per explicit request during testing (see ADR-025). An owner can currently thrash a tenant's billing frequency with no throttling or minimum-commitment enforcement at all. Re-enable (uncomment, one line each) once done testing, and reconsider whether the current defaults / global constants are still the right shape.
- **The pre-existing tenant-request→owner-`approve()` billing frequency flow still has no real effect on obligation generation for agreement-based tenants.** Fixed for the owner-*direct* path (`ownerInitiateChange`, ADR-024) and for Custom Dates (ADR-022, which never had this gap) — both now correctly supersede and regroup an agreement tenant's future rent. `BillingTransitionService.approve()` (the older flow: tenant submits a request, owner approves it) still only calls `writeBillingPlanTransition` — it updates `tenant_billing_plans`/`tenants.payment_frequency` but never touches `rent_obligations`, so a tenant with a signed agreement approved through *that specific flow* still keeps getting unchanged monthly obligations. Given `ownerInitiateChange` supersedes the entire need to wait for a tenant request, this legacy path may see little real use going forward, but it hasn't been fixed or removed — worth revisiting if it's still reachable from the UI.
- **Manual ledger POST route validates against the wrong enum values.** `/api/tenants/[id]/financial-ledger` only accepts `DEPOSIT/TOPUP/DEDUCTION/REFUND/CORRECTION`, none of which exist in the real `FinancialLedgerReason` Prisma enum. Left untouched as out-of-scope during the 2026-07 financial workspace redesign — worth fixing if that route is ever actually exercised.
- **No live-database audit done** for tenants with simultaneous Outstanding + Future Credit predating the future-credit-auto-consumption fix (`cf88ce94`). Needs an explicit user-run query.
- **The broken `["OWNER", "ADMIN"]` guard + `resolveOwnerScope()` pattern (see the stabilization-pass entry above) exists across roughly 100 pre-existing owner-scoped routes repo-wide** (`tenants/*`, `dashboard/*`, `agreements/*`, `expenses/*`, `leads/*`, `recovery/*`, `rooms/*`, `food/*`, `move-out/*`, and more — found via `grep -rl 'OWNER", "ADMIN"\].includes(session.role)' app/api`). This predates the Tenant App/Platform Admin work by a wide margin and was harmless while `ADMIN` was never a real, assignable role; ADR-030 makes `ADMIN` real, so these routes are no longer theoretically unreachable for that role, though every one still fails closed (`resolveOwnerScope` throws `FORBIDDEN` for non-`OWNER`) — not a security hole, just ~100 files of dead/misleading authorization surface implying an admin capability that doesn't work. Only the 8 new routes introduced this session were fixed (see above); the pre-existing ~100 were left untouched as out of scope for a stabilization pass over new work, but are a good candidate for a dedicated follow-up sweep.
- **Platform Admin Revenue routes (`/api/platform-admin/revenue`, `/revenue/hostels`, `/revenue/export`) run unbounded `findMany` queries across every `hostel_subscriptions`/`platform_invoices` row** with no `take` limit — correct for computing true platform-wide MRR/ARR (you can't paginate a sum), but worth revisiting (DB-side aggregate/`GROUP BY` instead of in-memory reduce) once hostel count grows large enough for this to matter. `hostels/route.ts`'s own list endpoint is already bounded (`take: 200`).
- **Hostel detail "Uploaded Photos"/"Uploaded Documents" sections from `Stayo Admin.dc.html` are not built** — deliberately deferred 2026-07-27 (see the admin deep-audit entry above). No backing schema exists for either; building this needs new tables/storage plus an owner-side upload flow (an admin can't review photos nobody uploaded), not just an admin-side display.
- **Revenue page's "Analytics" stats block (churn rate, ARPU, ARPT, new subscriptions, renewals, failed payments) and its date-range filter are not built** — deliberately deferred 2026-07-27 alongside the item above. Both need new backend time-windowed/derived calculations the current `/api/platform-admin/revenue` doesn't compute.
- **Emergency Contact's Phone/Alternate phone fields have no OTP UI, but the backend requires one when changing an already-set number.** `updateTenantSelfProfile` gates any change to `phone_2`/`guardian_phone` or `phone_3`/`emergency_contact` (once a value already exists) behind a pre-existing OTP-verification check — this is unrelated to the 2026-08-14 owner-approval governance work (see [[Business-Rules]]) and predates it, but the Profile tab's Emergency contact edit form has no send-OTP/verify-OTP step, so such a save currently fails with a `VALIDATION_ERROR` toast instead of succeeding. Setting these fields for the *first time* (from empty) works fine — confirmed live. A full fix needs a small OTP-request UI reusing the existing `phoneVerificationOtp` flow (see `src/portal/pages/TenantProfilePortalPage.tsx`'s frozen-but-still-referenceable send/verify pattern for the shape of it), out of scope for the visual/governance-narrowing pass that surfaced this.

## See also
- [[Features]] for which feature each bug affected
- [[Changelog]] for when fixes shipped





## 2026-08-26 — Completing a move-out silently wrote off everything the tenant owed

`confirmPaymentAndComplete` ended with an unconditional `obligationEngine.bulkWaiveInTx` over every `PENDING`/`PARTIAL` obligation, reason `"Move-out settlement confirmed — outstanding rent waived"`. The owner app's button for that call read **"Confirm Refund & Complete"** — on a sheet that had, one step earlier, displayed *Owed by tenant ₹25,000*.

So the owner tapped a button that said *refund*, and forgave ₹25,000 owed **to them**. Nothing on screen mentioned a write-off, and nothing asked. The label was wrong in the other direction too: `summariseSettlement` now derives direction once and every label reads from it.

**Fix:** `duesDisposition` on the service and the route, defaulting to `RECOVERABLE`; `WAIVE` is opt-in and the button then says *"Write off ₹25,000 & close"*. See [[Decisions#ADR-130|ADR-130]], [[Business-Rules]].

## 2026-08-26 — `/api/auth/me` picked an arbitrary tenancy, locking re-admitted tenants out

The tenant lookup was `prisma.tenants.findFirst({ where: { profile_id } })` — **no `orderBy`, no status filter**. For anyone with more than one tenancy row (a previous stay plus a current one) Postgres returned whichever it liked, so `tenant_status` could come back `FORMER_TENANT` for someone who had just moved into a new hostel. Every `hasLiveTenancy` gate downstream then refused them their own dashboard.

`profile-identity-service.ts::selectFallbackTenancy` had already solved exactly this — live tenancy first, else most recently created, with a comment explaining why `orderBy: { status: 'asc' }` is wrong (`TenantStatus` declares `INVITED` before `ACTIVE`, so enum sorting prefers a tenancy the person never activated). `/auth/me` never got the fix. It now uses the same precedence.

## 2026-08-26 — A tenant who moved out was deleted from the app without a word

`hasLiveTenancy` is `INVITED|ACTIVE`, so a `FORMER_TENANT` failed `ProtectedTenantRoute` and hit `<Navigate to="/discover" replace />`: no message, no explanation, and `buildOuterTabs` silently swapped the six dashboard tabs for Explore/Profile. Someone opening the app to check whether their deposit had come back landed on a marketing browse page as though they had never lived anywhere — and their settlement record, which lives inside the tenant dashboard tree, became permanently unreachable from their side.

The timing made it worse: `tenants.status` flips to `FORMER_TENANT` in **`vacate`**, when the bed is released, which is a whole step before `complete` settles the money. People were locked out of the app *while still owed a refund*.

**Fix:** three tenancy states instead of two. `EXITING` keeps the dashboard read-only until the settlement closes; `EXITED` lands on `/tenant/farewell` with the receipt and a door into Discover. See [[Decisions#ADR-130|ADR-130]].

## 2026-08-26 — Two owner action bars never learned about `FORMER_TENANT`

`FloatingActionMenu.tsx` and `StickyOpsBar.tsx` both gated on `['LEFT', 'CANCELLED', 'EXPIRED']`. `FORMER_TENANT` — the status the move-out flow actually writes — was in neither list, so a tenant who had already moved out still got the full action set on their profile: Receive Payment, Send Reminder, and **Move Out** a second time. `INACTIVE_STATUSES` in `features/tenants/utils/normalize.ts` had it right all along, which is why the tenant *list* behaved correctly and only the profile did not.

## 2026-08-26 — The move-out sheet latched onto a tenant's old completed exit

`MoveOutSheet` resolved its request with `requests.find(r => r.tenant_id === tenantId)` over one 50-row page ordered `created_at desc`, **with no status filter**. Two consequences: a re-admitted tenant matched their previous `COMPLETED` request, so the sheet showed "Move-out completed" forever with no way to start a new one; and past 50 requests in a hostel an in-flight request could fall off the page entirely, leaving the sheet offering "Initiate Move Out" to someone who already had one open — which `createRequest` then rejects with `VALIDATION: Active move-out request already exists`.

`resolveActiveRequest` now prefers a non-terminal request regardless of list order, and returns the last completed one separately so a finished exit can still show its receipt without being mistaken for work outstanding.

## 2026-08-19 — A signed-in user was told to sign in when posting a review

**Symptom:** `POST /api/discover/hostels/[slug]/reviews` returned `UNAUTHORIZED — "Sign in to continue"` for a user with a valid session.

**Root cause:** `middleware.ts` matches `PUBLIC_ROUTES` **by prefix**, and `/api/discover/hostels` is public so that anyone can browse. The reviews route lives under that prefix because it is the same resource — and the public branch deliberately calls `stripIdentityHeaders()` and never sets `x-auth-mode`, so `getSession()` inside *any* route beneath a public prefix returns null **by design**. Reading reviews must be public; writing one cannot be, and the two shared a prefix.

**Fix:** `lib/auth/public-route-exceptions.ts` — `requiresSessionDespitePublicPrefix(pathname, method)`, consulted in the public branch. The alternative was moving the write to a path outside the prefix, which would have split one resource across two URL trees to work around a matching rule.

**Lesson:** a prefix-matched allowlist silently confers its permissions on every path added beneath it later. Adding a route under an existing public prefix is a security-relevant decision, not a filing choice.

## 2026-08-19 — A normal phone multi-select of photos was rejected as "limit exceeded"

**Symptom:** an owner picking several photos at once on a phone was told the size limit was exceeded, though every individual photo was well inside it.

**Root cause:** the client sent the whole selection as **one** request (`MAX_PER_UPLOAD = 10`), so ten 4MB photos became a ~40MB body that the platform rejected before any of the per-file checks in `uploadPhotos` ran. Both the client and the server checked size **per file** and correctly so — the failure happened above both of them, which is why the message the owner saw named a limit nothing had actually crossed.

**Fix:** one file per request (`marketingService.uploadMedia`), uploaded sequentially, with photos re-encoded in the browser first (`compressImage` — a 6MB phone photo becomes a few hundred KB at a resolution the listing can use). A failure now costs one photo instead of the whole selection, and progress is reported per file.

**Lesson:** a size rule enforced in two places was still not enforced where it mattered. Neither test suite could see the failure, because the limit that broke was the transport's, not the application's.

## 2026-08-19 — A live listing told its owner it was a "Draft"

**Symptom:** owners could not tell what state their listing was in — whether a submission had reached Stayo, or whether what was live included their latest edits.

**Root cause:** the marketing page derived its badge from `draft.status` alone. After approval there is **no open revision** (`getEditorState` synthesises a fresh draft), so the status read `DRAFT` and the page said "Draft" about a listing that was live on Discovery. The status toggle had a `status === 'APPROVED'` branch that could never be reached for the same reason. Nothing anywhere confirmed a submission had been received. Verified against the live database: the hostel had v3 APPROVED and v4 PENDING_REVIEW at the time — the cycle itself was working; only the reporting of it was not.

**Fix:** `listingLifecycle` derives the real state from three facts — the open revision's status, what is published, and whether there are unsent edits — into six states (Draft, In review, Live, Live + in review, Live + unsent edits, Changes requested), shown as a three-step tracker with a sentence saying what happens next.

**Lesson:** one field looked like it described the whole state machine and described a corner of it. See [[Features]], [[Changelog]].

## 2026-08-19 — Discovery showed a placeholder for every hostel, and the gallery had no way to reach photo 2

**Symptom:** every card on `/discover` rendered the striped placeholder texture instead of the hostel's cover photo, while the listing page those cards open showed a full gallery of the same hostel's photos. On the listing page itself, photos 2..n were unreachable on a phone.

**Root cause — two independent bugs, one per surface:**

1. **The card projection never learned where photos live.** `discovery-service.toCard()` read `hostels.admission_photos`, and **nothing writes that column** — a hostel's photos arrive through the marketing review flow and live on its APPROVED `hostel_marketing_revisions.content.photos` (ADR-076). Verified against the live database: `admission_photos` is `null` for every hostel row, while the approved Starlink revision holds 3 photos. `projectListing` (the listing page) already preferred marketing photos; the card path was written before that source existed and was never revisited. `marketing-content.ts`'s `normaliseContent` even carries the comment *"the design's Discovery search shows the cover photo first"* and guarantees exactly one `is_cover` per revision — **nothing read the flag**, on either surface.

2. **The gallery was a single background image.** `ListingPage` rendered `photos[photoIndex]` as one `background-image` whose only control was three **3px-tall** indicator bars — no swipe track, no arrows, a tap target three pixels high, and the bars sat *underneath* the body sheet (pulled `-mt-6` over the gallery), so they were both invisible and unclickable. White-on-white over a bright photo finished the job.

**Fix:** one shared `listingPhotos(marketing, fallback)` in `listing-projection.ts` — approved photos win, cover first — used by both the listing and, via a new post-pagination `fillCoverPhotos()`, by cards/saved/enquiries. Cards carry one photo (the cover), and the revision content is fetched only for the rows actually returned, never for the up-to-500 candidates the facet pass scans. The gallery became a native scroll-snap track (real swipe, trackpad, `md`+ arrows), with the index derived from scroll position by a pure `photoIndexFromScroll`, indicators lifted clear of the sheet, and a scrim behind them.

**Lesson:** the listing page and the card were two projections of "this hostel's photos" and only one of them was updated when the source of truth moved. The rule now lives in a single exported function that both call — the same compose-don't-reimplement pattern the financial read model uses. Verified end to end: `/api/discover/hostels` returns the cover, and the gallery was driven in a real browser (swipe → "3 / 3", dot click → "1 / 3"). See [[Frontend]], [[Features]], [[Changelog]].

## 2026-08-07 — `window.scrollY` is always 0: `<body>` is the scroll container, not the document

**Symptom:** the new scroll-depth enquiry prompt never appeared at any scroll position, and — found while investigating — the landing nav's `scrolled` styling had *never once fired in production*.

**Root cause:** `theme.css` sets `overflow-x: hidden` on **both** `html` and `body`. Per CSS spec a non-`visible` value on one axis forces the other axis from `visible` to `auto`, which makes `<body>` the scroll container instead of the document. Measured in a headless browser against the live page: `documentElement.scrollHeight` was 437 (exactly the viewport) while `body.scrollHeight` was 5101. Two independent consequences, either fatal on its own:
1. `documentElement.scrollHeight - innerHeight` is `0`, so any scroll *fraction* is pinned at 0.
2. A `scroll` listener on `window` fires **0** times and one on `document` fires **0** times — only `body` fires.

**Fix:** `@shared/lib/scroll` now reads whichever element actually scrolls and binds the listener to all three targets; both the prompt and the nav use it. The arithmetic is a pure, tested `computeScrollFraction`.

**Lesson:** the unit tests passed throughout. They fed `scrollFraction` in as an argument and never asked where that number came from — only driving the real page caught it. See [[Frontend]], [[Changelog]].

### Migration 070's `payout_*` columns were never declared on the Prisma `profile` model — the inverse of the 074 outage

- **Found:** 2026-08-23, when the new owner Money tab returned `500` from `GET /api/owner/payouts/summary` on every load.
- **Area:** [[Backend]] — `prisma/schema.prisma` (`profile`), `app/api/owner/payout-account/route.ts`, `src/services/settlements/settlement-run-service.ts`, `src/services/settlements/owner-payout-read-model.ts`
- **Symptom:** The owner's Collections tab showed "Couldn't load your payouts" and the console logged two `500`s. The dues list beside it rendered fine, so the failure looked specific to the new code.
- **Root cause:** Migration 070 added five columns to `profiles` — `payout_holder_name`, `payout_account_no`, `payout_ifsc`, `payout_bank_name`, `payout_updated_at` — and **none of them was ever added to the `profile` model in `schema.prisma`.** Any `select` naming them therefore failed at runtime with Prisma's "Unknown field" validation error. **Three call sites were affected and two of them shipped months earlier**: `/api/owner/payout-account` (the owner's own payout-account form) and `settlement-run-service.getRun` (the payout destination in the admin settlement console). Only the third — the new read model's `bank()` — was noticed, because it was the one anybody had loaded recently.
- **This is the exact inverse of the 2026-08-22 `navigation` outage**, and the pair defines the actual rule. There, a field was declared in `schema.prisma` while its column did not yet exist, so every *unselected* read broke. Here, a column existed while its field was undeclared, so every *explicit* read broke. **The danger is the mismatch, in either direction** — "never declare fields" is the wrong lesson to take from 074, and taking it is how this bug survived.
- **Fix:** Declared the five fields on `profile` (safe precisely because 070 *is* applied — verified in `information_schema` before declaring, not after), and independently wrapped `bank()` in a try/catch. **Two separate fixes on purpose:** the schema mismatch was the root cause, but the reason a masked four-digit account number could take down an entire money screen — amounts and all — was a missing guard on the least important field on it. The rest of the read model already degraded honestly via `Promise.allSettled`; `bank()` was the one hole in that design. Nothing decorative gets to fail a money screen.
- **Also surfaced:** migration 075 being unapplied was correctly *degrading*, not failing — `paid_today` and the promise column both errored and were absorbed as designed. That part worked; it was simply invisible behind the 500.
- **See:** [[Decisions#ADR-092|ADR-092]], [[Database]], [[Changelog]]

### The tenant's "Report a bug" button filed app bugs against the hostel owner

- **Found:** 2026-08-26, reviewing `/tenant/complaints` while splitting the hostel and Stayo inboxes ([[Decisions#ADR-117|ADR-117]]). Reported by the user as a naming problem — *"why is it listed in ticketing system"* — which turned out to be the visible edge of a routing bug.
- **Area:** [[Frontend]] — `platforms/tenant/pages/TenantComplaintsPage.tsx`, `platforms/tenant/components/overlays/configs/serviceRequestFormConfigs.ts`
- **Symptom:** None, to anyone who could see it. The tenant got "Bug reported — our team will investigate and update you here" and heard nothing again. The hostel owner got maintenance jobs titled "Payments" and "Food ordering" with no description.
- **Root cause:** The page offered two equal-looking buttons, "Raise a ticket" and "Report a bug". Its own doc comment stated the page "only ever writes to `tenant_service_requests`" — and that was true of **both** buttons. `report_bug`'s config promised "Help us improve the app" and then called `submitWithCategory('MAINTENANCE', reportBugOptions)`, writing a maintenance request into the hostel's queue. Stayo's actual inbox, `platform_support_tickets`, was never touched. The copy was inherited verbatim from the deleted `TenantProfilePage`'s "Tickets & bug reports" section, where the same two words had already meant two different things.
- **Live cost:** **5 of the 9 rows** in `tenant_service_requests` arrived this way — three "Room services", two "Food ordering"/"Payments" — all `MAINTENANCE`, all `RAISED`, all with empty descriptions. Every one is an app report sitting in a hostel owner's repair queue.
- **Why it survived:** the two channels were correctly separated in the schema, the services and the routes. Nothing on the server could detect the mistake, because the request it received was a valid maintenance request. Only the button's *promise* was wrong, and no test asserts on copy.
- **Fix:** `report_bug` and its options map deleted outright; the page now has **one** action, "Raise a complaint", and a plainly separate row pointing app problems at the Help Centre. One vocabulary throughout — a resident raises **complaints** with their hostel and sends **reports** to Stayo; "ticket", which meant both, is gone from every user-facing string (`My tickets` → `My complaints`, Room's `Tickets` section → `Complaints`, `Ticket history` → `Complaint history`). Internal identifiers (`raise_ticket`, `TicketBucket`) were left alone deliberately — renaming them changes nothing a resident sees.
- **Not fixed:** the 5 existing rows were left where they are. They are same-day test data with empty descriptions, and rewriting history in an owner's queue is worse than leaving it.
- **Lesson:** two buttons side by side are read as two destinations. When only one of them is real, the copy is not a label — it is a promise the code has to keep.
- **See:** [[Decisions#ADR-117|ADR-117]], [[Features]], [[Changelog]]

### The profile's "Request to move out" button opened nothing

- **Found:** 2026-08-26, reading `DiscoverProfilePage.tsx` before redesigning it ([[Decisions#ADR-118|ADR-118]]). Not reported — nobody had been able to notice, because the failure is silent.
- **Area:** [[Frontend]] — `app/pages/discover/DiscoverProfilePage.tsx`
- **Symptom:** Tapping **Request to move out** on the profile did nothing at all. No sheet, no toast, no console error. The same button on the Room tab worked.
- **Root cause:** `<MoveOutSheet>` had been placed inside `function Stat(...)` — a local component **nothing ever renders** — instead of at the page root. It referenced `moveOutOpen`, `setMoveOutOpen` and `stay`, none of which are in `Stat`'s scope. Because `Stat` is never called, the out-of-scope references never executed, so there was no runtime error either: the button set state that no mounted component read.
- **Why nothing caught it:** `npm run build` is `check:architecture && vite build && branding-check`, and **`vite build` uses esbuild, which does not typecheck** — so three undefined identifiers shipped through a green build. The frontend suite is node-only with no component rendering, so no test could see it. `tsc --noEmit` was the only thing that would have caught it, and it is not in the build.
- **Fix:** `MoveOutSheet` moved to the page root as part of the redesign; `Stat`, `MiniStat` and `ActivityTile` all deleted with the old card vocabulary.
- **Found alongside, same cause:** `ListingPage.tsx` called `describeAvailability(amenity)` **without importing it**, and read `C.muted`, which does not exist on the Discover palette. The first would have thrown a `ReferenceError` while rendering amenities on any listing that has them. Both also survived a green `vite build`.
- **Lesson:** a green build here proves the bundle was produced, not that the code is sound. Three genuine reference errors sat in two of the most-visited pages. **`tsc --noEmit` belongs in the build**, or at minimum in CI — this bug and the two on `ListingPage` were all found by running it once, by hand.
- **See:** [[Decisions#ADR-118|ADR-118]], [[Changelog]]
