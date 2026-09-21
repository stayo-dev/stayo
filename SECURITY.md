# Security Policy

This document is the security contract for Stayo. It is normative: the rules
here are enforced by tests, build-time invariant checks, and code review, and a
change that violates them is a defect, not a style preference.

Audience: engineers and operators of this repository.

- **Authentication:** Clerk is the only authentication provider. Supabase is only a database. ([[ADR-176]], [[ADR-204]])
- **Authorization:** decided in our own database from `profiles.role` and ownership, never inferred from the auth vendor.
- Full cutover design and inventory: `docs/design/2026-09-15-clerk-only-auth.md`. Decision log: `docs/obsidian/Decisions.md`.

---

## Reporting a vulnerability

Do not open a public GitHub issue for a security problem. Email
**security@yourstayo.com** (alias of the primary mailbox) with the details and,
if possible, a reproduction. You will get an acknowledgement; please allow time
to remediate before any disclosure. Findings are tracked in
`docs/obsidian/Bugs.md`.

---

## 1. Authentication architecture — Clerk only

> **The rule:** Clerk holds every credential and every session. The application
> must be able to swap Supabase for another Postgres host without changing
> sign-in, sessions, password resets, or user identity.

**Current status (transition).** The target above is decided and implemented on
the `fix/security-h2-clerk-native` branch (ADR-204). Production still runs the
Supabase-auth path pending a validated, controlled cutover; both paths are
verified during that window only, and the Supabase path is removed in Phase 4.
Until then, the transition rules below hold; after it, the "forbidden patterns"
in §3 are absolute.

**The one credential module.** `apps/backend/src/services/auth/credential-service.ts`
is the *only* place that sets, checks, changes, or revokes a credential or a
session. It talks to Clerk's Backend API through `apps/backend/lib/auth/clerk-backend.ts`.
Nothing else in the codebase may call an auth provider's credential or session
APIs. This is enforced by a source guard in
`apps/backend/tests/credential-service.test.ts`, which fails the build if that
module (or the Clerk session modules) references Supabase Auth.

**Passwords.**
- Passwords live in Clerk. No code writes a non-null `profiles.password_hash`;
  a test walks `app/`, `lib/`, and `src/` and fails on any such write.
- `password_hash` is *read* only to check a not-yet-migrated account's password;
  that account's first successful sign-in moves it to Clerk and nulls the column
  (`migrateOnSignIn`). There is no second password store.
- Every password write (reset, change, onboarding, activation) goes through
  `credentialService.setPassword`, which writes Clerk, revokes **every** Clerk
  session, deny-lists the Clerk user id in Redis, and nulls the legacy hash. A
  Clerk failure throws — a reset that did not reach Clerk must never report
  success.
- Change-password revokes the caller's own session too; the client is told to
  sign in again.

**Sessions.**
- Sign-in is backend-mediated (rate limits, account-status and activation gates)
  and returns a single-use Clerk sign-in **ticket**; the SPA redeems it with
  Clerk. The password never goes from the browser to Clerk, and the backend
  never holds a session token.
- `apps/backend/middleware.ts` verifies the Clerk session token on **every**
  `/api/*` route (`apps/backend/lib/auth/clerk-jwt-edge.ts`), pinning the
  session id and, where configured, `azp` via `CLERK_AUTHORIZED_PARTIES`.
- `getSession()` (`apps/backend/lib/auth.ts`) resolves the profile by the
  immutable Clerk user id:
  `clerk sub → users.clerk_user_id → users.profile_id → profiles`.
- Revocation is enforced by Clerk (session revoke) plus a Redis deny-list keyed
  on the Clerk user id, which covers a token minted seconds before revocation.

**Identity table.** `users` (migration 081) is the vendor-neutral identity
anchor: `clerk_user_id` (unique) ↔ `profile_id` (unique). It is the only place
the database learns about the auth vendor. `profiles.auth_user_id` /
`auth_linked_at` / `password_hash` are transition state and are dropped in
Phase 4.

---

## 2. Authorization rules

Authorization is decided in our database, never from a token's claims or the
auth vendor. A valid session answers "who is this?"; the rules below answer
"what may they do?".

**Roles.** `profiles.role` is one of `OWNER`, `TENANT`, `ADMIN` (plus warden
where applicable). Roles are never stored in or read from the auth vendor
(e.g. Clerk `publicMetadata`) — that would put an authorization decision behind
a vendor dashboard, outside our migrations, tests, and audit trail.

**`requireAdmin`.** Every `/api/admin/**` (and platform-admin) route must gate on
the shared `requireAdmin` in `apps/backend/lib/security/authz.ts`. Do not
hand-roll a role check in a route. `apps/backend/tests/admin-routes-guarded.test.ts`
enumerates admin routes and fails if any ships ungated. (Origin: audit finding
C2 — three reconciliation routes were OWNER-gated instead of ADMIN.)

**Ownership checks.**
- A profile is reachable only by its own holder or an ADMIN. `/api/profiles/[id]`
  (GET, PUT) is self-or-ADMIN only; profile responses never include
  `password_hash`, `invitation_token`, or `auth_user_id`; `updateProfile` never
  writes `email` or `phone` (those have OTP/verified paths). (Origin: audit
  finding C1 — a public-owner-signup → any-profile takeover.)
- Operational data is scoped to the caller's own `owner_id` / `hostel_id` /
  `tenant_id` from the resolved session — never from an id supplied in the
  request body or query. A tenant session is force-scoped to its own
  `tenant_id`.
- `hostelId` is a **required** parameter in operational service and route
  signatures (with the few documented exceptions). Code must never treat it as
  optional and never fall back to "first hostel" (`hostels[0]`) — silently
  picking the wrong hostel for a multi-hostel owner is a past incident class.
  Enforced by `apps/backend/scripts/architectural-invariants-check.ts`
  (`npm run check:invariants`).

**Financial routes.** The six financially sensitive owner routes additionally
require the 2-minute `identity_tokens` step-up confirmation. Money owed is read
from `rent_obligations` via the read model; never recompute "amount due"
independently.

---

## 3. Forbidden patterns (hard rules)

These are enforced, not advisory. A PR that introduces any of them must be
rejected.

1. **No email-based account linking.** Identity is resolved and linked by
   immutable id only — a Clerk user carries `externalId = profiles.id`, and the
   webhook / `/me` handshake link on that id. Matching a login to a `profiles`
   row by email address is forbidden: it is an account-takeover primitive (any
   path that can change a profile's email becomes an identity change). This
   killed the C1 takeover chain and must not return.

2. **No runtime `supabase.auth.*` authentication logic.** No route, service, or
   frontend module may call `supabase.auth.*`, `admin.updateUserById`,
   `admin.signOut`, or read/write `auth.users`, `auth.sessions`, or
   `auth.refresh_tokens` for authentication. Supabase is a database only. The
   credential and Clerk session modules are source-guarded against this; extend
   the guard rather than working around it.

3. **No second credential store.** No code writes a non-null
   `profiles.password_hash`. Passwords live in Clerk.

4. **No role from the auth vendor.** Roles come from `profiles`, never from
   Clerk metadata or any token claim.

5. **No raw `fetch`/`axios` in the frontend app layer.** All requests go through
   `@lib/api-client` (which attaches the session token and CSRF). Enforced by
   `apps/frontend/scripts/check-architecture.mjs`.

6. **Backend-only tables are not PostgREST-exposed.** Tables written only by the
   backend `postgres`/`service_role` connection must have RLS enabled and
   `anon`/`authenticated` revoked (deny-all, no policy). This is why
   `email_verification_otps` and `_prisma_migrations` were locked down (audit
   finding C3). Do not ship a backend-only table with public grants.

Relevant enforcement:
- `apps/backend/tests/credential-service.test.ts` — Supabase-auth source guard + no-`password_hash`-write scan.
- `apps/backend/scripts/architectural-invariants-check.ts` (`npm run check:invariants`).
- `apps/frontend/scripts/check-architecture.mjs` (`npm run check:architecture`).

---

## 4. Security release checklist

Run before shipping anything that touches auth, authorization, payments, or a
backend-only table.

**Pre-merge**
- [ ] `npm run test:pure` (backend) green apart from known pre-existing failures.
- [ ] `npm run check:invariants`, `check:activation-invariants`,
      `check:financial-safety`, `check:payment-production` pass for payment/
      obligation changes.
- [ ] `npm run check:architecture` (frontend) and a production `npm run build` pass.
- [ ] No new `supabase.auth.*` / `auth.users` / `password_hash`-write / email-link
      call sites (grep + the source guards above).
- [ ] Any new `/api/admin/**` route gates on `requireAdmin`; any new operational
      route is owner/hostel-scoped from the session, not the request body.
- [ ] New backend-only table ships with RLS on + anon/authenticated revoked, in
      a migration (not a dashboard change).
- [ ] ADR added/updated in `docs/obsidian/Decisions.md`; ADR number checked
      against `origin/main` to avoid collision; `Bugs.md`/`Changelog.md` updated.

**Deploy ordering (deploy-before-migrate)**
- [ ] Adding a column to an existing model: **deploy the code first, then apply
      the migration.** A Prisma field without its column breaks every query on
      that model that does not `select` it (2026-08-22 incident). A brand-new
      table has no such blast radius.
- [ ] Confirm required migrations exist in production **before** deploying code
      that reads them (e.g. `getSession` reading `users` requires migration 081).
- [ ] Apply migrations from the correct project — read `GET /api/health`'s
      `auth.supabase.project_ref`; never trust a local `.env` to name production.

**Post-deploy**
- [ ] `GET /api/health` reports the expected commit and `database: connected`.
- [ ] Unauthenticated probe: protected routes return 401; admin routes reject a
      non-admin session (403).
- [ ] For an auth cutover, run the auth matrix in §6 before widening rollout.

---

## 5. Incident response procedure

1. **Declare & scope.** State what is affected (auth, a data class, a route) and
   whether it is actively exploitable. Note the deployed commit from
   `GET /api/health`.
2. **Contain.**
   - Compromised session(s): revoke via Clerk (session revoke) and the Redis
     deny-list; `logout-all` for a user. For a suspected mass compromise, rotate
     the relevant credential (§7) — that revokes sessions as a side effect.
   - Vulnerable endpoint: if a fix is not immediate, gate or disable the route.
     A blocked-but-safe route beats an open one.
   - Data-plane exposure (a public-readable table): apply the RLS/REVOKE
     lockdown migration immediately (it is safe and independent of code).
3. **Revert if it shipped.** If a deploy introduced the issue, revert the commit
   and redeploy `main`; do not hotfix forward under pressure. For an auth
   cutover, a failing auth-critical flow means **stop rollout and revert** — do
   not push further.
4. **Eradicate & verify.** Land the real fix behind the release checklist (§4),
   with a regression test that fails on the pre-fix code.
5. **Record.** Add an entry to `docs/obsidian/Bugs.md` (symptom, root cause,
   fix, what was and was not verified) and an ADR if a design gap was revealed.
6. **Rotate** any credential that may have been exposed (§7).

---

## 6. Auth cutover verification matrix

For any change to the authentication path (notably the Clerk cutover), validate
these against a Clerk-enabled target **before** widening to all users. Never
validate auth against production data without a maintenance window; never point a
test client at the production database with a mismatched Clerk instance. Full
gate: `docs/design/2026-09-15-clerk-cutover-verification-gate.md`.

Owner login · Admin login · Tenant login · Token refresh · Password change (old
fails, new works, other sessions ended) · Password reset (email link and
WhatsApp code; link is single-use) · Google login · `logout-all` (confirmed from
a second device) · sign-in ticket is single-use and expires · `GET /api/auth/me`.

If any of these fails: stop rollout and revert the auth commit.

---

## 7. Credential rotation procedure

Rotate on suspected exposure, on offboarding a person with access, and on a
schedule for long-lived secrets. Secrets live in Vercel project env
(`stayo-backend`, `stayo-drc3`) and in the repo-root `.env` for local use — the
`.env` is gitignored and must never be committed.

- **Clerk (`CLERK_SECRET_KEY`, `CLERK_JWT_KEY`, publishable key, webhook signing
  secret):** rotate in the Clerk dashboard, update both Vercel projects (frontend
  and backend must resolve to the **same** Clerk instance — a `pk`/`sk` instance
  mismatch breaks sign-in), redeploy, and confirm a real sign-in end-to-end.
  Rotating `CLERK_SECRET_KEY` invalidates Backend API access for the old key.
- **Supabase (`DATABASE_URL`/`DIRECT_URL` password, `SUPABASE_ANON_KEY`,
  service-role key):** rotate the database password and keys in the Supabase
  dashboard, update Vercel env and local `.env`, redeploy. Never let the test
  project and production converge on the same credentials.
- **Application secrets (`JWT_SECRET` for SSE/receipt/step-up/reset tokens,
  `CRON_SECRET`, Redis token, Razorpay keys, Resend/ImageKit/WhatsApp tokens):**
  rotate at the provider, update Vercel env, redeploy. `JWT_SECRET` rotation
  invalidates in-flight short-lived tokens (SSE, step-up, password-reset) — this
  is expected.
- **After any rotation:** redeploy so the running instances pick up the new
  value, then verify `GET /api/health` and one authenticated request. Record the
  rotation (what, when, why) — do not record the secret values.

---

## References

- `docs/obsidian/Decisions.md` — ADR-031 (Supabase Auth, superseded), ADR-176
  (Clerk migration), ADR-204 (Clerk-only), plus the C1/C2/C3 security ADRs.
- `docs/design/2026-09-15-clerk-only-auth.md` — cutover design, dependency
  inventory, and Supabase-auth removal checklist.
- `docs/design/2026-09-15-clerk-cutover-verification-gate.md` — the deployment
  readiness gate.
- `docs/obsidian/Bugs.md` — logged security findings and fixes.
- `CLAUDE.md` — "Auth/session model" and the enforced architectural boundaries.
