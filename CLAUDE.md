# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository layout — read this first

This repo contains multiple UI trees from different project phases. **Do not assume `frontend/` is active** just because it looks complete — the canonical choice (per `docs/README.md` and `docs/architecture/overview.md`) is:

| Tree | Role |
|---|---|
| `apps/backend/` | **Canonical API** — Next.js 14 App Router + Prisma + Postgres (Supabase). All business logic lives here. |
| `apps/frontend/` | **Canonical UI** — Vite + React 19 SPA. Owner app, tenant portal, and public marketing site. |
| `frontend/` | Legacy Vite + React 19 SPA. Kept as reference evidence for older UX; not the deploy target for new work. |
| `temp-ui/` | Figma/prototype export, visual reference only — not wired to real data. |
| `backend/` | Legacy Python/FastAPI. Not called by any current frontend. |
| `migrations/` | Hand-written SQL migrations (51+), applied via Supabase SQL editor/psql — order matters, see `docs/data-models/schema.md`. |
| `docs/` | A maintained "rebuild map" of the product — architecture, every module, business rules, schema, known issues. **Check here before spelunking through code for how something is supposed to work.** |

The root `README.md` is stale on this point (still describes `frontend/` as active); trust `docs/` over it. See `docs/known-issues.md` for other places the docs flag drift.

## Commands

### Backend (`apps/backend/`)

```bash
cd apps/backend
npm install
npm run prisma:generate      # regenerate Prisma client after schema.prisma changes
npm run dev                  # Next.js dev server on :3000
npm run build
npm run lint                 # next lint
npm test                     # vitest, all tests in tests/**/*.test.ts
npx vitest run tests/<file>.test.ts        # single test file
npx vitest run tests/<file>.test.ts -t "case name"   # single test case
```

Env vars load from `../.env` (repo root), not `apps/backend/.env` — scripts use `DOTENV_CONFIG_PATH=../.env`. `.env.test` is used by the test suite (`vitest.config.ts` loads it first, then falls back to `.env`).

Vitest runs with `fileParallelism: false` / single worker — tests share a real Postgres connection and are not safe to parallelize.

Other checks worth knowing about (run before touching payment/obligation code):
```bash
npm run check:invariants            # architectural-invariants-check.ts — see below
npm run check:activation-invariants
npm run check:financial-safety
npm run check:payment-production
```

### Frontend (`apps/frontend/`)

```bash
cd apps/frontend
npm install
npm run dev                  # Vite dev server
npm run build                # runs check:architecture, then vite build, then branding check — build fails if either check fails
npm run check:architecture   # scripts/check-architecture.mjs, standalone
```

No test suite in `apps/frontend/` currently.

## Architecture

### Request flow

`apps/frontend` page → feature hook (`useQuery`/`useMutation`) → feature API wrapper (`src/features/*/api`) → Axios client (`src/lib/api-client.ts`) → `apps/backend/app/api/*` route → service (`lib/services/` or `src/services/`) → Prisma → Postgres.

Query cache keys are centralized in `apps/frontend/src/lib/queryKeys.ts`; mutations invalidate by key, and the UI updates from cache rather than manual refetches.

### `apps/backend/` internals

- `app/api/` — route handlers, kept thin; business logic belongs in a service, not the route.
- `lib/services/` — older/legacy domain services. `src/services/` — newer domain services, including payments internals (`src/services/payments/`). **Both trees are live** — check imports before assuming one is dead code.
- `src/repositories/` — narrower DB-access wrappers used by some domains.
- `prisma/schema.prisma` — source of truth for models/enums. `prisma/migrations_manual/` holds additional raw SQL not expressed as Prisma migrations.
- `lib/billing/engine.ts` — late-fee calculation (flat/per-day/percentage, grace days, cap).
- `lib/auth*` — JWT + httpOnly refresh-cookie auth; `lib/auth-edge.ts` is the edge-safe variant used by `middleware.ts`.

### `apps/frontend/` internals

- `src/app/router` — combines public/owner/tenant/admin route trees; routes lazy-load provider shells (`OwnerProviderShell`, `TenantProviderShell`) so public pages don't pay for dashboard bootstrap cost.
- `src/platforms/owner`, `src/platforms/tenant` — protected route trees per role.
- `src/app/components/views` — owner-facing screens.
- `src/features/*/api` — per-feature API wrappers; this is the *only* layer allowed to know endpoint shapes for a feature.
- `src/portal/` — **frozen legacy tenant portal code.** New tenant-portal work goes in `src/platforms/tenant` or `src/domains`, not here. The allowlist of files still permitted to live under `src/portal` is enforced by `scripts/check-architecture.mjs` and fails the build if violated.
- `src/shared/` — must not import from `app/platforms/portal/features/domains/services` (enforced by the same script) — keep it a leaf.

### Enforced architectural boundaries

Both apps have scripted invariant checks that run in CI/build and will hard-fail:

- `apps/frontend/scripts/check-architecture.mjs`: no raw `fetch()`/`axios` in `app/`, `platforms/`, `shared/ui`, `features/`, `portal/`, or `context/` — everything must go through `@lib/api-client`; `src/portal` is frozen (allowlist-based).
- `apps/backend/scripts/architectural-invariants-check.ts`: e.g. operational backend code must not treat `hostelId` as optional, must not fall back to "first hostel" (`hostels[0]`), and dashboard cache invalidation must go through the one blessed helper — these exist because past bugs picked the wrong hostel silently for multi-hostel owners.

When adding code to areas these scripts cover, run the relevant check script rather than relying on manual review.

### Domain model (see `docs/glossary.md` for full list)

- **Obligation** (`rent_obligations`) is the source of truth for money owed — never derive "amount due" independently in the frontend. Obligations are effectively immutable/audit-first: there is no obligation-edit endpoint; "editing" is done by creating a replacement obligation and cancelling the original.
- **Payments** reduce obligations via allocation logic (FIFO); **Settlement** happens at move-out.
- Money is stored as integer paise wherever payment precision matters.
- Multiple surfaces (owner dashboard, tenant portal) historically reimplemented "outstanding/overdue/future-credit" calculations independently and drifted out of sync with each other. The fix pattern is a **read model that composes existing services rather than recalculating** — see `apps/backend/src/services/payments/financial-read-model-service.ts`, which composes `financialService.getTenantDues()` + `tenantFinancialLedgerService.getBalance()`. Follow this pattern (compose, don't reimplement) for any new financial-summary surface. Background: `docs/business-logic/financial-consistency-investigation-report.md`.
- Many database statuses are plain strings, not Prisma enums — don't assume a status column's possible values without checking the service that writes it.

### Auth/session model

**Supabase Auth is the sole authentication provider (ADR-030… see `docs/obsidian/Decisions.md` ADR-031 for the full migration record).** Email/password and Google both mint real Supabase sessions; `/api/auth/login` stays backend-mediated (rate limiting, tenant-status gates, and just-in-time Supabase-identity linking all happen there — the frontend never calls `supabase.auth.signInWithPassword()` directly). Google sign-in is Owner/Admin-only and never auto-provisions an account (matches an existing `profiles` row by email; rejects otherwise — see `tests/auth-hardening-security.test.ts`).

- Access token: a real Supabase-issued JWT (ES256, verified via `middleware.ts` against Supabase's JWKS endpoint — no shared secret, no per-request network call). Session persistence/refresh is owned by the Supabase client SDK (`apps/frontend/src/lib/supabaseClient.ts`), not custom logic.
- `profiles.auth_user_id` links a profile to its `auth.users` row; nullable — accounts are linked just-in-time on next successful password login (`lib/auth/supabase-identity.ts`), not backfilled by a forced reset. `npm run reconcile:supabase-identities` (dry-run by default) reports linkage state.
- Idle timeout 30 min (Redis-enforced in `middleware.ts` for Supabase-mode requests); absolute session cap 30 days for both owner and tenant (configured in the Supabase dashboard's session settings, not app code). Immediate session revocation (e.g. logout, password reset) is enforced via a Redis deny-list, since Supabase's own access tokens are stateless — this is intentionally *stronger* than Supabase's default, not a gap.
- `JWT_SECRET`/`jose` remain in use for things unrelated to the login session: SSE short-lived tokens, receipt-verification tokens, the 2-minute `identity_tokens` step-up-confirmation flow (6 financially-sensitive owner routes), and password-reset tokens.
- A `middleware.ts`-injected `x-auth-mode: supabase|legacy` header lets `getSession()` (`lib/auth.ts`) dual-accept during the migration's transition window — this can be removed once no legacy-issued token can still be valid (they expire after 12h from issuance).

### External providers

Razorpay (checkout + webhooks, `src/services/payments/providers/razorpay.ts` — the only payment provider actually implemented; treat any "PhonePe" reference elsewhere in this repo's docs as stale), Resend (email), ImageKit (photos/documents), WhatsApp Cloud API (OTP + reminders + a bot with DUES/PAY commands — see `lib/services/notifications/whatsapp-webhook-event-service.ts`), Upstash Redis (optional read acceleration/rate limiting/queue primitives — Postgres via Prisma remains the source of truth; Redis failures fall back to direct DB reads, never block correctness).

## Where to look before making changes

Two documentation layers exist. Use both, in this order:

1. **`docs/obsidian/` — read this first, every time.** An Obsidian-compatible knowledge vault (wiki-linked markdown), built by directly reading the live code (routes, services, `prisma/schema.prisma`, the full `apps/frontend/src` tree) rather than summarized secondhand. It is the **most current reference** for architecture, backend/frontend structure, exact schema shape, the full API surface, and business rules as actually implemented — in several places it is more current than `docs/` (see the explicit discrepancy lists inside `docs/obsidian/Database.md` and `docs/obsidian/APIs.md`). **Before starting any non-trivial task in this repo, open `docs/obsidian/README.md` and use its Quick Reference table** to find the specific page(s) to read for the area you're touching — it is almost always faster than exploring the codebase cold, and it surfaces known gotchas (frozen directories, invariant checks, near-duplicate services, decommissioned subsystems) that are easy to miss by reading code alone. Pages also flag things marked "Unknown / needs clarification" — treat those as open questions to resolve, not settled facts.
2. **`docs/` — the curated rebuild map.** Still useful for narrative/onboarding context and for areas `docs/obsidian/` hasn't covered in depth (module walkthroughs, build guides, deep business-logic investigation reports). Expected to be updated in the same change as any feature/API/schema/business-rule/env-var/UI-pattern change (see `docs/README.md`'s documentation rule). Check the relevant file under `docs/modules/`, `docs/business-logic/`, or `docs/data-models/` for large changes.

If the two layers disagree, trust `docs/obsidian/` for current code shape and treat the `docs/` page as due for a refresh.

## Documentation Rules

`docs/obsidian/` (start at `docs/obsidian/README.md`) is the living, day-to-day knowledge base for this system — read it before working (see above), and **update it after working, every time, in the same change, not as a follow-up**.

Whenever Claude does any of the following, it **must** update the relevant file(s) under `docs/obsidian/` in the same change:

- Implements a feature → update [[Features]] (`docs/obsidian/Features.md`) and add an entry to [[Changelog]] (`docs/obsidian/Changelog.md`).
- Modifies an API (adds/changes/removes an endpoint) → update [[APIs]] (`docs/obsidian/APIs.md`).
- Changes the database schema → update [[Database]] (`docs/obsidian/Database.md`).
- Changes a business rule → update [[Business-Rules]] (`docs/obsidian/Business-Rules.md`), and add an ADR to [[Decisions]] (`docs/obsidian/Decisions.md`) if the change reflects a deliberate architectural/design choice rather than a pure bugfix.
- Performs significant refactoring → update [[Architecture]], [[Backend]], and/or [[Frontend]] as relevant, plus [[Changelog]].
- Fixes an important bug (the kind that revealed a real design gap, not a typo) → add an entry to [[Bugs]] (`docs/obsidian/Bugs.md`) and [[Changelog]].
- Resolves something a vault page had flagged "Unknown / needs clarification" → remove or update that flag on the page where it was raised (don't leave a stale open question once you know the answer).

Rules for keeping the vault useful:

- Use Obsidian wiki links (`[[Page Name]]`) when cross-referencing between files under `docs/obsidian/`, so Obsidian's Graph View stays connected. Every new or edited note should link to at least one related note.
- Don't invent or guess when updating a vault page. If something can't be verified from the code you're changing, mark it "Unknown / needs clarification" rather than asserting it — this vault's value comes from being trustworthy, not complete.
- This layer does not replace `docs/` — `docs/obsidian/` is the read-first/changelog/decision-log/bug-tracker layer; `docs/` remains useful for narrative and deep-dive context. Update both when a change touches both (e.g. a schema change updates `docs/data-models/schema.md` **and** `docs/obsidian/Database.md`).
- Documentation must never go stale: if a change in one of the categories above ships without a corresponding `docs/obsidian/` update, treat that as incomplete work, not optional follow-up.
