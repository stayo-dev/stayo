# Scoped Admin Access & Settings — Design

**Date:** 2026-08-16
**Status:** Awaiting review
**Follows:** `2026-08-16-admin-console-rebuild-design.md` (Plan 1 shipped; this is the Settings screen it deferred, plus a new authorization subsystem)

## Goal

Two things the console needs before more people touch it:

1. **A working Settings screen** — the admin's own profile, and the platform's support contact details.
2. **Scoped team access** — invite a teammate by email, choose what they can reach, and have that actually restrict them. A listing reviewer sees hostel listings and nothing else; an accountant gets revenue and settlements.

## The finding that shapes everything

`platform_admins.title` (`OWNER` / `SALES` / `VERIFICATION`) already exists. It is **written on invite, displayed in a list, and never consulted for any authorization decision**. Every one of the **38** admin route files does exactly this:

```ts
if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
```

So today a `VERIFICATION` admin has full access to revenue, settlements and the team panel. This is not a feature to extend — it is a decorative field that reads as a permission system, which is worse than having none, because it invites the assumption that access is already limited.

**Therefore:** this work is an authorization subsystem, not a nav filter.

## Decisions taken

| # | Decision | Choice |
|---|---|---|
| 1 | Scope selection | Presets that pre-fill a scope set, then tick/untick per section before inviting |
| 2 | Granularity | Section-level. Access to a section means full control of it |
| 3 | Existing admins | All become super admins on migration; narrowing is done deliberately afterwards |
| 4 | Self-service profile | Name, phone, photo, email change, password change |

## The permission model

### Scopes

One scope per console section:

```
OVERVIEW  LEADS  OWNERS  KYC  LISTINGS  REVENUE
SETTLEMENTS  SUBSCRIPTIONS  REPORTS  BROADCASTS
```

Plus one that is not a section:

```
TEAM   — invite/edit/revoke admins and edit support details
```

`TEAM` is deliberately separate. Someone with every section scope still cannot grant themselves or anyone else more access unless they hold `TEAM`. Without that split, any scope is one click away from being every scope.

**Settings is not a scope.** Every admin reaches Settings, because it holds their own profile. What they see *inside* it is scoped: the Team tab and Support details require `TEAM`.

### Presets

| Preset | Scopes |
|---|---|
| Super Admin | all, including `TEAM` |
| Listing Reviewer | `LISTINGS`, `KYC` |
| Accountant | `REVENUE`, `SETTLEMENTS`, `SUBSCRIPTIONS` |
| Sales | `LEADS`, `OWNERS` |
| Support | `REPORTS`, `BROADCASTS` |

Presets are a starting point, not a constraint — the invite form shows the resulting checkboxes and lets you adjust before sending. A member's stored state is always the resulting scope list, never the preset name, so editing a preset later never silently re-permissions existing people.

### Schema

```
model platform_admins
  + scopes          String[]  @default([])
  + is_super_admin  Boolean   @default(false)
  + invited_by      String?   @db.Uuid
  + revoked_at      DateTime? @db.Timestamptz(6)

  title  — retained, now purely a display label. Deliberately NOT reused as a
           permission: its three values do not map onto ten sections, and
           overloading it would rebuild the exact confusion this fixes.
```

`is_super_admin` is a separate boolean rather than "has all scopes", so that adding a new section later does not silently widen anyone: a super admin gets it, and nobody else does.

`revoked_at` means access removal is reversible and auditable. Deleting the row would also delete the audit trail of what that person could once reach.

### Enforcement

A single map, one place:

```ts
// lib/auth/admin-scopes.ts
export const ROUTE_SCOPES: Record<string, AdminScope> = {
  '/api/platform-admin/revenue': 'REVENUE',
  '/api/platform-admin/hostels': 'LISTINGS',
  ...
};

export async function requireAdminScope(session, scope: AdminScope): Promise<void>
```

- Resolves the caller's `platform_admins` row by `profile_id`, honouring `revoked_at`.
- Super admin short-circuits to allowed.
- Cached in Redis for 60s keyed by profile id, invalidated on any scope edit — the pattern already used elsewhere in this codebase, with the same rule that a Redis failure falls back to a direct DB read rather than to "allow".
- Throws `FORBIDDEN` exactly as `requireAdmin` does today, so error handling in all 38 routes is unchanged.

**The 38 call sites all change.** Each route's local `requireAdmin(session)` becomes `await requireAdminScope(session, 'X')`.

### The invariant check (this is the safety net)

Missing one route is an open door, and there is no test that would notice. This repo already solves exactly this problem with scripted invariants that hard-fail the build (`apps/backend/scripts/architectural-invariants-check.ts`). So:

**`scripts/admin-scope-coverage-check.ts`** walks every `app/api/platform-admin/**/route.ts` and `app/api/admin/**/route.ts` and fails if a file:

- defines a handler but never calls `requireAdminScope`, **or**
- is absent from `ROUTE_SCOPES`.

Wired into `npm run check:invariants`. A new admin route cannot be merged without declaring its scope. This is the difference between "we updated 38 files carefully" and "the 39th cannot be forgotten."

## Frontend

### Session

New `GET /api/platform-admin/me` → `{ id, name, email, phone, photo_url, title, scopes, is_super_admin }`.

`useAdminScopes()` wraps it. The console does not read scopes from anywhere else, so there is one answer to "what can I do".

### Nav filtering

`buildAdminNav(counts, scopes)` gains a second argument and filters items, then drops any group left empty. It is already a tested pure module, so the filtering rules get tests alongside the existing ones — including the case that matters most: **a group with no reachable items must disappear entirely**, not render as a bare heading.

### Route guards

`<RequireScope scope="REVENUE">` wraps each scoped route. On failure it redirects to the member's first reachable section rather than showing a 403 — for a listing reviewer, `/admin` is not their home, `/admin/listings` is. Landing them on a wall they can never pass would be a bug, not security.

`/admin` itself resolves to the first reachable section when `OVERVIEW` is not held.

### Settings screen

Three tabs:

**My profile** (every admin)
- Name, phone — `PATCH /api/platform-admin/me`.
- Photo — ImageKit, reusing the existing upload path used for owner documents and hostel photos.
- Password — Supabase `updateUser`, requiring the current password first.
- Email — a verification round-trip. Changing the login email re-links the Supabase identity (`profiles.auth_user_id`), so the new address must be confirmed before the old one stops working. **This is the highest-risk item here** and is sequenced last; a half-done email change locks an admin out of their own console.

**Support details** (`TEAM`)
- `supportEmail`, `supportPhone`, `businessAddress` — the existing `platform_settings` key/value row and its existing `PATCH /api/platform-admin/settings` endpoint. No backend work.

**Team** (`TEAM`)
- Admin list with scope chips, invited-by and status.
- Invite: email, name, preset dropdown, resulting checkboxes, send.
- Edit scopes on an existing member; revoke and restore.
- A super admin cannot revoke or de-scope **themselves** — the last-super-admin case leaves the platform with nobody who can grant access, and recovering means a manual database edit. Guarded server-side, not just hidden in the UI.

## Non-goals

- Per-hostel or per-region scoping. Scopes are platform-wide sections.
- View/act splits within a section (decision 2).
- Turning `title` into a permission.
- Any change to owner or tenant authorization.
- Reworking the invite delivery mechanism — it keeps returning a temporary password as it does today.

## Verification

- `apps/backend`: `npm test`, `npm run check:invariants` (now including scope coverage).
- New tests: scope resolution (super admin, exact scope, missing scope, revoked admin), the last-super-admin guard, and preset → scope-set expansion.
- **A route-level test that a scoped admin gets 403 from a section they don't hold** — the whole feature is worthless if this doesn't hold, and it is the one thing a UI review cannot check.
- `apps/frontend`: `npm test` (nav filtering incl. empty-group collapse), `npm run typecheck`, `check:architecture`, `npm run build`.

## Sequencing

1. **Schema + scope resolution + the coverage check script.** Script first, allowed to fail loudly, so the 38-route migration has a finish line it can prove it reached.
2. **Migrate all 38 routes** to `requireAdminScope`. Existing admins are super admins, so behaviour is unchanged and this is safely shippable on its own.
3. **`/me` endpoint, `useAdminScopes`, nav filtering, route guards.**
4. **Settings: My profile (name/phone/photo) + Support details.**
5. **Settings: Team** — list, invite with presets, edit, revoke.
6. **Email + password change**, last, being the riskiest.
7. **Docs** — ADR for the scope model, `Database`, `APIs`, `Features`, `Changelog`.

Steps 1–2 change no behaviour at all and are shippable alone. The console becomes genuinely restrictive at step 3.

## Risks

- **A missed route is a silent hole.** Mitigated by the coverage check, which is the reason it is built first rather than last.
- **Scope caching.** A stale cache means a revoked admin keeps access for up to 60s. Acceptable for section access; the cache is explicitly invalidated on every scope edit and on revoke, so the window only applies if Redis itself is lagging.
- **Locking someone out.** The email-change flow and the last-super-admin guard are both cases where a bug removes an admin's own access. Both are sequenced late and both are guarded server-side.
- **Existing admins keeping full access is intentional**, not an oversight — but it does mean the feature ships doing nothing visible until someone is deliberately narrowed. Worth stating plainly so it does not read as a bug.
