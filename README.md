# StayO
<!-- dev deploy test -->

Multi-tenant SaaS for hostel owners — tenant lifecycle, rooms & allocations,
rent generation, online payments (Razorpay), receipts, expenses, and a WhatsApp
bot for tenants — plus a Platform Admin console for the marketplace layer
(owner leads, listings, subscriptions, revenue).

## Repository layout

| Tree | Stack | Role |
|---|---|---|
| `apps/backend/` | Next.js 14 App Router + Prisma + Postgres (Supabase) | **Canonical API.** All business logic lives here. |
| `apps/frontend/` | Vite + React 19 SPA | **Canonical UI.** Owner app, tenant portal, admin console, public marketing site. |
| `migrations/` | Hand-written SQL | Applied via Supabase SQL editor/psql — order matters, see `docs/architecture/data-models/schema.md`. |
| `apps/backend/prisma/migrations/` | Prisma-managed SQL | Schema migrations since the Prisma-managed era began. |
| `docs/` | Markdown | A maintained "rebuild map" — architecture, every module, business rules, schema, known issues. |
| `docs/obsidian/` | Markdown (Obsidian vault) | **Read this first.** The most current architecture/API/schema/business-rule reference — built directly from the live code. Start at `docs/obsidian/README.md`. |
| `scripts/backup/` | Bash | Local/Supabase Storage backup utilities. |
| `.github/workflows/db-backup.yml` | GitHub Actions | Scheduled database backups. |
| `shared/` | — | Reserved for code shared between the two apps (none exists yet — they only talk over HTTP today). |
| `tests/` | Markdown | Standalone test plans/fixtures not owned by one app's own test suite. |

If `docs/obsidian/` and `docs/` ever disagree, trust `docs/obsidian/`.

## Architecture at a glance

```
apps/frontend page
  → feature hook (useQuery / useMutation)
  → feature API wrapper (src/features/*/api)
  → Axios client (src/lib/api-client.ts)
  → apps/backend/app/api/* route handler (thin)
  → service (lib/services/ or src/services/)
  → Prisma
  → Postgres (Supabase)
```

**Auth:** Supabase Auth is the sole authentication provider — email/password
(backend-mediated, for rate-limiting and business-rule gates) and Google
(`supabase.auth.signInWithOAuth`, full-page PKCE redirect). See
`docs/obsidian/Decisions.md` (ADR-031) and `docs/obsidian/Backend.md`'s
Auth/session model section for the full design.

**Money:** `rent_obligations` is the single source of truth for amounts owed
— obligations are audit-first and effectively immutable; "editing" means
creating a replacement and cancelling the original. Payments reduce
obligations via FIFO allocation. Money is stored as integer paise wherever
precision matters. See `docs/obsidian/Business-Rules.md`.

**Owner acquisition:** a public lead-capture flow (Google sign-in + phone
OTP) creates a lead → an admin approves it → a single-use activation link is
sent (WhatsApp, email fallback) → the owner completes the real onboarding
wizard, prefilled from the lead → the lead's status auto-advances as real
signup/hostel-creation events happen. See `docs/obsidian/Decisions.md`
(ADR-032).

## Documentation

1. **`docs/obsidian/`** — read this first, every time. Use its `README.md`
   Quick Reference table to jump straight to the page for whatever area
   you're touching. It surfaces gotchas (frozen directories, invariant
   checks, near-duplicate services) that are easy to miss reading code cold.
2. **`docs/`** — narrative/onboarding context and deep-dive investigation
   reports the vault hasn't covered yet: `docs/architecture/`, `docs/product/`,
   `docs/ui/`, `docs/build-guide/`, `docs/operations/`.

`CLAUDE.md` has the full set of repo conventions (architectural invariants,
enforced boundaries, where business logic is allowed to live) if you're
working with an AI coding agent on this repo.

## Running locally

### Prerequisites

- Node.js ≥ 20
- A Supabase project (URL, anon key, service-role key, direct + pooled connection strings) with Supabase Auth's Google provider configured
- A Resend account for transactional email (degrades to a console-logged simulation without `RESEND_API_KEY`)
- WhatsApp Cloud API credentials (optional — OTP/notifications fall back to a demo mode that logs the code instead of sending it when unset)
- Razorpay test-mode/live credentials (optional — only required for the hosted checkout provider)

### Environment

```bash
cp .env.example .env                      # root — shared backend env
cp apps/frontend/.env.example apps/frontend/.env
# fill in real values, then:
bash scripts/validate_env.sh              # sanity-check required vars
```

### Backend (`apps/backend/`)

```bash
cd apps/backend
npm install
npm run prisma:generate
npm run dev                  # :3000
npm test                     # vitest — requires DATABASE_URL_TEST, a separate test DB
```

Apply SQL migrations in order (see `docs/architecture/data-models/schema.md`)
via the Supabase SQL editor, `psql`, or `prisma/migrations/SUPABASE_APPLY_ALL_PENDING.sql`
for a from-scratch environment.

### Frontend (`apps/frontend/`)

```bash
cd apps/frontend
npm install
npm run dev                  # Vite dev server
npm run build                # runs the architecture-boundary check + branding check too
```

## Enforced architectural invariants

Both apps have scripted checks that hard-fail CI/build — see `CLAUDE.md` for
the full list. Highlights:

- `apps/frontend/scripts/check-architecture.mjs` — no raw `fetch()`/`axios`
  outside `@lib/api-client`; the frozen legacy tenant-portal tree
  (`apps/frontend/src/portal/`) is allowlisted file-by-file.
- `apps/backend/scripts/architectural-invariants-check.ts` — `hostelId` must
  never be treated as optional in operational code; no "first hostel"
  (`hostels[0]`) fallback for multi-hostel owners; settled payments are
  immutable.

## Deployment

- Backend: Vercel, deployed from `apps/backend/` (`apps/backend/vercel.json`).
- Frontend: Vercel, deployed from `apps/frontend/` (`apps/frontend/vercel.json`).
- Database: Supabase Postgres. Backups: `.github/workflows/db-backup.yml`.

## License

Proprietary. All rights reserved.
