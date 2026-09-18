# Design: `/` becomes a supply-honest student homepage; the audience gate is retired

- **Date:** 2026-09-17
- **Status:** approved design, not yet implemented
- **Branch:** `feat/public-homepage` (cut from `origin/main` @ `f6ae3e70`)
- **ADR to file on implementation:** ADR-214 (highest on `origin/main` is ADR-213 — re-check at merge time, numbers collide across concurrent branches)

## 1. Context

`/` renders `WelcomePage` — a full-viewport diagonal-seam audience chooser introduced by
[[Decisions#ADR-071|ADR-071]]. It asks "student or owner?" before the visitor has been told
what Stayo is. Five problems, all verified against `origin/main` (the deployed tree), not
against the stale local checkout:

1. **It answers no question before asking one.** A 1.6s splash shows the wordmark and the
   `Manage · Automate · Grow` line, then hard-cuts to two halves. The tagline leaves with the
   splash. First-time visitors report the literal reaction "what is this, and what are these
   two halves?"
2. **Mobile content is clipped and unreachable.** At rest `active` is `null`, so *both* panels
   render expanded (`PANEL_BODY.open` on both, `WelcomePage.tsx:288` and `:359`). Each half
   gets ~45% of a phone viewport for badge + heading + paragraph + two feature chips + a
   button. The overflow is silently cut by the panel's `clip-path`, and the root is
   `fixed inset-0 overflow-hidden` — **the page cannot scroll**, so clipped content has no
   recovery path.
3. **Two-stage commit on a one-stage expectation.** Tapping a panel calls `select()`, which
   only moves the seam; committing needs a second tap on the CTA inside. Desktop hover hides
   this; on touch it reads as "I tapped and nothing happened."
4. **The strongest visual element carries no information.** The seam and the mark riding it are
   the best craft on the page and say nothing about what happens next, while the real
   affordances are two ~14px buttons.
5. **`/` is a dead root for search.** Its entire indexable content is two headings. It sits at
   `priority 0.7` in `sitemap.xml`, whose own comment concedes the root is "thin,
   client-rendered, nothing to rank on." [[Decisions#ADR-071|ADR-071]]'s 2026-08-15 amendment
   flagged this as live and unanswered once Discover shipped. **This spec answers it.**

### The economics that decide the design

Settled in `docs/superpowers/specs/2026-09-10-legal-policies-production-design.md` (commit
`427fff80`): **the owner subscription is Stayo's only revenue.** Stayo takes no share of
transaction fees or TDR on resident rent, and the published terms state so affirmatively.

The naive reading — "owners pay, so the homepage is for owners" — is backwards, for the reason
every one-sided-payment marketplace converges on the same shape (Airbnb, Zomato, Swiggy). The
owner is not buying hostel-management software; that category is crowded and competes on price
per bed. **The owner is buying filled beds** — which is what `/owners`' own hero promises
("Fill empty beds faster"). Student traffic is therefore not a cost the business tolerates; it
is the inventory the subscription buys. Starve the student surface and the subscription
becomes a commodity defended on price.

Owner acquisition is also **sales-led, not root-led**: `LandingPage.tsx:129-137` documents the
real funnel — lead modal → *a human reviews the lead* → admin sends an activation link. Owners
arrive at `/owners` from outbound WhatsApp, demo calls and links the team sends. Optimising `/`
for owners optimises a path owners largely do not take.

So: **students get the default; owners get a permanent, unmissable door.** Asymmetric, not
forked.

### The constraint that shapes everything else

**There are one to two live hostels.** (Confirmed by the user; a production `count(*)` against
the `DISCOVERABLE` predicate was attempted and blocked by the auto-mode classifier, so the
number is not independently verified here.)

At that supply, a search-led hero is actively harmful: a search box is a promise of inventory,
and every student who types a college name spends the one impression proving Stayo is empty.

Inverted, the same moment becomes the most valuable event on the site. A student naming a
campus Stayo does not cover is a **demand signal**, and demand signals are exactly what closes
owners:

> "Fourteen students searched for hostels near your campus last month. None of them found one.
> You have eleven empty beds."

The flywheel: students express demand → demand recruits owners → supply grows → students
convert. **At this stage the student surface's primary job is demand collection, not
transactions**, and the empty marketplace stops being something to hide.

**Stated risk, accepted by the user:** at 1-2 listings the homepage is not the growth
bottleneck — owner acquisition is. This redesign will not manufacture students. What it does is
convert the students who do arrive into owner-acquisition leverage, and put a durable structure
in place that grows with supply rather than needing a second rewrite.

## 2. Decisions

1. **`/` becomes `HomePage` — a scrolling, student-first, supply-honest homepage.** The
   audience gate is retired.
2. **One domain, path-based split. No owner/tenant URL separation.** Separate domains would fund
   two brands from zero and split every ranking signal; audience subdomains (`owners.`) dilute
   authority for a site that has little, and do not answer "what is this?" any better than a nav
   link does. The split that *is* right is **public vs authenticated** (`yourstayo.com` +
   `app.yourstayo.com`), because it buys a blanket `noindex` on the app, a smaller public bundle
   and independent deploy cadence — but it is infra work with no payoff this quarter and it
   collides with the in-flight Clerk migration's cross-subdomain session config. **Deferred to
   v2, explicitly, not rejected.**
3. **The brand spine is a claim about the channel, not about money: _no agents — straight to the
   hostel owner._** An earlier draft of this spec used *"Stayo earns nothing from your rent"*,
   taken from the legal work's settled position that the owner subscription is Stayo's only
   revenue. **That position has changed** (see §11 open question 4): a per-converted-tenant fee of
   roughly ₹100–300, charged to the owner when a Stayo lead becomes an active tenant, is planned
   but not priced. A success fee paid by the owner on a placement is, in substance, the thing a
   reader means by brokerage — so the page must not claim there is none, and must not name a
   price that is not settled. What stays true whatever the pricing lands on is the *channel*:
   every hostel is visited and verified before it is listed, and the enquiry reaches the person
   who runs the hostel rather than an agent or a call centre. **No revenue, commission, brokerage
   or fee claim appears in public copy until pricing is signed off and the terms are updated.**
4. **No search box until supply justifies one.** The hero leads with *place* and with the
   hostels that actually exist. A search entry point arrives with supply (§7).
5. **Scarcity is framed as curation, and the claim is true in the schema.** Every listed hostel
   satisfies `DISCOVERABLE` (`listing_status=LIVE` ∧ `verification_status=VERIFIED` ∧
   `status=ACTIVE` ∧ `admissions_enabled` ∧ `public_slug` non-null), so "every hostel on Stayo
   is visited and verified before it is listed" is a fact, not marketing.
6. **Coverage requests are a first-class feature, not an empty state.** New table, new public
   endpoint, and the owner-facing readout that turns them into a sales weapon (§7, phase 2).
7. **[[Decisions#ADR-073|ADR-073]]'s no-invented-data rule is upheld.** No fabricated ratings,
   amenity grids, counts or testimonials. Absent data renders nothing, never a plausible
   fallback.
8. **Brand theatre is kept and repurposed, not deleted.** Per explicit user direction — "keep
   the feeling, drop the gate." The mark, the footprint trail, the warm palette and the
   cream→dark duality survive. **The diagonal seam becomes the section transition** partway down
   the scroll, where the page turns from the student story to the owner band: the same gesture,
   now meaning "here is Stayo's other side" instead of "choose before you may enter." The
   full-screen splash gate and the chime are dropped from `/` — a 1.6s interstitial on every
   first visit is a tax on the exact metric this redesign exists to improve.
9. **`/` continues to render for everyone, including signed-in owners — no auto-redirect.**
   This preserves [[Decisions#ADR-071|ADR-071]] point 4, which was reverted-in-the-same-day
   precisely because bouncing owners out of the root makes the student side unreachable for the
   person who most needs to inspect it. The header's owner CTA changes *wording and destination*
   instead ("Go to dashboard" → `/owner/home` when `useOwnerSession()` reports authenticated
   with ≥1 hostel).
10. **Clicking "List your hostel" still counts as declaring owner intent.** It navigates to
    `/owners` with `{ declaredOwnerIntent: true }` router state, preserving
    [[Decisions#ADR-071|ADR-071]] point 5 — `LandingPage` opens the lead conversation on arrival
    and suppresses `OwnerEnquiryPrompt`, so nobody is asked a question they just answered.
11. **`/owners` is not redesigned.** It is a competent page and it is where real owner traffic
    already lands. Out of scope beyond the trust-line echo.
12. **`WelcomePage` is unmounted, not deleted.** It stays on disk with a header comment pointing
    at ADR-214, matching this repo's existing precedent for shelved surfaces
    (`DiscoverRoutes` under ADR-170). `welcome.css`'s footprint rules and keyframes are retained
    because the new page reuses `FootprintTrail`.

## 3. Non-goals

- Redesigning `/owners`, `/discover`, or any authenticated surface.
- Server-side rendering or prerendering. Real crawler-visible content needs it and the SPA shell
  is the ceiling until then — recorded as a known limitation in §8, not solved here.
- Moving to `app.yourstayo.com` (decision 2).
- Pricing-page work — [[Decisions#ADR-211|ADR-211]] already owns that surface.
- Any change to the `DISCOVERABLE` predicate or to listing/verification state, which
  [[Decisions#ADR-040|ADR-040]] reserves to admin.

## 4. The page

Rendered inside `<ThemeProvider theme="marketing">` like `LandingPage`, so it uses real theme
tokens. (`WelcomePage` hard-codes its palette because it renders before any `[data-app-theme]`
shell exists; a themed page has no such excuse.)

| # | Section | Content | Notes |
|---|---|---|---|
| 1 | **PublicHeader** (sticky) | Stayo mark + wordmark · Browse hostels · How it works · **List your hostel** · Log in | The owner door on every public page. Present in the mobile menu at the *top*, not buried. |
| 2 | **Hero** | "Hostel living, sorted." · sub: verified hostels, real photos, no brokers · live-in-city chip · CTA *See hostels in <city>* | Lead listing's own photography, or brand-only when supply is zero (§6). No search box (decision 4). |
| 3 | **Featured hostels** | 1-3 editorial-scale cards: real photos, `starting_price`, `vacant_beds`, `sharing`, `food_included`, verified badge | Data from the existing public browse endpoint. Layout adapts to count (§5). |
| 4 | **Supply requests** (two prongs) | **a.** "Get your hostel on Stayo" — hostel name + optional owner's number. **b.** "Not in your area yet?" — campus/area + optional contact | The engine. Prong (a) is student-led owner acquisition: the student names the hostel, Stayo approaches the owner. Prong (b) is demand data. Everyone gets an action even when Stayo cannot serve them. |
| 5 | **Trust** | **Stayo earns nothing from your rent** · verified before listed · digital agreement · payments through licensed rails | Written for parents as much as students. |
| 6 | **How it works** | Browse → Enquire → Visit → Move in | Dissolves the "is this a broker?" doubt. |
| 7 | **Owner band** (across the seam) | "Run a hostel? Fill your beds and collect rent on autopilot." → `/owners` | One band, not a second homepage. Gains the demand readout in phase 2. |
| 8 | **MarketingFooter** | Reused as-is: Company · Contact · Privacy · Terms | `/` has no footer at all today, so none of these are reachable from the root. See open question 3 on the missing refunds/cancellation link. |

### The live-city chip

Derived from the distinct cities of currently-discoverable hostels — never hard-coded:

- **1 city** → "Now live in <City>"
- **2+ cities** → "Now live in <City> & <City>" (3+: "<City>, <City> +N more")
- **0** → chip hidden, featured section hidden, hero CTA becomes the coverage request

Scoping the promise costs nothing. Nobody feels cheated by a small marketplace that says it is
small; they feel cheated by a national-sounding one that turns out to be empty.

### Featured-hostels layout by count

Handled by pure logic, not by the component: `0` → section omitted · `1-3` → editorial
full-width/large cards · `4+` → grid capped at 6 plus a "See all" link to `/discover`.

Two large, beautiful listings read as *curation*. Twelve card slots with two filled read as
*failure*. This is the whole reason the count drives the layout.

### Coverage request behaviour

- **The signal is never gated behind contact details.** Submitting the area alone is a valid,
  recorded request; contact is a second, optional field ("tell me when a hostel lists here").
  The query is the valuable part and it is free to collect; making it conditional on a phone
  number trades most of the signal for a little of the contact.
- Success state is honest and specific — it confirms the area was recorded and, if contact was
  given, that they will hear when a hostel lists there. It must not imply a hostel exists.
- Signed-in seekers have their `seeker_profile_id` attached; anonymous ones do not, and that is
  permanently fine.

## 5. Frontend

All new code respects `scripts/check-architecture.mjs`: no raw `fetch`/`axios` outside
`@lib/api-client`, nothing new under the frozen `src/portal`, and `src/shared` stays a leaf.

```
src/app/pages/public/
  HomePage.tsx                  # new — composes the sections
  components/PublicHeader.tsx   # new — sticky header, owner door
  home/
    HomeHero.tsx
    FeaturedHostels.tsx
    CoverageRequestSection.tsx
    TrustSection.tsx
    HowItWorks.tsx
    OwnerBand.tsx               # owns the cream→dark seam transition
    homeFeatured.ts   + .test.ts   # count → layout; ordering; empty handling
    liveCities.ts     + .test.ts   # listings → chip copy, all cardinalities
    coverageRequest.ts + .test.ts  # input validation + payload normalisation
src/features/coverage/api/index.ts  # new — the only layer naming the endpoint
```

Per `CLAUDE.md`, the frontend suite is **node-environment only** and matches `src/**/*.test.ts`.
Decision logic therefore lives in the pure `.ts` modules above and is tested directly; the
`.tsx` files stay thin renderers. **No `.test.tsx`, no component rendering in tests.**

Reads reuse the existing public browse endpoint through `features/discover/api` — its
`DiscoverCard` already carries `photos`, `city`, `vacant_beds`, `starting_price`, `sharing`,
`food_included` and `verified`, so no new read endpoint is needed and no second definition of a
listing shape is created.

Routing: `PublicRoutes.tsx` maps `/` → `HomePage`; `WelcomePage` is unmounted per decision 12.

## 6. Imagery

**There is no static hero media, by design.** The `SAH_*` assets previously sitting in
`apps/frontend/public/` were previous-project content — a single hostel's own marketing site —
and are deleted in this branch: 13 files, 25 MB, referenced by nothing in `apps/frontend/src`
and shipped in every frontend deploy.

> **Do not delete the backend's copy.** An identical 25 MB set lives in `apps/backend/public/`
> and is *live* — see open question 2.

All listing imagery comes from real listings, via the existing Discover browse endpoint's
`DiscoverCard.photos` (ImageKit-hosted). The homepage therefore cannot display a hostel
photograph that is not a real hostel's photograph, which upholds
[[Decisions#ADR-073|ADR-073]]'s no-invented-content rule at the level of the image rather than
just the copy.

Hero treatment follows supply:

- **≥1 discoverable hostel** — the hero carries the lead listing's own photography, credited and
  linked to that listing. It is simultaneously the hero and the first featured listing, which is
  the honest version of a hero at this stage: this is not a stock image of hostel life, it is
  the hostel you can actually book.
- **0 discoverable hostels** — no photographic fallback and no stock imagery. The hero reverts to
  brand-only: the graph-paper ground `/owners` already uses, the Stayo mark, the footprint trail
  and the warm gradient. The coverage request becomes the hero's primary action, which is
  exactly right — with no supply, collecting demand *is* the page's only useful job.

Performance rules, now applied to remote images rather than bundled video:

- The hero image is a real `<img>` and the LCP candidate, with `width`/`height` set so layout is
  reserved and CLS stays at zero.
- Sizes are requested through ImageKit transform parameters (width + format) rather than
  shipping originals; a narrower width is requested under 640px.
- **No autoplaying video on `/` in phase 1.** If listing video exists later it inherits the same
  `prefers-reduced-motion` and `navigator.connection?.saveData` guards.

## 7. Data and API

### New table (migration `085_coverage_requests.sql`)

`origin/main`'s latest is `084_lead_source_tracking.sql`. A coverage request **cannot** reuse
`visitor_leads`: that model requires non-null `hostel_id` *and* `owner_id`, and the entire point
is a request for an area where no hostel exists.

```sql
create table public.coverage_requests (
  id                uuid primary key default gen_random_uuid(),
  area_query        text not null,
  normalized_query  text not null,
  city              text,
  contact_phone     text,
  contact_email     text,
  seeker_profile_id uuid references public.profiles(id) on delete set null,
  source            text not null default 'HOME',
  notified_at       timestamptz,
  created_at        timestamptz not null default now()
);
create index idx_coverage_requests_normalized
  on public.coverage_requests (normalized_query, created_at desc);
create index idx_coverage_requests_city
  on public.coverage_requests (city, created_at desc) where city is not null;
```

**No unique constraint, deliberately.** A student asking twice is signal, not duplication;
de-duplication is a reporting concern. Abuse is handled at the endpoint by rate limiting and a
length cap, not by a constraint that would discard genuine repeat demand.

### New endpoint

`POST /api/discover/coverage-requests` — public. Its middleware allowlist entry must be that
**exact path**, never `/api/discover`: `PUBLIC_ROUTES` is prefix-matched, and the broader entry
is what [[Decisions#ADR-073|ADR-073]] point 6 exists to prevent (it would make every seeker's
enquiry history world-readable).

Rate limited per IP via the existing Upstash helper. Consistent with `CLAUDE.md`'s Redis rule,
a Redis outage must not take the endpoint down — it fails open, because losing a demand signal
is worse than admitting a duplicate.

### Deployment order

The migration must be applied to production **before** the code that queries the table deploys.
Note also that several earlier migrations are recorded as unapplied in production; `085` joins
that queue and needs applying explicitly rather than assumed.

### Phase 2 — the payoff

`GET /api/owner/coverage-demand` (owner/admin session required), aggregating requests by
normalised area and city, surfaced in the owner dashboard and in the admin console as
prospecting ammunition. This is what turns the homepage into an owner-acquisition instrument,
and it is the reason the table exists. Kept out of phase 1 only to ship the collection first —
a signal not collected today cannot be aggregated later.

## 8. SEO

- `sitemap.xml`: `/` → `1.0`, `/owners` → `0.9`; refresh `lastmod`; replace the comment that
  justifies the root's demotion.
- `index.html`: student-first `<title>`/`description`/OG copy that still names the owner
  product; add `Organization` JSON-LD.
- **Known limitation, not solved here:** this is a client-rendered SPA, so crawlers see the
  shell, and per-page `document.title` updates are not reliably indexed. Genuine crawler-visible
  content requires prerendering or SSR for `/`, `/discover` and `/discover/h/:slug`. Listing and
  city pages are where student search traffic will actually land, so that work matters more than
  anything on `/` — **it is the highest-value follow-up and should be scheduled next.**

## 9. Verification

- `npm test` in `apps/frontend` (the pure `.ts` modules in §5).
- `npm run check:architecture` in `apps/frontend`.
- `npx tsc --noEmit`, filtered to the new files. **`npm run build` does not typecheck** —
  it is `check:architecture && vite build && branding-check`, and esbuild skips type checking
  entirely.
- Backend route/service tests via `npm test` in `apps/backend`. Note the DB-backed suite is
  currently expected to fail in setup: the test Supabase project is paused as of 2026-09-14.
  Attribute failures against a baseline before believing they are new.
- Manual: 360px-wide viewport, top to bottom, confirming the page **scrolls** and no section is
  clipped — the specific regression this redesign exists to end.

## 10. Documentation to update in the same change

Per `CLAUDE.md`'s documentation rule: `docs/obsidian/Decisions.md` (ADR-214, and amend
[[Decisions#ADR-071|ADR-071]] to record that its open SEO question is now answered and its
chooser retired), `Features.md`, `Changelog.md`, `APIs.md` (new endpoint), `Database.md` (new
table), `Frontend.md` (new page + header), plus `docs/data-models/schema.md` in the `docs/`
layer.

## 11. Open questions

1. **The live hostel count and city list are unverified from here** — the production read was
   blocked. Every count-dependent branch in §4 is written to handle 0, 1-3 and 4+ without
   knowing which, so this does not block implementation, but the copy should be reviewed against
   reality before launch.
2. **The previous project is still live on the API host.** `apps/backend/app/page.tsx` renders a
   Sanity-backed, ISR-cached (`revalidate = 3600`) marketing site for a single hostel —
   `NEXT_PUBLIC_PRIMARY_VISIT_SLUG`, defaulting to `sah-1-ea89eed3` — wired to real availability
   through `admissionsService.getPublicHostel()`, with ~30 components under
   `apps/backend/components/landing/` and the matching 25 MB of `SAH_*` media in
   `apps/backend/public/`. It is deliberately untouched here and **must not be deleted along
   with the frontend copies**, but it is publicly reachable and deserves its own decision: keep,
   redirect to `/`, or retire.
4. **The pricing change invalidates a settled legal decision.** Commit `427fff80` recorded that
   *"the owner subscription is Stayo's **only** revenue"* and that the published terms would state
   affirmatively *"Stayo earns nothing from your rent"*, calling it a trust asset. The planned
   per-converted-tenant fee makes that statement false, and that spec's own proviso — *"If the
   Easebuzz commercials ever change to include a share, this claim must change with them"* —
   applies with equal force here. **The terms, and `docs/superpowers/specs/2026-09-10-legal-policies-production-design.md`,
   must be revised before any pricing goes live**, and the e-commerce disclosure rules the same
   spec cites are likely to require the fee to be disclosed to owners. Out of scope for this page
   beyond keeping the claim off it.
5. **Who contacts the owner on a referral?** This spec assumes *Stayo* does — the student names
   the hostel and we approach the owner, which is lower friction for the student and keeps the
   pitch consistent. The alternative is giving the student a share link to pass on. Not decided;
   the schema supports either.
3. **`MarketingFooter` links only to `/company`, `/contact`, `/legal/privacy` and
   `/legal/terms`.** There is no refunds/cancellation-policy route, which a payment aggregator's
   onboarding review typically requires to be reachable from the homepage. Out of scope for this
   spec, but it should be confirmed against the Easebuzz sub-merchant requirements before this
   page is treated as launch-ready.
