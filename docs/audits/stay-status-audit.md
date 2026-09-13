# Stay Status — pre-build audit

**Date:** 2026-09-14 · **Base:** `origin/main` @ `48c20f41` · **Prod data:** project
`qgfyfbdccjnibdhhvnsr`, read-only aggregate queries (no personal rows read)

**Purpose:** before building the Stay Status system (PRD "Stayo Stay Status System v1.0"),
establish what already exists so we compose instead of rebuild. Design:
[`docs/superpowers/specs/2026-09-14-stay-status-design.md`](../superpowers/specs/2026-09-14-stay-status-design.md).

## Headline

**Stayo has no concept of absence.** A `git grep` of backend, frontend and the vault for leave,
attendance, presence, away, headcount, meal opt-out, housekeeping and roll-call returned only
marketing copy and one move-out reason label ("Going Home" = `PERSONAL_REASONS` in the frozen
`src/portal`). The Stay Status engine is a new subsystem. Everything it needs *around* it
(residents, rooms, capacity, owner scoping, tenant sessions, QR rendering) already exists and
must be reused.

## Live data (production, 2026-09-14)

| Fact | Value | Consequence |
|---|---|---|
| Active hostels | 1 | Pre-launch; no migration or backfill of existing behaviour needed |
| ACTIVE tenants | 2 (both `SELF_SERVE`) | — |
| Rooms | 12 | — |
| `hostels.food_included = true` | 0 | Meal answers must not assume food is served |
| `hostels.timezone` values | `UTC` only | **The column default, never set by provisioning. "Today" must be computed in IST explicitly, never from this column.** |
| `beds` table | does not exist | Beds are `rooms.capacity`; occupancy is `room_allocations` |

## What exists, and what Stay must reuse

### Residents and tenancy
- A `tenants` row is one **tenancy**, not one person. Live = `INVITED|ACTIVE`, at most one per
  profile (partial unique index `tenants_one_live_tenancy_per_profile`).
  - `liveTenancyWhere(profileId)` / `getActiveTenancy(profileId)` in
    `apps/backend/lib/tenancy/active-tenancy.ts` resolve a tenant's own tenancy.
  - Route pattern: `app/api/tenants/me/room/route.ts`.
- **There is no hostel-keyed "active tenants of hostel X" helper.** The de-facto "occupies a bed"
  predicate is inline, twice, in `lib/services/room-capacity-service.ts` (single room ~:51,
  hostel map ~:112): allocation `is_active = true AND end_date IS NULL` and
  `tenant.status = 'ACTIVE'`.
- **`ACTIVE` includes owner-managed tenants who cannot log in.** An invite runs
  `initializeActiveUnacceptedTenancy` (`src/services/tenants/owner-managed-tenancy-service.ts`),
  which sets `ACTIVE + OWNER_MANAGED + PENDING` and creates a real allocation. Such a tenant
  occupies a bed but has no way to report their own stay, so **owner-entered stay updates are a
  core path, not an edge case**.
- A tenant with a **future-dated move-out stays `ACTIVE` with an open allocation** until the
  `move-out-releases` cron closes it. They remain a resident, which is correct.
- **Permanently vacated** = `FORMER_TENANT` plus a closed allocation (`move-out-service.ts`
  `vacate()`, the `move-out-releases` cron, the legacy `/api/tenant/exit`). This is "Checked
  Out", and it already exists.

### Vacancy
- There are **six or more independent vacancy formulas** in the repo (dashboard snapshot,
  stats-shell SQL, `/api/owner/hostels`, admissions, portfolio-performance, search provider,
  browser-side on the hostel overview).
- **`roomCapacityService.getHostelCapacityMap(hostelId)`** is the closest to canonical: it
  returns capacity / occupied / reserved / available per room.
- The Owner Home **"Vacant beds"** tile (`useOwnerDashboard.ts` `fillVacantBeds`) is
  portfolio-wide and reads a daily snapshot, so it can be up to a day old.
- **Stay must not add a seventh formula.**
- Unverified, noted for whoever owns capacity: an unaccepted invite may count as both occupied
  (live allocation) and reserved (PENDING `tenant_invitations`). `roomCapacityService` takes
  `max(reservations, invitations)` as reserved independently of allocations.

### Owner scoping
- Pattern: `resolveOwnerScope(session)` (`lib/auth/resolve-operational-scope.ts:38`), then a
  required `hostelId` (400 `HOSTEL_CONTEXT_REQUIRED`), then
  `requireHostelBelongsToOwner(ownerId, hostelId)` (`lib/security/scoped-query.ts:72`).
- `scripts/architectural-invariants-check.ts` forbids optional `hostelId` and first-hostel
  fallbacks, **but only in the folders it lists**. It does not scan `src/services/**` or unlisted
  `app/api` folders, so new code there is unchecked unless its folders are added.
- `portfolio-service.ts` may not query raw `tenant` tables (invariant rule 8).

### Time
- `lib/timezone.ts` has only `getDayInTimezone` and `formatIST`. No "today's date in IST" helper.
- `istDateOf(instant)` (IST calendar date, `YYYY-MM-DD`) is exported from
  `src/services/settlements/payout-promise.ts:29` and used by the payout read model and a test.
- `hostel-policy-service` resolves timezone via preferences, then `hostels.timezone` (`UTC`),
  then IST, so it can yield `UTC` in production.

### Surfaces
- **Owner Home** composes a client-side `actionCenter` of `StatCard`s in
  `features/owner-dashboard/hooks/useOwnerDashboard.ts` (~:163) from React Query calls, rendered
  by the display-only `OwnerHomeDashboard.tsx`.
- **Tenant Home** (`platforms/tenant/pages/TenantHomePage.tsx`) builds section blocks and lays
  them out **twice** (desktop and mobile branches). A new block must be added to both.
- **Routes:**
  - `/h/<slug>` is **taken** (the share link with a preview card).
  - `/visit/:slug` is admissions lead capture (it also uses "QR" as a lead source).
  - `/discover/h/:slug` is the listing.
  - **`/stay/` is free.**
- **Deep links through login are lost.** `ProtectedTenantRoute.tsx` redirects to `/login` with
  no return path, and the login modal hands a tenant to `/tenant/home` via
  `crossSurfaceHandoff` (`shared/lib/crossSurfaceLogin.ts`). A QR deep link would drop the
  tenant on Home.
- **QR rendering:** the `qrcode` package is already a backend dependency (menu poster, receipt,
  agreement PDFs). `GET /api/admissions/qr-code` fetches from third-party `api.qrserver.com` and
  has no caller. The frontend has no QR library.

### Food (the future meal-forecast consumer)
- There's no headcount, opt-out or diner concept. The only count is an inline `eligibleCount`
  (ACTIVE tenants with a `profile_id`), repeated per poll/publish route.
- Meal slots are the fixed enum BREAKFAST / LUNCH / SNACKS / DINNER, with per-hostel windows in
  `hostels.preferences_config.meal_timings`. There's no dated menu (`serve_date` was never built).
- The kitchen sheet (`/owner/food/kitchen`, today + tomorrow) is the natural future home for a
  "tomorrow: N breakfasts" figure.

### WhatsApp (designed for, shipped in a later slice)
- **What exists:**
  - Interactive reply buttons (≤3) and list messages (≤10 rows) send and receive inside the
    24-hour session window (`providers/whatsapp/meta-provider.ts`, `extractMessageEvents`).
  - The command-center router resolves phone → tenant, with a multi-resident picker.
- **What's missing:**
  - Templates cannot carry per-send quick-reply payloads (`sendTemplate` builds URL buttons
    only), so an evening "Staying tonight?" template can't identify the tenant by payload.
  - Nothing records the last inbound message per phone, so the 24-hour window is unknown.
  - There's no per-tenant opt-out or STOP handling.
  - Vercel Hobby crons run once a day and can land up to 59 minutes late.
  - Several business-initiated templates are still awaiting Meta approval.
- **Conclusion:** WhatsApp is its own slice. The Phase 1 write path must be channel-agnostic so
  that slice only adds a handler.

## What must NOT be rebuilt

1. **Vacancy.** Compose `roomCapacityService`; leave the Home "Vacant beds" tile untouched.
2. **Checked Out.** It is the move-out lifecycle. Stay neither writes to it nor mirrors it.
3. **Tenant identity.** Use `liveTenancyWhere` / `getActiveTenancy`.
4. **Owner scoping.** Use `resolveOwnerScope` → `requireHostelBelongsToOwner`.
5. **QR rendering.** Use the installed `qrcode` package, not the external-API route.
6. **Home composition.** Use the existing `actionCenter` / `StatCard` pattern.

## Unverified

- Whether any production hostel has a timezone set in `preferences_config`. Irrelevant to Stay,
  which never reads it.
- The pending-invite occupied-and-reserved double count, with real data.
- Which WhatsApp templates Meta has actually approved (docs only).
