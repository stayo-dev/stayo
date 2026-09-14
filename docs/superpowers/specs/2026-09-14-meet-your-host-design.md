# Meet your host — design

**Date:** 2026-09-14 · **Branch:** `feat/meet-your-host` (worktree off `origin/main` 7e02b707) · **ADR:** ADR-200 · **Migration:** 083

## Why

A hostel listing that shows who runs it earns trust in a way that facts about rooms and prices can't. Today the Discover listing names the owner as "Managed by Shiva P." with a letter avatar. There's no photo, no voice and nothing about the person. This feature gives the owner a real presence on their listing. The design treats them with respect, and the owner-side screen should make them proud of how they appear.

Visual reference: Airbnb's "Meet your host". Chosen direction (from mockups): **"In their own words"**, where the owner's bio leads as a signed note.

## Decisions taken with the user

| Question | Decision |
|---|---|
| Moderation | **Live on save, admin can override.** No approval queue. |
| Admin scope | Admin can edit **bio, photo and name**, and hide the bio or photo. |
| Public name | **Full name** (`profiles.name`). This replaces the "first name + last initial" rule for hosts only. Reviewers stay abbreviated. Recorded as ADR-200. |
| Card direction | **B — "In their own words"** |
| Owner surface | **A dedicated "Your host profile" screen** under More, not a section inside Details |

## Respect rules (apply to every surface)

1. **Full name everywhere,** including the button: "Enquire with Shiva Prakash", never "Message Shiva".
2. **The person sits above the price.** The section renders directly below the hostel title block and above "Choose your bed".
3. **No zero stats and no "new host" wording.** A stat that is zero or unknown is left out entirely. A first-year owner reads "On Stayo since September 2026".
4. **Their words, untouched.** The bio renders in full (max 500 chars) with line breaks kept. It is never truncated into a teaser.
5. **Respectful empty state.** With no bio, the quote block is dropped and the card leads with photo and name. It never says "No description yet".

## 1. Public card (Discover listing)

Replaces the "Who runs it" block in `apps/frontend/src/app/pages/discover/ListingPage.tsx`, in the same position: directly under the title/address/vacancy block, above "Choose your bed".

**With a bio:**
- Heading "A note from your host".
- A white card with a large clay opening quote mark. The bio is set in a serif face (Georgia stack) at ~15.5px.
- A divider, then the signature row: photo (56px; verified tick if ID-verified), **full name** (display font, 800), and a subline built from the non-empty parts of: "Owner", "running hostels since {year}", "speaks {languages}".
- Below the card, a quiet stats row with up to 3 items, each shown only when real:
  - **Rating:** `4.8★` over "{n} reviews". Needs ≥ 1 published review.
  - **Residents:** `240+` over "residents". Needs ≥ 5 (see stats rules).
  - **On Stayo:** "Sep 2026" over "on Stayo since".
- An outlined button, **"Enquire with {full name}"**, that navigates to the existing `/discover/h/:slug/enquire` flow, the same target as the sticky Enquire bar.
- A trust note: "Pay and talk through Stayo, so there's a record of everything." It makes no payment-protection claim and names no payment aggregator, per the legal copy rules.

**Without a bio (or bio hidden by admin):** heading "Meet your host". A compact card with photo (60px), full name, and "Owner of {hostel name} · On Stayo since {Month YYYY}". Then the stats row, minus the "on Stayo since" item because the subline already says it. Then the button and the trust note.

**Photo:** `profile_identity.photo_url`, unless `photo_hidden`. The fallback is the existing clay initial disc.

**PLATFORM_LISTED hostels:** unchanged. They show "Listed by Stayo", with no host card, no button and no stats.

## 2. Owner screen — "Your host profile"

New route `/owner/more/host-profile`, reached from a new row in the owner More menu ("Your host profile — how residents meet you").

Top to bottom:
1. Title "Your host profile", then the subtitle "This is how residents meet you on Stayo."
2. **Milestones strip:** three tiles with the same stats as the public card, but they always render. A tile with nothing to show yet gets a gentle placeholder ("Your first review will show here") instead of a zero. This is the pride moment.
3. **Live preview:** the exact public card component, fed from the form state as the owner types.
4. **"Your story":**
   - A prompt chip: "Not sure what to write? Try: why you started your hostel · what you do for residents · where to find you."
   - A textarea with a `n / 500` counter and the helper text "No phone numbers or links — residents reach you through Stayo."
5. **Languages:** multi-select chips from a fixed list, max 6: Telugu, Hindi, English, Tamil, Kannada, Malayalam, Marathi, Urdu, Bengali, Gujarati, Punjabi, Odia.
6. **Running hostels since:** a year picker from 1950 to the current year, optional.
7. The photo is shown with a "Change photo" link to the existing Details screen. Upload is not duplicated here.
8. A Save button. It's sticky when the form is dirty, following the MoreProfilePage pattern.

**Admin hides:** if `bio_hidden` or `photo_hidden` is set, a notice on this screen reads "Stayo has hidden your {bio/photo} from your public listing. Contact support if you think this is a mistake." The owner can still edit. Their edits save but stay hidden until an admin turns the hide off.

## 3. Admin — Owners drawer

A new **"Public host profile"** `DrawerSection` in `apps/frontend/src/platforms/admin/drawer/OwnerDrawerBody.tsx`:
- The same public card component, as a preview.
- An Edit mode with name, bio, languages and running-since fields. The bio passes through the same contact-detail check (admins are not exempt; the rule protects the platform, not the owner).
- Toggles for "Hide bio from public listing" and "Hide photo from public listing".
- Photo: **Replace** (upload) and **Remove**.
- A "Last edited by {name}, {relative time}" line from `updated_by`/`updated_at`.

Every admin write goes through `eventLog.log("OWNER_HOST_PROFILE_ADMIN_EDIT", ownerId, { fields, admin_id })`, following the pattern in `platform-admin/owner-documents/[id]/review/route.ts`.

## 4. Data

### New table `owner_host_profiles` (migration `083_owner_host_profiles.sql`)

```sql
CREATE TABLE IF NOT EXISTS owner_host_profiles (
  profile_id    uuid PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  bio           text CHECK (bio IS NULL OR char_length(bio) <= 500),
  languages     text[] NOT NULL DEFAULT '{}',
  hosting_since smallint CHECK (hosting_since IS NULL OR hosting_since BETWEEN 1950 AND 2100),
  bio_hidden    boolean NOT NULL DEFAULT false,
  photo_hidden  boolean NOT NULL DEFAULT false,
  updated_by    uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz
);
ALTER TABLE owner_host_profiles ENABLE ROW LEVEL SECURITY;  -- no policies: backend-only
```

**Why a new table and not columns on `profile_identity`:** `profile_identity` is read without a `select` in `profile-identity-service.ts`, `property-service.ts`, `owner/me/photo/route.ts` and a backfill script. Declaring a new column on it before migration 083 is applied would make all of those demand a column that doesn't exist. That's the 2026-08-22 `navigation` outage pattern. A new model only affects its own queries.

**RLS:** enabled with no policies, so the table is invisible to `anon`/`authenticated` via PostgREST. The backend connection bypasses RLS. This follows ADR-189's convention for backend-only tables and avoids another open-table finding like the 2026-09-14 pentest's.

**Prisma:** a new `owner_host_profile` model mapped to `owner_host_profiles`, with a `host_profile owner_host_profile?` relation field on `profile`. Relation fields add no scalar columns to `profile`, so `getSession()`'s profile reads are unaffected.

**Missing-table tolerance:** the **public** read (listing) wraps the host-profile lookup in a try/catch that degrades to "no bio, no hides". This mirrors `readNavigationSafely`, so the listing never 500s if the code deploys before 083 is applied. Owner and admin write endpoints return `503 HOST_PROFILE_UNAVAILABLE` in that case.

### Stats (composed, not stored)

In `src/services/host-profile/host-stats.ts`, computed per owner:
- **Reviews:** `hostel_reviews` with `status = 'PUBLISHED'` on hostels where `owner_id = X`, giving a count and an average rating rounded to 1 decimal. This counts reviews across all of the owner's hostels, like Airbnb's host-level stats.
- **Residents welcomed:** `COUNT(DISTINCT profile_id)` from `tenants` on the owner's hostels with `status IN ('ACTIVE','FORMER_TENANT')`. Bulk-imported tenants count; they are real residents.
  - Display rule: < 5 → omitted; 5–9 → exact; ≥ 10 → floored to the nearest 10, with "+".
  - Always labelled "on Stayo". It is never combined with the self-reported `hosting_since` year.
- **On Stayo since:** `profiles.created_at` of the owner.
- **Verified:** the owner has an active `owner_documents` row with `doc_type IN ('AADHAAR','PAN')` and `status = 'VERIFIED'`.

The two stats queries are small aggregates. They're not cached for now. A listing page already fans out to several queries, and these are indexed by `hostel_id`.

## 5. Bio rules (`src/services/host-profile/bio-rules.ts`, pure)

`validateBio(text) → { ok: true, value } | { ok: false, reason }`:
- Trim, collapse runs of 3+ newlines to 2, and treat empty as `null`. Max 500 chars after trim.
- Reject a **phone number**: any run of ≥ 10 digits once spaces, dashes, dots and parentheses between digits are ignored. This includes `+91` forms.
- Reject an **email**: `\S+@\S+\.\S+`.
- Reject a **link**: `https?://`, `www.`, `wa.me`, or a bare domain matching `\b[a-z0-9-]+\.(com|in|net|org|co|me|io|app|link)\b`.
- Each rejection returns a specific reason, shown to the user as "Remove the phone number — residents reach you through Stayo."

The same module supplies `validateLanguages` (subset of the fixed list, max 6, deduped) and `validateHostingSince` (integer from 1950 to the current year, or null).

## 6. API

| Method | Route | Who | Body / result |
|---|---|---|---|
| GET | `/api/owner/me/host-profile` | OWNER | `{ name, photo_url, bio, languages, hosting_since, bio_hidden, photo_hidden, stats, verified }` |
| PUT | `/api/owner/me/host-profile` | OWNER | `{ bio, languages, hosting_since }`. Upserts. 400 `VALIDATION_ERROR` with a reason |
| GET | `/api/platform-admin/owners/[id]/host-profile` | ADMIN | Same as the owner GET, plus `updated_by_name`, `updated_at` |
| PATCH | `/api/platform-admin/owners/[id]/host-profile` | ADMIN | Any of `{ name, bio, languages, hosting_since, bio_hidden, photo_hidden }`. `name` writes `profiles.name` |
| POST / DELETE | `/api/platform-admin/owners/[id]/photo` | ADMIN | Replace/remove `profile_identity.photo_url`. Reuses the upload helper from `owner/me/photo` |

Routes stay thin. Logic lives in `src/services/host-profile/host-profile-service.ts` (`getForOwner`, `updateByOwner`, `getForAdmin`, `updateByAdmin`, `getPublicHost`).

**Listing contract:** in `listing-projection.ts`, `host` becomes:

```ts
host: {
  platform_listed: boolean,
  name: string | null,            // full name now (was hostName(): "Ravi K.")
  photo_url: string | null,       // null when photo_hidden
  bio: string | null,             // null when bio_hidden
  languages: string[],
  hosting_since: number | null,
  verified: boolean,
  listed_since: string | null,    // kept: owner profile created_at
  stats: { review_count: number, rating: number | null, residents: number | null },
}
```

`discoveryService.getListing` and the admin marketing preview route (`platform-admin/marketing-reviews/[revisionId]/preview`) both call `projectListing`. Both pass a `hostProfile` input read through `hostProfileService.getPublicHost(ownerId)`, so the preview renders the same card. `hostName()` stays exported (reviews use the same rule through `reviewerDisplayName`). The host projection just stops calling it.

## 7. Frontend structure

- `src/features/host-profile/api/` — API wrappers (the only layer that knows these endpoints). Query keys go in `src/lib/queryKeys.ts`.
- `src/features/host-profile/model/hostCardModel.ts` — **pure**. Given the `host` payload, it decides the variant (`note` | `compact` | `platform`), the subline parts, which stats render and their labels (residents rounding, the rating's review count), and the button label. Unit-tested.
- `src/features/host-profile/components/HostCard.tsx` — a thin renderer over `hostCardModel`. It's used by the Discover listing, the owner preview and the admin drawer. One renderer means the three can't drift apart, the same reasoning `ListingPage` gives for the admin marketing preview.
- `src/features/host-profile/pages/HostProfilePage.tsx` — the owner screen.
- Admin section in `OwnerDrawerBody.tsx`, using the feature's API wrapper.
- Discover imports `HostCard`. Verify the `check:architecture` import rules allow `app/pages/discover` → `features/host-profile` during planning; `features/hostel-marketing` is already imported there, so the pattern exists.

## 8. Testing

**Backend (vitest):**
- `bio-rules.test.ts` (pure). Phones in all common Indian formats, emails, links and bare domains are rejected. Normal prose with numbers passes ("2 floors, 40 beds, since 2015"). Also covers trimming, newline collapse and the 500-char limit.
- `host-stats.test.ts`. Counts only PUBLISHED reviews and only ACTIVE/FORMER_TENANT distinct residents, and only on the owner's own hostels. Also the residents rounding rule and the verified rule.
- `host-profile-service.test.ts`. The owner can't set the hide flags. An admin hide survives an owner edit. An admin name edit writes `profiles.name`. An event log entry is written on admin edits.
- `listing-projection` tests. Hidden bio/photo never reach the payload, the full name is exposed, PLATFORM_LISTED is unchanged, and a missing table degrades to no bio.

**Frontend (vitest, node-only):** `hostCardModel.test.ts` covers variant selection, respect rules (no zero stats, full-name button, the empty-state wording) and the subline composition.

**Checks:** `npm run check:architecture` (frontend) and `npm run check:invariants` (backend). Both builds must pass.

## 9. Rollout

1. Merge to `dev` via PR.
2. **Apply migration 083 by hand on the canonical prod project** (`qgfyfbdccjnibdhhvnsr`), then verify with `information_schema` plus a real listing request. Never run `prisma migrate deploy`. The code tolerates the table being absent on the public path, so deploy order isn't critical, but owner/admin editing won't work until 083 is applied.
3. Docs in the same change:
   - `docs/obsidian/Features.md`, `APIs.md`, `Database.md`, `Business-Rules.md` (host display rules, bio rules, stats rules)
   - `Decisions.md` (ADR-200: full host name on public listings; live-with-admin-override moderation)
   - `Changelog.md`
   - `docs/data-models/schema.md`

## Out of scope

- Response rate and response time. Not tracked reliably, and never fabricated.
- A pre-publication approval queue for bios.
- Co-hosts / managers.
- Translating the bio.
- Owner-level public profile pages (e.g. `/host/:id` listing all their hostels).
