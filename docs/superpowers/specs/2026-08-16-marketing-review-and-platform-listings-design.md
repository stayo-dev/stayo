# Marketing Review & Platform-Listed Hostels — Design

**Date:** 2026-08-16
**Status:** Awaiting review
**Extends:** [[Decisions]] ADR-076 (marketing revisions), ADR-080 (the rebuilt console), ADR-081 (lead lifecycle)

## Goal

Two connected pieces of work:

1. **Finish the marketing review loop.** An owner submits their marketing page; the admin must see *everything* they entered — tagline, photos, about, bed tiers, amenities, mess menu, getting-around — preview it exactly as Discovery will render it, flag specific sections that need changing, and approve it onto the Discovery page.

2. **Let Stayo list hostels it doesn't manage.** Coverage is the point: a tenant searching a city should find hostels there whether or not the owner uses Stayo's PMS. An admin authors the marketing page directly. When that owner later joins, the listing is **assigned** to them, carrying its content and history.

## Why these are one piece of work

Both produce the same artifact — an approved `hostel_marketing_revisions` row rendering on Discovery. The only difference is who authored it. Building them separately would mean two authoring paths, two review paths and two previews for one output.

## Decisions taken

| # | Decision | Choice |
|---|---|---|
| 1 | Ownership of unmanaged listings | `hostels.listing_source` + a Stayo Platform owner profile, claimed via one transaction |
| 2 | Enquiries on unclaimed listings | Captured, and they create/update a `platform_leads` row |
| 3 | Preview | A preview endpoint reusing the **live Discovery projection**, rendered by the real `ListingPage` |
| 4 | Admin feedback | Per-section flags, each with its own note |

## 1. Platform-listed hostels

### Schema

```
hostels
  + listing_source  ListingSource  @default(OWNER_MANAGED)   -- OWNER_MANAGED | PLATFORM_LISTED
  + claimed_at      DateTime?
  + claimed_by      String? @db.Uuid

enum ListingSource { OWNER_MANAGED  PLATFORM_LISTED }
```

`owner_id` stays **non-nullable** and points at a dedicated `Stayo Platform` profile until claimed. This is the whole reason for choosing it: `check:invariants` already forbids treating `hostelId` as optional and forbids `hostels[0]` fallbacks, and nullable ownership would force every owner-scoped query in the codebase to learn that a hostel might have nobody. One sentinel profile keeps all of that untouched.

### Claiming

One transaction: `owner_id` → the real profile, `listing_source` → `OWNER_MANAGED`, `claimed_at`/`claimed_by` set. Marketing revisions, photos and rooms all key on `hostel_id`, so they carry over with no data movement at all.

Claiming is reachable two ways, and both land in the same service call:

- From the **lead drawer** — a lead whose `hostel_name` matches a platform listing offers "Assign this listing".
- From the **listing drawer** — "Assign to an owner", searching existing owners.

**Guard:** a hostel already `OWNER_MANAGED` can never be re-assigned by this path. Reassigning a live hostel is a different, much more dangerous operation (it moves tenants, money and obligations) and must not share a code path with claiming an empty listing.

### The honesty problem this creates

Discovery shows **live vacancy computed from real `rooms` rows**. A platform-listed hostel has no rooms — nobody is operating it in Stayo. So:

- Bed tiers on an unclaimed listing are an **advertised claim**, not live inventory.
- The listing must say so plainly (`Availability not confirmed — contact to check`), and must never render a live bed count.
- `buildReviewFlags`' `NO_ROOMS` flag is **expected** on platform listings and must not read as an error; it is suppressed for `PLATFORM_LISTED` and replaced by an explicit "unverified inventory" notice on the review screen.

Getting this wrong means Discovery advertising vacancy nobody can honour — the single worst failure available in this feature.

## 2. Enquiries become leads

A tenant enquiry on a `PLATFORM_LISTED` hostel:

1. Stores the enquiry as normal.
2. Creates — or updates — a `platform_leads` row for that hostel, with `hostel_name`, `city` and a running enquiry count.

This closes a genuinely useful loop with the lead pipeline: real tenant demand becomes the pitch. *"Six people asked about your hostel on Stayo this month"* is a materially stronger opening than a cold call, and it arrives in the same Leads queue that already exists.

On claim, the listing's enquiries transfer to the new owner, and the lead advances to its converted stage.

**Not built:** notifying the hostel out-of-band. Stayo has no verified contact channel for a business that never signed up, and cold-messaging one from a scraped number is a different decision with legal weight. The lead sits in the queue for a human.

## 3. Preview

`GET /api/discover/preview/:revisionId` (admin-only) runs the **same projection function** the live listing uses, over a pending revision rather than the approved one. The console opens the real `ListingPage` in preview mode.

The alternative — a second preview renderer inside the drawer — was rejected: two renderers over one content model drift, and the moment they do, the admin is approving something other than what ships. Same code path is the only version of "preview" that stays true.

The projection must be extracted into a shared function if it is currently inline in the route. That extraction is part of this work, not a follow-up.

## 4. Per-section review flags

```
hostel_marketing_revisions
  + review_flags Json @default("[]")
```

Shape: `[{ section, note, flagged_by, flagged_at }]`, where `section` ∈ `basics | photos | beds | amenities | places | mess`.

- Admin flags sections while reviewing; sending back requires **at least one flag or a note** (a reasonless "no" just produces a resubmission of the same page — ADR-076 already established this and it is reaffirmed here at section granularity).
- The owner's editor highlights exactly the flagged sections.
- Flags persist on the revision, so the history records what was objected to and when.
- Automated `ReviewFlag`s (price drift, sharing-not-in-inventory) stay separate and remain advisory — they never block approval, per ADR-076 point 6.

## 5. The admin review screen

Replaces the current thin Content-review tab. Full-height drawer showing every section of the submitted content:

| Section | Shown as |
|---|---|
| Basics | Name, tagline, about, highlights |
| Photos | Grid, count, click to enlarge |
| Bed tiers | Sharing type, advertised price, deposit, availability claim — **beside real `rooms` inventory** where it exists |
| Amenities | Chips by category |
| Mess | Full 7-day × 4-meal grid, `provided` state |
| Getting around | Place, distance, mode |

Each section carries a flag toggle and note field. Footer: **Preview on Discovery** · **Send back** · **Approve & publish**.

## 6. Admin authoring

Admin creates a platform listing through the **same** `features/hostel-marketing` editor the owner uses, not a parallel form. It writes the same `MarketingContent`, validated by the same `marketing-content.ts` schema.

Creating a platform listing needs a minimal `hostels` row first (name, city, address, `listing_source: PLATFORM_LISTED`, owner = Stayo Platform). An admin-authored revision may be approved directly by its author — there is no second reviewer, and pretending otherwise would be theatre. That self-approval is recorded (`reviewed_by` = the same admin) so the audit trail is honest about it.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/platform-admin/marketing-reviews/[revisionId]` | Full content + inventory + automated flags *(exists, extend)* |
| POST | `.../[revisionId]/reject` | Now accepts `review_flags[]` *(extend)* |
| GET | `/api/discover/preview/[revisionId]` | Preview projection, admin-only *(new)* |
| POST | `/api/platform-admin/platform-listings` | Create a platform-listed hostel *(new)* |
| POST | `/api/platform-admin/hostels/[id]/assign-owner` | Claim/assign *(new)* |
| GET | `/api/platform-admin/platform-listings` | Unclaimed listings + enquiry counts *(new)* |

## Non-goals

- Reassigning an already-owner-managed hostel.
- Scraping or importing hostels in bulk.
- Contacting unmanaged hostels automatically.
- Live vacancy for unclaimed listings — impossible by definition, and the design says so rather than faking it.
- Changing how owners author their own marketing pages.

## Verification

- `apps/backend`: `npm test`, `npm run check:invariants`.
- Tests that matter most:
  - a `PLATFORM_LISTED` hostel never renders a live bed count;
  - claiming moves `owner_id` and `listing_source` atomically and carries revisions;
  - claiming refuses on an `OWNER_MANAGED` hostel;
  - send-back requires at least one flag or note;
  - the preview projection and the live projection produce identical output for the same content.
- `apps/frontend`: `npm test`, `typecheck`, `check:architecture`, `build`.

## Sequencing

1. **Schema** — `listing_source`, `claimed_at/by`, `review_flags`; migration 068.
2. **Projection extraction + preview endpoint.** Nothing else is trustworthy until preview shares the live code path.
3. **Full review screen** with per-section flags, replacing the thin tab.
4. **Platform listing creation** — hostel shell + the shared marketing editor.
5. **Claim/assign flow**, from both the listing and lead drawers.
6. **Enquiry → lead** wiring.
7. **Docs** — ADR for platform listings and the claim model; `Database`, `APIs`, `Features`, `Changelog`.

Steps 1–3 are useful alone: they finish the owner review loop, which is the half that has real users waiting. Steps 4–6 add the unmanaged-listing capability on top.

## Risks

- **Advertising vacancy that does not exist** — the central risk; mitigated by suppressing live counts on unclaimed listings and stating availability is unconfirmed.
- **Claim on the wrong hostel.** Matching a lead to a listing by name is fuzzy; the assign action must show full address and require explicit confirmation, never auto-match.
- **Preview drift** — mitigated by construction (shared projection), and pinned by an equality test.
- **Self-approval of admin-authored listings** is a real weakening of ADR-076's review gate. It is accepted deliberately, recorded in the audit trail, and revisited if a second admin exists (the scoped-access spec would make a `LISTINGS`-scoped reviewer possible).
