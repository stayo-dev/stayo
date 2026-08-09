---
tags: [bugs]
---

# Bugs

Related: [[Features]] · [[Changelog]] · [[TODO]] · [[Business-Rules]]

Log of significant bugs — open and fixed. Not meant to replace an issue tracker for every minor bug; use this for anything that revealed a real architectural/business-rule gap (the kind of thing worth remembering months later), matching the bar already used in `docs/known-issues.md` and `docs/business-logic/*-investigation-report.md`.

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

## See also
- [[Features]] for which feature each bug affected
- [[Changelog]] for when fixes shipped


## 2026-08-07 — `window.scrollY` is always 0: `<body>` is the scroll container, not the document

**Symptom:** the new scroll-depth enquiry prompt never appeared at any scroll position, and — found while investigating — the landing nav's `scrolled` styling had *never once fired in production*.

**Root cause:** `theme.css` sets `overflow-x: hidden` on **both** `html` and `body`. Per CSS spec a non-`visible` value on one axis forces the other axis from `visible` to `auto`, which makes `<body>` the scroll container instead of the document. Measured in a headless browser against the live page: `documentElement.scrollHeight` was 437 (exactly the viewport) while `body.scrollHeight` was 5101. Two independent consequences, either fatal on its own:
1. `documentElement.scrollHeight - innerHeight` is `0`, so any scroll *fraction* is pinned at 0.
2. A `scroll` listener on `window` fires **0** times and one on `document` fires **0** times — only `body` fires.

**Fix:** `@shared/lib/scroll` now reads whichever element actually scrolls and binds the listener to all three targets; both the prompt and the nav use it. The arithmetic is a pure, tested `computeScrollFraction`.

**Lesson:** the unit tests passed throughout. They fed `scrollFraction` in as an argument and never asked where that number came from — only driving the real page caught it. See [[Frontend]], [[Changelog]].
