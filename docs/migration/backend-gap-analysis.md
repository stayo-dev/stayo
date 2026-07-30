# StayO Backend Gap Analysis

Version: 2.0 — rewritten from live code inspection
Status: Active
Last Updated: July 2026
Supersedes: v1.0 of this document, which was written from assumptions before the codebase was inspected (see "What changed from v1.0" below).

---

# Purpose

This document evaluates the **actual** Shri Adithya backend (`apps/backend/`, Next.js 14 App Router + Prisma + Postgres/Supabase — not FastAPI, not Supabase Auth) to determine its suitability for StayO. Every claim below was verified by reading route handlers, service files, validators, and `prisma/schema.prisma` directly — not inferred from module names or assumed from a typical SaaS backend's shape.

No code was modified to produce this document.

---

# What changed from v1.0

The previous version of this document was a template filled in with plausible-sounding assumptions rather than verified findings. The two most consequential errors, now corrected:

1. **Complaints was classified "✅ Reuse"** with "Current Features: Create, Update, Resolve, History." **This is false.** There is a bare `complaints` Prisma table with zero API routes, zero service file, and zero write path anywhere in the backend. The only code that touches it is two read-only dashboard aggregate queries (a count for a briefing engine, an average-resolution-time stat). A tenant cannot file a complaint through this backend today. Corrected classification: **❌ Replace (build new)**.
2. **Food was classified "⚠ Extend"** with "Current Features: Schedules, Menus, Meal records." **This is false.** A repo-wide search (routes, services, Prisma schema) found zero food/meal/menu tables, endpoints, or services. The only "food" hits are unrelated: a static marketing-copy block on the landing page, an expense-category label, and a single star-rating field on a move-out feedback form. Corrected classification: **❌ Replace (build new)**.

Two more corrections worth flagging up front, both affecting the API Mapping document (`docs/architecture/api-mapping.md`) as well:
3. **PhonePe is not implemented.** CLAUDE.md and the root README both describe PhonePe as the live hosted-checkout provider. In the actual code, only **Razorpay** is wired up (`PaymentProviderFactory` throws `Unsupported payment provider` for anything else); PhonePe appears only as a UI label for manually-recorded offline payments and as forward-looking design comments. The provider adapter pattern (`PaymentProvider` base class) is written to make adding a second provider straightforward, but it doesn't exist today.
4. **The backend already went through one "single-business migration."** It used to be multi-tenant SaaS infrastructure (owners subscribing to a plan, buying WhatsApp-message addons, etc.). That commercial layer — `/billing/*`, `/addons/*`, `/subscription`, `/plans`, `/usage`, plus 13 of 24 `/admin/*` routes (`activation-analytics`, all of `/admin/settlements/*`) — has been intentionally decommissioned to `410 Gone` stubs, per explicit code comments ("removed in single-business migration... do not add this route back to vercel.json without a new design"). If StayO's pricing model (see `docs/product/pricing.md` — annual platform fee + per-active-tenant) needs a subscription/billing engine, **none of that exists live today**; it would be new work, not reactivation of dormant code.

---

# Classification legend

| Symbol | Meaning |
|---|---|
| ✅ Reuse | Implementation satisfies StayO's need as-is. Frontend-only work. |
| ⚠ Extend | Solid foundation exists; needs additive endpoints/fields, not a rewrite. |
| 🔄 Refactor | Logic is right but has a structural issue (dead code path, inconsistent pattern, security gap) worth fixing during the rebuild. |
| ❌ Replace | No usable implementation exists. New backend work required. |

---

# Backend Overview (verified)

| | |
|---|---|
| Framework | Next.js 14, App Router (`apps/backend/app/api/**/route.ts`, 305 route files) |
| Language | TypeScript |
| Database | Postgres via Supabase, accessed through Prisma ORM |
| Auth | Custom — JWT access token (12h) + httpOnly refresh cookie, `jose` for Edge-compatible verification in `middleware.ts`. Supabase's own Auth product is used only incidentally (service-role admin API for owner-account password sync), not as the session system. |
| File storage | ImageKit (photos, documents, agreement signatures, logos) |
| Payments | Razorpay only (see correction #3 above) |
| Messaging | WhatsApp Cloud API (Meta) — OTP, tenant reminders, a full two-way bot for both tenants and owners; Resend for email, used as a fallback channel |
| Caching | Upstash Redis — optional, gated by env flag, used for dashboard caching, rate limiting, one-time locks; falls back to direct DB reads if unset |
| Role model | Prisma `enum Role { OWNER; TENANT }` — **there is no ADMIN value in the schema.** Multiple routes gate on `role === "ADMIN"` (finance-ops, events, some dashboard routes) but no code path anywhere assigns that string to a real profile, so those checks are currently unreachable by any real login. This matters directly for StayO's "Super Admin" persona (`docs/product/personas.md`) — the role needs to be added to the schema and an issuance path built, not just "reused." |

---

# Module Analysis

## Authentication

**Purpose**: Owner and tenant login, session lifecycle, password reset, phone OTP.

**Current status**: Exists, extensively — 19 endpoints across login, refresh, logout, password reset/change, phone OTP (WhatsApp-delivered), Google OAuth (owner-only), step-up "identity confirmation" tokens for sensitive financial actions, and SSE session tokens.

**Verified business rules**: 12h access token / 30-day refresh (owner refresh has an absolute 30-day cap regardless of rotation); 30-minute inactivity timeout; session-reuse detection that revokes every session for a user if a used refresh token is replayed; Redis-primary/DB-fallback rate limiting (10 attempts/15min login, 5/15min OTP send); bcrypt password hashing with automatic legacy-plaintext migration on first successful login.

**Verified gaps/issues** (🔄 Refactor candidates, not blockers):
- The refresh-token-reuse-detection logic exists in `session-lifecycle-service.ts` but the live `/api/auth/refresh` route doesn't call it — it manually re-validates the same token without rotating it. The security feature is written but not wired in.
- `token_blacklist` table is written by a service method that the live logout route doesn't call — looks like dead code from an earlier logout design.
- Dev-mode OTP bypass writes the OTP to a local file (`latest-otp.txt`) for phone-number test prefixes — needs stripping before any production cutover under the new brand (this file is already gitignored per the earlier repo reorg in this project).

**StayO pages this serves**: Login, Owner Registration/Onboarding step 1, Forgot/Reset Password, Activation flow, session persistence for every authenticated screen.

**Classification: ✅ Reuse.** The session model, rate limiting, and password flows are production-grade and directly reusable. The two dead-code items above are worth cleaning up during the rebuild but don't block frontend work.

---

## Owners

**Purpose**: Owner profile, hostel-portfolio management, onboarding, WhatsApp account linking, activity feed.

**Current status**: Exists. ~25 endpoints under `/owner/*` and `/owners/*`. Owner registration itself (`/auth/register`) is gated behind an *existing* owner session or a bootstrap env flag — it is **not** currently a public self-service signup form. StayO's roadmap explicitly lists "Manual Owner Approval" for V1 (`docs/product/roadmap.md`), which is actually a reasonable fit for this constraint rather than a gap — but it means a true self-service "Register your hostel" flow is not something the current backend supports out of the box.

**Verified business rules**: hostel creation blocked on case-insensitive duplicate names; a legacy single-hostel-implicit-resolution helper (`resolveLegacyHostelId`) correctly refuses to guess when an owner has more than one hostel; agreement-template publish/versioning runs in a transaction with automatic archiving of prior versions.

**Verified gaps/issues**:
- `owner/activity-logs` uses a `findFirst`-across-all-hostels "pick one" fallback when no `hostelId` is given — this is exactly the anti-pattern CLAUDE.md's architectural-invariant checker is designed to catch, but this route sits outside the checker's scanned directories, so it slipped through. Worth fixing during the rebuild, not blocking.
- `owner/integrity` has no explicit auth check in the route body (relies solely on middleware) — low risk since middleware does gate it, but inconsistent with every other route's explicit role check.
- 4 sub-routes under `owner/finance/*` and 3 under `owner/me/*` (`activation`, `subscription`, `usage`) are decommissioned SaaS-billing tombstones (see "single-business migration" above) — not owner-profile functionality, just dead paths in this namespace.

**StayO pages this serves**: Owner Registration/Onboarding (all 12 steps per the "Stayo Homepage Design" prototype), Owner Dashboard shell, Settings → Profile/Hostel Identity, WhatsApp connection settings.

**Classification: ✅ Reuse**, with **⚠ Extend** needed specifically for a genuine self-service registration flow if StayO V1 wants one (current path assumes manual/admin-mediated onboarding, which — per the roadmap's own "Manual Owner Approval" line — may be intentional for V1 anyway).

---

## Hostels

**Purpose**: Hostel record CRUD, and — the bulk of this module's real surface — a large hostel-scoped **policy/configuration engine** (billing rules, reminder schedules, receipt formatting, security/data-retention settings, system locale).

**Current status**: Exists, thoroughly. Base CRUD plus 12 policy-config sub-routes, all merging into one versioned JSON `preferences_config` blob on the `hostels` row rather than a separate settings table.

**Verified business rules**: archived hostels reject all edits except restore; **a hostel cannot be archived while it has active tenant allocations** (hard block); every policy patch is versioned (`policy_version`) and logged.

**Verified gaps/issues**: most of the 12 policy-config routes skip the explicit `["OWNER","ADMIN"]` role check that the base CRUD routes have — they rely entirely on `resolveOwnerScope` throwing for non-owners, which means **ADMIN cannot use any of the config-patch endpoints today**, only OWNER can. Inconsistent, worth normalizing in the rebuild if StayO's Super Admin needs to touch hostel config.

**StayO pages this serves**: Settings (Hostel Identity, Billing Configuration, Notification Preferences, Receipt Settings, Security), Owner Onboarding "hostel setup" steps.

**Classification: ✅ Reuse.** This is one of the most mature, well-tested parts of the backend.

---

## Floors

**Purpose**: Floor records within a hostel, used to group rooms.

**Current status**: Exists, small and clean — 2 route files, 4 endpoints total.

**Verified business rules**: a floor with active rooms cannot be deleted; the floor list query does hostel-ownership verification inside the same parameterized raw-SQL call that computes room/occupancy counts, avoiding an extra round-trip.

**StayO pages this serves**: Rooms management screen (floor grouping/filter).

**Classification: ✅ Reuse.** No issues found.

---

## Rooms (incl. Allocations)

**Purpose**: Room CRUD, and the tenant↔room assignment engine (allocate, end, atomically shift/transfer).

**Current status**: Exists, and this is the one module directly covered by CLAUDE.md's architectural-invariant checker (`app/api/rooms` is in its scanned roots) — meaning the "no optional hostelId, no first-hostel fallback" rule is actually enforced by CI here, not just aspirational.

**Verified business rules**: hard capacity ceiling of 20 beds/room; capacity cannot be set below current occupied+reserved count; a room can't be deleted while it has active allocations or active invitation reservations; **room shift/transfer validates the target room's capacity *before* closing the old allocation**, specifically so a failed transfer never leaves a tenant "roomless" and never transiently frees capacity for a race condition to grab; allocations denormalize a `hostel_id` snapshot at creation time so a tenant's hostel-of-record updates correctly even on a cross-hostel transfer.

**Verified gaps/issues**: the flat (non-grouped) `GET /rooms` response has several duplicated/aliased fields (`room_no`/`room_number`, `base_rent`/`monthly_rent`/`rent`) — cosmetic API cleanup worth doing since the frontend is being rebuilt anyway, not a backend risk.

**StayO pages this serves**: Rooms management, room detail/assign/transfer modals, tenant-facing "my room" view.

**Classification: ✅ Reuse.** This is the most rigorously-guarded module in the backend (capacity math, atomic transfers, invariant-checked). Build the StayO rooms UI directly against these endpoints.

---

## Tenants

**Purpose**: The largest module in the backend — tenant CRUD, the full invite→activate→active lifecycle, reactivation, transfer, documents, notes, behavior scoring, and a substantial slice of tenant-scoped financial self-service (billing timeline, ledger, frequency change, payment history).

**Current status**: Exists, extensively — 60+ endpoints across `/tenants/*`, `/tenant/*`, `/profile*`, `/profiles/*`, and `/bulk-import/*`.

**Verified business rules** (highlights — see the checklist doc for the full endpoint list):
- Invitation delivery is WhatsApp-first with email fallback; invitations expire, cap at 10 edit-versions, and are blocked from further editing once a payment has been recorded against the tenant.
- Activation runs inside a transaction with row-level locks to prevent two people racing for the same room slot, and is **financially gated** — it can be blocked pending deposit/maintenance payment via dedicated error codes the frontend needs to handle (`DEPOSIT_OUTSTANDING`, `MAINTENANCE_OUTSTANDING`).
- Two independent reactivation paths exist: tenant self-service (rate-limited to one request/24h) and a direct owner override — worth consolidating conceptually in the new frontend even though both stay on the backend.
- Transfer is blocked by any open move-out request, unresolved settlement, or open dispute — cross-checked against three other modules before it's allowed.
- Bulk import is a two-phase validate-then-confirm flow (max 150 rows/file), with duplicate detection, spreadsheet-formula-injection guarding, and idempotent-per-row execution — genuinely production-grade, not a toy CSV importer.
- Certain owner-initiated profile edits don't apply immediately — they can create a pending **change request** the tenant must approve, rather than being written straight through.

**StayO pages this serves**: Tenant list/portfolio, tenant profile, Invite Tenant flow, Bulk Import, tenant financial screens (both owner- and tenant-facing), Activation flow, Move-out/Transfer flows.

**Classification: ✅ Reuse.** This is deep, tested, production logic. The size of this module is the strongest argument in the entire codebase for "rebuild frontend, reuse backend" — reimplementing this lifecycle from scratch would be a multi-week effort StayO doesn't need to take on.

---

## Payments (incl. Billing/Rent/Webhooks)

**Purpose**: The financial core — payment collection, FIFO obligation settlement, late fees, receipts, reconciliation.

**Current status**: Exists and is the most sophisticated part of the backend. A single, unified settlement-allocation engine (`settlement-planner.ts`, explicitly documented in its own header as "THE single source of truth") replaced what the code comments describe as a prior generation of "~6 independent calculators that sometimes disagreed" — this consolidation already happened, StayO inherits the fixed version.

**Verified business rules**:
- **FIFO settlement priority**: Security Deposit → Admission → Maintenance → Rent → Late Fee/Fine → Extra Charges → Other, oldest-due-first within each tier, with chronology validation preventing a later rent month from being paid while an earlier one is outstanding.
- **Paisa-safe arithmetic**: every amount is converted to integer paise before any arithmetic and divided back only at output — note the actual DB columns are `Decimal(10,2)` rupees, so this is an arithmetic discipline applied at calculation time, not a schema-level guarantee.
- **Obligations are immutable by design**: no edit endpoint exists at all. The only mutations are cancel (only if zero payments recorded) and waive (write-off with a ledger correction) — both gated behind a short-lived password re-confirmation token, separate from the session JWT. "Editing" a wrong obligation means cancel-and-recreate.
- A configurable late-fee engine supports flat/per-day/percentage rules, stacked cumulatively, with a cap.
- Three financial invariants are checked on every settlement and roll back the transaction if violated (captured amount = allocations + ledger credit movement; outstanding-before minus allocations = outstanding-after; ledger balance delta matches credit movement) — this is a genuine correctness safety net, not just validation.
- The Razorpay webhook's only auth is HMAC-SHA256 signature verification against the raw request body — deliberately not re-parsed-and-reserialized, to avoid a byte-mismatch false-negative.

**Verified gaps/issues**:
- **PhonePe is not implemented** (see correction #3 above) — if StayO needs PhonePe specifically, this is real backend work, not configuration.
- All platform/SaaS billing (subscriptions, addons, message quotas, overflow billing) is decommissioned — StayO's pricing model (`docs/product/pricing.md`) will need a billing engine built from scratch if it's meant to run through this backend, since the prior one was deliberately removed.
- Two parallel session-lookup helpers (`getSession` vs `authService.getCurrentUser`) are used interchangeably across payment routes — not a bug, but worth standardizing on one during the rebuild for consistency.

**StayO pages this serves**: Billing Dashboard, Record Payment, Payment Link / Quick Collect, Tenant financials (dues, payment history), Settlement at move-out, the Razorpay checkout flow itself.

**Classification: ✅ Reuse for the core settlement/obligation engine** (this is the highest-value reuse in the whole backend). **⚠ Extend/❌ Replace split**: Razorpay checkout is reusable as-is; PhonePe integration and any SaaS-style subscription billing for StayO's own pricing model are new work.

---

## Food

**Purpose (StayO's intended purpose, per `docs/product/roadmap.md`)**: Food polls, food scheduling, menu management.

**Current status**: **Does not exist.** No table, no route, no service, anywhere in the backend. Verified via three independent search passes (route directories, service files, Prisma schema) turning up nothing but incidental, unrelated string matches (marketing copy, an expense-category label, a single satisfaction-survey rating field).

**StayO pages this serves**: Food Dashboard, Food Poll, Food Schedule (all listed in `docs/product/roadmap.md` V1 scope).

**Classification: ❌ Replace (build new).** This is a from-scratch backend module: schema design (menu/schedule/poll/vote tables), API routes, and business logic (vote counting, result aggregation, schedule publishing) all need to be written. Budget this as new backend engineering effort, not a frontend-only task, despite the "reuse backend" mandate — there is nothing to reuse here.

---

## Complaints

**Purpose**: Tenant-raised complaints/maintenance requests, with owner-side tracking and resolution.

**Current status**: **Effectively does not exist.** A `complaints` Prisma table is present (with `tenant_id`, `owner_id`, `hostel_id`, `title`, `description`, `category`, `status`, `priority`, `resolved_at`, `comment` columns — so the schema was clearly designed with intent), but nothing reads or writes individual rows. The only two references in the entire codebase are read-only aggregate queries (a pending-count for the owner's WhatsApp daily briefing, and an average-resolution-time stat for the analytics dashboard). No tenant can create a complaint. No owner can view, update, or resolve one, through any API.

**StayO pages this serves**: Complaint List, Complaint Details, Create Complaint (owner and tenant sides).

**Classification: ❌ Replace (build new).** The table shape is a reasonable starting point (reuse the schema), but the entire API and service layer — create, list, detail, status transitions, notes/timeline — needs to be built. This is real backend work, same caveat as Food.

---

## Reports (→ Dashboard/Analytics)

**Purpose**: Revenue, occupancy, collections, and operational reporting.

**Current status**: Exists, but **not under a `/reports` path** — there is no such route anywhere. The equivalent functionality lives across `/dashboard/*` (13 endpoints — cashflow, funnel, monthly stats, operations, portfolio performance, tenant intelligence, and several near-duplicate "stats"/"summary"/"stats-shell" endpoints the code comments acknowledge are redundant because "frontend calls both"), `/analytics/dashboard`, and `/metrics`.

**Verified business rules**: a genuinely sophisticated two-tier cache (in-process memory + Redis, tag-based invalidation) sits in front of nearly every dashboard query, with TTLs tuned per endpoint (45s for frequently-polled stats, up to 180s for heavier aggregates); a separate daily-snapshot table (`hostel_daily_snapshots`, `owner_dashboard_snapshots`) precomputes numbers beneath that cache layer.

**Verified gaps/issues**: `GET /metrics` has **no authentication check at all** — it publicly exposes webhook/payment/auth counters to anyone who requests it. Worth fixing during the rebuild; not exploitable for financial data, but a real information-disclosure gap.

**StayO pages this serves**: Owner Dashboard (all widgets), any dedicated Reports screen StayO adds.

**Classification: ✅ Reuse**, with the caveat that the endpoint *naming* (`stats`/`summary`/`stats-shell` all doing the same thing) should be cleaned up or consciously picked-from during the rebuild rather than copied 1:1 — and the `/metrics` auth gap should be closed regardless of frontend work.

---

## Notifications

**Purpose**: In-app notifications, reminder delivery (email + WhatsApp), and — the largest hidden asset in this module — a full two-way WhatsApp bot for both tenants (`BAL`, `DUES`, `PAY`, `STATUS`, `HELP`) and owners (17 commands: `SUMMARY`, `COLLECTIONS`, `VACANCIES`, `INSIGHTS`, tenant search, invite flow, and more).

**Current status**: Exists, is production-grade, and is significantly more capable than a typical "notifications" module — this is effectively a second UI surface (conversational, over WhatsApp) that already exists for owners.

**Verified business rules**: webhook and delivery idempotency are both handled properly (event-hash dedup on inbound webhooks; a same-day idempotency key with retry-only-on-failure for outbound reminders); overdue tenants past 3 days automatically also notify a stored guardian contact; automated reminders escalate through configurable tiers and generate late-fee obligations with duplicate-prevention built in.

**StayO pages this serves**: In-app notification bell/list, Settings → Notification Preferences, and — worth explicitly deciding on for StayO — whether the WhatsApp bot commands stay as-is or get a StayO-branded equivalent.

**Classification: ✅ Reuse.** No gaps found in this module.

---

## Admin

**Purpose (as it exists today)**: Financial-operations tooling — payment-attempt inspection, webhook-event auditing, a 7-detector financial reconciliation scanner with a formal issue-tracking state machine.

**Current status**: Of 24 route files under `/admin/*`, **13 are fully decommissioned** (`activation-analytics` and all 11 `settlements/*` routes return `410 Gone` on every HTTP verb, per explicit "single-business migration" comments). Only 9 endpoints are actually live: 6 under `finance-ops/*` (summary, anomalies, attempts, attempts detail, reconciliation runs, webhook events) and 3 under `finance/reconciliation/*` (issues list, issue status transition, run-scan).

**Verified gaps/issues** — this module needs the most care in the rebuild:
- The `finance-ops/*` endpoints gate on `session.role === "ADMIN"` — a role that, per the Backend Overview above, **does not exist in the schema and cannot currently be issued to any real user**. These endpoints are live code but functionally unreachable today.
- The `finance/reconciliation/*` endpoints, despite living under `/api/admin/`, actually gate on `OWNER`, not `ADMIN` — a naming/placement inconsistency (a stale code comment even claims they're "ADMIN-ONLY").
- **None of what StayO's roadmap/personas describe for a Super Admin exists here**: no owner-approval workflow, no cross-account/cross-hostel visibility, no platform-wide user management. What exists under `/admin/*` today is financial-operations tooling for one operator, not a multi-tenant platform-admin console.

**StayO pages this serves**: Nothing directly maps yet — `docs/product/personas.md`'s "Super Admin" (owner approval, platform monitoring, support tools) and the proposed `/admin/*` screens from the earlier legacy-frontend sitemap exercise have no backend counterpart today, live or decommissioned.

**Classification: 🔄 Refactor for what exists** (fix the ADMIN-role plumbing so `finance-ops/*` becomes actually usable — the reconciliation logic itself is solid and worth keeping) **+ ❌ Replace for what StayO actually needs** (owner-approval workflow, platform-wide account/hostel visibility, support tooling — none of this exists and needs to be designed and built). This is the second-largest genuine gap after Food/Complaints, and it's a role/access-control gap as much as a features gap: StayO cannot have a working Super Admin persona until the `Role` enum itself is extended.

---

# Additional modules found beyond the requested 12

The inspection surfaced substantial, production-grade functionality outside the 12 modules named in the brief, worth knowing about even though they weren't explicitly asked for:

- **Agreements, Renewals, Move-out** (`/agreements/*`, `/change-requests/*`, `/move-out/*`, `/tenant/exit`, `/recovery/cases`) — a full lease-lifecycle system: agreement templates with versioned publishing, a renewal-offer/decision workflow, move-out with inspections/settlement/disputes/feedback, and a change-request approval flow for tenant-profile edits. **✅ Reuse** — this is real, tested lifecycle logic StayO would otherwise have to design from scratch.
- **Admissions, Leads, Visit** (`/admissions/*`, `/leads/*`, `/visit/[hostelSlug]`) — a public-facing lead-generation and conversion-funnel system: lead scoring/temperature, room reservation holds with anti-abuse cooldowns, and lead→tenant conversion. This maps directly to StayO's Version 2 roadmap ("Hostel discovery," "Lead management," "Online admission" — `docs/product/roadmap.md`). **✅ Reuse**, and worth reconsidering whether it belongs in V1 rather than V2 given how much of it already works today.

---

# Reuse Summary

| Module | Classification | One-line reason |
|---|---|---|
| Authentication | ✅ Reuse | Production-grade session/OTP/rate-limiting; two small dead-code items to clean up. |
| Owners | ✅ Reuse (⚠ Extend for self-service signup) | Solid; registration assumes manual/admin-mediated onboarding today. |
| Hostels | ✅ Reuse | Mature policy-config engine; minor ADMIN-access inconsistency. |
| Floors | ✅ Reuse | Small, clean, no issues found. |
| Rooms/Allocations | ✅ Reuse | Most rigorously invariant-checked module in the backend. |
| Tenants | ✅ Reuse | Largest, most complete module; deep lifecycle logic worth keeping. |
| Payments/Billing | ✅ Reuse (core) / ❌ Replace (PhonePe, SaaS billing) | Best-engineered module; but PhonePe and platform billing don't exist. |
| Food | ❌ Replace | Confirmed zero backend presence. |
| Complaints | ❌ Replace | Confirmed table-only, zero API/service layer. |
| Reports/Dashboard | ✅ Reuse | Sophisticated caching; one auth gap on `/metrics`, naming cleanup worth doing. |
| Notifications | ✅ Reuse | Production-grade, includes a full WhatsApp bot beyond basic notifications. |
| Admin | 🔄 Refactor + ❌ Replace | Financial-ops tooling exists but is ADMIN-role-broken; Super Admin platform features don't exist at all. |
| *(bonus)* Agreements/Renewals/Move-out | ✅ Reuse | Full lease lifecycle, not asked for but substantial and solid. |
| *(bonus)* Admissions/Leads/Visit | ✅ Reuse | Public lead-gen/conversion funnel, maps to StayO's V2 marketplace ambitions. |

---

# What this means for sequencing frontend work

Roughly in order of "how much backend risk is retired already":

1. **Lowest risk, build first**: Rooms/Floors, Hostels, Tenants, Authentication — deep, tested backend logic, frontend is genuinely the only remaining work.
2. **Low risk with one caveat**: Payments (fine for Razorpay; flag PhonePe as a separate backend workstream if required), Notifications, Dashboard/Reports (flag the `/metrics` auth gap for a backend fix, doesn't block frontend work).
3. **Needs a backend decision before frontend work starts**: Admin/Super Admin (the `Role` enum needs an `ADMIN` value and an issuance path before any Super Admin screen can be wired to real data).
4. **New backend module required, budget accordingly**: Food, Complaints. Frontend work here should either be sequenced after a backend sprint, or built against a mocked API contract first if the frontend needs to move in parallel.

See `docs/migration/api-reuse-checklist.md` for the endpoint-by-endpoint detail behind every classification above.
