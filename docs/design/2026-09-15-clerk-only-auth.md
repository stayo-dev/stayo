# Clerk-only authentication: Clerk-native H2, identity migration, and Supabase Auth removal

**Date:** 2026-09-15 · **Branch:** `fix/security-h2-clerk-native` (off `origin/main` `7e02b707`) · **Decision:** [ADR-204](../obsidian/Decisions.md) · **Supersedes:** the Supabase-native H2 on `fix/security-h2-password-reset` (`c2fe07d1`, ADR-203), which must not be merged.

> **Architectural rule.** Clerk is the only authentication provider. Supabase is only a database. Replacing Supabase with another Postgres host must not change sign-in, sessions, password resets or user identity.

---

## 1. Why "rewrite H2" became "move the session authority"

H2 (2026-09-14 audit): a password reset or change did not invalidate the old credential or the sessions it had opened. The withdrawn fix repaired that inside Supabase Auth (`admin.updateUserById`, deleting `auth.sessions` / `auth.refresh_tokens`).

A Clerk-native fix needs one thing that did not exist: **the session has to be Clerk's.** On `origin/main`, every signed-in request carried a Supabase JWT. Clerk tokens were honoured on exactly one route (`/api/auth/me`). Password login checked a local bcrypt hash and then minted a Supabase session. So "reset the password in Clerk and revoke the Clerk sessions" would have revoked nothing anyone was using. The old Supabase password would also have kept working directly against GoTrue, which is public.

So this change does the minimum that makes Clerk the real authority:

| | Before (`origin/main`) | After (this branch) |
|---|---|---|
| Password store | `profiles.password_hash` (bcrypt) **and** Supabase `auth.users` | Clerk only. `password_hash` is read once for a not-yet-moved account, then nulled |
| Session issued at sign-in | Supabase access + refresh token | Single-use Clerk sign-in ticket → the browser redeems it → Clerk session |
| Token verified by middleware | Supabase, then legacy HS256; Clerk only on `/api/auth/me` | **Clerk on every route**, then Supabase/legacy for the transition only |
| Profile resolved by | `auth_user_id`, with an **email fallback that wrote the link** | `users.clerk_user_id → users.profile_id`. No email lookup anywhere |
| Reset / change revokes | A Redis deny-list keyed on `profile.id`, which middleware never checked for Supabase tokens | Clerk `signOutOfOtherSessions` + explicit revoke of every live session + deny-list on the Clerk `sub` |
| Pre-Clerk session after a reset | Survived | Refused. `getSession()` rejects any Supabase/legacy token for a profile that has a Clerk login |

---

## 2. The session model, as implemented

1. **Clerk issues the session.** Sign-in stays backend-mediated. `/api/auth/login` keeps its rate limits, the disabled-account check, the activation gate and `PASSWORD_RESET_REQUIRED`. The backend checks the password through Clerk (`users.verifyPassword`), then returns a 120-second single-use ticket (`signInTokens.createSignInToken`). The SPA redeems it with Clerk's `ticket` strategy (`lib/auth/clerkTicket.ts`). The browser never sends the password to Clerk. The backend never holds a session token.
2. **The backend verifies the Clerk token.** `middleware.ts` → `lib/auth/clerk-jwt-edge.ts`. The check is networkless with `CLERK_JWT_KEY`; otherwise the SDK fetches and caches the JWKS. `azp` can be pinned with `CLERK_AUTHORIZED_PARTIES`. A token without `sid` is refused. The token's `iss` is read first (unverified) only to choose the verifier. Every token still has to pass a real verifier.
3. **The profile is resolved by the immutable Clerk user id.** `lib/auth/clerk-session-resolver.ts` follows Clerk `sub` → `users.clerk_user_id` (unique) → `users.profile_id` (unique) → `profiles`. An unlinked login is `NO_STAYO_ACCOUNT`. A deactivated login or profile is `ACCOUNT_DISABLED`. An invited tenant is `TENANCY_NOT_ACTIVATED`.
4. **Roles stay in our database.** Nothing Clerk sends grants a role. The webhook's field allow-list is unchanged.

**Revocation.** `credential-service.revokeAllSessions()` lists and revokes every `active`/`pending` Clerk session. It then writes `user-revoked-after` in Redis for the Clerk user id, which is the `sub` middleware checks. A revoked Clerk session cannot mint new tokens. The deny-list covers the at most ~60 s left on a token already minted. Logout revokes this device's Clerk session (`sid`). Logout-all and every password write revoke all of them.

---

## 3. What each password flow does now

| Flow | Proof of ownership | Credential write | Sessions |
|---|---|---|---|
| Reset by email link | Our Resend link (unchanged) | `credentialService.setPassword` → Clerk | All revoked; legacy hash nulled |
| Reset by WhatsApp code | Our OTP → 5-min reset token (unchanged) | same | same |
| Change password | Current password checked by Clerk | same | **All revoked, this device included.** The response carries `reauth_required: true` and the owner Password screen signs out |
| Onboarding first password (`reset-onboarding-password`) | Temporary password checked by Clerk (or legacy hash) | same | same |
| Tenant activation (ACCOUNT / ACTIVATE steps, invitation `startActivation` / `completeActivation`) | Invitation token | same. Written **before** the tenancy commits where the profile exists, so a Clerk failure leaves nothing activated | same |
| Owner / tenant signup, bootstrap owner, platform-admin invite | — | Profile created with **our own UUID** plus a Clerk login (`ensureLogin`). If Clerk refuses, the profile is deleted again | — |
| Step-up re-verification (`confirm-identity`) | Clerk `verifyPassword` | — | — |

**Why the proof step is still ours and not Clerk's hosted reset.** Clerk's built-in reset (`reset_password_email_code`) emails a code to the account's Clerk email address. Phone-invited tenants hold a `<phone>@hms.temp` placeholder that must never be sent anywhere (ADR-183). WhatsApp reset (ADR-055) is how those tenants recover. Keeping the proof channel and moving only the credential and the sessions to Clerk loses neither. Clerk still enforces its own password rules: a breached or weak password is refused with a `VALIDATION_ERROR` that carries Clerk's message. If you want Clerk's hosted reset for email-verified accounts as well, it can be added alongside this; it cannot replace it.

**No second password store.** No code path writes a non-null `profiles.password_hash` any more. `tests/credential-service.test.ts` walks `app/`, `lib/` and `src/` and fails on any such write. `hashPassword` / `verifyPassword` are deleted from `lib/auth.ts`. The column is still *read* for one purpose: checking the password of an account that has not yet moved. That account's first sign-in or password set moves it and nulls the column.

---

## 4. Identity-field decision and migration plan

### 4.1 The neutral identity field already exists. Do not rename `auth_user_id`.

Migration 081 (ADR-176) added `users`:

```
users.clerk_user_id  text   UNIQUE   -- Clerk's immutable id ("user_…")
users.profile_id     uuid   UNIQUE   -- → profiles.id, ON DELETE SET NULL
users.is_active      bool            -- user.deleted / account closure → false
```

That is the "neutral immutable identity field", one indexed join from `profiles`. **Renaming `profiles.auth_user_id` to `clerk_user_id` would be wrong:**

- It holds **Supabase** `auth.users` UUIDs. A rename would store one vendor's ids under the other vendor's name.
- Clerk ids are `user_…` text, not UUIDs, so the column type would change anyway.
- It is transition state. It dies with Supabase Auth (Phase 4).

Changing identity provider again means adding one column to `users` and backfilling it. `profiles` does not change.

**Foreign keys, verified from the migrations:** nothing references `auth.*`. `profiles.auth_user_id` has a unique index and no FK. `profiles.id` is a plain UUID primary key. For accounts born under ADR-031 it happens to equal their `auth.users.id`, but no code relies on that any more, and new accounts get `randomUUID()`. Every business FK (tenancies, obligations, payments, documents) points at `profiles.id` and is untouched.

**Business logic that still reads Supabase Auth ids** is transition-only and listed in §5: `getSession`'s Supabase branch, `resolveSupabaseSession`, the `auth_user_id` "has a login" marker in `hasOwnLogin` and in `activation-invariants-check`, account closure's Supabase delete, and the RLS policies that use `auth.uid()`.

### 4.2 Zero-downtime rollout

**Step 0 — preconditions. Each one breaks sign-in if missed.**

| # | Precondition | How to check |
|---|---|---|
| 0.1 | **`public.users` (migration 081) exists in production** (`qgfyfbdccjnibdhhvnsr`). `getSession()` now queries `users` on every Supabase and legacy request. Without the table, every authenticated request 500s (P2021). | `SELECT to_regclass('public.users');` must not be null |
| 0.2 | A **production** Clerk instance; `VITE_CLERK_PUBLISHABLE_KEY` (frontend, `stayo-drc3`) and `CLERK_SECRET_KEY` (backend, `stayo-backend`) come from **the same** instance | `pk_live_`/`sk_live_`; the browser loads clerk-js from `clerk.yourstayo.com` |
| 0.3 | Clerk **Password** is enabled as a credential (ADR-176 Phase 2 set "password off" in the dashboard) | Dashboard → User & Authentication → Password |
| 0.4 | Clerk **email address is not required**, so phone-only tenants can have a login with no email | Dashboard → Email → "Require email address" off. **Unverified:** that the Backend API accepts a user with no identifier on this instance |
| 0.5 | Backend env: `CLERK_SECRET_KEY`; recommended `CLERK_JWT_KEY` (networkless verify) and `CLERK_AUTHORIZED_PARTIES=https://yourstayo.com,https://www.yourstayo.com` | `vercel env ls` |
| 0.6 | Clerk webhook → `https://api.yourstayo.com/webhooks/clerk` with `CLERK_WEBHOOK_SIGNING_SECRET` | A test delivery returns 200 |
| 0.7 | Redis reachable by middleware (the Clerk deny-list) | `/api/health` Redis section |

Read-only pre-check for 0.1 and the current state (run in the SQL editor; nothing is written):

```sql
SELECT to_regclass('public.users') AS users_table;
SELECT count(*) AS profiles,
       count(*) FILTER (WHERE auth_user_id IS NOT NULL) AS supabase_linked,
       count(*) FILTER (WHERE password_hash IS NOT NULL) AS with_local_hash
FROM profiles;
-- only if users_table is not null:
SELECT count(*) AS logins, count(profile_id) AS linked, count(*) FILTER (WHERE NOT is_active) AS inactive FROM users;
```

**Step 1 — deploy the backend.** Nothing changes for anyone yet:
- Clerk tokens now work on every route.
- A pre-Clerk SPA does not send `X-Auth-Capabilities`, so it keeps getting Supabase sessions for accounts that have not moved. That is every account at this point.
- An account that *has* moved gets `409 CLIENT_UPDATE_REQUIRED` ("reload the page") from an old tab. None have moved yet.

**Step 2 — deploy the frontend.** It sends `X-Auth-Capabilities: clerk-ticket` on every request. From here every sign-in ends in a Clerk session, and each account that signs in with a password moves onto Clerk on that sign-in (its proven password is carried across). `establishSession()` also accepts the legacy token pair, so this order is safe, and so is the reverse.

**Step 3 — bulk-move everyone else.**

```bash
cd apps/backend
npm run migrate:logins-to-clerk             # dry run: a line per profile + summary
npm run migrate:logins-to-clerk -- --apply
```

The script imports each `password_hash` into Clerk as a **bcrypt digest** (`passwordHasher: "bcrypt"`), so nobody's password changes. It sets `externalId = profiles.id`, writes the `users` link and nulls the local hash. It never matches by email. It reports:
- `CONFLICT_EMAIL_TAKEN`: Clerk already holds that email, typically from someone's Google sign-in. A human confirms it is the same person and sets that Clerk user's `externalId` to the profile id in the dashboard. The `user.updated` webhook then links it (late-link, by id).
- `LINK_UNVERIFIED`: a `users` row linked by the pre-ADR-204 webhook's email match whose Clerk user does not carry the matching `externalId`. Review these; the script never changes them.

**Step 4 — validate (suggested: 7 days).**
- `SELECT count(*) FROM profiles p LEFT JOIN users u ON u.profile_id = p.id WHERE u.id IS NULL AND p.is_active;` → 0.
- No `password_hash IS NOT NULL` rows.
- No `x-auth-mode: supabase|legacy` traffic. *Not instrumented yet.* Add a counter in `getSession`'s transition branches before starting the window.
- Reset, change password and logout-all exercised once each on a real account, confirming other devices are signed out.

**Step 5 — remove Supabase Auth** (§6).

**Existing Supabase-linked accounts:** moved by step 3 or by their next sign-in. The moment an account moves, its Supabase session stops working (`getSession` refuses it). The person signs in once more and lands on Clerk.
**Current Clerk users:** rows the webhook created are kept. Unlinked rows stay `NO_STAYO_ACCOUNT` until a link by id exists. Email-linked rows are surfaced by `LINK_UNVERIFIED`.

**Rollback.** Before step 3, reverting both deploys restores the old behaviour. The only cost: accounts that already moved (by signing in or resetting) have a null `password_hash`, so pre-Clerk code cannot check their password. They recover with a password reset, which the old code handles. After step 3 that applies to every account. Do step 3 only once steps 1–2 look healthy.

---

## 5. Inventory of remaining Supabase-auth dependencies

Searched after the change for `auth_user_id`, `auth_linked_at`, `ensureSupabaseIdentity`, `resolveSupabaseSession`, `supabase.auth`, `updateUserById`, `auth.sessions`, `auth.refresh_tokens`, `auth.users`, `auth.uid()`, `signInWithSupabasePassword`, `verifySupabaseAccessToken`, `SUPABASE_ANON_KEY`, `VITE_SUPABASE_*`.

**Keep** = correct as it stands. **Replace** = done in this change (already Clerk) or needs a Clerk equivalent. **Remove** = deleted in Phase 4 once validation passes.

### Backend — runtime

| File | Keep | Replace | Remove | Note |
|---|---|---|---|---|
| `middleware.ts` | Clerk verifier | — | Supabase + legacy verifier branches | Clerk first; the others exist for the transition only |
| `lib/auth.ts` (`getSession`) | `clerk` branch | — | `supabase` + `legacy` branches | Both refuse moved profiles (`profileHasClerkLogin`) |
| `lib/auth/supabase-jwt-edge.ts` | | | ✔ whole file | |
| `lib/auth/supabase-session.ts` (`resolveSupabaseSession`) | | | ✔ whole file | Still has the email fallback that writes `auth_user_id`; C1 (`9644fbf6`) removes that fallback. Reachable only for accounts not yet moved |
| `lib/auth/supabase-identity.ts` (`ensureSupabaseIdentity`, `signInWithSupabasePassword`) | | | ✔ whole file | Used only by `createSessionAndTokens`'s legacy branch (pre-Clerk tab + unmoved account) |
| `lib/auth/supabase-provision.ts` + `app/api/auth/google/provision/route.ts` | | | ✔ | Unreferenced by the frontend since ADR-176 Phase 3.1 |
| `lib/services/auth-service.ts` | Clerk paths | reset / change / onboarding / signup / login / step-up → `credentialService` (done) | legacy Supabase branch in `createSessionAndTokens` | |
| `src/services/auth/credential-service.ts` | ✔ | | | New. The only credential module; source-guarded against Supabase Auth |
| `lib/auth/clerk-backend.ts`, `clerk-jwt-edge.ts`, `clerk-session-resolver.ts`, `session-capabilities.ts` | ✔ | | `setLegacySessionCookies` + the no-capability branch | New |
| `lib/auth/clerk-session.ts` (`verifyClerkSession`) | ✔ | | | Used by `GET /me` (outside `/api`) |
| `src/services/auth/clerk-user-sync-service.ts` | ✔ | email linking → `externalId` linking (done) | | Never links by email now |
| `app/api/auth/me/route.ts` | ✔ | route-local Clerk path → `getSession` (done) | `supabaseRejection` + `SIGN_IN_AGAIN` for supabase/legacy | |
| `app/api/auth/logout/route.ts`, `logout-all/route.ts` | Clerk revoke | — | `supabase.auth.admin.signOut` blocks | |
| `app/api/auth/login`, `onboarding-login`, `owner-signup`, `tenant-signup`, `tenants/activate` | ✔ | cookies → `setLegacySessionCookies` (done) | stale "setSession" comments; the legacy cookies | |
| `src/services/profile/account-closure-service.ts` | `closeLogin` (Clerk) | done | `supabaseAdmin.auth.admin.deleteUser` + `auth_user_id: null` | |
| `src/services/tenants/activation-workflow-service.ts` (`hasOwnLogin`) | Clerk-login check | done | `auth_user_id` / `password_hash` markers | |
| `src/services/tenants/owner-managed-tenancy-service.ts` | | | `auth_user_id: null` / `password_hash: null` writes | Harmless now; drop with the columns |
| `app/api/health/route.ts` | | Add a Clerk section (instance type, JWKS reachable) | Supabase-auth issuer diagnostic | |
| `lib/db.ts` (`supabase` admin client) | ✔ if still used for Storage | | Auth use | Check Storage use before deleting the client itself |
| `prisma/schema.prisma` | `users` | | `profiles.auth_user_id`, `auth_linked_at` | Phase 4, deploy-before-migrate (see §6) |

### Backend — SQL, scripts, tests

| File | Keep | Replace | Remove | Note |
|---|---|---|---|---|
| `prisma/migrations/20260728000000_profile_auth_user_id` | ✔ (history) | | | Applied history is never edited |
| `prisma/migrations/20260910040000_subscription_billing_rls`, `20260911100000_subscription_gateway_payments` | | ✔ | | RLS policies use `auth.uid()` via `profiles.auth_user_id`. The app connects as `postgres` and bypasses RLS, so these guard only direct PostgREST access. Replace with deny-all (no policy) when the column is dropped, or they fail to compile |
| `prisma/migrations/SUPABASE_APPLY_ALL_PENDING.sql` | ✔ (history) | | | |
| `scripts/migrate-logins-to-clerk.ts` | ✔ until Phase 4 ends | | then ✔ | New |
| `scripts/reconcile-supabase-identities.ts`, `clear-auth-except-admin.ts`, `reset-to-admin-only.ts`, `production-reset-keep-owner.ts`, `inspect-accounts.ts`, `inspect-profiles.ts` | | | ✔ | Supabase-auth admin tooling |
| `scripts/create-user.ts`, `create-test-tenant.ts`, `setup-trio.ts` | | ✔ → `credentialService.ensureLogin` | | Dev seeding still creates Supabase users |
| `scripts/activation-invariants-check.ts` | Clerk login | done | `auth_user_id` arm | |
| `tests/auth-hardening-security.test.ts`, `auth-google-provisioning.test.ts` (4 stale failures pre-date this) | | ✔ | | DB-backed, pin Supabase Google behaviour |
| `tests/platform-owner-profile.test.ts` | ✔ | | `auth_user_id` assertions with the column | |

### Frontend

| File | Keep | Replace | Remove | Note |
|---|---|---|---|---|
| `src/lib/api-client.ts` | Clerk token first; capability header | done | Supabase fallback token | |
| `src/lib/auth/establishSession.ts`, `clerkTicket.ts`, `sessionHandoff.ts` | ✔ | | Supabase branch of `establishSession` | New |
| `src/lib/auth/clerkBrowser.ts` (`pickSessionSource`) | ✔ (Clerk first) | done | `supabase` source | |
| `src/context/AuthContext.tsx` | | done (sign-in/out) | `onAuthStateChange` Supabase listener | Hydration is provider-agnostic via `/auth/me` |
| `src/app/pages/AuthCallbackPage.tsx`, `public/LeadSignupCallbackPage.tsx` | | ✔ | Supabase `getSession`/`getUser` reads | Google landing is Clerk's; these still consult Supabase first |
| `src/lib/supabaseClient.ts` | ✔ only if Supabase Storage/Realtime is used client-side | | Auth config (`persistSession`, `detectSessionInUrl`, `flowType`) | Verify no non-auth use before deleting |
| `.env.example` `VITE_SUPABASE_*` | | | ✔ with the client | |
| `src/platforms/tenant/onboarding/ActivationPage.tsx`, `public/OwnerActivationPage.tsx`, `portal/pages/ActivateAccountPage.tsx` | ✔ | done (`establishSession`) | | |

---

## 6. Supabase Auth removal checklist (Phase 4)

Start only after step 4 validation passes. Each line is a separate reviewable change.

- [ ] **Gate:** 0 active profiles without a `users` link; 0 non-null `password_hash`; 0 transition-branch hits for 7 days.
- [ ] Middleware: delete the Supabase and legacy HS256 verifier branches and `x-auth-mode: supabase|legacy`. Every token is Clerk or 401.
- [ ] `getSession`: delete the `supabase`/`legacy` branches and `profileHasClerkLogin`. That also drops the extra `users` query per request.
- [ ] `/api/auth/me`: delete `supabaseRejection` and the `SIGN_IN_AGAIN` paths.
- [ ] `auth-service.createSessionAndTokens`: delete the legacy branch and `CLIENT_UPDATE_REQUIRED`. Delete `session-capabilities`' no-capability path and `setLegacySessionCookies`. The capability header then becomes unnecessary (leave the frontend sending it for one release, then remove).
- [ ] Delete `lib/auth/supabase-identity.ts`, `supabase-session.ts`, `supabase-jwt-edge.ts`, `supabase-provision.ts`, `app/api/auth/google/provision`, `lib/config/supabase-auth-config.ts` (after moving `/api/health` onto Clerk).
- [ ] `credentialService.verifyPassword`: delete the legacy-hash fallback and `migrateOnSignIn`. Remove `bcryptjs` if nothing else uses it.
- [ ] Logout / logout-all / account closure: delete the Supabase `admin.signOut` / `deleteUser` blocks.
- [ ] `hasOwnLogin` and `activation-invariants-check`: drop the `auth_user_id` / `password_hash` markers.
- [ ] Frontend: delete the Supabase token fallback in `api-client`, the `supabase` source in `pickSessionSource`, the Supabase branch of `establishSession`, the `onAuthStateChange` listener, and the Supabase reads in `AuthCallbackPage` / `LeadSignupCallbackPage`. Delete `supabaseClient.ts` and `VITE_SUPABASE_*` if nothing non-auth uses them.
- [ ] Scripts: delete the Supabase-auth admin scripts; move the seed scripts onto `credentialService.ensureLogin`.
- [ ] **Schema, deploy-before-migrate** (2026-08-22 incident):
  1. Deploy code that no longer references `auth_user_id` / `auth_linked_at` / `password_hash`, with the fields removed from `schema.prisma`. A Prisma field without its column breaks every query on the model. A column without its field is harmless.
  2. Replace the two `auth.uid()` RLS policy sets with deny-all (no policy), since they reference `profiles.auth_user_id`.
  3. Then `ALTER TABLE profiles DROP COLUMN auth_user_id, DROP COLUMN auth_linked_at, DROP COLUMN password_hash;`
- [ ] Supabase dashboard: disable email/password and OAuth providers on the Supabase project; rotate `SUPABASE_ANON_KEY` if the frontend no longer needs it. Leave `auth.*` schema data in place (Supabase-managed) or delete users after an export.
- [ ] Update `CLAUDE.md` ("Auth/session model"), `docs/obsidian/Architecture.md`, `Backend.md`, `Frontend.md`, `Database.md`, and close ADR-176's Phase 4.
- [ ] **Portability test:** on a staging copy, point `DATABASE_URL` at a non-Supabase Postgres restored from a dump. Sign-in, reset, change password and logout-all must work unchanged.

---

## 7. What is verified, and what is not

**Verified here:**
- Backend pure suite: 2464 passing (baseline had 2 pre-existing failures in `agreement-requirement.test.ts`, unchanged).
- New tests: `credential-service` (29), `password-flows-clerk` (13), `clerk-session-resolver` (13), rewritten `tenant-self-signup` (11), `auth-me-dual-session` (13).
- Four mutation checks each fail the suite:
  - dropping the explicit session revocation;
  - dropping `signOutOfOtherSessions`;
  - dropping the Supabase cut-off in `getSession`;
  - swallowing a Clerk failure in reset, which is the original H2 bug.
- Backend `tsc`: no new errors versus `origin/main`.
- Frontend: 2902 tests pass, `check:architecture` passes, and `npm run build` passes. The ticket redeemer and Clerk loader are separate lazy chunks (1 KB + 10 KB).

**Not verified:**
- **No real Clerk call has been made.** Every Clerk interaction is against a fake of the Backend API. The Backend API method names and parameters were read from the installed `@clerk/backend@3.17.1` type definitions, not exercised.
- The DB-backed phone-reset test was updated for Clerk but not run (the test project is paused; Prisma cannot reach the pooler from this machine).
- Not run in a browser: the ticket redemption, and `ClerkProvider` reusing the headlessly loaded `window.Clerk` (read from the `@clerk/clerk-react` source, not observed).
- Production facts are unknown: whether `public.users` exists, how many `users` rows are email-linked, and the Clerk instance settings (0.2–0.4). Production reads are blocked from this machine.
- `scripts/migrate-logins-to-clerk.ts` has not been run, not even as a dry run: this machine's `.env` points at production.
