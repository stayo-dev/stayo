# Stayo Discover — Phase A: discovery surface + enquiry

**Date:** 2026-08-15
**Status:** Approved design, ready for implementation planning
**Source design:** Claude Design project "Stayo SaaS redesign", file `Stayo Discover.dc.html`

---

## 1. Why

`/` asks visitors whether they are a tenant or an owner (ADR-071). The owner
side goes to `/owners`. The tenant side goes nowhere — it renders a
non-navigating "Coming soon" pill, because the hostel-browsing page it would
open has never existed. Half the front door is a dead end.

This phase builds that page: a public place where a student can find a
verified hostel, and enquire to it with a real Stayo account, landing in the
owner's existing lead funnel.

### Scope decomposition

The full prototype spans four subsystems. Only **A** is in scope here.

| | Subsystem | Status |
|---|---|---|
| **A** | Discovery surface + enquiry wiring | **this spec** |
| B | Portable Stayo Account (identity + documents hoisted off `tenants`) | next |
| C | Owner listing content management (amenities, distances, bed tiers) | later |
| D | Reviews & ratings | later |
| E | Owner listing marketing page | explicitly deferred by the user |

Phase A deliberately does **not** make the profile portable. It creates the
account that Phase B will make portable, and avoids retrofitting by linking
enquiries to that account from day one.

---

## 2. What already exists

This phase reuses far more than it builds. Established before designing:

| Capability | Where |
|---|---|
| Listing status lifecycle | `hostels.listing_status` (DRAFT/LIVE/SUSPENDED), `verification_status` (PENDING/VERIFIED/REJECTED), `publish_requested` |
| Admin moderation of listings | `/admin/hostels` — approve / suspend / reactivate |
| Public single-hostel page | `/visit/:hostelSlug`, `admissionsService.getPublicHostel(slug)` |
| Photos | `hostels.admission_photos`, `rooms.admission_photos` (Json) |
| Prospective-tenant lead funnel | `visitor_leads`, `lead_activities`, `room_reservations`, `lead_notes` |
| Owner lead notifications | owner lead funnel, merged to `dev` 2026-08-07 |
| Lead → tenancy hand-off | `POST /api/leads/[id]/convert-to-invitation` |
| Session minting | `authService.createSessionAndTokens()` — the single chokepoint (ADR-031) |

**ADR-040 is a security boundary this phase must respect:** owners write
`publish_requested`; only the Platform Admin console writes `listing_status`
and `verification_status`. Discovery visibility is therefore admin-gated, and
no discovery code may write those columns.

---

## 3. Visibility rule

A hostel appears in discovery when **all** of these hold:

```
listing_status      = LIVE
verification_status = VERIFIED
status              = ACTIVE
admissions_enabled  = true
public_slug         IS NOT NULL
```

This predicate lives in exactly one place — `discovery-service.ts` — and is
exported as a single Prisma `where` fragment reused by search and detail.
Duplicating it is the failure mode that lets a suspended hostel stay reachable
by direct URL after it vanishes from search.

---

## 4. Data honesty

Every element rendered maps to a real column, or it does not ship.

**Rendered from real data**

| UI element | Source |
|---|---|
| Name, city, address | `hostels.name`, `.city`, `.address` |
| Photos | `hostels.admission_photos` |
| Starting price | `min(rooms.base_rent)` where `base_rent > 0`, active rooms |
| Vacancy count | existing allocation/reservation math in `admissionsService` |
| Sharing types | distinct `rooms.capacity` → "2-bed", "4-bed", … |
| Gender / audience | `hostels.hostel_type` (BOYS / GIRLS / CO_LIVING / WORKING_PROS) |
| Meals included | `hostels.food_included` |
| Verified badge | `verification_status = VERIFIED` |
| Bed options on detail | active rooms grouped by `capacity` + `base_rent` |

**Deliberately omitted until Phase C/D**

- Star ratings and review counts — no rating data exists anywhere.
- The amenity grid — not modelled.
- "400 m to Osmania University" distances — there is no lat/lng on any table.
- "Responds in ~1 hour" — not measured.

Card and detail layouts reserve space for these so Phase C slots them in
without a redesign. **Nothing is faked, seeded, or hard-coded to make the page
resemble the prototype.**

### Filters

All backed by real columns, so no facet lies:

- City (facet counts from the result set)
- Price range (against starting price)
- Sharing type (`rooms.capacity`)
- Gender / audience (`hostel_type`)
- Meals included (`food_included`)
- Has vacancy

Free-text search matches `name`, `address`, `city`. There is no geo search and
no college proximity in Phase A; the prototype's "Near Osmania University"
rail becomes "Recently listed in <city>".

---

## 5. Routes

A public `/discover` shell with its own 4-tab bottom nav, matching the design.

| Screen | Route | Auth |
|---|---|---|
| Explore | `/discover` | public |
| Search + filter sheet | `/discover/search` | public |
| Listing detail | `/discover/h/:slug` | public |
| Enquiry form | `/discover/h/:slug/enquire` | public to fill, sign-in to submit |
| Enquiry detail + timeline | `/discover/enquiries/:id` | authed |
| Saved | `/discover/saved` | authed |
| Enquiries | `/discover/enquiries` | authed |
| Profile | `/discover/profile` | authed |

`WelcomePage.tsx`'s tenant panel gains a real link to `/discover`; the
`aria-disabled` pill and "Coming soon" label are removed, and the file's
header comment (lines 12–20), which explicitly anticipates this page, is
updated to describe what now exists.

**Not built in Phase A:** the prototype's Owner Review and Result screens
(they are an in-prototype *demonstration* of the owner's side; real owners act
on leads in the existing admissions/CRM view), the delete-account friction
flow, deposit payment (remains a stub, as in the prototype), Aadhaar KYC.

### Guard

`/discover` does **not** use `ProtectedTenantRoute`. That guard redirects any
profile with `is_profile_completed = false` to `/complete-profile`, which
would trap every seeker, none of whom have completed a tenancy profile. A new
`RequireSeekerSession` guard checks only: authenticated, `role = TENANT`.
Public discovery routes have no guard at all.

---

## 6. The Stayo account

### Shape

A seeker is a `profiles` row with `role = TENANT` and **zero** `tenants` rows.
One account per person, which later gains tenancy rows as they move in — this
is what makes Phase B's portability possible without a second identity type.

Verified as safe: `auth-service.ts:132-148` guards the tenancy lookup with
`if (tenant)` and passes `tenantId = null`, so a tenancy-less TENANT can log
in. (`loginWithPhone()` at line 208 *does* hard-require a tenancy, but it
serves the onboarding activation path only and is not reachable from
discovery.)

### Signup — already built, reused as-is

**Corrected during implementation.** This spec originally proposed a new
`POST /api/auth/seeker-signup` pair using email OTP. That was wrong: the
account already exists.

`POST /api/auth/tenant-signup` → `authService.selfSignUpTenant()` already
creates precisely this account, and its own doc comment describes it as "a
marketplace account (browse/save/enquire), not a tenant of any hostel". It
sets `role = TENANT`, writes no `tenants` row, provisions the Supabase
identity at creation (ADR-031's "born linked"), sets
`is_profile_completed = true`, and rejects a duplicate email or phone with a
clear `ALREADY_EXISTS`. `AuthContext.signUpTenant()` already calls it and
hydrates the session exactly like `login()`.

It verifies by **phone OTP over WhatsApp** (`resolveSignupPhoneVerification`,
the same gate as owner signup), not email OTP. Phase A adopts that rather than
adding an email-OTP path — a second signup route reintroduces exactly the
parallel-session-mechanism problem ADR-031 exists to prevent.

Phase A therefore builds **no signup backend**. It builds the seeker-facing
signup *screen* against the existing endpoint.

### Bug this phase must fix first

`GET /api/auth/me` sets `extra.is_profile_completed` only inside its
`if (tenant)` branch (`route.ts:80-105`). A TENANT with no tenancy — every
seeker — therefore gets `is_profile_completed: undefined` back, even though
their profile row says `true`. Any guard reading that field bounces them on
reload. The TENANT branch must fall back to `profile.is_profile_completed`
when there is no tenancy. Goes in `docs/obsidian/Bugs.md`.

Separately noted, **not** fixed here: the same lookup uses
`findFirst({ where: { profile_id } })` rather than the live-tenancy helper in
`lib/tenancy/active-tenancy.ts`, contrary to the rule in CLAUDE.md. It picks an
arbitrary tenancy for anyone who has stayed in more than one hostel. Real, but
pre-existing and out of Phase A's scope.

### Verification in Phase A

The design's verify screen has three cards: email, Aadhaar KYC, college ID.
In Phase A **only email is real.** Aadhaar and college ID render as clearly
upcoming, are not clickable, and do not gate submission. The owner sees an
"Email verified" badge only.

Aadhaar KYC needs a licensed AUA/KUA integration — a commercial and regulatory
dependency, not a coding task. Showing an unearned "Aadhaar KYC" badge on a
lead would be a false claim to the owner making a decision on it.

### Collision handling

`profiles.email` and `profiles.phone` are both `@unique`. A seeker signing up
with an address already on a profile gets a clear "you already have a Stayo
account — log in" response, never a 500 and never a silent overwrite.

---

## 7. Enquiry lifecycle

An enquiry **is** a `visitor_leads` row. No parallel enquiry table, no
parallel funnel, no parallel notification path.

```
seeker submits enquiry
  → visitor_leads (source = 'DISCOVER', seeker_profile_id set,
                   hostel_id, owner_id, student_name/phone/email)
  → owner's existing lead inbox, scoring and notifications — unchanged
owner approves
  → POST /api/leads/[id]/convert-to-invitation      (already exists)
  → tenant_invitations → /activate → existing tenant onboarding
```

That final hand-off is the point of the phase: discovery feeds the system
already built, and when Phase B lands, the profile arriving at onboarding
already carries its details.

`visitor_leads.source` is a plain string column, so `'DISCOVER'` needs no
migration. Enquiry status shown to the seeker maps from the existing
`visitor_leads.status` values; the seeker-facing timeline (sent → reviewing →
decision) is a presentation of that column, not a new state machine.

---

## 8. Backend

Routes stay thin; logic lives in one new service that **composes existing
services rather than recalculating** — the pattern
`src/services/payments/financial-read-model-service.ts` established.

```
GET    /api/discover/hostels          public  search, filter, facets, paginate
GET    /api/discover/hostels/[slug]   public  detail — wraps getPublicHostel()
POST   /api/discover/enquiries        authed  create visitor_lead
GET    /api/discover/enquiries        authed  my enquiries
GET    /api/discover/saved            authed  saved list
POST   /api/discover/saved            authed  save a hostel
DELETE /api/discover/saved/[hostelId] authed  unsave
POST   /api/auth/seeker-signup/start     public
POST   /api/auth/seeker-signup/complete  public
```

New: `apps/backend/src/services/discovery/discovery-service.ts`.

Detail composes `admissionsService.getPublicHostel(slug)` rather than
re-querying rooms, pricing and vacancy — that function already encodes the
correct availability math (active allocations, active room reservations, and
active invitation reservations), and reimplementing it is how two surfaces
drift apart. Discovery adds the visibility predicate on top, because
`getPublicHostel` today gates only on `status = ACTIVE` and
`admissions_enabled` — it must not become the discovery gate by accident,
since `/visit/:slug` is a direct-link surface with intentionally different
rules.

Public endpoints are rate-limited and cached with the existing Redis
`getOrSetJson` helper, consistent with `getPublicHostel`'s 180s cache.

---

## 9. Frontend

```
src/features/discover/api/        the only layer that knows endpoint shapes
src/features/discover/hooks/      useQuery / useMutation
src/app/pages/discover/           screens
src/app/router/DiscoverRoutes.tsx shell + 4-tab nav
```

Query keys are added to the central `src/lib/queryKeys.ts` under a `discover`
namespace; mutations invalidate by key. All HTTP goes through
`@lib/api-client` — `scripts/check-architecture.mjs` fails the build on raw
`fetch`/`axios` in `app/`, `features/` and `platforms/`. Nothing is added to
`src/portal/`, which is frozen and allowlist-enforced.

Design fidelity: the prototype's palette (`#221E1A`, `#B46A55`, `#F7F3EF`,
`#D9906F`), Manrope/Inter pairing, and card geometry are carried across.
Manrope and Inter are already loaded by `index.html`, so no new font request.

---

## 10. Schema changes

Two additive changes. Both are safe against a live table — one nullable
column, one new table. Written as SQL in `migrations/` per repo convention and
mirrored into `prisma/schema.prisma`.

**1. `visitor_leads.seeker_profile_id`** — nullable uuid, FK → `profiles(id)`,
indexed on `(seeker_profile_id, created_at DESC)`.

Without it, "my enquiries" can only match on phone string, which breaks the
moment someone edits their number, and gives Phase B nothing to attach a
portable profile to. Nullable because every existing row, and every future
QR/walk-in lead, has no seeker account.

**2. `saved_hostels`** — `(id, profile_id, hostel_id, created_at)`, unique on
`(profile_id, hostel_id)`, FKs to both parents.

Saved is an authenticated tab in the design with a count on the profile
screen; localStorage would not survive a device change and would leave Phase B
with nothing to carry across.

---

## 11. Risks, and how each is resolved

| Risk | Resolution |
|---|---|
| TENANT profiles with no tenancy are new to this system | Audit every path that reads a tenancy off a TENANT profile before shipping — starting with `GET /api/auth/me`, `AuthContext`, and the tenant route guards. Two paths were checked during design; that is not proof the set is complete. |
| A seeker's email collides with an existing tenant profile | Explicit "log in instead" response; covered by a test. |
| Suspended hostel still reachable by direct URL | Single shared visibility predicate; a test asserts a SUSPENDED hostel 404s on both search and detail. |
| Discovery accidentally becomes a self-publish path | No discovery code writes `listing_status` / `verification_status`; asserted by test. |
| `getPublicHostel` gets loosened to serve discovery | Discovery layers its predicate on top and never edits the admissions gate; both surfaces keep their own rules. |

### Testing

Backend vitest under `apps/backend/tests/`. Structural migration verification
needs `DATABASE_URL_TEST`; if that is still unprovisioned, the migration will
be reported as **unverified against a live database** rather than claimed as
tested — matching how the Food phase and the onboarding-publish transaction
work were reported.

Run before merge: `npm run check:invariants`, `npm run lint`, `npm test`
(backend); `npm run build`, which runs `check:architecture` (frontend).

### Branch

Feature branch → `dev`. Never `main`. Pull `main` first.

---

## 12. Documentation

Updated in the same change, not as follow-up:

- `docs/obsidian/Features.md` — the Discover surface; correct the WelcomePage
  entry at line 123, which currently documents the tenant side as a dead end.
- `docs/obsidian/APIs.md` — the nine new endpoints.
- `docs/obsidian/Database.md` — `seeker_profile_id`, `saved_hostels`.
- `docs/obsidian/Decisions.md` — an ADR for the discovery visibility rule and
  its relationship to ADR-040's owner/admin boundary.
- `docs/obsidian/Changelog.md` — an entry.
