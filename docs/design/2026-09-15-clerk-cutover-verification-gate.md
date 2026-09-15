# Clerk cutover — deployment-readiness verification gate

**Owner: the person deploying. Do not merge or deploy until every box is checked.** This is the gate the user defined on 2026-09-15 for `fix/security-h2-clerk-native` (ADR-204) and the three P0 branches. It replaces "another coding phase" — the code is written; this is proving it against reality.

Record the result of each item inline (date, who, outcome). An unchecked or failing item blocks the merge.

---

## Phase 0 — findings already established from this machine (2026-09-15)

Read-only, before the gate proper. These change what Phase 1 must fix.

- **`/api/health` (prod, both hosts):** commit `7e02b707`, `branch: main`, `vercel_env: production`, Supabase project `qgfyfbdccjnibdhhvnsr`, JWKS ok. So production still authenticates with Supabase; nothing here is live yet.
- **🔴 BLOCKER — Clerk instance sign-in settings are wrong for this design.** Read live from the production Frontend API (`clerk.yourstayo.com`, `instance_environment_type: production`):
  - `password: enabled=false` — **the entire H2 flow needs Clerk passwords on.** `verifyPassword`, `setPassword`, ticket sign-in all fail against this instance as configured. Turn Password **on** (Clerk Dashboard → User & authentication → Password).
  - `email_address: required=true` — a phone-only tenant (`<phone>@hms.temp`, no real email) cannot be created. `credential-service.ensureLogin` deliberately sends no email for those, which this instance will reject. Set "Require email address" **off**, or phone-only onboarding breaks.
  - `email_address` first factor is `email_code` only; `oauth_google` is on. Fine.
- **🟠 Key mismatch (same class as ADR-176's note).** Local `apps/frontend/.env` has `VITE_CLERK_PUBLISHABLE_KEY=pk_test_…` while backend `.env` has `pk_live_`/`sk_live_`. Production frontend (`stayo-drc3`) and backend (`stayo-backend`) must both carry keys from the **same production instance**. Verify in Vercel, not locally.
- **Could not verify from here (permission-blocked, do in Phase 1):** the Clerk user count and per-user `external_id`/`password_enabled` (Clerk Backend API reads blocked as PII/Production Reads), and `public.users` existence in prod (prod SQL blocked). Run `scripts/verify-clerk-cutover-preconditions.sql` and the Clerk dashboard checks.
- **Trial merge (local, clean):** C1 → C3 → C2 → H2 merge with only additive conflicts (`vitest.pure.config.ts`, `Bugs.md`, `Changelog.md`, `Decisions.md` — each a union of independent additions). ADRs 200/201/202/204 are distinct. Merged tree's pure suite: **2596 pass, 2 pre-existing failures** (`agreement-requirement.test.ts`, present on `origin/main`). So the four fixes coexist and the merge order in Phase 4 is safe.

---

## Phase 1 — infrastructure verification (real production facts)

- [ ] **Migration 081 in prod.** Run `apps/backend/scripts/verify-clerk-cutover-preconditions.sql` in the prod SQL editor. Check 1 (`public.users`) non-null. **If null, deployment is blocked** — apply migration 081 first (see [ADR-176] and the deploy-before-migrate rule).
- [ ] Record from the same script: profiles total / active, `supabase_linked`, `with_local_hash`, `placeholder_email`, `users` total / linked / linked-active, the per-role unmoved breakdown (check 5), bcrypt-importable count (check 6), the email-linked rows to review (check 7), and that check 8 returns nothing.
- [ ] **Clerk Password enabled** (currently OFF — blocker above).
- [ ] **Clerk email NOT required** (currently required — blocker above).
- [ ] **`pk_live`/`sk_live` are the same production instance**, and the frontend Vercel project carries the `pk_live` (not `pk_test`). Quick tell: the browser must load clerk-js from `clerk.yourstayo.com`, not `*.accounts.dev`.
- [ ] **Webhook** `https://api.yourstayo.com/webhooks/clerk` returns 200 to a Clerk test delivery; `CLERK_WEBHOOK_SIGNING_SECRET` set on `stayo-backend`.
- [ ] **`CLERK_JWT_KEY`** set on `stayo-backend` (networkless verify) and **`CLERK_AUTHORIZED_PARTIES`** = `https://yourstayo.com,https://www.yourstayo.com`.
- [ ] **Redis** reachable by middleware (`/api/health` redis section) — the deny-list depends on it.

## Phase 2 — real browser validation (no mocks)

Run against a preview deploy of the merged branch pointed at a **non-production** database and a Clerk **development** instance configured like production (Password on, email not required), OR a controlled window on production. Document each result (pass/fail + note).

- **Auth:** [ ] login  [ ] refresh (token renews, no re-login)  [ ] logout (this device)  [ ] logout-all  [ ] second device confirms logout-all
- **Password:** [ ] change password  [ ] old password now fails  [ ] new password works  [ ] change signs the acting device out (`reauth_required`)  [ ] reset via email link  [ ] reset via WhatsApp code  [ ] a reset link cannot be replayed  [ ] a breached/weak password is rejected with Clerk's message
- **Identity:** [ ] Google login (existing account)  [ ] Google login for an unknown email → `NO_STAYO_ACCOUNT` (no account created)  [ ] tenant activation (email tenant)  [ ] tenant activation (phone-only tenant, no real email)  [ ] an invited-but-not-activated tenant is refused
- **Session:** [ ] an expired sign-in ticket is rejected  [ ] a second redemption of the same ticket fails (single-use)  [ ] the same ticket in two browsers → only one session  [ ] a request after logout-all/reset is refused (revocation honoured)  [ ] a pre-Clerk (Supabase) session for a migrated account is refused with `SIGN_IN_AGAIN`

## Phase 3 — red-team the fully-merged branch (external)

Report only successful attacks or confirmed failures. `scripts/redteam-auth-probe.sh` covers the unauthenticated shape; the authenticated cases need two real accounts.

- [ ] Read another owner's profile (`GET /api/profiles/[id]`) → expect 403/404 (C1)
- [ ] Rewrite another user's profile (`PUT /api/profiles/[id]`) → expect 403/404 (C1)
- [ ] `/api/admin/finance/reconciliation/*` as an OWNER session → expect 403 (C2)
- [ ] Any `/api/admin/*` as OWNER → expect 403 (C2)
- [ ] A valid Supabase JWT for a **migrated** account → expect 401 (getSession refuses it)
- [ ] A legacy HS256 JWT → expect 401
- [ ] Email-link takeover: sign into Clerk with an email matching a victim profile that our backend never linked → expect `NO_STAYO_ACCOUNT`, no link created
- [ ] Ticket replay (Phase 2 covers the happy path; here, a stolen ticket after first use) → expect failure
- [ ] ID tampering in bodies/queries (`hostelId`, `tenantId`, `ownerId`) on operational routes → expect scoping to the session, not the supplied id
- [ ] `email_verification_otps` / `_prisma_migrations` direct DML as `anon` → expect denied (C3; needs migration `20260916000000` deployed)

## Phase 4 — merge readiness

Only when Phases 1–3 pass. Merge order (verified conflict-free locally): **C1 → C3 → C2 → H2.** Resolve the four additive doc/config conflicts by union (keep both sides). Re-check ADR numbers against `origin/main` at merge time (they were 200/201/202/204 on 2026-09-15). Then write the release report: fixes included, remaining known risks, Supabase Auth removal progress (Phase 4 checklist in the cutover doc), rollback plan, production deployment checklist.

> Per repo policy ([[stayo-git-workflow]]): merge into `dev`, push `dev`; `main` only on the user's explicit say-so. Never push `main` without being asked.
