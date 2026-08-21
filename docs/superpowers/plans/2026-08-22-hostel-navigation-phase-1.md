# Hostel navigation, Phase 1 — one-tap directions without a Maps API

**Date:** 2026-08-22 · **Status:** planned
**Goal:** a student standing in a dense hostel cluster taps one button and Google
Maps navigates them to the *correct gate*. No Google Maps API, no billing, no key.
A manually collected **Place ID** is the single source of truth.

Related: [[Features]] · [[Database]] · [[APIs]] · [[Decisions]]

---

## 1. Audit — what is actually there today (verified, 2026-08-22)

| Claim | Evidence |
|---|---|
| **Greenfield.** No `place_id`, `placeId`, `dir_action` or `maps/dir` anywhere in `apps/backend` or `apps/frontend`. | grep over both trees |
| The only Google Maps reference is a **hardcoded `maps/embed` iframe** for Sri Adithya in `lib/sanity/landingContent.ts`. Legacy landing site, not Discovery. Carries a CID (`0x3bcb…:0xde3e…`), *not* a Place ID — not reusable. | `landingContent.ts:197` |
| **"Getting around" already exists** on the listing and renders `places[]` — name, category, distance — from owner-authored marketing content. | `ListingPage.tsx:949` |
| **The SNIST anchor is already live data.** Sri Adithya's APPROVED revision holds exactly one place: `{name:"SNIST", category:"COLLEGE", distance:"400m"}`. | prod query on `hostel_marketing_revisions` |
| 4 hostels exist; **2 are LIVE + VERIFIED** (Sri Adithya, DEF), 2 are DRAFT + REJECTED. | prod query on `hostels` |
| Approval today is `POST /api/platform-admin/hostels/[id]/approve-listing`, which only flips `verification_status`/`listing_status`. Driven from the admin Listings drawer. | route + `ListingsPage.tsx:106` |
| **Migration convention in actual practice is `migrations/NNN_*.sql`**, applied via the Supabase SQL editor, *plus* a matching field in `schema.prisma`. The last three features (071, 072, 073) all did this. | `git log` on `migrations/` |
| ImageKit upload has a reusable shape: route takes `multipart/form-data`, service validates type/size, uploads sequentially, returns URLs. | `marketing/photos/route.ts`, `marketing-page-service.ts:252` |

**Doc discrepancy found:** `CLAUDE.md` and the vault call `migrations/` "legacy, archived —
Prisma is the single source of truth". Three consecutive shipped features contradict that.
This plan follows **actual practice** (`074_…sql` + `schema.prisma`) and flags the doc for correction.

### The load-bearing audit finding

`hostel_marketing_revisions.content` is **owner-authored and owner-editable** — it is the
payload the owner's marketing editor writes and submits for review. Putting `placeId` there
would hand owners write access to the exact field the user has said only admins may touch.
It also inherits the revision lifecycle: a Place ID would be *withdrawn* along with a draft.

`hostels` already encodes this distinction explicitly. `listing_status` carries a schema
comment saying it is deliberately **not** owner-writable, "so an owner writing it directly
would self-approve past platform verification" (ADR-040). Navigation belongs on the same side
of that line.

**→ `navigation` is a column on `hostels`, written only by `/api/platform-admin/*`.**

---

## 2. Decisions

- **D1 — Storage: one `hostels.navigation jsonb` column,** Zod-validated on the way in *and*
  on the way out. Matches the spec's literal "navigation object", matches this schema's
  existing hostel-level blobs (`house_rules`, `preferences_config`, `admission_photos`), and
  matches `marketing-content.ts`'s stated pattern — "a checked payload rather than free-form
  JSON". Read-path validation means a row written under a future shape degrades to
  "no navigation" rather than 500ing a public listing.
- **D2 — Admin-only, enforced server-side.** No owner route reads or writes it. The owner
  marketing editor gains nothing and is not told it exists.
- **D3 — `distanceFromReference` is admin-entered** (user's call, this session). The owner's
  `places[]` SNIST row stays where it is and keeps rendering; the navigation block's distance
  is a separate, admin-owned number so the whole block is trustworthy end to end. Free text
  ("400m", "5 min walk"), because that is how the existing `places.distance` already reads and
  a `numeric` metres column would invite a precision nobody measured.
- **D4 — The Maps URL is never stored.** Built on the frontend from `placeId` at render time,
  per the spec. A stored URL is a second source of truth that goes stale silently.
- **D5 — Approval warns, it does not block.** Two hostels are already LIVE with no Place ID; a
  hard server-side gate would make them unfixable through the normal flow and would fail an
  admin mid-approval with no way forward. The drawer shows a prominent "No Place ID — students
  will not get directions" warning, and the Listings card shows a marker. Revisit once every
  live hostel has one.
- **D6 — Entrance photo is uploaded through ImageKit**, reusing the existing route/service
  shape, on an admin-only endpoint. Not a pasted URL: the point is a photo of *this* gate.

## 3. The contract

```ts
// stored in hostels.navigation, and returned to Discovery as `navigation`
{
  placeId: string,                    // "ChIJ…", from Google's Place ID Finder
  landmark: string | null,            // "Opposite SNIST Gate 2"
  entrancePhoto: string | null,       // ImageKit URL
  distanceFromReference: string | null, // "400m"
  referenceName: string               // "SNIST" — defaulted, not hardcoded in the UI
}
```

`referenceName` is in the object rather than a constant so the copy reads "400m from SNIST"
today and does not need a code change the first time Stayo lists near a different campus.

Frontend URL builder (pure, tested):

```
https://www.google.com/maps/dir/?api=1
  &destination=<encodeURIComponent(hostel.name)>
  &destination_place_id=<placeId>
  &dir_action=navigate
```

`destination` carries the hostel *name* rather than the spec's literal `Hostel` — Google
requires the parameter and shows its value in the UI; `destination_place_id` is what actually
resolves the pin.

## 4. Tasks, in order

1. **`migrations/074_hostel_navigation.sql`** — `ALTER TABLE hostels ADD COLUMN IF NOT EXISTS navigation jsonb;` + matching `navigation Json?` in `schema.prisma`. Nullable, no backfill.
2. **`src/services/discovery/hostel-navigation.ts`** (pure) + `.test.ts` — `NavigationSchema`, `parseNavigation()` (never throws, read path), `hasDirections()`. Registered in `vitest.pure.config.ts`'s include allowlist, which is an explicit list — a new test file silently never runs otherwise.
3. **`GET`/`PUT /api/platform-admin/hostels/[id]/navigation`** — ADMIN-only, 403 otherwise.
4. **`POST /api/platform-admin/hostels/[id]/navigation/entrance-photo`** — ADMIN-only ImageKit upload, returns a URL; the drawer holds it in draft state and persists on save.
5. **Projection** — `listing-projection.ts` emits `navigation` (parsed, or `null`) on the public listing payload.
6. **`app/pages/discover/hostelNavigation.ts`** (pure) + `.test.ts` — `directionsUrl()`, encoding, and the "no Place ID → no button" rule.
7. **Listing UI** — "Getting around" gains the navigation block above the existing places list: distance from SNIST, landmark, entrance photo captioned "Look for this entrance", and a prominent **Get Directions** button (`target="_blank"`, `rel="noopener noreferrer"`).
8. **Admin UI** — a Navigation block in the Listings drawer: Place ID, landmark, distance, entrance photo upload, save. Missing-Place-ID warning per D5.
9. **Docs, same change** — [[Database]], [[APIs]], [[Features]], [[Changelog]], and an ADR in [[Decisions]] for D1/D2 (navigation is admin-owned platform data, not owner marketing content).

## 5. Verification

- `npm run test:pure` (backend) and `npm test` (frontend), both including the new files.
- `check:architecture` + production build.
- Live: set a real Place ID on Sri Adithya through the admin drawer, then load `/discover/h/starlink-79ba709b` and confirm the button opens Maps at the right pin.

## 6. Open / not in scope

- **Applying 074 to production.** `.env` points at the live database; the migration is written but **not applied** without explicit go-ahead.
- Phase 2 (360°/entrance video, walking directions from a campus gate, multi-reference distances) is deliberately out.
- Whether approval should eventually *require* a Place ID — see D5.
