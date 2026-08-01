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
