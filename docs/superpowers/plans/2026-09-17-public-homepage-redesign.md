# Public Homepage Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the audience-chooser at `/` with a scrolling, student-first homepage that leads with real listings, collects coverage requests where there is no supply, and keeps a permanent owner door.

**Architecture:** A new `HomePage` composes small section components. All decision logic lives in pure `.ts` modules with direct unit tests; the `.tsx` files are thin renderers. Listing reads reuse the existing public Discover browse endpoint and its `DiscoverCard` shape — no new read endpoint, no second definition of a listing. One new write endpoint (`POST /api/discover/coverage-requests`) is split into a dependency-injected pure handler plus a two-line Prisma service, so the request logic is testable without a database.

**Tech Stack:** Vite + React 19 + TypeScript + TanStack Query + Tailwind (frontend); Next.js 14 App Router + Prisma + Postgres + Upstash Redis (backend); Vitest both sides.

**Spec:** `docs/superpowers/specs/2026-09-17-public-homepage-redesign-design.md`

**Branch:** `feat/public-homepage`, worktree `.claude/worktrees/public-homepage`, cut from `origin/main` @ `f6ae3e70`.

## Global Constraints

Every task's requirements implicitly include these.

- **No invented data.** No fabricated ratings, amenity grids, counts, testimonials or stock photography. Absent data renders nothing, never a plausible fallback (ADR-073).
- **No search box on `/`.** A search field is a promise of inventory the marketplace cannot keep at 1–2 listings.
- **`/` renders for everyone, including signed-in owners. Never auto-redirect off `/`** — this preserves ADR-071 point 4, which was reverted-in-a-day when it made the student side unreachable for owners. Change the CTA's wording and destination instead.
- **"List your hostel" navigates to `/owners` with router state `{ declaredOwnerIntent: true }`**, preserving ADR-071 point 5 so `LandingPage` opens the lead conversation and suppresses `OwnerEnquiryPrompt`.
- **Frontend tests are node-environment only** and match `src/**/*.test.ts`. No `.test.tsx`, no component rendering, no jsdom.
- **No raw `fetch()`/`axios`** in `app/`, `platforms/`, `shared/ui`, `features/`, `portal/`, `context/` — everything goes through `@lib/api-client`. Enforced by `scripts/check-architecture.mjs`.
- **The middleware allowlist entry is the exact path `/api/discover/coverage-requests`, never `/api/discover`.** `PUBLIC_ROUTES` is prefix-matched; the broad entry would make every seeker's enquiry history and saved list world-readable (ADR-073 point 6).
- **Rate limiting fails open.** Losing a demand signal is worse than admitting a duplicate.
- **Area query bounds: 2–120 characters. Contact is optional** and never gates recording the signal.
- **No autoplaying video anywhere on `/`.**
- **Migration `085` must be applied to production BEFORE the code that queries the table deploys.** Several earlier migrations are recorded as unapplied; `085` joins that queue and needs applying explicitly.
- **`npm run build` does NOT typecheck** — it is `check:architecture && vite build && branding-check`, and esbuild skips type checking. Run `npx tsc --noEmit` filtered to your own files.
- **Use the brand pack at `Stayo-Brand-Assetes/`, not hand-picked hexes.** Palette: Warm Clay `#B46A55`, Terra Cotta `#A45D44`, Dusty Orange `#D2986C`, Latte `#EBD9C4`, Charcoal `#2F2F2F`, Cream `#F7F3EE`. The mark is the S-monogram already shipped as `StayoMark` (viewBox `0 0 539 727`, geometry lifted from the brand vector) — **never redraw it**. The header/footer lockup is the horizontal logo.
- **Texture is the graph-paper grid, never the brand pattern tile.** `pattern/stayo-pattern-tile.svg` carries house/window/tick motifs — sticker art, too loud behind copy. Use ruled 1px gradients: `rgba(180,106,85,0.11)` at `52px` on cream, `rgba(255,255,255,0.055)` at `48px` on charcoal, and `rgba(164,93,68,0.15)` at `26px` on Latte for a photo slot that has not loaded.
- **No claim about money, commission, brokerage or fees appears in public copy.** A
  per-converted-tenant fee (~₹100-300, charged to the owner) is planned and unpriced, which makes
  "no brokerage" and "Stayo earns nothing from your rent" unsafe and the amount unquotable. The
  trust claim is about the channel instead: *no agents — straight to the hostel owner*.
- **No green.** The brand has no success colour. Availability ("3 beds free") uses `#3F6B50`, a muted warm-leaning green chosen for 6.1:1 on white — never a Tailwind `emerald-*`, which is off-palette.
- **ADR number is 214.** Highest on `origin/main` is ADR-213. Re-check `git show origin/main:docs/obsidian/Decisions.md | grep -oE 'ADR-[0-9]+' | sort -n | tail -1` at merge time — numbers collide across concurrent branches.

## Danger: the local `.env` points at PRODUCTION

`/.env` was repointed to the production Supabase project (`qgfyfbdccjnibdhhvnsr`) on 2026-09-11. **Do not run the migration locally, do not start `apps/backend` dev and POST to the new endpoint, and do not run the DB-backed backend suite expecting a scratch database.** Every task in this plan is verified through pure unit tests, `tsc`, the architecture check, and the frontend node suite. Endpoint behaviour against a real database is verified by the user on a preview deployment after they apply `085`, or against the test project once it is un-paused (it is `INACTIVE` as of 2026-09-14).

## File Structure

**Frontend — create:**

| Path | Responsibility |
|---|---|
| `src/app/pages/public/HomePage.tsx` | Composes the sections; owns the listings query. |
| `src/app/pages/public/components/PublicHeader.tsx` | Sticky header, owner door, log-in link. |
| `src/app/pages/public/home/homeHeader.ts` (+`.test.ts`) | Owner CTA label + destination from session state. |
| `src/app/pages/public/home/liveCities.ts` (+`.test.ts`) | Listings → live-city list and chip copy. |
| `src/app/pages/public/home/homeFeatured.ts` (+`.test.ts`) | Listing count → layout plan and lead listing. |
| `src/app/pages/public/home/listingPhoto.ts` (+`.test.ts`) | ImageKit width sizing for listing photography. |
| `src/app/pages/public/home/coverageRequest.ts` (+`.test.ts`) | Coverage form validation and payload shaping. |
| `src/app/pages/public/home/HomeHero.tsx` | Hero, both supply states. |
| `src/app/pages/public/home/FeaturedHostels.tsx` | Section wrapper + `FeaturedHostelCard`. |
| `src/app/pages/public/home/SupplyRequestSection.tsx` | Both supply forms: refer a hostel, request an area. |
| `src/app/pages/public/home/TrustSection.tsx` | The four trust facts. |
| `src/app/pages/public/home/HowItWorks.tsx` | Four steps. |
| `src/app/pages/public/home/OwnerBand.tsx` | Seam transition + owner pitch. |
| `src/features/coverage/api/index.ts` | The only layer naming the coverage endpoint. |
| `src/features/coverage/hooks/useSubmitCoverageRequest.ts` | Mutation wrapper. |

**Frontend — modify:** `src/app/router/PublicRoutes.tsx` (route swap), `src/app/pages/public/WelcomePage.tsx` (unmount comment only), `public/sitemap.xml`, `index.html`.

**Backend — create:** `migrations/085_coverage_requests.sql`, `src/services/discovery/coverage-request-rules.ts`, `src/services/discovery/coverage-request-handler.ts`, `src/services/discovery/coverage-request-service.ts`, `app/api/discover/coverage-requests/route.ts`, `tests/coverage-request-rules.test.ts`, `tests/coverage-request-handler.test.ts`.

**Backend — modify:** `prisma/schema.prisma` (new model + back-relation on `profile`), `middleware.ts` (allowlist), `vitest.pure.config.ts` (register the two new pure test files).

---

### Task 1: Live-city derivation

**Files:**
- Create: `apps/frontend/src/app/pages/public/home/liveCities.ts`
- Test: `apps/frontend/src/app/pages/public/home/liveCities.test.ts`

**Interfaces:**
- Consumes: `DiscoverCard` from `@features/discover/api`.
- Produces: `liveCities(cards: DiscoverCard[]): string[]`, `citiesFromFacets(facets: DiscoverCityFacet[] | undefined): string[]`, `liveCityLabel(cities: string[]): string | null`, `primaryCity(cities: string[]): string | null`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/app/pages/public/home/liveCities.test.ts
import { describe, expect, it } from 'vitest';
import type { DiscoverCard } from '@features/discover/api';
import { citiesFromFacets, liveCities, liveCityLabel, primaryCity } from './liveCities';

function card(city: string | null): DiscoverCard {
  return {
    id: 'h1', slug: 's', name: 'N', city, address: 'A',
    latitude: null, longitude: null, hostel_type: 'BOYS', food_included: false,
    verified: true, photos: [], listed_at: '2026-01-01T00:00:00.000Z',
    vacant_beds: 1, starting_price: null, sharing: [],
  } as DiscoverCard;
}

describe('liveCities', () => {
  it('dedupes case-insensitively and keeps first-seen spelling and order', () => {
    expect(liveCities([card('Hyderabad'), card('hyderabad'), card('Pune')])).toEqual(['Hyderabad', 'Pune']);
  });

  it('ignores null and blank cities', () => {
    expect(liveCities([card(null), card('   '), card('Pune')])).toEqual(['Pune']);
  });

  it('returns an empty list for no cards', () => {
    expect(liveCities([])).toEqual([]);
  });
});

describe('liveCityLabel', () => {
  it('is null with no cities, so the chip can be hidden', () => {
    expect(liveCityLabel([])).toBeNull();
  });

  it('names one city', () => {
    expect(liveCityLabel(['Hyderabad'])).toBe('Now live in Hyderabad');
  });

  it('joins two with an ampersand', () => {
    expect(liveCityLabel(['Hyderabad', 'Pune'])).toBe('Now live in Hyderabad & Pune');
  });

  it('counts the remainder past two', () => {
    expect(liveCityLabel(['Hyderabad', 'Pune', 'Mumbai', 'Delhi'])).toBe('Now live in Hyderabad, Pune +2 more');
  });
});

describe('primaryCity', () => {
  it('is the first city, or null', () => {
    expect(primaryCity(['Pune', 'Delhi'])).toBe('Pune');
    expect(primaryCity([])).toBeNull();
  });
});

describe('citiesFromFacets', () => {
  it('is empty when the search returned no facets', () => {
    expect(citiesFromFacets(undefined)).toEqual([]);
    expect(citiesFromFacets([])).toEqual([]);
  });

  it('orders by how many hostels each city has, biggest first', () => {
    expect(citiesFromFacets([
      { city: 'Pune', count: 1 },
      { city: 'Hyderabad', count: 4 },
    ])).toEqual(['Hyderabad', 'Pune']);
  });

  it('drops blank city facets', () => {
    expect(citiesFromFacets([{ city: '  ', count: 9 }, { city: 'Pune', count: 1 }])).toEqual(['Pune']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/liveCities.test.ts`
Expected: FAIL — cannot resolve `./liveCities`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/frontend/src/app/pages/public/home/liveCities.ts
import type { DiscoverCard } from '@features/discover/api';

/**
 * The cities Stayo actually has listings in, first-seen order.
 *
 * Derived from live listings rather than hard-coded on purpose: the hero's
 * "Now live in …" chip is a promise, and a promise compiled into the bundle
 * goes stale the first time a city's only hostel is suspended.
 */
export function liveCities(cards: DiscoverCard[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const card of cards) {
    const city = card.city?.trim();
    if (!city) continue;
    const key = city.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(city);
  }
  return out;
}

/** Chip copy, or null when there is nothing to promise. */
export function liveCityLabel(cities: string[]): string | null {
  if (cities.length === 0) return null;
  if (cities.length === 1) return `Now live in ${cities[0]}`;
  if (cities.length === 2) return `Now live in ${cities[0]} & ${cities[1]}`;
  return `Now live in ${cities[0]}, ${cities[1]} +${cities.length - 2} more`;
}

/** The city the hero's CTA points at. */
export function primaryCity(cities: string[]): string | null {
  return cities[0] ?? null;
}

export interface DiscoverCityFacet {
  city: string;
  count: number;
}

/**
 * Cities from the search response's facets.
 *
 * Preferred over `liveCities` where available, because facets describe the
 * whole result set while the cards are only the page the homepage fetched —
 * a city whose single hostel sorts onto page two still deserves the chip.
 * Ordered by hostel count so `primaryCity` names the biggest one.
 */
export function citiesFromFacets(facets: DiscoverCityFacet[] | undefined): string[] {
  if (!facets?.length) return [];
  return facets
    .filter((facet) => Boolean(facet.city?.trim()))
    .slice()
    .sort((a, b) => b.count - a.count)
    .map((facet) => facet.city.trim());
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/liveCities.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/pages/public/home/liveCities.ts apps/frontend/src/app/pages/public/home/liveCities.test.ts
git commit -m "feat(home): derive the live-city chip from real listings"
```

---

### Task 2: Featured-listings layout plan

**Files:**
- Create: `apps/frontend/src/app/pages/public/home/homeFeatured.ts`
- Test: `apps/frontend/src/app/pages/public/home/homeFeatured.test.ts`

**Interfaces:**
- Produces: `planFeatured(cards: DiscoverCard[]): FeaturedPlan` where `FeaturedPlan = { layout: 'none' | 'editorial' | 'grid'; cards: DiscoverCard[]; lead: DiscoverCard | null; showBrowseAll: boolean }`, plus `EDITORIAL_MAX = 3` and `GRID_MAX = 6`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/app/pages/public/home/homeFeatured.test.ts
import { describe, expect, it } from 'vitest';
import type { DiscoverCard } from '@features/discover/api';
import { homeSupplyState, planFeatured, EDITORIAL_MAX, GRID_MAX } from './homeFeatured';

function card(id: string, photos: string[] = []): DiscoverCard {
  return {
    id, slug: id, name: id, city: 'Pune', address: 'A',
    latitude: null, longitude: null, hostel_type: 'BOYS', food_included: false,
    verified: true, photos, listed_at: '2026-01-01T00:00:00.000Z',
    vacant_beds: 2, starting_price: 7000, sharing: [2],
  } as DiscoverCard;
}

describe('planFeatured', () => {
  it('omits the section entirely when there is nothing to show', () => {
    expect(planFeatured([])).toEqual({ layout: 'none', cards: [], lead: null, showBrowseAll: false });
  });

  it('shows one to three listings editorially, with no browse-all link', () => {
    const plan = planFeatured([card('a'), card('b')]);
    expect(plan.layout).toBe('editorial');
    expect(plan.cards).toHaveLength(2);
    expect(plan.showBrowseAll).toBe(false);
  });

  it('switches to a capped grid past the editorial maximum', () => {
    const many = Array.from({ length: 9 }, (_, i) => card(`h${i}`));
    const plan = planFeatured(many);
    expect(plan.layout).toBe('grid');
    expect(plan.cards).toHaveLength(GRID_MAX);
    expect(plan.showBrowseAll).toBe(true);
  });

  it('prefers a listing that actually has a photograph as the lead', () => {
    const plan = planFeatured([card('no-photo'), card('has-photo', ['https://ik.imagekit.io/x/a.jpg'])]);
    expect(plan.lead?.id).toBe('has-photo');
  });

  it('falls back to the first listing when none has a photograph', () => {
    expect(planFeatured([card('a'), card('b')]).lead?.id).toBe('a');
  });

  it('treats exactly EDITORIAL_MAX as editorial', () => {
    const exact = Array.from({ length: EDITORIAL_MAX }, (_, i) => card(`h${i}`));
    expect(planFeatured(exact).layout).toBe('editorial');
  });
});

describe('homeSupplyState', () => {
  it('is loading while the query is in flight, even with nothing yet', () => {
    expect(homeSupplyState(true, 0)).toBe('loading');
  });

  it('stays loading when a refetch is in flight over existing cards', () => {
    expect(homeSupplyState(true, 3)).toBe('loading');
  });

  it('is empty only once the query has settled with nothing', () => {
    expect(homeSupplyState(false, 0)).toBe('empty');
  });

  it('is ready when listings exist', () => {
    expect(homeSupplyState(false, 2)).toBe('ready');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/homeFeatured.test.ts`
Expected: FAIL — cannot resolve `./homeFeatured`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/frontend/src/app/pages/public/home/homeFeatured.ts
import type { DiscoverCard } from '@features/discover/api';

export type FeaturedLayout = 'none' | 'editorial' | 'grid';

export interface FeaturedPlan {
  layout: FeaturedLayout;
  cards: DiscoverCard[];
  /** The listing whose photograph fronts the hero. */
  lead: DiscoverCard | null;
  showBrowseAll: boolean;
}

/** Up to this many listings are shown large; past it they become a grid. */
export const EDITORIAL_MAX = 3;
/** The grid never shows more than this before deferring to `/discover`. */
export const GRID_MAX = 6;

/**
 * How many listings there are decides how they are shown.
 *
 * Two listings shown large read as curation. The same two in a twelve-slot
 * grid read as failure — the empty slots do the talking. So the count drives
 * the layout rather than the layout being fixed and the content rattling
 * around inside it.
 */
export function planFeatured(cards: DiscoverCard[]): FeaturedPlan {
  if (cards.length === 0) {
    return { layout: 'none', cards: [], lead: null, showBrowseAll: false };
  }
  const lead = cards.find((card) => (card.photos?.length ?? 0) > 0) ?? cards[0];
  if (cards.length <= EDITORIAL_MAX) {
    return { layout: 'editorial', cards, lead, showBrowseAll: false };
  }
  return { layout: 'grid', cards: cards.slice(0, GRID_MAX), lead, showBrowseAll: true };
}

export type HomeSupplyState = 'loading' | 'empty' | 'ready';

/**
 * Loading is not the same as empty, and conflating them is a real bug.
 *
 * On first paint the listings query has no data, so a page that branches on
 * `cards.length === 0` alone renders the zero-supply layout — brand-only hero,
 * no city chip, no listings — and then pops into the real page a moment later.
 * Every first visit would flash the wrong page, and the wrong page happens to
 * be the one that says Stayo has nothing.
 */
export function homeSupplyState(isLoading: boolean, cardCount: number): HomeSupplyState {
  if (isLoading) return 'loading';
  return cardCount === 0 ? 'empty' : 'ready';
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/homeFeatured.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/pages/public/home/homeFeatured.ts apps/frontend/src/app/pages/public/home/homeFeatured.test.ts
git commit -m "feat(home): let the listing count choose the featured layout"
```

---

### Task 3: Listing photo sizing

**Files:**
- Create: `apps/frontend/src/app/pages/public/home/listingPhoto.ts`
- Test: `apps/frontend/src/app/pages/public/home/listingPhoto.test.ts`

**Interfaces:**
- Produces: `listingPhotoUrl(url: string | null | undefined, widthPx: number): string | null`.

**Why not reuse `@shared/lib/photoThumbnail`:** it appends `fo-face`, which crops to a detected face and forces a square. That is right for tenant avatars and wrong for a building.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/app/pages/public/home/listingPhoto.test.ts
import { describe, expect, it } from 'vitest';
import { listingPhotoUrl } from './listingPhoto';

const IK = 'https://ik.imagekit.io/stayo/hostel.jpg';

describe('listingPhotoUrl', () => {
  it('is null for a missing photo', () => {
    expect(listingPhotoUrl(null, 600)).toBeNull();
    expect(listingPhotoUrl(undefined, 600)).toBeNull();
  });

  it('asks ImageKit for twice the drawn width, auto format, no face crop', () => {
    const out = listingPhotoUrl(IK, 600);
    expect(new URL(out as string).searchParams.get('tr')).toBe('w-1200,q-75,f-auto');
  });

  it('leaves non-ImageKit hosts untouched', () => {
    const other = 'https://example.com/a.jpg';
    expect(listingPhotoUrl(other, 600)).toBe(other);
  });

  it('never double-transforms a url that already carries one', () => {
    const already = 'https://ik.imagekit.io/stayo/tr:w-100/hostel.jpg';
    expect(listingPhotoUrl(already, 600)).toBe(already);
    const query = `${IK}?tr=w-100`;
    expect(listingPhotoUrl(query, 600)).toBe(query);
  });

  it('returns junk unchanged rather than throwing', () => {
    expect(listingPhotoUrl('not a url', 600)).toBe('not a url');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/listingPhoto.test.ts`
Expected: FAIL — cannot resolve `./listingPhoto`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/frontend/src/app/pages/public/home/listingPhoto.ts
/**
 * A listing photograph at the width it will actually be drawn.
 *
 * Mirrors `@shared/lib/photoThumbnail`'s safety rules — only ImageKit URLs are
 * rewritten and never one that already carries a transform — but asks for a
 * width rather than a face-centred square: these are buildings and rooms, and
 * `fo-face` would crop them to whatever face ImageKit thinks it found.
 */
export function listingPhotoUrl(url: string | null | undefined, widthPx: number): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.hostname.endsWith('imagekit.io')) return url;
  if (parsed.pathname.includes('/tr:') || parsed.searchParams.has('tr')) return url;
  parsed.searchParams.set('tr', `w-${Math.round(widthPx * 2)},q-75,f-auto`);
  return parsed.toString();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/listingPhoto.test.ts`
Expected: PASS, 6 tests. If the `tr` assertion fails on encoding, note the test reads it back via `searchParams.get`, which decodes — do not "fix" it by asserting the raw string.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/pages/public/home/listingPhoto.ts apps/frontend/src/app/pages/public/home/listingPhoto.test.ts
git commit -m "feat(home): size listing photography without face cropping"
```

---

### Task 4: Coverage form validation (frontend)

**Files:**
- Create: `apps/frontend/src/app/pages/public/home/coverageRequest.ts`
- Test: `apps/frontend/src/app/pages/public/home/coverageRequest.test.ts`

**Interfaces:**
- Produces: `AREA_MIN`, `AREA_MAX`, `classifyContact(raw: string): 'empty' | 'phone' | 'email' | 'invalid'`, `validateCoverage(draft: CoverageDraft, source?: string): CoverageValidation`, with `CoverageDraft = { area: string; contact: string }` and `CoverageValidation = { valid: boolean; errors: { area?: string; contact?: string }; payload: CoveragePayload | null }`, `CoveragePayload = { area_query: string; contact?: string; source: string }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/app/pages/public/home/coverageRequest.test.ts
import { describe, expect, it } from 'vitest';
import { AREA_MAX, classifyContact, validateCoverage, validateHostelReferral } from './coverageRequest';

describe('classifyContact', () => {
  it('treats blank as empty, because contact is optional', () => {
    expect(classifyContact('')).toBe('empty');
    expect(classifyContact('   ')).toBe('empty');
  });

  it('recognises Indian mobile numbers with or without country code', () => {
    expect(classifyContact('9876543210')).toBe('phone');
    expect(classifyContact('+91 98765 43210')).toBe('phone');
  });

  it('rejects numbers that are not Indian mobiles', () => {
    expect(classifyContact('1234567890')).toBe('invalid');
    expect(classifyContact('98765')).toBe('invalid');
  });

  it('recognises an email and rejects a malformed one', () => {
    expect(classifyContact('a@b.co')).toBe('email');
    expect(classifyContact('a@b')).toBe('invalid');
  });
});

describe('validateCoverage', () => {
  it('accepts an area with no contact at all — the signal is the point', () => {
    const result = validateCoverage({ area: '  Osmania University  ', contact: '' });
    expect(result.valid).toBe(true);
    expect(result.payload).toEqual({ kind: 'AREA', area_query: 'Osmania University', source: 'HOME' });
  });

  it('includes a valid contact when one is given', () => {
    const result = validateCoverage({ area: 'BITS Pilani', contact: '+91 98765 43210' });
    expect(result.payload?.contact).toBe('+91 98765 43210');
  });

  it('rejects an area that is too short', () => {
    const result = validateCoverage({ area: 'a', contact: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.area).toBeTruthy();
    expect(result.payload).toBeNull();
  });

  it('rejects an area past the maximum length', () => {
    expect(validateCoverage({ area: 'x'.repeat(AREA_MAX + 1), contact: '' }).valid).toBe(false);
  });

  it('rejects a malformed contact rather than silently dropping it', () => {
    const result = validateCoverage({ area: 'Osmania University', contact: 'nope' });
    expect(result.valid).toBe(false);
    expect(result.errors.contact).toBeTruthy();
  });

  it('passes the source through', () => {
    expect(validateCoverage({ area: 'Osmania University', contact: '' }, 'HOME_EMPTY').payload?.source).toBe('HOME_EMPTY');
  });
});

describe('validateHostelReferral', () => {
  it('accepts a hostel name on its own — the number is a bonus, not a gate', () => {
    const result = validateHostelReferral({ hostelName: '  Sri Sai Boys Hostel ', ownerContact: '' });
    expect(result.valid).toBe(true);
    expect(result.payload).toEqual({ kind: 'HOSTEL', hostel_name: 'Sri Sai Boys Hostel', source: 'HOME' });
  });

  it("includes the owner's number when one is given", () => {
    const result = validateHostelReferral({ hostelName: 'Sri Sai', ownerContact: '9876543210' });
    expect(result.payload?.owner_contact).toBe('9876543210');
  });

  it('rejects a name too short to identify a hostel', () => {
    const result = validateHostelReferral({ hostelName: 'ab', ownerContact: '' });
    expect(result.valid).toBe(false);
    expect(result.errors.hostelName).toBeTruthy();
    expect(result.payload).toBeNull();
  });

  it('rejects a malformed owner number rather than dropping it', () => {
    const result = validateHostelReferral({ hostelName: 'Sri Sai', ownerContact: '12345' });
    expect(result.valid).toBe(false);
    expect(result.errors.ownerContact).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/coverageRequest.test.ts`
Expected: FAIL — cannot resolve `./coverageRequest`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/frontend/src/app/pages/public/home/coverageRequest.ts
export const AREA_MIN = 2;
export const AREA_MAX = 120;

export interface CoverageDraft {
  area: string;
  contact: string;
}

export interface CoveragePayload {
  kind: 'AREA';
  area_query: string;
  contact?: string;
  source: string;
}

/** A student naming a hostel that should be on Stayo. */
export interface HostelReferralDraft {
  hostelName: string;
  ownerContact: string;
}

export interface HostelReferralPayload {
  kind: 'HOSTEL';
  hostel_name: string;
  owner_contact?: string;
  source: string;
}

export interface HostelReferralValidation {
  valid: boolean;
  errors: { hostelName?: string; ownerContact?: string };
  payload: HostelReferralPayload | null;
}

export interface CoverageValidation {
  valid: boolean;
  errors: { area?: string; contact?: string };
  payload: CoveragePayload | null;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

export type ContactKind = 'empty' | 'phone' | 'email' | 'invalid';

/** What the optional contact field holds, if anything. */
export function classifyContact(raw: string): ContactKind {
  const value = raw.trim();
  if (!value) return 'empty';
  if (value.includes('@')) return EMAIL.test(value) ? 'email' : 'invalid';
  const digits = value.replace(/\D/g, '');
  const local = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  return INDIAN_MOBILE.test(local) ? 'phone' : 'invalid';
}

/**
 * Validates the coverage form.
 *
 * The area alone is a complete, valid submission. Contact is a second,
 * optional field — gating the signal behind a phone number trades most of the
 * demand data for a little of the contact data, which is the wrong way round
 * when the demand is what recruits owners. The server re-validates all of
 * this; it is the authority, and this exists so the form can say why before
 * a round trip.
 */
export function validateCoverage(draft: CoverageDraft, source = 'HOME'): CoverageValidation {
  const errors: { area?: string; contact?: string } = {};
  const area = draft.area.trim();

  if (area.length < AREA_MIN) {
    errors.area = 'Tell us the college or area you are looking near.';
  } else if (area.length > AREA_MAX) {
    errors.area = `Keep this under ${AREA_MAX} characters.`;
  }

  const contactKind = classifyContact(draft.contact);
  if (contactKind === 'invalid') {
    errors.contact = 'Enter a mobile number or an email — or leave it blank.';
  }

  if (errors.area || errors.contact) {
    return { valid: false, errors, payload: null };
  }

  const payload: CoveragePayload = { kind: 'AREA', area_query: area, source };
  if (contactKind !== 'empty') payload.contact = draft.contact.trim();
  return { valid: true, errors: {}, payload };
}

export const HOSTEL_NAME_MIN = 3;
export const HOSTEL_NAME_MAX = 120;

/**
 * Validates a hostel referral.
 *
 * This is student-led owner acquisition: the student names the hostel they
 * already live in or want, and Stayo approaches the owner. The owner's number
 * is the single most valuable field on the page — it turns a name into a call —
 * but it stays optional, because a hostel name alone is still findable and
 * demanding the number would lose most of the referrals.
 */
export function validateHostelReferral(draft: HostelReferralDraft, source = 'HOME'): HostelReferralValidation {
  const errors: { hostelName?: string; ownerContact?: string } = {};
  const hostelName = draft.hostelName.trim();

  if (hostelName.length < HOSTEL_NAME_MIN) {
    errors.hostelName = 'Tell us the name of the hostel.';
  } else if (hostelName.length > HOSTEL_NAME_MAX) {
    errors.hostelName = `Keep this under ${HOSTEL_NAME_MAX} characters.`;
  }

  const contactKind = classifyContact(draft.ownerContact);
  if (contactKind === 'invalid') {
    errors.ownerContact = "Enter the owner's mobile number — or leave it blank.";
  }

  if (errors.hostelName || errors.ownerContact) {
    return { valid: false, errors, payload: null };
  }

  const payload: HostelReferralPayload = { kind: 'HOSTEL', hostel_name: hostelName, source };
  if (contactKind !== 'empty') payload.owner_contact = draft.ownerContact.trim();
  return { valid: true, errors: {}, payload };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/coverageRequest.test.ts`
Expected: PASS, 14 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/pages/public/home/coverageRequest.ts apps/frontend/src/app/pages/public/home/coverageRequest.test.ts
git commit -m "feat(home): validate area requests and hostel referrals, neither gated on contact"
```

---

### Task 5: Header CTA logic

**Files:**
- Create: `apps/frontend/src/app/pages/public/home/homeHeader.ts`
- Test: `apps/frontend/src/app/pages/public/home/homeHeader.test.ts`

**Interfaces:**
- Produces: `ownerDoor(session: { isLoading: boolean; isAuthenticated: boolean; hostelCount: number }): OwnerDoor` where `OwnerDoor = { label: string; to: string; declaresOwnerIntent: boolean }`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/app/pages/public/home/homeHeader.test.ts
import { describe, expect, it } from 'vitest';
import { ownerDoor } from './homeHeader';

describe('ownerDoor', () => {
  it('invites a signed-out visitor to list, and declares owner intent', () => {
    const door = ownerDoor({ isLoading: false, isAuthenticated: false, hostelCount: 0 });
    expect(door).toEqual({ label: 'List your hostel', to: '/owners', declaresOwnerIntent: true });
  });

  it('sends an onboarded owner to their dashboard instead of the pitch', () => {
    const door = ownerDoor({ isLoading: false, isAuthenticated: true, hostelCount: 1 });
    expect(door).toEqual({ label: 'Go to dashboard', to: '/owner/home', declaresOwnerIntent: false });
  });

  it('treats a signed-in account with no hostel as a prospect, not an owner', () => {
    expect(ownerDoor({ isLoading: false, isAuthenticated: true, hostelCount: 0 }).to).toBe('/owners');
  });

  it('shows the signed-out wording while the session is still settling', () => {
    expect(ownerDoor({ isLoading: true, isAuthenticated: true, hostelCount: 3 }).label).toBe('List your hostel');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/homeHeader.test.ts`
Expected: FAIL — cannot resolve `./homeHeader`.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/frontend/src/app/pages/public/home/homeHeader.ts
export interface OwnerDoorSession {
  isLoading: boolean;
  isAuthenticated: boolean;
  hostelCount: number;
}

export interface OwnerDoor {
  label: string;
  to: string;
  /**
   * True when following this link is itself an answer to `/owners`'
   * "Are you a hostel owner?" prompt, so `LandingPage` opens the lead
   * conversation instead of asking again (ADR-071 point 5).
   */
  declaresOwnerIntent: boolean;
}

const LIST: OwnerDoor = { label: 'List your hostel', to: '/owners', declaresOwnerIntent: true };
const DASHBOARD: OwnerDoor = { label: 'Go to dashboard', to: '/owner/home', declaresOwnerIntent: false };

/**
 * The owner door, on every public screen.
 *
 * Owners are the paying side, so their path is permanent and one click from
 * anywhere — but it changes wording and destination rather than removing the
 * student side, because `/` must stay reachable for a signed-in owner who
 * wants to look at the marketplace they are paying for (ADR-071 point 4).
 * While the session is still loading, the signed-out wording is shown: it is
 * correct for everyone who is not yet known, and flipping the label after the
 * fact is less jarring than flipping a destination under a finger.
 */
export function ownerDoor(session: OwnerDoorSession): OwnerDoor {
  if (session.isLoading) return LIST;
  return session.isAuthenticated && session.hostelCount > 0 ? DASHBOARD : LIST;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/app/pages/public/home/homeHeader.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/app/pages/public/home/homeHeader.ts apps/frontend/src/app/pages/public/home/homeHeader.test.ts
git commit -m "feat(home): owner door label and destination from session state"
```

---

### Task 6: Coverage request table and Prisma model

**Files:**
- Create: `migrations/085_coverage_requests.sql`
- Modify: `apps/backend/prisma/schema.prisma` (add model; add back-relation inside `model profile`, which starts at line 811)

**Interfaces:**
- Produces: Prisma model `coverage_requests` with fields `id`, `area_query`, `normalized_query`, `city`, `contact_phone`, `contact_email`, `seeker_profile_id`, `source`, `notified_at`, `created_at`.

- [ ] **Step 1: Write the migration**

```sql
-- migrations/085_coverage_requests.sql
--
-- Coverage requests: "I am looking near <area> and Stayo has nothing there."
--
-- Deliberately NOT a visitor_leads row. That model requires a non-null
-- hostel_id and owner_id, and the entire point of this record is an area where
-- no hostel exists yet. These are demand signals, and they are what recruits
-- owners into a city.

CREATE TABLE IF NOT EXISTS public.coverage_requests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL DEFAULT 'AREA',   -- 'AREA' | 'HOSTEL'
  area_query        text,
  normalized_query  text,
  hostel_name       text,
  owner_contact     text,
  city              text,
  contact_phone     text,
  contact_email     text,
  seeker_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  source            text NOT NULL DEFAULT 'HOME',
  notified_at       timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  -- Each kind carries its own required payload; neither may be half-filled.
  CONSTRAINT coverage_requests_kind_payload CHECK (
    (kind = 'AREA'   AND area_query IS NOT NULL AND normalized_query IS NOT NULL) OR
    (kind = 'HOSTEL' AND hostel_name IS NOT NULL)
  )
);

-- Aggregation is always "how much demand for this area / this city, lately".
CREATE INDEX IF NOT EXISTS idx_coverage_requests_normalized
  ON public.coverage_requests (normalized_query, created_at DESC) WHERE normalized_query IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_coverage_requests_kind
  ON public.coverage_requests (kind, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_coverage_requests_city
  ON public.coverage_requests (city, created_at DESC) WHERE city IS NOT NULL;

-- No unique constraint, deliberately: a student asking twice is signal, not
-- duplication. De-duplication is a reporting concern. Abuse is handled by the
-- endpoint's rate limit and length cap, not by a constraint that would throw
-- away genuine repeat demand.
```

- [ ] **Step 2: Add the Prisma model**

Append to `apps/backend/prisma/schema.prisma`:

```prisma
/// Demand for an area Stayo does not cover yet. See migration 085.
model coverage_requests {
  id                String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  /// 'AREA' (demand for a place) or 'HOSTEL' (a student naming a hostel to onboard).
  kind              String    @default("AREA")
  area_query        String?
  /// Lower-cased, whitespace-collapsed `area_query`, for aggregation.
  normalized_query  String?
  /// The hostel a student referred, for kind = 'HOSTEL'.
  hostel_name       String?
  /// The owner's number, when the student knew it. Optional, always.
  owner_contact     String?
  city              String?
  contact_phone     String?
  contact_email     String?
  /// Set only when a signed-in seeker submitted it. Null forever otherwise.
  seeker_profile_id String?   @db.Uuid
  source            String    @default("HOME")
  notified_at       DateTime? @db.Timestamptz(6)
  created_at        DateTime  @default(now()) @db.Timestamptz(6)

  seeker profile? @relation("SeekerCoverageRequests", fields: [seeker_profile_id], references: [id], onDelete: SetNull)

  @@index([normalized_query, created_at(sort: Desc)], map: "idx_coverage_requests_normalized")
  @@index([kind, created_at(sort: Desc)], map: "idx_coverage_requests_kind")
  @@index([city, created_at(sort: Desc)], map: "idx_coverage_requests_city")
}
```

Inside `model profile` (near the existing `seeker_enquiries` line at 864), add:

```prisma
  seeker_coverage_requests                                          coverage_requests[]   @relation("SeekerCoverageRequests")
```

This is a virtual relation field, not a column, so it adds no migration surface on `profiles` and cannot break existing `profile` selects.

- [ ] **Step 3: Regenerate the Prisma client and typecheck the schema**

Run: `cd apps/backend && npm run prisma:generate`
Expected: "Generated Prisma Client". If it fails, the schema has a syntax error — fix before continuing.

- [ ] **Step 4: Confirm the client exposes the model**

Run: `cd apps/backend && node -e "const{PrismaClient}=require('@prisma/client');console.log(typeof new PrismaClient().coverage_requests.create)"`
Expected: prints `function`. This touches no database — it only proves the generated client has the delegate.

- [ ] **Step 5: Commit**

```bash
git add migrations/085_coverage_requests.sql apps/backend/prisma/schema.prisma
git commit -m "feat(db): coverage_requests — demand for areas Stayo does not cover (085)"
```

---

### Task 7: Coverage request parsing rules (backend, pure)

**Files:**
- Create: `apps/backend/src/services/discovery/coverage-request-rules.ts`
- Test: `apps/backend/tests/coverage-request-rules.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` (add the new test to `include`, before the closing `],` at line 231)

**Interfaces:**
- Produces: `normalizeQuery(value: string): string`; `parseCoverageRequest(body: unknown): ParsedCoverageRequest`; types `CoverageSource`, `RecordCoverageRequestInput`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/coverage-request-rules.test.ts
import { describe, expect, it } from 'vitest';
import { normalizeQuery, parseCoverageRequest } from '@/src/services/discovery/coverage-request-rules';

describe('normalizeQuery', () => {
  it('lower-cases and collapses whitespace so the same campus aggregates', () => {
    expect(normalizeQuery('  Osmania   UNIVERSITY ')).toBe('osmania university');
  });
});

describe('parseCoverageRequest', () => {
  it('accepts an area with no contact', () => {
    const parsed = parseCoverageRequest({ area_query: ' Osmania University ' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.areaQuery).toBe('Osmania University');
    expect(parsed.value.normalizedQuery).toBe('osmania university');
    expect(parsed.value.kind).toBe('AREA');
    expect(parsed.value.contactPhone).toBeNull();
    expect(parsed.value.contactEmail).toBeNull();
    expect(parsed.value.source).toBe('HOME');
  });

  it('stores an Indian mobile as ten local digits', () => {
    const parsed = parseCoverageRequest({ area_query: 'BITS', contact: '+91 98765 43210' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.contactPhone).toBe('9876543210');
    expect(parsed.value.contactEmail).toBeNull();
  });

  it('lower-cases an email contact', () => {
    const parsed = parseCoverageRequest({ area_query: 'BITS', contact: 'A@B.CO' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.contactEmail).toBe('a@b.co');
  });

  it('rejects a missing, short or over-long area', () => {
    expect(parseCoverageRequest({}).ok).toBe(false);
    expect(parseCoverageRequest({ area_query: 'a' }).ok).toBe(false);
    expect(parseCoverageRequest({ area_query: 'x'.repeat(121) }).ok).toBe(false);
  });

  it('rejects a non-string area rather than coercing it', () => {
    const parsed = parseCoverageRequest({ area_query: 42 });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toBe('INVALID_AREA');
  });

  it('rejects a malformed contact', () => {
    const parsed = parseCoverageRequest({ area_query: 'BITS', contact: 'nope' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toBe('INVALID_CONTACT');
  });

  it('falls back to HOME for an unknown source rather than trusting the client', () => {
    const parsed = parseCoverageRequest({ area_query: 'BITS', source: 'DROP TABLE' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.source).toBe('HOME');
  });

  it('accepts a hostel referral with just a name', () => {
    const parsed = parseCoverageRequest({ kind: 'HOSTEL', hostel_name: ' Sri Sai Boys Hostel ' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe('HOSTEL');
    expect(parsed.value.hostelName).toBe('Sri Sai Boys Hostel');
    expect(parsed.value.areaQuery).toBeNull();
    expect(parsed.value.normalizedQuery).toBeNull();
    expect(parsed.value.ownerContact).toBeNull();
  });

  it("keeps the owner's number on a referral, as ten local digits", () => {
    const parsed = parseCoverageRequest({ kind: 'HOSTEL', hostel_name: 'Sri Sai', owner_contact: '+91 98765 43210' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.ownerContact).toBe('9876543210');
  });

  it('rejects a referral with no usable hostel name', () => {
    expect(parseCoverageRequest({ kind: 'HOSTEL' }).ok).toBe(false);
    expect(parseCoverageRequest({ kind: 'HOSTEL', hostel_name: 'ab' }).ok).toBe(false);
  });

  it('treats an unknown kind as AREA rather than failing', () => {
    const parsed = parseCoverageRequest({ kind: 'WHATEVER', area_query: 'BITS' });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.kind).toBe('AREA');
  });
});
```

- [ ] **Step 2: Register the test in the pure config and run it**

In `apps/backend/vitest.pure.config.ts`, add `'tests/coverage-request-rules.test.ts',` as the last entry of the `include` array (immediately before the `],` on line 231).

Run: `cd apps/backend && npm run test:pure -- tests/coverage-request-rules.test.ts`
Expected: FAIL — cannot resolve the rules module.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/backend/src/services/discovery/coverage-request-rules.ts
//
// Pure parsing for coverage requests. Imports nothing with I/O, so it runs in
// the `test:pure` suite — which matters, because the DB-backed suite needs a
// test database that is currently paused.

export const AREA_MIN = 2;
export const AREA_MAX = 120;

export const COVERAGE_SOURCES = ["HOME", "HOME_EMPTY", "SEARCH_EMPTY"] as const;
export type CoverageSource = (typeof COVERAGE_SOURCES)[number];

export type CoverageKind = "AREA" | "HOSTEL";

export interface RecordCoverageRequestInput {
  kind: CoverageKind;
  /** Set for AREA; null for HOSTEL. */
  areaQuery: string | null;
  normalizedQuery: string | null;
  /** Set for HOSTEL; null for AREA. */
  hostelName: string | null;
  /** The owner's number on a referral. Optional, always. */
  ownerContact: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  source: CoverageSource;
  seekerProfileId: string | null;
}

export type ParsedCoverageRequest =
  | { ok: true; value: Omit<RecordCoverageRequestInput, "seekerProfileId"> }
  | { ok: false; error: "INVALID_AREA" | "INVALID_CONTACT" | "INVALID_HOSTEL" };

export const HOSTEL_NAME_MIN = 3;
export const HOSTEL_NAME_MAX = 120;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const INDIAN_MOBILE = /^[6-9]\d{9}$/;

/** Lower-cased and whitespace-collapsed, so the same campus aggregates. */
export function normalizeQuery(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function parseContact(raw: unknown): { phone: string | null; email: string | null } | "invalid" {
  if (raw === undefined || raw === null) return { phone: null, email: null };
  if (typeof raw !== "string") return "invalid";
  const value = raw.trim();
  if (!value) return { phone: null, email: null };

  if (value.includes("@")) {
    return EMAIL.test(value) ? { phone: null, email: value.toLowerCase() } : "invalid";
  }
  const digits = value.replace(/\D/g, "");
  const local = digits.length === 12 && digits.startsWith("91") ? digits.slice(2) : digits;
  return INDIAN_MOBILE.test(local) ? { phone: local, email: null } : "invalid";
}

/**
 * The server is the authority on what a supply request is.
 *
 * Two kinds share one endpoint and one table: AREA is demand for a place,
 * HOSTEL is a student naming a hostel that should be listed. Neither is gated
 * on a contact detail — the area and the hostel name are the valuable parts and
 * they are free to collect; making either conditional on a phone number trades
 * most of the signal for a little of the contact. An unrecognised `source` is
 * coerced to HOME rather than rejected: the client has no business widening an
 * enum, and losing the whole signal over a bad label would be the wrong trade.
 */
export function parseCoverageRequest(body: unknown): ParsedCoverageRequest {
  const input = (body ?? {}) as Record<string, unknown>;

  const rawSource = input.source;
  const source = COVERAGE_SOURCES.includes(rawSource as CoverageSource)
    ? (rawSource as CoverageSource)
    : "HOME";

  const kind: CoverageKind = input.kind === "HOSTEL" ? "HOSTEL" : "AREA";

  if (kind === "HOSTEL") {
    const rawName = input.hostel_name;
    if (typeof rawName !== "string") return { ok: false, error: "INVALID_HOSTEL" };
    const hostelName = rawName.trim();
    if (hostelName.length < HOSTEL_NAME_MIN || hostelName.length > HOSTEL_NAME_MAX) {
      return { ok: false, error: "INVALID_HOSTEL" };
    }
    const owner = parseContact(input.owner_contact);
    if (owner === "invalid") return { ok: false, error: "INVALID_CONTACT" };
    return {
      ok: true,
      value: {
        kind,
        areaQuery: null,
        normalizedQuery: null,
        hostelName,
        // A referral's contact is the OWNER's, and it is the whole point of the
        // prong: it turns a hostel name into a phone call.
        ownerContact: owner.phone ?? owner.email,
        contactPhone: null,
        contactEmail: null,
        source,
      },
    };
  }

  const rawArea = input.area_query;
  if (typeof rawArea !== "string") return { ok: false, error: "INVALID_AREA" };
  const areaQuery = rawArea.trim();
  if (areaQuery.length < AREA_MIN || areaQuery.length > AREA_MAX) {
    return { ok: false, error: "INVALID_AREA" };
  }

  const contact = parseContact(input.contact);
  if (contact === "invalid") return { ok: false, error: "INVALID_CONTACT" };

  return {
    ok: true,
    value: {
      kind,
      areaQuery,
      normalizedQuery: normalizeQuery(areaQuery),
      hostelName: null,
      ownerContact: null,
      contactPhone: contact.phone,
      contactEmail: contact.email,
      source,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npm run test:pure -- tests/coverage-request-rules.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/discovery/coverage-request-rules.ts apps/backend/tests/coverage-request-rules.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(api): parse coverage requests, server-side and pure"
```

---

### Task 8: Coverage request handler and service

**Files:**
- Create: `apps/backend/src/services/discovery/coverage-request-handler.ts`
- Create: `apps/backend/src/services/discovery/coverage-request-service.ts`
- Test: `apps/backend/tests/coverage-request-handler.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` (register the handler test too)

**Interfaces:**
- Consumes: `parseCoverageRequest`, `RecordCoverageRequestInput`, `CoverageSource` from Task 7.
- Produces: `handleCoverageRequest(body: unknown, ip: string, deps: CoverageHandlerDeps): Promise<CoverageHandlerResult>`; `coverageRequestService.record(input: RecordCoverageRequestInput)`.

**Why a handler separate from the route:** the route owns Next.js plumbing (JSON parsing, headers, response shape); the handler owns the decision. Injecting the three dependencies means the decision is testable in the pure suite with no database and no Redis — which is the only way it gets tested at all right now.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/coverage-request-handler.test.ts
import { describe, expect, it, vi } from 'vitest';
import { handleCoverageRequest, type CoverageHandlerDeps } from '@/src/services/discovery/coverage-request-handler';

function deps(overrides: Partial<CoverageHandlerDeps> = {}): CoverageHandlerDeps {
  return {
    checkLimit: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    resolveSeekerProfileId: async () => null,
    record: async () => ({ id: 'cr1', willNotify: false }),
    ...overrides,
  };
}

describe('handleCoverageRequest', () => {
  it('records a valid request and reports whether anyone will be told', async () => {
    const record = vi.fn(async () => ({ id: 'cr1', willNotify: true }));
    const result = await handleCoverageRequest(
      { area_query: 'Osmania University', contact: '9876543210' },
      '1.2.3.4',
      deps({ record }),
    );
    expect(result.status).toBe(201);
    expect(result.body).toEqual({ recorded: true, will_notify: true });
    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ areaQuery: 'Osmania University', contactPhone: '9876543210', seekerProfileId: null }),
    );
  });

  it('attaches the seeker when one is signed in', async () => {
    const record = vi.fn(async () => ({ id: 'cr1', willNotify: false }));
    await handleCoverageRequest({ area_query: 'BITS' }, '1.2.3.4', deps({
      record,
      resolveSeekerProfileId: async () => 'profile-9',
    }));
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ seekerProfileId: 'profile-9' }));
  });

  it('rate-limits before doing any work', async () => {
    const record = vi.fn(async () => ({ id: 'x', willNotify: false }));
    const result = await handleCoverageRequest({ area_query: 'BITS' }, '1.2.3.4', deps({
      checkLimit: async () => ({ allowed: false, retryAfterSeconds: 42 }),
      record,
    }));
    expect(result.status).toBe(429);
    expect(result.body).toEqual({ error: 'RATE_LIMITED', retry_after_seconds: 42 });
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects a bad area with 400 and does not record', async () => {
    const record = vi.fn(async () => ({ id: 'x', willNotify: false }));
    const result = await handleCoverageRequest({ area_query: 'a' }, '1.2.3.4', deps({ record }));
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'INVALID_AREA' });
    expect(record).not.toHaveBeenCalled();
  });

  it('rejects a malformed contact with 400', async () => {
    const result = await handleCoverageRequest({ area_query: 'BITS', contact: 'nope' }, '1.2.3.4', deps());
    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: 'INVALID_CONTACT' });
  });

  it('never lets a signed-in lookup failure lose the signal', async () => {
    const result = await handleCoverageRequest({ area_query: 'BITS' }, '1.2.3.4', deps({
      resolveSeekerProfileId: async () => { throw new Error('session backend down'); },
    }));
    expect(result.status).toBe(201);
  });
});
```

- [ ] **Step 2: Register the test and run it**

Add `'tests/coverage-request-handler.test.ts',` to `include` in `apps/backend/vitest.pure.config.ts`.

Run: `cd apps/backend && npm run test:pure -- tests/coverage-request-handler.test.ts`
Expected: FAIL — cannot resolve the handler module.

- [ ] **Step 3: Write the handler**

```ts
// apps/backend/src/services/discovery/coverage-request-handler.ts
import {
  parseCoverageRequest,
  type RecordCoverageRequestInput,
} from "./coverage-request-rules";

export interface CoverageHandlerDeps {
  checkLimit: (ip: string) => Promise<{ allowed: boolean; retryAfterSeconds: number }>;
  resolveSeekerProfileId: () => Promise<string | null>;
  record: (input: RecordCoverageRequestInput) => Promise<{ id: string; willNotify: boolean }>;
}

export type CoverageHandlerResult =
  | { status: 201; body: { recorded: true; will_notify: boolean } }
  | { status: 400; body: { error: "INVALID_AREA" | "INVALID_CONTACT" | "INVALID_HOSTEL" } }
  | { status: 429; body: { error: "RATE_LIMITED"; retry_after_seconds: number } };

/**
 * The decision behind `POST /api/discover/coverage-requests`.
 *
 * Rate limiting runs first so a flood of junk is capped before it is parsed.
 * The seeker lookup is best-effort: a signed-in submission is nicer to have
 * attributed, but an auth hiccup must never cost us the demand signal, which
 * is the entire reason this endpoint exists.
 */
export async function handleCoverageRequest(
  body: unknown,
  ip: string,
  deps: CoverageHandlerDeps,
): Promise<CoverageHandlerResult> {
  const limit = await deps.checkLimit(ip);
  if (!limit.allowed) {
    return { status: 429, body: { error: "RATE_LIMITED", retry_after_seconds: limit.retryAfterSeconds } };
  }

  const parsed = parseCoverageRequest(body);
  if (!parsed.ok) {
    return { status: 400, body: { error: parsed.error } };
  }

  let seekerProfileId: string | null = null;
  try {
    seekerProfileId = await deps.resolveSeekerProfileId();
  } catch {
    seekerProfileId = null;
  }

  const saved = await deps.record({ ...parsed.value, seekerProfileId });
  return { status: 201, body: { recorded: true, will_notify: saved.willNotify } };
}
```

- [ ] **Step 4: Write the service**

```ts
// apps/backend/src/services/discovery/coverage-request-service.ts
import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { RecordCoverageRequestInput } from "./coverage-request-rules";

export const coverageRequestService = {
  /**
   * Persist one coverage request.
   *
   * `lib/db` exports `prisma: any`, so the payload is pinned with `satisfies`
   * — without it a missing required field only surfaces at runtime.
   */
  async record(input: RecordCoverageRequestInput): Promise<{ id: string; willNotify: boolean }> {
    const data = {
      kind: input.kind,
      area_query: input.areaQuery,
      normalized_query: input.normalizedQuery,
      hostel_name: input.hostelName,
      owner_contact: input.ownerContact,
      contact_phone: input.contactPhone,
      contact_email: input.contactEmail,
      source: input.source,
      seeker_profile_id: input.seekerProfileId,
    } satisfies Prisma.coverage_requestsUncheckedCreateInput;

    const row = await prisma.coverage_requests.create({ data, select: { id: true } });
    // A referral notifies nobody: the contact we hold is the owner's, and we
    // are the ones who will call them.
    return {
      id: row.id,
      willNotify: input.kind === "AREA" && Boolean(input.contactPhone || input.contactEmail),
    };
  },
};
```

- [ ] **Step 5: Run tests and typecheck**

Run: `cd apps/backend && npm run test:pure -- tests/coverage-request-handler.test.ts`
Expected: PASS, 6 tests.

Run: `cd apps/backend && npx tsc --noEmit 2>&1 | grep coverage-request`
Expected: no output. (The repo carries a large pre-existing error backlog, so only your own files are meaningful.)

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/services/discovery/coverage-request-handler.ts apps/backend/src/services/discovery/coverage-request-service.ts apps/backend/tests/coverage-request-handler.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(api): coverage request handler, testable without a database"
```

---

### Task 9: The public endpoint

**Files:**
- Create: `apps/backend/app/api/discover/coverage-requests/route.ts`
- Modify: `apps/backend/middleware.ts` (`PUBLIC_ROUTES`, near the existing `/api/discover/hostels` entry at line 32)

**Interfaces:**
- Consumes: `handleCoverageRequest`, `coverageRequestService`, `checkFixedWindowLimit` from `@/lib/redis/rate-limit`, `getSession` from `@/lib/auth`, `ApiResponse` from `@/src/lib/api-response`.
- Produces: `POST /api/discover/coverage-requests`.

- [ ] **Step 1: Write the route**

```ts
// apps/backend/app/api/discover/coverage-requests/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { ApiResponse } from "@/src/lib/api-response";
import { handleCoverageRequest } from "@/src/services/discovery/coverage-request-handler";
import { coverageRequestService } from "@/src/services/discovery/coverage-request-service";

/** Ten a day per address is generous for a person and useless for a script. */
const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 60 * 60;

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Record demand for an area Stayo does not cover yet.
 *
 * Public by design: this fires for visitors who have no account and no
 * intention of making one, and requiring a session would throw away the
 * signal from exactly the people we most need to hear from.
 */
export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const result = await handleCoverageRequest(body, clientIp(req), {
    checkLimit: async (ip) => {
      // A Redis outage must not take the endpoint down — `checkFixedWindowLimit`
      // already returns `allowed: true` when Redis is unreachable. Losing a
      // demand signal is worse than admitting a duplicate.
      const limit = await checkFixedWindowLimit({
        scope: "coverage-request",
        identifier: ip,
        maxAttempts: MAX_ATTEMPTS,
        windowSeconds: WINDOW_SECONDS,
      });
      return { allowed: limit.allowed, retryAfterSeconds: limit.retryAfterSeconds };
    },
    resolveSeekerProfileId: async () => {
      const session = await getSession(req);
      // Owners and admins browsing the marketplace are not seekers; attributing
      // their request to a seeker profile would misreport who wants what.
      return session?.role === "TENANT" ? session.sub : null;
    },
    record: (input) => coverageRequestService.record(input),
  });

  if (result.status === 201) {
    return ApiResponse.success(result.body, undefined, { status: 201 });
  }
  return NextResponse.json({ success: false, ...result.body }, { status: result.status });
}
```

- [ ] **Step 2: Add the allowlist entry**

In `apps/backend/middleware.ts`, inside `PUBLIC_ROUTES`, directly after the `"/api/discover/hostels",` entry:

```ts
  // Coverage requests are submitted by visitors with no account — that is the
  // point of them. Exact path, never "/api/discover": PUBLIC_ROUTES is
  // prefix-matched, and the broad entry would expose every seeker's enquiry
  // history and saved list (ADR-073 point 6).
  "/api/discover/coverage-requests",
```

- [ ] **Step 3: Verify the allowlist entry cannot over-match**

Run: `cd apps/backend && grep -n '"/api/discover' middleware.ts`
Expected: exactly three entries — `/api/discover/hostels`, `/api/discover/coverage-requests`, `/api/discover/share`. **If a bare `"/api/discover"` appears, stop and remove it.**

- [ ] **Step 4: Typecheck your own files**

Run: `cd apps/backend && npx tsc --noEmit 2>&1 | grep -E "coverage-request|api/discover/coverage"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/api/discover/coverage-requests/route.ts apps/backend/middleware.ts
git commit -m "feat(api): POST /api/discover/coverage-requests, public and rate limited"
```

---

### Task 10: Frontend coverage API and hook

**Files:**
- Create: `apps/frontend/src/features/coverage/api/index.ts`
- Create: `apps/frontend/src/features/coverage/hooks/useSubmitCoverageRequest.ts`

**Interfaces:**
- Consumes: `CoveragePayload` from Task 4.
- Produces: `coverageService.submit(payload: CoveragePayload): Promise<CoverageRequestResult>` where `CoverageRequestResult = { recorded: boolean; will_notify: boolean }`; `useSubmitCoverageRequest()`.

- [ ] **Step 1: Write the API wrapper**

```ts
// apps/frontend/src/features/coverage/api/index.ts
import api from '@lib/api-client';

import type { CoveragePayload } from '@/app/pages/public/home/coverageRequest';

/**
 * The only layer that knows the coverage endpoint's shape. Screens and hooks
 * talk to this; nothing else in the app may name the path.
 */

export interface CoverageRequestResult {
  recorded: boolean;
  will_notify: boolean;
}

function unwrap(response: { data: any }) {
  if (response.data && response.data.success !== undefined) {
    return response.data.data !== undefined ? response.data.data : response.data;
  }
  return response.data;
}

export const coverageService = {
  submit: async (payload: CoveragePayload): Promise<CoverageRequestResult> => {
    const response = await api.post('/discover/coverage-requests', payload);
    return unwrap(response) as CoverageRequestResult;
  },
};
```

- [ ] **Step 2: Write the hook**

```ts
// apps/frontend/src/features/coverage/hooks/useSubmitCoverageRequest.ts
import { useMutation } from '@tanstack/react-query';

import { coverageService, type CoverageRequestResult } from '../api';
import type { CoveragePayload } from '@/app/pages/public/home/coverageRequest';

/**
 * No cache invalidation: nothing on the public site reads coverage requests
 * back. The owner-facing aggregate is a later phase and has its own key.
 */
export function useSubmitCoverageRequest() {
  return useMutation<CoverageRequestResult, unknown, CoveragePayload>({
    mutationFn: (payload) => coverageService.submit(payload),
  });
}
```

- [ ] **Step 3: Confirm the architecture check still passes**

Run: `cd apps/frontend && npm run check:architecture`
Expected: PASS. It fails if the new files call `fetch`/`axios` directly — they must go through `@lib/api-client`.

- [ ] **Step 4: Typecheck**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep -E "features/coverage"`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/coverage
git commit -m "feat(home): coverage request api wrapper and mutation hook"
```

---

### Task 11: PublicHeader

**Files:**
- Create: `apps/frontend/src/app/pages/public/components/PublicHeader.tsx`

**Interfaces:**
- Consumes: `ownerDoor` (Task 5), `useOwnerSession` from `@features/owner-session/useOwnerSession` (returns `{ isAuthenticated, hostels, isLoading }`), `StayoMark` from `@shared/ui/brand`.
- Produces: `<PublicHeader />`.

- [ ] **Step 1: Write the component**

```tsx
// apps/frontend/src/app/pages/public/components/PublicHeader.tsx
import { Link } from 'react-router-dom';
import { Building2 } from 'lucide-react';

import { StayoMark } from '@shared/ui/brand';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';

import { ownerDoor } from '../home/homeHeader';

/**
 * The public site's one header.
 *
 * The owner door is a real, visible control at every width — not a hamburger
 * item. Owners are the paying side of this marketplace and must never have to
 * hunt for their entrance; they are simply not half the page, because they are
 * not half the traffic.
 */
export function PublicHeader() {
  const session = useOwnerSession();
  const door = ownerDoor({
    isLoading: session.isLoading,
    isAuthenticated: session.isAuthenticated,
    hostelCount: session.hostels.length,
  });

  return (
    <header className="sticky top-0 z-50 border-b border-border bg-background/92 backdrop-blur-lg">
      <div className="mx-auto flex h-[68px] max-w-6xl items-center gap-4 px-4 sm:h-[76px] sm:gap-8 sm:px-6">
        <Link to="/" className="flex flex-none items-center gap-2.5">
          <StayoMark className="h-7 w-auto text-primary" />
          <span className="font-display text-xl font-extrabold tracking-tight text-foreground">Stayo</span>
        </Link>

        <nav className="hidden items-center gap-7 md:flex">
          <Link to="/discover" className="text-sm font-semibold text-foreground/80 hover:text-primary">
            Browse hostels
          </Link>
          <a href="#how" className="text-sm font-semibold text-foreground/80 hover:text-primary">
            How it works
          </a>
        </nav>

        <div className="flex-1" />

        <Link
          to={door.to}
          state={door.declaresOwnerIntent ? { declaredOwnerIntent: true } : undefined}
          className="inline-flex h-11 flex-none items-center gap-2 rounded-xl border border-border bg-card px-3.5 font-display text-[13px] font-bold text-foreground hover:border-primary/40 sm:px-4.5 sm:text-sm"
        >
          <Building2 className="h-4 w-4 text-primary" strokeWidth={2} aria-hidden="true" />
          {door.label}
        </Link>

        {/* Visible at every width. `LandingPage` shipped this exact bug once —
            login left out of the mobile menu made signing in impossible on a
            phone — and a homepage that hides it repeats it. */}
        <Link to="/login" className="inline-flex h-11 flex-none items-center px-2.5 text-[13.5px] font-semibold text-foreground/80 hover:text-primary sm:px-3 sm:text-sm">
          Log in
        </Link>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Verify the owner-intent handoff is intact**

Run: `cd apps/frontend && grep -n "declaredOwnerIntent" src/app/pages/public/components/PublicHeader.tsx src/app/pages/public/LandingPage.tsx`
Expected: the header passes it as router state; `LandingPage` reads it from `location.state`. This is the ADR-071 point 5 contract — if the names differ, the lead conversation silently stops opening.

- [ ] **Step 3: Typecheck and architecture check**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep PublicHeader; npm run check:architecture`
Expected: no `PublicHeader` errors; architecture check passes.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/app/pages/public/components/PublicHeader.tsx
git commit -m "feat(home): one public header with a permanent owner door"
```

---

### Task 12: Home sections

**Files:**
- Create: `apps/frontend/src/app/pages/public/home/HomeHero.tsx`
- Create: `apps/frontend/src/app/pages/public/home/FeaturedHostels.tsx`
- Create: `apps/frontend/src/app/pages/public/home/SupplyRequestSection.tsx`
- Create: `apps/frontend/src/app/pages/public/home/TrustSection.tsx`
- Create: `apps/frontend/src/app/pages/public/home/HowItWorks.tsx`
- Create: `apps/frontend/src/app/pages/public/home/OwnerBand.tsx`

**Interfaces:**
- Consumes: `planFeatured`/`FeaturedPlan` (Task 2), `listingPhotoUrl` (Task 3), `validateCoverage`/`validateHostelReferral` (Task 4), `useSubmitCoverageRequest` (Task 10), `hostelCardFacts` from `@/app/pages/discover/hostelCardFacts`, `DiscoverCard`.
- Produces: `<HomeHero cityLabel ctaCity lead loading />`, `<FeaturedHostels plan loading />`, `<SupplyRequestSection source />`, `<TrustSection />`, `<HowItWorks />`, `<OwnerBand />`.

**Reference:** the approved visual design is the canvas at https://claude.ai/artifact/3EvwF3FiM5Kzz52M5TMML3 — desktop, 390px mobile, and the zero-listings hero. Match its hierarchy and copy; use theme tokens (`bg-background`, `text-foreground`, `bg-card`, `border-border`, `text-muted-foreground`, `bg-primary`, `font-display`) rather than the canvas's literal hexes, so dark mode and the marketing theme both work.

- [ ] **Step 1: Write `HomeHero.tsx`**

```tsx
// apps/frontend/src/app/pages/public/home/HomeHero.tsx
import { Link } from 'react-router-dom';
import { ArrowRight, FileText, ShieldCheck, Users } from 'lucide-react';

import type { DiscoverCard } from '@features/discover/api';
import { hostelCardFacts } from '@/app/pages/discover/hostelCardFacts';

import { listingPhotoUrl } from './listingPhoto';

interface HomeHeroProps {
  /** "Now live in Pune", or null when there is nothing to promise. */
  cityLabel: string | null;
  /** The city the CTA names, or null when there are no listings. */
  ctaCity: string | null;
  /** The listing whose photograph fronts the page, if any. */
  lead: DiscoverCard | null;
  /** Listings are still in flight — withhold the empty treatment. */
  loading: boolean;
}

/**
 * The hero, in both supply states.
 *
 * With listings it carries the lead listing's own photograph — credited and
 * linked, so it is at once the hero and the first listing, and it cannot be a
 * picture of a hostel you can't actually book. With none it goes brand-only:
 * no stock photography, because a stock hostel is exactly the lie the whole
 * product is positioned against.
 */
export function HomeHero({ cityLabel, ctaCity, lead, loading }: HomeHeroProps) {
  const facts = lead ? hostelCardFacts(lead) : null;
  const photo = listingPhotoUrl(facts?.photo ?? null, 620);

  return (
    <header className="relative px-4 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-16 [background-image:linear-gradient(rgba(180,106,85,.11)_1px,transparent_1px),linear-gradient(90deg,rgba(180,106,85,.11)_1px,transparent_1px)] [background-size:52px_52px]">
      <div className="mx-auto grid max-w-6xl items-center gap-10 lg:grid-cols-2 lg:gap-16">
        <div>
          {cityLabel && (
            <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card py-1.5 pl-2.5 pr-3.5">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              <span className="font-display text-[11px] font-bold uppercase tracking-wider text-primary">{cityLabel}</span>
            </span>
          )}

          <h1 className="mt-5 font-display text-[clamp(42px,6vw,76px)] font-extrabold leading-[1.02] tracking-tight text-foreground">
            Hostel living,
            <br />
            sorted.
          </h1>

          <p className="mt-5 max-w-[460px] text-[clamp(15px,1.6vw,18px)] leading-relaxed text-muted-foreground">
            Verified hostels with real photos, real prices and a real person on the other end. No brokers in the middle.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <Link
              to="/discover"
              className="inline-flex h-14 items-center gap-2.5 rounded-[15px] bg-foreground px-6 font-display text-base font-bold text-background"
            >
              {ctaCity ? `See hostels in ${ctaCity}` : 'Browse hostels'}
              <ArrowRight className="h-4 w-4 text-primary" strokeWidth={2.2} />
            </Link>
            <span className="text-[13.5px] font-semibold text-muted-foreground">Visited and verified before listing</span>
          </div>

          <ul className="mt-9 flex flex-wrap items-center gap-6">
            <li className="inline-flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
              <ShieldCheck className="h-4 w-4 text-primary" strokeWidth={1.9} aria-hidden="true" /> Verified hostels only
            </li>
            <li className="inline-flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
              <Users className="h-4 w-4 text-primary" strokeWidth={1.9} aria-hidden="true" /> Straight to the owner
            </li>
            <li className="inline-flex items-center gap-2 text-[13px] font-semibold text-foreground/80">
              <FileText className="h-4 w-4 text-primary" strokeWidth={1.9} aria-hidden="true" /> Digital agreement
            </li>
          </ul>
        </div>

        {loading && (
          <div className="h-[280px] w-full animate-pulse rounded-3xl bg-secondary sm:h-[430px]" aria-hidden="true" />
        )}

        {!loading && lead && facts && photo && lead.slug && (
          <div className="relative">
            <Link to={`/discover/h/${lead.slug}`} className="block">
              <img
                src={photo}
                alt={`${lead.name} — ${facts.location}`}
                width={620}
                height={430}
                className="h-[280px] w-full rounded-3xl border border-border object-cover sm:h-[430px]"
              />
            </Link>
            <div className="absolute inset-x-4 bottom-4 flex items-center gap-4 rounded-[18px] bg-card p-4 shadow-2xl sm:inset-x-6 sm:bottom-6 sm:p-5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-display text-[17px] font-extrabold text-foreground">{lead.name}</div>
                <div className="mt-0.5 truncate text-[13px] font-medium text-muted-foreground">
                  {facts.location} · {facts.availability.label}
                </div>
              </div>
              <div className="flex-none text-right">
                <div className="font-display text-lg font-extrabold text-foreground">{facts.price ?? 'On request'}</div>
                {facts.price && <div className="text-[11.5px] font-semibold text-muted-foreground">per month</div>}
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
```

- [ ] **Step 2: Write `FeaturedHostels.tsx`**

```tsx
// apps/frontend/src/app/pages/public/home/FeaturedHostels.tsx
import { Link } from 'react-router-dom';
import { ArrowRight, Check } from 'lucide-react';

import type { DiscoverCard } from '@features/discover/api';
import { hostelCardFacts } from '@/app/pages/discover/hostelCardFacts';

import { listingPhotoUrl } from './listingPhoto';
import type { FeaturedPlan } from './homeFeatured';

/**
 * ONE link, not a card containing a button.
 *
 * The first pass wrapped the photo in a link and put a second link in the
 * footer, so the card looked entirely clickable while only two parts of it
 * were — and a keyboard user hit two tab stops for one destination. The whole
 * card is the target; "View listing" is an affordance, not a second control.
 */
function FeaturedHostelCard({ hostel }: { hostel: DiscoverCard }) {
  const facts = hostelCardFacts(hostel);
  const photo = listingPhotoUrl(facts.photo, 560);

  return (
    <Link
      to={hostel.slug ? `/discover/h/${hostel.slug}` : '/discover'}
      className="block overflow-hidden rounded-[22px] border border-border bg-card no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      aria-label={`${hostel.name}, ${facts.location}`}
    >
      <div className="block">
        <div className="relative">
          {photo ? (
            <img src={photo} alt={hostel.name} width={560} height={240} className="h-[190px] w-full object-cover sm:h-[240px]" />
          ) : (
            <div className="h-[190px] w-full bg-secondary sm:h-[240px]" />
          )}
          {hostel.verified && (
            <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full bg-background px-3 py-1.5 text-[11.5px] font-bold text-[#3F6B50]">
              <Check className="h-3 w-3" strokeWidth={2.6} aria-hidden="true" /> Verified
            </span>
          )}
        </div>
      </div>

      <div className="p-5 sm:p-6">
        <div className="flex items-baseline gap-3">
          <h3 className="flex-1 font-display text-lg font-extrabold text-foreground sm:text-xl">{hostel.name}</h3>
          <span className={facts.price ? 'font-display text-lg font-extrabold text-foreground' : 'text-sm font-bold text-muted-foreground'}>
            {facts.price ?? 'Price on request'}
          </span>
        </div>
        <p className="mt-1.5 text-sm font-medium text-muted-foreground">{facts.location}</p>

        <div className="mt-4 flex flex-wrap gap-2">
          {facts.sharing.map((label) => (
            <span key={label} className="rounded-full bg-secondary px-3 py-1.5 text-[12.5px] font-semibold text-foreground/80">{label}</span>
          ))}
          {facts.meals && <span className="rounded-full bg-secondary px-3 py-1.5 text-[12.5px] font-semibold text-foreground/80">Food included</span>}
          {facts.audience && <span className="rounded-full bg-secondary px-3 py-1.5 text-[12.5px] font-semibold text-foreground/80">{facts.audience}</span>}
        </div>

        <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
          <span className="flex-1 text-[13.5px] font-bold text-[#3F6B50]">{facts.availability.label}</span>
          <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold text-primary" aria-hidden="true">
            View listing <ArrowRight className="h-4 w-4" strokeWidth={2.3} />
          </span>
        </div>
      </div>
    </Link>
  );
}

/**
 * Every listing, framed as every listing.
 *
 * "Not a selection — all of them" turns a small marketplace into a claim about
 * honesty rather than an apology for size, and it stays true automatically:
 * the heading does not have to change when supply grows, only the layout does.
 */
export function FeaturedHostels({ plan, loading }: { plan: FeaturedPlan; loading: boolean }) {
  // A skeleton row, never the "we have nothing" framing, while data is in flight.
  if (loading) {
    return (
      <section className="bg-card px-4 py-16 sm:px-6 sm:py-20" aria-busy="true">
        <div className="mx-auto grid max-w-6xl gap-6 sm:grid-cols-2">
          <div className="h-[420px] animate-pulse rounded-[22px] bg-secondary" />
          <div className="h-[420px] animate-pulse rounded-[22px] bg-secondary" />
        </div>
      </section>
    );
  }
  if (plan.layout === 'none') return null;

  return (
    <section id="listings" className="bg-card px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end gap-6">
          <div className="flex-1">
            <h2 className="font-display text-[clamp(28px,4vw,40px)] font-extrabold leading-[1.08] tracking-tight text-foreground">
              Every hostel on Stayo, right now
            </h2>
            <p className="mt-3.5 max-w-[620px] text-base leading-relaxed text-muted-foreground sm:text-[16.5px]">
              Not a selection — all of them. We would rather show you every hostel we have than pretend to be bigger than we are.
            </p>
          </div>
          {plan.showBrowseAll && (
            <Link to="/discover" className="inline-flex items-center gap-2 font-display text-[14.5px] font-bold text-primary">
              Browse all <ArrowRight className="h-4 w-4" strokeWidth={2.2} />
            </Link>
          )}
        </div>

        <div className={`mt-10 grid gap-6 ${plan.layout === 'editorial' ? 'sm:grid-cols-2' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
          {plan.cards.map((hostel) => (
            <FeaturedHostelCard key={hostel.id} hostel={hostel} />
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Write `SupplyRequestSection.tsx`**

Two prongs, one section, one endpoint. Prong (a) is student-led owner acquisition — the student
names a hostel and Stayo approaches the owner. Prong (b) is demand for a place Stayo does not
cover. Each is an independent form with its own success state, so submitting one never clears the
other.

```tsx
// apps/frontend/src/app/pages/public/home/SupplyRequestSection.tsx
import { useState, type FormEvent } from 'react';
import { HousePlus, MapPin } from 'lucide-react';

import { useSubmitCoverageRequest } from '@features/coverage/hooks/useSubmitCoverageRequest';

import { validateCoverage, validateHostelReferral } from './coverageRequest';

interface SupplyRequestSectionProps {
  /** 'HOME' from the normal page, 'HOME_EMPTY' when there are no listings. */
  source: string;
}

const FIELD =
  'mt-2 h-[50px] w-full rounded-[13px] border border-white/15 bg-white/[0.06] px-4 text-[15px] text-background placeholder:text-background/45';
const LABEL = 'mt-3.5 block font-display text-[11px] font-bold uppercase tracking-wider text-primary';
const SUBMIT =
  'mt-4 h-[50px] w-full rounded-[13px] bg-primary font-display text-[15px] font-extrabold text-primary-foreground disabled:opacity-60';

/** A student naming the hostel they already live in is an owner lead. */
function ReferHostelForm({ source }: { source: string }) {
  const [hostelName, setHostelName] = useState('');
  const [ownerContact, setOwnerContact] = useState('');
  const [errors, setErrors] = useState<{ hostelName?: string; ownerContact?: string }>({});
  const submit = useSubmitCoverageRequest();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateHostelReferral({ hostelName, ownerContact }, source);
    setErrors(result.errors);
    if (result.valid && result.payload) submit.mutate(result.payload);
  };

  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.055] p-6">
      <HousePlus className="h-6 w-6 text-primary" strokeWidth={1.9} aria-hidden="true" />
      <h3 className="mt-3 font-display text-[19px] font-extrabold text-background">Get your hostel on Stayo</h3>
      <p className="mt-2 text-sm leading-relaxed text-background/70">
        Living somewhere that isn't listed? Name it and we'll approach the owner ourselves. Your hostel gets a real
        page — and you get rent receipts and complaints that don't get lost.
      </p>

      {submit.isSuccess ? (
        <p className="mt-5 text-[15px] font-semibold text-background" role="status" aria-live="polite">
          Got it — we'll reach out to them. Thank you.
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="refer-name" className={LABEL}>Hostel name</label>
          <input
            id="refer-name"
            type="text"
            value={hostelName}
            onChange={(event) => setHostelName(event.target.value)}
            placeholder="e.g. Sri Sai Boys Hostel"
            aria-invalid={Boolean(errors.hostelName)}
            aria-describedby={errors.hostelName ? 'refer-name-error' : undefined}
            className={FIELD}
          />
          {errors.hostelName && <p id="refer-name-error" className="mt-1.5 text-[13px] font-semibold text-primary">{errors.hostelName}</p>}

          <label htmlFor="refer-owner" className={LABEL}>
            Owner's number <span className="font-semibold normal-case tracking-normal text-background/60">— optional</span>
          </label>
          <input
            id="refer-owner"
            type="tel"
            value={ownerContact}
            onChange={(event) => setOwnerContact(event.target.value)}
            placeholder="So we can call them"
            aria-invalid={Boolean(errors.ownerContact)}
            aria-describedby={errors.ownerContact ? 'refer-owner-error' : undefined}
            className={FIELD}
          />
          {errors.ownerContact && <p id="refer-owner-error" className="mt-1.5 text-[13px] font-semibold text-primary">{errors.ownerContact}</p>}

          <button type="submit" disabled={submit.isPending} className={SUBMIT}>
            {submit.isPending ? 'Sending…' : 'Refer this hostel'}
          </button>
          <p className="mt-2.5 text-[12.5px] font-medium text-background/60">We do the asking — you don't have to.</p>
          {submit.isError && (
            <p className="mt-2 text-[13px] font-semibold text-primary" role="alert">That didn't send. Try again in a moment.</p>
          )}
        </form>
      )}
    </div>
  );
}

/** Demand for a place Stayo has no supply in. */
function AreaRequestForm({ source }: { source: string }) {
  const [area, setArea] = useState('');
  const [contact, setContact] = useState('');
  const [errors, setErrors] = useState<{ area?: string; contact?: string }>({});
  const submit = useSubmitCoverageRequest();

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    const result = validateCoverage({ area, contact }, source);
    setErrors(result.errors);
    if (result.valid && result.payload) submit.mutate(result.payload);
  };

  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.055] p-6">
      <MapPin className="h-6 w-6 text-primary" strokeWidth={1.9} aria-hidden="true" />
      <h3 className="mt-3 font-display text-[19px] font-extrabold text-background">Not in your area yet?</h3>
      <p className="mt-2 text-sm leading-relaxed text-background/70">
        Tell us the campus you're near. We'll go and find hostels there, and you'll be the first to know when one lists.
      </p>

      {submit.isSuccess ? (
        <p className="mt-5 text-[15px] font-semibold text-background" role="status" aria-live="polite">
          {submit.data?.will_notify
            ? "Noted — we'll message you when a hostel lists there."
            : "Noted — we've recorded the area."}
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="area-query" className={LABEL}>Your college or area</label>
          <input
            id="area-query"
            type="text"
            value={area}
            onChange={(event) => setArea(event.target.value)}
            placeholder="e.g. Osmania University"
            aria-invalid={Boolean(errors.area)}
            aria-describedby={errors.area ? 'area-query-error' : undefined}
            className={FIELD}
          />
          {errors.area && <p id="area-query-error" className="mt-1.5 text-[13px] font-semibold text-primary">{errors.area}</p>}

          <label htmlFor="area-contact" className={LABEL}>
            Your phone <span className="font-semibold normal-case tracking-normal text-background/60">— optional</span>
          </label>
          <input
            id="area-contact"
            type="text"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            placeholder="So we can tell you"
            aria-invalid={Boolean(errors.contact)}
            aria-describedby={errors.contact ? 'area-contact-error' : undefined}
            className={FIELD}
          />
          {errors.contact && <p id="area-contact-error" className="mt-1.5 text-[13px] font-semibold text-primary">{errors.contact}</p>}

          <button type="submit" disabled={submit.isPending} className={SUBMIT}>
            {submit.isPending ? 'Sending…' : 'Tell Stayo'}
          </button>
          <p className="mt-2.5 text-[12.5px] font-medium text-background/60">Just the area is enough — we record it either way.</p>
          {submit.isError && (
            <p className="mt-2 text-[13px] font-semibold text-primary" role="alert">That didn't send. Try again in a moment.</p>
          )}
        </form>
      )}
    </div>
  );
}

/**
 * The supply engine, and the reason this page earns its keep at two listings.
 *
 * A student who names an uncovered campus is demand data. A student who names
 * the hostel they already live in is an owner lead with a phone number attached
 * — the cheapest owner acquisition Stayo has, because the student does the
 * finding and Stayo only has to make the call.
 */
export function SupplyRequestSection({ source }: SupplyRequestSectionProps) {
  return (
    <section className="bg-card px-4 pb-16 sm:px-6 sm:pb-20">
      <div className="mx-auto max-w-6xl rounded-[28px] bg-foreground p-7 sm:p-12">
        <span className="font-display text-xs font-bold uppercase tracking-[0.14em] text-primary">Help Stayo grow</span>
        <h2 className="mt-3.5 font-display text-[clamp(26px,3.6vw,38px)] font-extrabold leading-[1.1] tracking-tight text-background">
          Can't find the hostel you want?
        </h2>
        <p className="mt-3 max-w-[640px] text-base leading-relaxed text-background/70">
          Two ways to fix that. Both take under a minute, and both make the list better for whoever looks next.
        </p>

        <div className="mt-7 grid gap-5 lg:grid-cols-2">
          <ReferHostelForm source={source} />
          <AreaRequestForm source={source} />
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Write `TrustSection.tsx`, `HowItWorks.tsx` and `OwnerBand.tsx`**

```tsx
// apps/frontend/src/app/pages/public/home/TrustSection.tsx
import { CreditCard, FileCheck2, ShieldCheck, Users } from 'lucide-react';

const FACTS = [
  { Icon: ShieldCheck, title: 'Visited before listed', body: 'Every hostel is verified by us before it can appear here.' },
  { Icon: Users, title: 'Straight to the owner', body: 'Your enquiry goes to the person who runs the hostel, not an agent.' },
  { Icon: FileCheck2, title: 'Agreement in writing', body: 'A digital agreement and receipts you can actually produce later.' },
  { Icon: CreditCard, title: 'Licensed payment rails', body: 'Rent moves through a regulated aggregator, not a personal account.' },
];

/**
 * The brand spine — a claim about the channel, never about money.
 *
 * An earlier draft led with "Stayo earns nothing from your rent". A planned
 * per-converted-tenant fee makes that unsafe, and the amount is not settled, so
 * nothing about revenue, commission or brokerage appears here. What is true
 * regardless of pricing is that every hostel is verified before listing and the
 * enquiry reaches whoever runs it — no agent in the middle.
 */
export function TrustSection() {
  return (
    <section className="px-4 py-16 sm:px-6 sm:py-20">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-[760px]">
          <span className="font-display text-xs font-bold uppercase tracking-[0.14em] text-primary">Why you can trust this</span>
          <h2 className="mt-4 font-display text-[clamp(32px,4.6vw,48px)] font-extrabold leading-[1.06] tracking-tight text-foreground">
            No agents.
            <br />
            Just you and the hostel.
          </h2>
          <p className="mt-4.5 text-[17px] leading-relaxed text-muted-foreground">
            Every hostel here is visited and verified before it goes live. Your enquiry reaches the person who actually
            runs it, not an agent or a call centre. And what you agree is written down, with receipts you can produce
            months later.
          </p>
        </div>

        <div className="mt-11 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {FACTS.map(({ Icon, title, body }) => (
            <div key={title} className="rounded-[18px] border border-border bg-card p-6">
              <Icon className="h-6 w-6 text-primary" strokeWidth={1.8} aria-hidden="true" />
              <h3 className="mt-3.5 font-display text-base font-extrabold text-foreground">{title}</h3>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

```tsx
// apps/frontend/src/app/pages/public/home/HowItWorks.tsx
const STEPS = [
  { n: '1', title: 'Browse', body: 'Real photos, real prices, and how many beds are actually free.' },
  { n: '2', title: 'Enquire', body: 'Your enquiry goes straight to the owner — no agent in between.' },
  { n: '3', title: 'Visit', body: 'See it yourself, with your parents if you want. Book a time.' },
  { n: '4', title: 'Move in', body: 'Agreement, rent and receipts all live in one place afterwards.' },
];

export function HowItWorks() {
  return (
    <section id="how" className="px-4 pb-16 sm:px-6 sm:pb-20">
      <div className="mx-auto max-w-6xl">
        <h2 className="font-display text-[clamp(26px,3.2vw,32px)] font-extrabold tracking-tight text-foreground">How it works</h2>
        <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step) => (
            <div key={step.n}>
              <span className="flex h-[34px] w-[34px] items-center justify-center rounded-full bg-primary font-display text-[15px] font-extrabold text-primary-foreground">
                {step.n}
              </span>
              <h3 className="mt-3.5 font-display text-lg font-extrabold text-foreground">{step.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{step.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

```tsx
// apps/frontend/src/app/pages/public/home/OwnerBand.tsx
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';

import { StayoMark } from '@shared/ui/brand';

/**
 * The seam, kept and repurposed.
 *
 * `WelcomePage` used this diagonal as a gate you had to resolve before you saw
 * anything. Here it is the same gesture — same clip-path, same mark riding it
 * — marking where the page turns from students to owners. You scroll past it
 * instead of being stopped by it, which is the whole difference between a
 * brand and an interrogation.
 */
export function OwnerBand() {
  return (
    <section className="relative overflow-hidden">
      <div className="absolute inset-0 bg-foreground [clip-path:polygon(0_62px,100%_0,100%_100%,0_100%)] sm:[clip-path:polygon(0_88px,100%_0,100%_100%,0_100%)]" />

      <div className="absolute left-1/2 top-[31px] z-10 -translate-x-1/2 -translate-y-1/2 sm:top-[44px]">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-background shadow-xl ring-[5px] ring-background/90 sm:h-14 sm:w-14">
          <StayoMark className="h-6 w-auto text-primary sm:h-7" />
        </div>
      </div>

      <div className="relative mx-auto max-w-6xl px-4 pb-14 pt-[104px] sm:px-6 sm:pb-20 sm:pt-[168px]">
        <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/15 px-3.5 py-1.5 font-display text-[11px] font-bold uppercase tracking-wider text-primary">
              For hostel owners
            </span>
            <h2 className="mt-4.5 font-display text-[clamp(28px,4.2vw,42px)] font-extrabold leading-[1.08] tracking-tight text-background">
              Run a hostel? Fill it, and stop chasing rent.
            </h2>
            <p className="mt-3.5 max-w-[560px] text-base leading-relaxed text-background/70 sm:text-[16.5px]">
              Live occupancy, rent on autopilot, WhatsApp reminders that chase themselves — and the students above, sent
              straight to your inbox.
            </p>
          </div>

          <div className="lg:pt-13">
            <Link
              to="/owners"
              state={{ declaredOwnerIntent: true }}
              className="flex h-14 items-center justify-center gap-2.5 rounded-[15px] bg-primary font-display text-base font-extrabold text-primary-foreground"
            >
              List your hostel
              <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
            </Link>
            <p className="mt-3.5 text-center text-[13px] font-semibold text-background/60">Free to list · No card needed</p>
          </div>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Typecheck and architecture check**

Run: `cd apps/frontend && npx tsc --noEmit 2>&1 | grep "pages/public/home"; npm run check:architecture`
Expected: no errors from the new files; architecture check passes.

- [ ] **Step 6: Commit**

```bash
git add apps/frontend/src/app/pages/public/home
git commit -m "feat(home): hero, listings, coverage, trust, steps and the owner seam"
```

---

### Task 13: HomePage and the route swap

**Files:**
- Create: `apps/frontend/src/app/pages/public/HomePage.tsx`
- Modify: `apps/frontend/src/app/router/PublicRoutes.tsx` (line 8 import; the `/` route at line 88)
- Modify: `apps/frontend/src/app/pages/public/WelcomePage.tsx` (header comment only)

**Interfaces:**
- Consumes: every section from Task 12, `PublicHeader` (Task 11), `useDiscoverSearch` from `@features/discover/hooks/useDiscover`, `MarketingFooter`, `ThemeProvider`.

- [ ] **Step 1: Write `HomePage.tsx`**

```tsx
// apps/frontend/src/app/pages/public/HomePage.tsx
import { useEffect, useMemo } from 'react';

import { useDiscoverSearch } from '@features/discover/hooks/useDiscover';
import { ThemeProvider } from '@/app/providers/ThemeProvider';

import { PublicHeader } from './components/PublicHeader';
import { MarketingFooter } from './components/MarketingFooter';
import { SupplyRequestSection } from './home/SupplyRequestSection';
import { FeaturedHostels } from './home/FeaturedHostels';
import { HomeHero } from './home/HomeHero';
import { HowItWorks } from './home/HowItWorks';
import { OwnerBand } from './home/OwnerBand';
import { TrustSection } from './home/TrustSection';
import { homeSupplyState, planFeatured } from './home/homeFeatured';
import { citiesFromFacets, liveCities, liveCityLabel, primaryCity } from './home/liveCities';

/** Enough to fill the grid and derive the city list; the rest is `/discover`. */
const HOME_LISTING_LIMIT = 12;

/**
 * `/` — the front door (ADR-214).
 *
 * This replaces `WelcomePage`, which asked "student or owner?" before it said
 * what Stayo was. Students are the volume, so they get the default; owners are
 * the paying side, so their door is in the header on every screen. The page
 * renders for everyone including signed-in owners and never redirects off `/`
 * — an owner has to be able to look at the marketplace they are paying for
 * (ADR-071 point 4, which was reverted in a day the one time it was violated).
 */
export function HomePage() {
  const { data, isLoading } = useDiscoverSearch({ limit: HOME_LISTING_LIMIT, sort: 'recommended' });

  useEffect(() => {
    document.title = 'Stayo — hostel living, sorted';
  }, []);

  const cards = useMemo(() => data?.results ?? [], [data]);
  const plan = useMemo(() => planFeatured(cards), [cards]);
  // Facets describe every matching hostel; the cards are only this page of
  // them. Fall back to the cards if the server ever stops sending facets.
  const cities = useMemo(() => {
    const faceted = citiesFromFacets(data?.facets?.cities);
    return faceted.length > 0 ? faceted : liveCities(cards);
  }, [data, cards]);

  const state = homeSupplyState(isLoading, cards.length);

  return (
    <ThemeProvider theme="marketing">
      <div className="min-h-screen bg-background text-foreground">
        <PublicHeader />
        {/* While loading, the chip and the lead photo are withheld rather than
            replaced with the zero-supply treatment — see `homeSupplyState`. */}
        <HomeHero
          cityLabel={state === 'ready' ? liveCityLabel(cities) : null}
          ctaCity={state === 'ready' ? primaryCity(cities) : null}
          lead={state === 'ready' ? plan.lead : null}
          loading={state === 'loading'}
        />
        <FeaturedHostels plan={plan} loading={state === 'loading'} />
        <SupplyRequestSection source={state === 'empty' ? 'HOME_EMPTY' : 'HOME'} />
        <TrustSection />
        <HowItWorks />
        <OwnerBand />
        <MarketingFooter />
      </div>
    </ThemeProvider>
  );
}
```

- [ ] **Step 2: Sanity-check the response shape you are consuming**

Run: `cd apps/frontend && grep -n "interface DiscoverSearchResult" -A8 src/features/discover/api/index.ts`
Expected: `results: DiscoverCard[]` and `facets: { cities: { city: string; count: number }[] }` — both already verified while writing this plan. If either has been renamed since, update `HomePage.tsx` to match rather than reshaping the API.

- [ ] **Step 3: Swap the route**

In `apps/frontend/src/app/router/PublicRoutes.tsx`, add beside the other lazy imports:

```tsx
const HomePage = lazy(() => import('@/app/pages/public/HomePage').then((m) => ({ default: m.HomePage })));
```

Replace the `/` route and its comment block (the ADR-071 comment above line 88) with:

```tsx
        {/* ADR-214: `/` is a student-first homepage, not an audience chooser.
            ADR-071's fork asked which audience you were before it said what
            Stayo is; the owner door now lives in the header of every public
            page instead. `/owners` is unchanged and is still where every
            owner CTA and route guard points. */}
        <Route path="/" element={<HomePage />} />
```

Leave the `/owners` and `/login` routes exactly as they are.

- [ ] **Step 4: Mark `WelcomePage` as unmounted**

Add to the top of the existing block comment in `apps/frontend/src/app/pages/public/WelcomePage.tsx`:

```
 * ⚠️ UNMOUNTED (ADR-214). `/` is now `HomePage`. This file, `welcome.css` and
 * `FootprintTrail` are kept on disk — the same treatment `DiscoverRoutes` got
 * under ADR-170 — so the seam and the splash remain recoverable. Nothing
 * routes here; reviving it means re-registering the route in PublicRoutes.
```

- [ ] **Step 5: Verify nothing still routes to WelcomePage**

Run: `cd apps/frontend && grep -rn "WelcomePage" src/ | grep -v "pages/public/WelcomePage.tsx"`
Expected: no output. If `PublicRoutes.tsx` still imports it, remove the now-unused lazy import.

- [ ] **Step 6: Run the full frontend suite, typecheck and build**

Run: `cd apps/frontend && npm test && npm run check:architecture && npx tsc --noEmit 2>&1 | grep -E "pages/public/(HomePage|home/|components/PublicHeader)" ; npm run build`
Expected: tests pass, architecture check passes, no typecheck errors in your files, build succeeds.

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/app/pages/public/HomePage.tsx apps/frontend/src/app/router/PublicRoutes.tsx apps/frontend/src/app/pages/public/WelcomePage.tsx
git commit -m "feat(home): / becomes a student-first homepage; retire the audience gate (ADR-214)"
```

---

### Task 14: SEO

**Files:**
- Modify: `apps/frontend/public/sitemap.xml`, `apps/frontend/index.html`

- [ ] **Step 1: Promote the root in the sitemap**

Replace the comment and priority on the `/` and `/owners` entries:

```xml
  <!-- ADR-214: `/` is a student-first homepage with real listings, trust copy
       and coverage capture — the page worth crawling. ADR-071's chooser (thin,
       nothing to rank on) is retired, and with it the 0.7 demotion. -->
  <url>
    <loc>https://yourstayo.com/</loc>
    <lastmod>2026-09-17</lastmod>
    <changefreq>weekly</changefreq>
    <priority>1.0</priority>
  </url>
  <url>
    <loc>https://yourstayo.com/owners</loc>
    <lastmod>2026-09-17</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.9</priority>
  </url>
```

- [ ] **Step 2: Make the shell's metadata student-first**

In `apps/frontend/index.html`, replace the `<title>` and the `description`/`og:title`/`og:description` values:

```html
    <title>Stayo | Verified hostels &amp; PGs for students — hostel living, sorted</title>
    <meta name="description"
      content="Find verified hostels and PGs near your campus — real photos, real prices, and an enquiry that goes straight to the person who runs the hostel. Hostel owners: fill empty beds and collect rent on autopilot." />
```

```html
    <meta property="og:title" content="Stayo | Verified hostels &amp; PGs — hostel living, sorted" />
    <meta property="og:description"
      content="Verified hostels with real photos and real prices. Your enquiry goes straight to the hostel owner." />
```

- [ ] **Step 3: Add Organization JSON-LD**

Before `</head>` in `apps/frontend/index.html`:

```html
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        "name": "Stayo",
        "url": "https://yourstayo.com/",
        "description": "Verified hostel and PG marketplace for students, and operations software for hostel owners.",
        "parentOrganization": { "@type": "Organization", "name": "Trishul Solutions" }
      }
    </script>
```

- [ ] **Step 4: Verify the sitemap is still well-formed**

Run: `cd apps/frontend && python3 -c "import xml.dom.minidom,sys; xml.dom.minidom.parse('public/sitemap.xml'); print('well-formed')"`
Expected: prints `well-formed`.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/public/sitemap.xml apps/frontend/index.html
git commit -m "feat(seo): promote / to priority 1.0 and make its metadata student-first"
```

---

### Task 15: Documentation

**Files:**
- Modify: `docs/obsidian/Decisions.md`, `Features.md`, `Changelog.md`, `APIs.md`, `Database.md`, `Frontend.md`
- Modify: `docs/data-models/schema.md`
- Modify: `docs/superpowers/specs/2026-09-17-public-homepage-redesign-design.md`

This is not optional follow-up. Per `CLAUDE.md`, a change in these categories that ships without the vault update is incomplete work.

- [ ] **Step 1: Re-check the ADR number**

Run: `git show origin/main:docs/obsidian/Decisions.md | grep -oE 'ADR-[0-9]+' | sed 's/ADR-//' | sort -n | tail -1`
Expected: `213`. If it is higher, use the next free number everywhere below instead of 214.

- [ ] **Step 2: Write ADR-214 in `docs/obsidian/Decisions.md`**

Append, matching the file's recent `### ADR-NNN — title (date)` heading style:

```markdown
### ADR-214 — `/` is a student-first homepage; the audience gate is retired (2026-09-17)

- **Context:** [[Decisions#ADR-071|ADR-071]] made `/` a diagonal-seam audience chooser. It asked "student or owner?" before saying what Stayo is, could not scroll (`fixed inset-0 overflow-hidden`), and clipped both panels on a phone because both render expanded at rest. Its own 2026-08-15 amendment left the root's SEO question open once Discover shipped. Meanwhile the legal work settled that **the owner subscription is Stayo's only revenue** — no share of rent.
- **Decision:** `/` becomes `HomePage`: a scrolling, student-first page leading with place and real listings, with the owner door in the header of every public page. Owners pay, but what they buy is filled beds, so student traffic is the inventory being sold rather than a cost — students get the default, owners get a permanent door. **One domain, path-based; no owner/tenant URL split.** The right axis is public-vs-app (`app.yourstayo.com`), deferred to v2. At 1–2 live listings there is **no search box** — a search field is a promise of inventory — and **coverage requests are a first-class feature**, because a student naming an uncovered campus is the demand signal that recruits owners. The seam survives as the section transition into the owner band rather than a gate. `WelcomePage` is unmounted, not deleted (the [[Decisions#ADR-170|ADR-170]] treatment).
- **Consequences:** `/` moves to sitemap priority 1.0. A new `coverage_requests` table and one public endpoint. The owner-facing aggregate ("N students searched near you") is phase 2 — collection ships first, because a signal not collected cannot be aggregated later. `/` is still a client-rendered SPA, so crawler-visible content still needs prerendering; that is now the highest-value follow-up.
- **Related:** [[Decisions#ADR-071|ADR-071]] (the fork this retires), [[Decisions#ADR-073|ADR-073]] (no invented listing data, and the allowlist rule), [[Features]], [[APIs]], [[Database]], [[Frontend]], [[Changelog]]
```

- [ ] **Step 3: Update the remaining vault pages**

- `Features.md` — add the homepage, the live-city chip, featured listings and coverage requests; link `[[Decisions#ADR-214|ADR-214]]`.
- `APIs.md` — document `POST /api/discover/coverage-requests`: public, rate limited 10/hour/IP, body `{ area_query, contact?, source? }`, responses `201 { recorded, will_notify }` / `400 { error }` / `429 { error, retry_after_seconds }`.
- `Database.md` — add `coverage_requests` with its columns, both indexes, and the note that it deliberately has no unique constraint.
- `Frontend.md` — record `HomePage`, `PublicHeader`, the `home/` pure modules, and that `WelcomePage` is unmounted.
- `Changelog.md` — one entry linking the ADR.
- `docs/data-models/schema.md` — add the table alongside the `docs/obsidian/Database.md` change.

Every edited note must link at least one other note with a `[[wiki link]]`.

- [ ] **Step 4: Amend the spec where implementation diverged**

In the spec's §6, the zero-listings hero uses **static decorative footprint marks**, not the interactive `FootprintTrail` (which is built around the seam's `pct` and has no meaning on a scrolling page). Update decision 12's parenthetical accordingly so the spec and the code agree.

- [ ] **Step 5: Check the vault has no broken links**

Run: `grep -oE "\[\[[^]|#]+" docs/obsidian/*.md | sed 's/.*\[\[//' | sort -u | while read -r p; do [ -f "docs/obsidian/$p.md" ] || echo "BROKEN: $p"; done`
Expected: no `BROKEN:` lines for pages you added links to.

- [ ] **Step 6: Commit**

```bash
git add docs/
git commit -m "docs: ADR-214 and the vault updates for the homepage redesign"
```

---

### Task 16: Final verification and handover

- [ ] **Step 1: Run everything**

```bash
cd apps/frontend && npm test && npm run check:architecture && npm run build
cd ../backend && npm run test:pure
```
Expected: all pass. The backend DB-backed suite (`npm test`) is expected to fail in setup — the test Supabase project is paused — so do not run it as a gate, and do not report its failures as caused by this work.

- [ ] **Step 2: Typecheck only your files**

```bash
cd apps/frontend && npx tsc --noEmit 2>&1 | grep -E "pages/public/(HomePage|home/|components/PublicHeader)|features/coverage"
cd ../backend && npx tsc --noEmit 2>&1 | grep coverage-request
```
Expected: no output from either.

- [ ] **Step 3: Look at the page at phone width**

Start the frontend dev server and open `/` at a 360px-wide viewport. Confirm, top to bottom: the page **scrolls**; no section is clipped; the owner door is visible in the header without opening a menu; every tap target is at least 44px; the coverage form submits with the area alone.

**Do not point the backend dev server at the local `.env` and submit the form** — that `.env` is production.

- [ ] **Step 4: Confirm every commit on the branch is yours**

```bash
git log --oneline origin/main..HEAD
```
Expected: only the commits from this plan plus the two spec/cleanup commits. Concurrent sessions share this repo — if anything else appears, ask before merging.

- [ ] **Step 5: Hand over what only the user can do**

Report explicitly:
1. `migrations/085_coverage_requests.sql` **must be applied to production before this deploys**, and it joins a queue of already-unapplied migrations.
2. The endpoint has not been exercised against a real database from here.
3. The open questions from the spec: the real listing count and city list, and the missing refunds/cancellation route that an aggregator review will want linked from the homepage.

## Self-Review

**Spec coverage.** §1 context → Task 13's route swap. §2 decisions 1/4/5/8/9/10 → Tasks 11–13; decision 2 (no URL split) → no code, recorded in ADR-214 (Task 15); decision 3 (trust line) → Task 12 `TrustSection`; decision 6 → Tasks 6–10; decision 7 → enforced throughout, no stock imagery anywhere; decision 11 (`/owners` untouched) → no task, deliberately; decision 12 → Task 13 step 4. §4 page table → Tasks 11–13. §5 file structure → Tasks 1–5, 10–13. §6 imagery → Tasks 3 and 12. §7 data/API → Tasks 6–9; phase 2 aggregate explicitly out of scope. §8 SEO → Task 14. §9 verification → Task 16. §10 docs → Task 15. §11 open questions → Task 16 step 5.

**Fixed after a second design review (2026-09-18):** the loading-vs-empty flash (`homeSupplyState`), the listing card being a card-with-a-button-inside-a-link rather than one link, `Log in` hidden below `sm`, and Tailwind `emerald-*` in place of a brand tone. The artboards were also rebuilt on the real brand pack.

**Known gap, deliberate:** the zero-listings hero is handled by `HomeHero` rendering without the photo block and `SupplyRequestSection` receiving `HOME_EMPTY`, rather than a separate component. The canvas's third artboard shows a distinct layout for that state; if the rendered result is weaker than the canvas, split it into `HomeHeroEmpty.tsx` — but do not build both up front for a state the business may leave within weeks.

**Type consistency.** `DiscoverCard`, `FeaturedPlan`, `CoveragePayload`, `RecordCoverageRequestInput`, `CoverageSource`, `DiscoverCityFacet` and `OwnerDoor` are each defined once and imported everywhere else. `DiscoverSearchResult.results` and `.facets.cities` were both read from the source while writing this plan, not guessed. The Tailwind tokens used (`bg-secondary`, `text-destructive`, `text-primary-foreground`) were confirmed to exist as `@theme` colors in `src/styles/theme.css`.
