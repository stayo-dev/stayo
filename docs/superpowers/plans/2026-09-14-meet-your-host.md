# Meet Your Host Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every owner-managed Discover listing a respectful "In their own words" host card (full name, photo, bio, languages, running-since year, earned stats), editable by the owner on its own screen and overridable by an admin from the Owners drawer.

**Architecture:**
- **Storage:** a new backend-only table, `owner_host_profiles` (migration 083, RLS on, no policies). A new service, `src/services/host-profile/`, composes that table with the existing photo (`profile_identity.photo_url`) and stats counted live (published reviews, distinct residents, verified ID).
- **Listing contract:** `projectListing` gains a `hostProfile` input, so the live listing and the admin marketing preview render the same `host`.
- **Frontend:** one pure view model, `hostCardModel.ts`, plus one thin `HostCard` renderer. The Discover listing, the owner's "Your host profile" screen and the admin drawer all use it.

**Tech Stack:** Next.js 14 route handlers + Prisma (backend), Vite + React 19 + TanStack Query (frontend), vitest (backend pure config with mocked prisma; frontend node-only).

**Spec:** `docs/superpowers/specs/2026-09-14-meet-your-host-design.md`

## Global Constraints

- **Full name on the host card** is `profiles.name`, trimmed with inner whitespace collapsed. Reviewers keep `hostName()`/`reviewerDisplayName` (first name + last initial).
- **Button label:** `Enquire with {full name}`. Never first-name-only.
- **Bio:** max 500 chars after normalisation. It must not contain a phone number (a digit run of ≥ 10 once separators are joined), an email, a link, or an @handle. The same rules apply to owners and admins.
- **Languages:** a subset of `Telugu, Hindi, English, Tamil, Kannada, Malayalam, Marathi, Urdu, Bengali, Gujarati, Punjabi, Odia`, max 6, deduped.
- **Running since:** an integer from 1950 to the current year, or null.
- **Residents** (public figure): < 5 → null; 5–9 → exact; ≥ 10 → floored to the ten. The client shows "+" when ≥ 10. It is always "on Stayo" and never combined with the running-since year.
- **Rating:** shown only when ≥ 1 PUBLISHED review; average rounded to 1 decimal.
- **Verified:** an active `owner_documents` row with `doc_type IN ('AADHAAR','PAN')` and `status = 'VERIFIED'`.
- **Hide flags** (`bio_hidden`, `photo_hidden`) are admin-only. An owner edit never changes them.
- **The public read never 500s a listing:** host-profile failures degrade to `hostProfile = null`.
- **Trust note copy:** "Pay and talk through Stayo, so there's a record of everything." No payment-provider name, no protection claim.
- **Numbers:** ADR-200 and migration 083. Re-check both against `origin/main` before merging.
- **Test DB is paused.** Backend tests go in `vitest.pure.config.ts` and `vi.mock("@/lib/db")`. Run them with `npm run test:pure`.
- **Do not run `npm run prisma:generate`** from this worktree. `apps/backend/node_modules` is a symlink into the shared main checkout. Use `npx prisma validate`; `prisma` is typed `any`, so nothing needs the generated client.

---

### Task 1: Bio rules (pure)

**Files:**
- Create: `apps/backend/src/services/host-profile/bio-rules.ts`
- Test: `apps/backend/tests/host-profile-bio-rules.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` (add the test file)

**Interfaces:**
- Produces: `HOST_LANGUAGES`, `BIO_MAX_CHARS`, `LANGUAGES_MAX`, `HOSTING_SINCE_MIN`, `type RuleResult<T>`, `fullName(name): string | null`, `normaliseBio(text)`, `containsContactDetails(text): string | null`, `validateBio(input): RuleResult<string|null>`, `validateLanguages(input): RuleResult<string[]>`, `validateHostingSince(input, now?): RuleResult<number|null>`, `validateDisplayName(input): RuleResult<string>`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/host-profile-bio-rules.test.ts
import { describe, expect, it } from "vitest";
import {
  BIO_MAX_CHARS, containsContactDetails, fullName, normaliseBio, validateBio,
  validateDisplayName, validateHostingSince, validateLanguages,
} from "@/src/services/host-profile/bio-rules";

describe("fullName", () => {
  it("is the whole name, tidied, or null", () => {
    expect(fullName("  Shiva   Prakash ")).toBe("Shiva Prakash");
    expect(fullName("   ")).toBeNull();
    expect(fullName(null)).toBeNull();
  });
});

describe("containsContactDetails", () => {
  it.each([
    "Call me on 9876543210",
    "Call +91 98765 43210 anytime",
    "Phone: 98765-43210",
    "(040) 2345 6789 is the office",
    "whatsapp 91 9876 543 210",
  ])("rejects a phone number: %s", (text) => {
    expect(containsContactDetails(text)).toMatch(/phone number/);
  });

  it("rejects an email", () => {
    expect(containsContactDetails("Write to shiva.p@gmail.com")).toMatch(/email/);
  });

  it.each(["See https://sriadithya.in", "www.sriadithya.com", "wa.me/919876543210", "visit sriadithya.in"])(
    "rejects a link: %s",
    (text) => {
      expect(containsContactDetails(text)).not.toBeNull();
    },
  );

  it("rejects a social handle", () => {
    expect(containsContactDetails("Follow @sriadithya_hostel")).toMatch(/handle/);
  });

  it.each([
    "I started Sri Adithya in 2015 with 40 beds across 2 floors.",
    "Rooms 101, 102 and 103 face the park.",
    "Dinner is at 8.30 pm, breakfast at 7.",
    "B.Tech students and working professionals welcome.",
  ])("lets ordinary prose with numbers through: %s", (text) => {
    expect(containsContactDetails(text)).toBeNull();
  });
});

describe("validateBio", () => {
  it("treats empty and whitespace as no bio", () => {
    expect(validateBio("   \n ")).toEqual({ ok: true, value: null });
    expect(validateBio(null)).toEqual({ ok: true, value: null });
    expect(validateBio(undefined)).toEqual({ ok: true, value: null });
  });

  it("keeps paragraphs but collapses runs of blank lines", () => {
    expect(normaliseBio("  Hello\r\n\r\n\r\n\r\nWorld  ")).toBe("Hello\n\nWorld");
    expect(validateBio("Line one\nLine two")).toEqual({ ok: true, value: "Line one\nLine two" });
  });

  it("counts length after normalising and caps it", () => {
    expect(validateBio("a".repeat(BIO_MAX_CHARS)).ok).toBe(true);
    const over = validateBio("a".repeat(BIO_MAX_CHARS + 1));
    expect(over).toEqual({ ok: false, reason: `Keep it under ${BIO_MAX_CHARS} characters — this is ${BIO_MAX_CHARS + 1}.` });
  });

  it("refuses contact details with the reason the owner will see", () => {
    expect(validateBio("Call 9876543210")).toEqual({
      ok: false,
      reason: "Remove the phone number — residents reach you through Stayo.",
    });
  });

  it("refuses non-text", () => {
    expect(validateBio(42).ok).toBe(false);
  });
});

describe("validateLanguages", () => {
  it("accepts known languages, deduped, in the order given", () => {
    expect(validateLanguages(["Telugu", "Hindi", "Telugu"])).toEqual({ ok: true, value: ["Telugu", "Hindi"] });
  });
  it("defaults to none", () => {
    expect(validateLanguages(undefined)).toEqual({ ok: true, value: [] });
  });
  it("refuses unknown languages and more than six", () => {
    expect(validateLanguages(["Klingon"]).ok).toBe(false);
    expect(validateLanguages(["Telugu", "Hindi", "English", "Tamil", "Kannada", "Malayalam", "Marathi"]).ok).toBe(false);
    expect(validateLanguages("Telugu").ok).toBe(false);
  });
});

describe("validateHostingSince", () => {
  const now = new Date("2026-09-14T00:00:00Z");
  it("accepts a year from 1950 to this year, or nothing", () => {
    expect(validateHostingSince(2015, now)).toEqual({ ok: true, value: 2015 });
    expect(validateHostingSince("2015", now)).toEqual({ ok: true, value: 2015 });
    expect(validateHostingSince(null, now)).toEqual({ ok: true, value: null });
    expect(validateHostingSince("", now)).toEqual({ ok: true, value: null });
  });
  it("refuses the future, the implausible past, and fractions", () => {
    expect(validateHostingSince(2027, now).ok).toBe(false);
    expect(validateHostingSince(1949, now).ok).toBe(false);
    expect(validateHostingSince(2015.5, now).ok).toBe(false);
  });
});

describe("validateDisplayName", () => {
  it("trims and collapses whitespace", () => {
    expect(validateDisplayName("  Shiva   Prakash ")).toEqual({ ok: true, value: "Shiva Prakash" });
  });
  it("refuses too short, too long, and non-text", () => {
    expect(validateDisplayName("S").ok).toBe(false);
    expect(validateDisplayName("x".repeat(81)).ok).toBe(false);
    expect(validateDisplayName(null).ok).toBe(false);
  });
});
```

Add `'tests/host-profile-bio-rules.test.ts',` to the `include` array in `apps/backend/vitest.pure.config.ts`, directly under the `// Meal forecast (ADR-195).` block, with the comment `// Meet your host (ADR-200).`

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/host-profile-bio-rules.test.ts`
Expected: FAIL. Cannot resolve `@/src/services/host-profile/bio-rules`.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/services/host-profile/bio-rules.ts
/**
 * What an owner may say about themselves on a public listing (ADR-200).
 *
 * Pure — no I/O — so the rules are assertable without a database and are
 * applied identically to the owner's own edits and to an admin's.
 *
 * The contact-detail rule is the load-bearing one. A public listing is not
 * where an owner's phone number goes: a resident who rings the number in a bio
 * has left Stayo, and with it the record of what was agreed. Admins are held
 * to the same rule — it protects the platform, not the owner.
 */

export const HOST_LANGUAGES = [
  "Telugu", "Hindi", "English", "Tamil", "Kannada", "Malayalam",
  "Marathi", "Urdu", "Bengali", "Gujarati", "Punjabi", "Odia",
] as const;

export const BIO_MAX_CHARS = 500;
export const LANGUAGES_MAX = 6;
export const HOSTING_SINCE_MIN = 1950;

export type RuleResult<T> = { ok: true; value: T } | { ok: false; reason: string };

const REACH_US = "residents reach you through Stayo.";
const PHONE_RUN = /\d{10,}/;
const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LINK = /https?:\/\/|www\.|wa\.me|\b[a-z0-9-]+\.(com|in|net|org|co|me|io|app|link|info|biz)\b/i;
const HANDLE = /(^|\s)@[a-z0-9_.]{3,}/i;

/** "98765 43210", "(040) 2345-6789" — digits split by separators read as one number. */
function joinDigitRuns(text: string): string {
  return text.replace(/(\d)[\s\-.()]+(?=\d)/g, "$1");
}

/** The owner-facing reason a text is refused, or null when it carries no contact details. */
export function containsContactDetails(text: string): string | null {
  if (PHONE_RUN.test(joinDigitRuns(text))) return `Remove the phone number — ${REACH_US}`;
  if (EMAIL.test(text)) return `Remove the email address — ${REACH_US}`;
  if (LINK.test(text)) return `Remove the link — ${REACH_US}`;
  if (HANDLE.test(text)) return `Remove the social media handle — ${REACH_US}`;
  return null;
}

/** Keeps paragraphs, drops trailing spaces and runs of blank lines. */
export function normaliseBio(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function validateBio(input: unknown): RuleResult<string | null> {
  if (input === null || input === undefined) return { ok: true, value: null };
  if (typeof input !== "string") return { ok: false, reason: "Your story must be text." };
  const value = normaliseBio(input);
  if (value.length === 0) return { ok: true, value: null };
  if (value.length > BIO_MAX_CHARS) {
    return { ok: false, reason: `Keep it under ${BIO_MAX_CHARS} characters — this is ${value.length}.` };
  }
  const contact = containsContactDetails(value);
  if (contact) return { ok: false, reason: contact };
  return { ok: true, value };
}

export function validateLanguages(input: unknown): RuleResult<string[]> {
  if (input === null || input === undefined) return { ok: true, value: [] };
  if (!Array.isArray(input)) return { ok: false, reason: "Languages must be a list." };
  const known = new Set<string>(HOST_LANGUAGES);
  const value: string[] = [];
  for (const item of input) {
    if (typeof item !== "string" || !known.has(item)) return { ok: false, reason: "Pick languages from the list." };
    if (!value.includes(item)) value.push(item);
  }
  if (value.length > LANGUAGES_MAX) return { ok: false, reason: `Pick up to ${LANGUAGES_MAX} languages.` };
  return { ok: true, value };
}

export function validateHostingSince(input: unknown, now: Date = new Date()): RuleResult<number | null> {
  if (input === null || input === undefined || input === "") return { ok: true, value: null };
  const year = typeof input === "string" ? Number(input) : input;
  if (typeof year !== "number" || !Number.isInteger(year)) return { ok: false, reason: "Pick a year." };
  const latest = now.getFullYear();
  if (year < HOSTING_SINCE_MIN || year > latest) {
    return { ok: false, reason: `Pick a year between ${HOSTING_SINCE_MIN} and ${latest}.` };
  }
  return { ok: true, value: year };
}

/**
 * The whole name, tidied — how a host card names the owner (ADR-200). Lives
 * here, in the pure module, so the listing projection can use it without
 * pulling a database client into its import graph.
 */
export function fullName(name: string | null | undefined): string | null {
  const value = String(name ?? "").trim().replace(/\s+/g, " ");
  return value.length > 0 ? value : null;
}

/** Same floor as `propertyService.updateOwnerProfile` (2 chars), plus a ceiling. */
export function validateDisplayName(input: unknown): RuleResult<string> {
  if (typeof input !== "string") return { ok: false, reason: "Name must be text." };
  const value = input.trim().replace(/\s+/g, " ");
  if (value.length < 2) return { ok: false, reason: "Name must be at least 2 characters." };
  if (value.length > 80) return { ok: false, reason: "Name must be 80 characters or fewer." };
  return { ok: true, value };
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/host-profile-bio-rules.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add apps/backend/src/services/host-profile/bio-rules.ts apps/backend/tests/host-profile-bio-rules.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(host-profile): bio, language and year rules (ADR-200)"
```

---

### Task 2: Migration 083 and Prisma model

**Files:**
- Create: `migrations/083_owner_host_profiles.sql`
- Modify: `apps/backend/prisma/schema.prisma` (new model after `model profile_identity`; two relation fields on `model profile`)

**Interfaces:**
- Produces: Prisma delegate `owner_host_profile` with fields `profile_id, bio, languages, hosting_since, bio_hidden, photo_hidden, updated_by, created_at, updated_at`.

- [ ] **Step 1: Write the migration**

```sql
-- 083_owner_host_profiles.sql
--
-- Meet your host (ADR-200). The owner as residents meet them on a public
-- listing: their own words, the languages they speak, the year they started.
-- Photo stays on `profile_identity.photo_url`; stats are counted, not stored.
--
-- A TABLE OF ITS OWN, deliberately not columns on `profile_identity`. That
-- table is read without an explicit `select` in several places; declaring a
-- new column on it ahead of this migration would make every one of those
-- reads demand a column that does not exist — the 2026-08-22 `navigation`
-- outage. A new model only affects its own queries, and the public listing
-- reads this one tolerantly (a missing table reads as "no bio").
--
-- RLS ON, NO POLICIES: backend-only, like ADR-189's billing tables. The
-- backend connection bypasses RLS; anon/authenticated see nothing via
-- PostgREST.
--
-- Apply via the Supabase SQL editor or psql. Idempotent. Never
-- `prisma migrate deploy` (see prisma-field-addition notes in docs/obsidian).

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

ALTER TABLE owner_host_profiles ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Add the Prisma model**

Insert directly after the closing `}` of `model profile_identity`:

```prisma
/// The owner as residents meet them on a public listing (ADR-200) — their own
/// words, languages, and the year they started. A table of its own, never
/// columns on `profile_identity`: see migration 083 for why. `bio_hidden` and
/// `photo_hidden` are set by a Stayo admin only; an owner edit never touches
/// them. Read through `src/services/host-profile/host-profile-service.ts`.
model owner_host_profile {
  profile_id    String    @id @db.Uuid
  bio           String?
  languages     String[]  @default([])
  hosting_since Int?      @db.SmallInt
  bio_hidden    Boolean   @default(false)
  photo_hidden  Boolean   @default(false)
  updated_by    String?   @db.Uuid
  created_at    DateTime  @default(now()) @db.Timestamptz(6)
  updated_at    DateTime? @db.Timestamptz(6)

  profile       profile   @relation("OwnerHostProfile", fields: [profile_id], references: [id], onDelete: Cascade)
  updater       profile?  @relation("OwnerHostProfileUpdater", fields: [updated_by], references: [id], onDelete: SetNull)

  @@map("owner_host_profiles")
}
```

In `model profile`, directly after the `identity profile_identity?` line, add:

```prisma
  // Meet your host (ADR-200). Relation fields add no scalar columns to
  // `profiles`, so `getSession()`'s profile reads are unaffected.
  host_profile                                                      owner_host_profile?   @relation("OwnerHostProfile")
  host_profiles_edited                                              owner_host_profile[]  @relation("OwnerHostProfileUpdater")
```

- [ ] **Step 3: Validate the schema (no generate)**

Run: `cd apps/backend && npx prisma validate`
Expected: `The schema at prisma/schema.prisma is valid 🚀`

- [ ] **Step 4: Commit**

```bash
git add migrations/083_owner_host_profiles.sql apps/backend/prisma/schema.prisma
git commit -m "feat(host-profile): owner_host_profiles table, migration 083 (ADR-200)"
```

---

### Task 3: Host stats and host-profile service

**Files:**
- Create: `apps/backend/src/services/host-profile/host-stats.ts`
- Create: `apps/backend/src/services/host-profile/host-profile-service.ts`
- Test: `apps/backend/tests/host-profile-service.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` (add the test file)

**Interfaces:**
- Consumes: Task 1's `validateBio`, `validateLanguages`, `validateHostingSince`, `validateDisplayName`, `RuleResult`.
- Produces:
  - `HostStats { review_count: number; rating: number | null; residents: number | null }`
  - `publicResidents(count): number | null`, `roundRating(avg, count): number | null`, `loadHostStats(db, ownerId): Promise<HostStats & { verified: boolean }>`
  - `PublicHost { name, photo_url, bio, languages, hosting_since, verified, listed_since, stats }`
  - `EditableHost = PublicHost & { bio_hidden; photo_hidden }`, `AdminHost = EditableHost & { updated_at; updated_by_name }`
  - `HostProfileError(code, status, message)`; re-exports `fullName` from bio-rules
  - `createHostProfileService({ db, log?, now? })` returning `{ getPublicHost, getForOwner, getForAdmin, updateByOwner, updateByAdmin }`
  - `hostProfileService` (bound to `prisma`)

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/host-profile-service.test.ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: { log: vi.fn(async () => undefined) } }));

import { loadHostStats, publicResidents, roundRating } from "@/src/services/host-profile/host-stats";
import { createHostProfileService, HostProfileError } from "@/src/services/host-profile/host-profile-service";

const NOW = new Date("2026-09-14T06:30:00.000Z");
const OWNER = { id: "o1", name: "  Shiva   Prakash ", created_at: new Date("2026-09-10T00:00:00.000Z") };

function missingTable() {
  return Object.assign(new Error("The table `public.owner_host_profiles` does not exist in the current database."), { code: "P2021" });
}

function makeDb({ row = null as any, owner = OWNER as any, photo = "https://ik.example/p.jpg" as string | null, missing = false } = {}) {
  let current = row;
  const db: any = {
    profile: {
      findFirst: vi.fn(async () => owner),
      findUnique: vi.fn(async () => ({ name: "Asha  Admin" })),
      update: vi.fn(async () => ({ id: "o1" })),
    },
    profile_identity: { findUnique: vi.fn(async () => (photo ? { photo_url: photo } : null)) },
    owner_host_profile: {
      findUnique: vi.fn(async () => {
        if (missing) throw missingTable();
        return current;
      }),
      upsert: vi.fn(async ({ create, update }: any) => {
        if (missing) throw missingTable();
        current = current ? { ...current, ...update } : { ...create };
        return { profile_id: "o1" };
      }),
    },
    hostel_reviews: { aggregate: vi.fn(async () => ({ _count: { _all: 36 }, _avg: { rating: 4.83 } })) },
    tenants: { findMany: vi.fn(async () => Array.from({ length: 243 }, (_, i) => ({ profile_id: `p${i}` }))) },
    owner_documents: { count: vi.fn(async () => 1) },
  };
  return db;
}

const log = { log: vi.fn(async () => undefined) };
const service = (db: any) => createHostProfileService({ db, log, now: () => NOW });

describe("host stats", () => {
  it("omits residents below five, keeps 5–9 exact, floors from ten", () => {
    expect(publicResidents(0)).toBeNull();
    expect(publicResidents(4)).toBeNull();
    expect(publicResidents(5)).toBe(5);
    expect(publicResidents(9)).toBe(9);
    expect(publicResidents(10)).toBe(10);
    expect(publicResidents(243)).toBe(240);
  });

  it("rounds the rating to one decimal and has none without reviews", () => {
    expect(roundRating(4.83, 36)).toBe(4.8);
    expect(roundRating(4.86, 2)).toBe(4.9);
    expect(roundRating(null, 0)).toBeNull();
    expect(roundRating(5, 0)).toBeNull();
  });

  it("counts only published reviews, real residents and verified ID on this owner's hostels", async () => {
    const db = makeDb();
    const stats = await loadHostStats(db, "o1");
    expect(stats).toEqual({ review_count: 36, rating: 4.8, residents: 240, verified: true });
    expect(db.hostel_reviews.aggregate.mock.calls[0][0].where).toEqual({ status: "PUBLISHED", hostel: { owner_id: "o1" } });
    const tenantQuery = db.tenants.findMany.mock.calls[0][0];
    expect(tenantQuery.where).toEqual({ owner_id: "o1", status: { in: ["ACTIVE", "FORMER_TENANT"] }, profile_id: { not: null } });
    expect(tenantQuery.distinct).toEqual(["profile_id"]);
    expect(db.owner_documents.count.mock.calls[0][0].where).toEqual({
      profile_id: "o1", is_active: true, status: "VERIFIED", doc_type: { in: ["AADHAAR", "PAN"] },
    });
  });
});

describe("getPublicHost", () => {
  it("gives the full name, photo, words and earned stats", async () => {
    const db = makeDb({ row: { bio: "I started in 2015.", languages: ["Telugu", "Hindi"], hosting_since: 2015, bio_hidden: false, photo_hidden: false } });
    expect(await service(db).getPublicHost("o1")).toEqual({
      name: "Shiva Prakash",
      photo_url: "https://ik.example/p.jpg",
      bio: "I started in 2015.",
      languages: ["Telugu", "Hindi"],
      hosting_since: 2015,
      verified: true,
      listed_since: "2026-09-10T00:00:00.000Z",
      stats: { review_count: 36, rating: 4.8, residents: 240 },
    });
  });

  it("drops what an admin has hidden", async () => {
    const db = makeDb({ row: { bio: "Words", languages: [], hosting_since: null, bio_hidden: true, photo_hidden: true } });
    const host = await service(db).getPublicHost("o1");
    expect(host.bio).toBeNull();
    expect(host.photo_url).toBeNull();
    expect(host).not.toHaveProperty("bio_hidden");
  });

  it("reads a missing table as no bio rather than failing", async () => {
    const host = await service(makeDb({ missing: true })).getPublicHost("o1");
    expect(host.bio).toBeNull();
    expect(host.languages).toEqual([]);
    expect(host.name).toBe("Shiva Prakash");
  });

  it("404s for anyone who is not an owner", async () => {
    await expect(service(makeDb({ owner: null })).getPublicHost("x")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("getForOwner", () => {
  it("shows the owner their own hidden words, with the flags", async () => {
    const db = makeDb({ row: { bio: "Words", languages: [], hosting_since: null, bio_hidden: true, photo_hidden: false } });
    const host = await service(db).getForOwner("o1");
    expect(host.bio).toBe("Words");
    expect(host.bio_hidden).toBe(true);
    expect(host.photo_hidden).toBe(false);
  });
});

describe("updateByOwner", () => {
  it("saves the three owner fields, stamped with the owner", async () => {
    const db = makeDb();
    await service(db).updateByOwner("o1", { bio: " Hello ", languages: ["Telugu"], hosting_since: 2015 });
    const { create } = db.owner_host_profile.upsert.mock.calls[0][0];
    expect(create).toEqual({
      profile_id: "o1", bio: "Hello", languages: ["Telugu"], hosting_since: 2015, updated_by: "o1", updated_at: NOW,
    });
  });

  it("ignores hide flags an owner tries to send", async () => {
    const db = makeDb({ row: { bio: "Old", languages: [], hosting_since: null, bio_hidden: true, photo_hidden: true } });
    const host = await service(db).updateByOwner("o1", { bio: "New", languages: [], hosting_since: null, bio_hidden: false, photo_hidden: false });
    const { update } = db.owner_host_profile.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty("bio_hidden");
    expect(update).not.toHaveProperty("photo_hidden");
    expect(host.bio).toBe("New");
    expect(host.bio_hidden).toBe(true);
  });

  it("refuses contact details before writing anything", async () => {
    const db = makeDb();
    await expect(service(db).updateByOwner("o1", { bio: "Call 9876543210" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR", status: 400, message: "Remove the phone number — residents reach you through Stayo.",
    });
    expect(db.owner_host_profile.upsert).not.toHaveBeenCalled();
  });

  it("says the feature is unavailable when the table is not there yet", async () => {
    await expect(service(makeDb({ missing: true })).updateByOwner("o1", { bio: "Hi" })).rejects.toMatchObject({
      code: "HOST_PROFILE_UNAVAILABLE", status: 503,
    });
  });
});

describe("updateByAdmin", () => {
  it("edits only what was sent, can hide, and records who", async () => {
    const db = makeDb({ row: { bio: "Words", languages: ["Telugu"], hosting_since: 2015, bio_hidden: false, photo_hidden: false } });
    const host = await service(db).updateByAdmin("o1", "admin-1", { bio_hidden: true });
    const { update } = db.owner_host_profile.upsert.mock.calls[0][0];
    expect(update).toEqual({ bio_hidden: true, updated_by: "admin-1", updated_at: NOW });
    expect(host.bio_hidden).toBe(true);
    expect(host.languages).toEqual(["Telugu"]);
    expect(host.updated_by_name).toBe("Asha Admin");
    expect(log.log).toHaveBeenCalledWith("OWNER_HOST_PROFILE_ADMIN_EDIT", "o1", { fields: ["bio_hidden"], admin_id: "admin-1" });
  });

  it("corrects the owner's account name", async () => {
    const db = makeDb();
    await service(db).updateByAdmin("o1", "admin-1", { name: "  Shiva  Prakash Reddy " });
    expect(db.profile.update).toHaveBeenCalledWith({
      where: { id: "o1" }, data: { name: "Shiva Prakash Reddy", updated_at: NOW }, select: { id: true },
    });
    expect(db.owner_host_profile.upsert).not.toHaveBeenCalled();
  });

  it("holds admins to the same bio rules", async () => {
    await expect(service(makeDb()).updateByAdmin("o1", "admin-1", { bio: "www.example.com" })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a non-boolean hide flag and an empty patch", async () => {
    await expect(service(makeDb()).updateByAdmin("o1", "a", { bio_hidden: "yes" })).rejects.toMatchObject({ status: 400 });
    await expect(service(makeDb()).updateByAdmin("o1", "a", {})).rejects.toMatchObject({ status: 400, message: "Nothing to update." });
  });

  it("404s for a profile that is not an owner", async () => {
    await expect(service(makeDb({ owner: null })).updateByAdmin("x", "a", { bio_hidden: true })).rejects.toBeInstanceOf(HostProfileError);
  });
});
```

Add `'tests/host-profile-service.test.ts',` to `vitest.pure.config.ts` under the Task 1 entry.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/host-profile-service.test.ts`
Expected: FAIL. Cannot resolve `host-stats` / `host-profile-service`.

- [ ] **Step 3: Implement `host-stats.ts`**

```ts
// apps/backend/src/services/host-profile/host-stats.ts
/**
 * The numbers on a host card (ADR-200) — counted from existing records, never
 * stored, so they cannot drift from the reviews and tenancies they describe.
 *
 * Every figure is one the owner earned *on Stayo*. The self-reported
 * "running hostels since" year is a separate fact and is never folded in:
 * "240 residents since 2015" would claim a history Stayo cannot see.
 */

export interface HostStats {
  review_count: number;
  /** Average of PUBLISHED reviews, one decimal; null with no reviews. */
  rating: number | null;
  /** Distinct residents ever housed, rounded for display; null below 5. */
  residents: number | null;
}

export const RESIDENTS_MIN_SHOWN = 5;

/**
 * Below five the count is omitted — "2 residents" reads as a warning, not a
 * credential. Five to nine stay exact; from ten the figure floors to the ten
 * and the client adds "+", so it never overstates.
 */
export function publicResidents(count: number): number | null {
  if (!Number.isFinite(count) || count < RESIDENTS_MIN_SHOWN) return null;
  if (count < 10) return count;
  return Math.floor(count / 10) * 10;
}

export function roundRating(avg: number | null | undefined, count: number): number | null {
  if (!count || avg === null || avg === undefined || !Number.isFinite(Number(avg))) return null;
  return Math.round(Number(avg) * 10) / 10;
}

/**
 * Host-level, across every hostel the owner runs — the same scope a resident
 * means by "this host". Bulk-imported tenants count: they are real residents.
 */
export async function loadHostStats(db: any, ownerId: string): Promise<HostStats & { verified: boolean }> {
  const [reviews, residents, verifiedDocs] = await Promise.all([
    db.hostel_reviews.aggregate({
      where: { status: "PUBLISHED", hostel: { owner_id: ownerId } },
      _count: { _all: true },
      _avg: { rating: true },
    }),
    db.tenants.findMany({
      where: { owner_id: ownerId, status: { in: ["ACTIVE", "FORMER_TENANT"] }, profile_id: { not: null } },
      select: { profile_id: true },
      distinct: ["profile_id"],
    }),
    db.owner_documents.count({
      where: { profile_id: ownerId, is_active: true, status: "VERIFIED", doc_type: { in: ["AADHAAR", "PAN"] } },
    }),
  ]);

  const reviewCount = Number(reviews?._count?._all ?? 0);
  return {
    review_count: reviewCount,
    rating: roundRating(reviews?._avg?.rating, reviewCount),
    residents: publicResidents(Array.isArray(residents) ? residents.length : 0),
    verified: Number(verifiedDocs) > 0,
  };
}
```

- [ ] **Step 4: Implement `host-profile-service.ts`**

```ts
// apps/backend/src/services/host-profile/host-profile-service.ts
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import {
  fullName, validateBio, validateDisplayName, validateHostingSince, validateLanguages, type RuleResult,
} from "./bio-rules";
import { loadHostStats, type HostStats } from "./host-stats";

/**
 * Meet your host (ADR-200) — the owner as residents meet them on a listing.
 *
 * Composes three sources rather than copying any of them: the account name
 * (`profiles.name`), the photo (`profile_identity.photo_url`), and the owner's
 * own words (`owner_host_profiles`), plus stats counted live in `host-stats`.
 *
 * Moderation is live-on-save with an admin override: an owner's edit is
 * public immediately; an admin can edit it or hide the bio/photo, and a hide
 * survives later owner edits until an admin lifts it.
 */

export class HostProfileError extends Error {
  constructor(public code: string, public status: number, message: string) {
    super(message);
    this.name = "HostProfileError";
  }
}

export interface PublicHost {
  name: string | null;
  photo_url: string | null;
  bio: string | null;
  languages: string[];
  hosting_since: number | null;
  verified: boolean;
  /** When the owner joined Stayo — `profiles.created_at`. */
  listed_since: string | null;
  stats: HostStats;
}

export interface EditableHost extends PublicHost {
  bio_hidden: boolean;
  photo_hidden: boolean;
}

export interface AdminHost extends EditableHost {
  updated_at: string | null;
  updated_by_name: string | null;
}

export { fullName };

const HOST_SELECT = {
  bio: true, languages: true, hosting_since: true, bio_hidden: true, photo_hidden: true, updated_at: true, updated_by: true,
} as const;

function isMissingTable(error: unknown): boolean {
  const e = error as { code?: string; message?: string } | null;
  return e?.code === "P2021" || /owner_host_profiles.*does not exist/i.test(String(e?.message ?? ""));
}

const iso = (value: unknown) => (value ? new Date(value as string).toISOString() : null);

function pickHostFields(body: Record<string, unknown>, now: Date, partial: boolean) {
  const data: Record<string, unknown> = {};
  const take = <T,>(key: string, result: RuleResult<T>) => {
    if (!result.ok) throw new HostProfileError("VALIDATION_ERROR", 400, result.reason);
    data[key] = result.value;
  };
  if (!partial || "bio" in body) take("bio", validateBio(body.bio));
  if (!partial || "languages" in body) take("languages", validateLanguages(body.languages));
  if (!partial || "hosting_since" in body) take("hosting_since", validateHostingSince(body.hosting_since, now));
  return data;
}

type Log = { log: (eventType: string, ownerId?: string | null, metadata?: Record<string, any>) => Promise<void> };

export function createHostProfileService({ db, log = eventLog, now = () => new Date() }: { db: any; log?: Log; now?: () => Date }) {
  async function readHostRow(ownerId: string) {
    try {
      return await db.owner_host_profile.findUnique({ where: { profile_id: ownerId }, select: HOST_SELECT });
    } catch (error) {
      // Migration 083 not applied yet: an owner with no words, not an outage.
      if (isMissingTable(error)) return null;
      throw error;
    }
  }

  async function upsertRow(ownerId: string, data: Record<string, unknown>) {
    const stamped = { ...data, updated_at: now() };
    try {
      await db.owner_host_profile.upsert({
        where: { profile_id: ownerId },
        create: { profile_id: ownerId, ...stamped },
        update: stamped,
        select: { profile_id: true },
      });
    } catch (error) {
      if (isMissingTable(error)) {
        throw new HostProfileError("HOST_PROFILE_UNAVAILABLE", 503, "Host profiles aren't available yet. Please try again later.");
      }
      throw error;
    }
  }

  async function requireOwner(ownerId: string) {
    const profile = await db.profile.findFirst({
      where: { id: ownerId, role: "OWNER" },
      select: { id: true, name: true, created_at: true },
    });
    if (!profile) throw new HostProfileError("NOT_FOUND", 404, "Owner not found");
    return profile;
  }

  async function load(ownerId: string) {
    const profile = await requireOwner(ownerId);
    const [identity, row, stats] = await Promise.all([
      db.profile_identity.findUnique({ where: { profile_id: ownerId }, select: { photo_url: true } }),
      readHostRow(ownerId),
      loadHostStats(db, ownerId),
    ]);
    const { verified, ...counts } = stats;
    const host: EditableHost = {
      name: fullName(profile.name),
      photo_url: identity?.photo_url ?? null,
      bio: row?.bio ?? null,
      languages: row?.languages ?? [],
      hosting_since: row?.hosting_since ?? null,
      verified,
      listed_since: iso(profile.created_at),
      stats: counts,
      bio_hidden: Boolean(row?.bio_hidden),
      photo_hidden: Boolean(row?.photo_hidden),
    };
    return { host, row };
  }

  async function getForOwner(ownerId: string): Promise<EditableHost> {
    return (await load(ownerId)).host;
  }

  async function getForAdmin(ownerId: string): Promise<AdminHost> {
    const { host, row } = await load(ownerId);
    const updater = row?.updated_by
      ? await db.profile.findUnique({ where: { id: row.updated_by }, select: { name: true } })
      : null;
    return { ...host, updated_at: iso(row?.updated_at), updated_by_name: fullName(updater?.name) };
  }

  return {
    /** What a stranger sees. Hidden fields are dropped here, never in the client. */
    async getPublicHost(ownerId: string): Promise<PublicHost> {
      const { bio_hidden, photo_hidden, ...host } = (await load(ownerId)).host;
      return { ...host, bio: bio_hidden ? null : host.bio, photo_url: photo_hidden ? null : host.photo_url };
    },

    /** The owner sees their own words even while Stayo has hidden them. */
    getForOwner,
    getForAdmin,

    /** Replaces the owner's three fields. The hide flags are not theirs to set. */
    async updateByOwner(ownerId: string, body: Record<string, unknown>): Promise<EditableHost> {
      await requireOwner(ownerId);
      const data = pickHostFields(body ?? {}, now(), false);
      await upsertRow(ownerId, { ...data, updated_by: ownerId });
      return getForOwner(ownerId);
    },

    /** Edits only the keys sent. Same bio rules as the owner — they protect the platform. */
    async updateByAdmin(ownerId: string, adminId: string, patch: Record<string, unknown>): Promise<AdminHost> {
      await requireOwner(ownerId);
      const body = patch ?? {};
      const hostData = pickHostFields(body, now(), true);
      for (const flag of ["bio_hidden", "photo_hidden"] as const) {
        if (!(flag in body)) continue;
        if (typeof body[flag] !== "boolean") throw new HostProfileError("VALIDATION_ERROR", 400, `${flag} must be true or false.`);
        hostData[flag] = body[flag];
      }

      let name: string | undefined;
      if ("name" in body) {
        const result = validateDisplayName(body.name);
        if (!result.ok) throw new HostProfileError("VALIDATION_ERROR", 400, result.reason);
        name = result.value;
      }

      const fields = [...Object.keys(hostData), ...(name !== undefined ? ["name"] : [])];
      if (fields.length === 0) throw new HostProfileError("VALIDATION_ERROR", 400, "Nothing to update.");

      // Host row first: if migration 083 is missing this fails before the
      // account name changes, so an admin never gets half an edit.
      if (Object.keys(hostData).length > 0) await upsertRow(ownerId, { ...hostData, updated_by: adminId });
      if (name !== undefined) {
        await db.profile.update({ where: { id: ownerId }, data: { name, updated_at: now() }, select: { id: true } });
      }

      await log.log("OWNER_HOST_PROFILE_ADMIN_EDIT", ownerId, { fields, admin_id: adminId });
      return getForAdmin(ownerId);
    },
  };
}

export const hostProfileService = createHostProfileService({ db: prisma });
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/host-profile-service.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/src/services/host-profile/host-stats.ts apps/backend/src/services/host-profile/host-profile-service.ts apps/backend/tests/host-profile-service.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(host-profile): service composing name, photo, words and earned stats (ADR-200)"
```

---

### Task 4: Owner and admin routes, plus the shared owner-photo helper

**Files:**
- Create: `apps/backend/src/services/host-profile/route-errors.ts`
- Create: `apps/backend/lib/owner-photo.ts`
- Create: `apps/backend/app/api/owner/me/host-profile/route.ts`
- Create: `apps/backend/app/api/platform-admin/owners/[id]/host-profile/route.ts`
- Create: `apps/backend/app/api/platform-admin/owners/[id]/photo/route.ts`
- Modify: `apps/backend/app/api/owner/me/photo/route.ts` (use the helper)
- Test: `apps/backend/tests/host-profile-routes.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Consumes: `hostProfileService`, `HostProfileError` (Task 3).
- Produces:
  - HTTP `GET|PUT /api/owner/me/host-profile` → `{ success, data: EditableHost }`
  - HTTP `GET|PATCH /api/platform-admin/owners/:id/host-profile` → `{ success, data: AdminHost }`
  - HTTP `POST|DELETE /api/platform-admin/owners/:id/photo` → `{ success, data: { photo_url } }`
  - `checkOwnerPhoto(file): string | null`, `saveOwnerPhoto(profileId, file, extraTags?)`, `clearOwnerPhoto(profileId)`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/host-profile-routes.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, mockService, mockPhoto, mockDb, mockLog } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockService: { getForOwner: vi.fn(), updateByOwner: vi.fn(), getForAdmin: vi.fn(), updateByAdmin: vi.fn() },
  mockPhoto: { checkOwnerPhoto: vi.fn(), saveOwnerPhoto: vi.fn(), clearOwnerPhoto: vi.fn() },
  mockDb: { profile: { findFirst: vi.fn() } },
  mockLog: { log: vi.fn(async () => undefined) },
}));

vi.mock("@/lib/db", () => ({ prisma: mockDb }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: mockLog }));
vi.mock("@/lib/auth", () => ({
  getSession: mockSession,
  apiError: (message: string, code = "ERROR", status = 500) =>
    new Response(JSON.stringify({ success: false, error: { message, code } }), { status }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ success: true, ...data }), { status }),
}));
vi.mock("@/lib/owner-photo", () => mockPhoto);
vi.mock("@/src/services/host-profile/host-profile-service", async () => {
  const actual: any = await vi.importActual("@/src/services/host-profile/host-profile-service");
  return { HostProfileError: actual.HostProfileError, hostProfileService: mockService };
});

import { GET as ownerGet, PUT as ownerPut } from "../app/api/owner/me/host-profile/route";
import { GET as adminGet, PATCH as adminPatch } from "../app/api/platform-admin/owners/[id]/host-profile/route";
import { POST as adminPhotoPost, DELETE as adminPhotoDelete } from "../app/api/platform-admin/owners/[id]/photo/route";
import { HostProfileError } from "@/src/services/host-profile/host-profile-service";

const OWNER = { sub: "o1", role: "OWNER" };
const ADMIN = { sub: "admin-1", role: "ADMIN" };
const TENANT = { sub: "t1", role: "TENANT" };
const jsonReq = (body: unknown) => ({ json: async () => body }) as any;
const formReq = (file: unknown) => ({ formData: async () => ({ get: () => file }) }) as any;
const ctx = { params: { id: "o1" } };
const read = async (res: Response) => ({ status: res.status, body: await res.json() });

beforeEach(() => {
  vi.clearAllMocks();
  mockDb.profile.findFirst.mockResolvedValue({ id: "o1" });
});

describe("owner host-profile route", () => {
  it("is for owners only", async () => {
    mockSession.mockResolvedValue(TENANT);
    expect((await ownerGet(jsonReq({}))).status).toBe(403);
    expect((await ownerPut(jsonReq({}))).status).toBe(403);
    mockSession.mockResolvedValue(ADMIN);
    expect((await ownerGet(jsonReq({}))).status).toBe(403);
  });

  it("reads and writes the session owner's own profile", async () => {
    mockSession.mockResolvedValue(OWNER);
    mockService.getForOwner.mockResolvedValue({ name: "Shiva Prakash" });
    expect(await read(await ownerGet(jsonReq({})))).toEqual({ status: 200, body: { success: true, data: { name: "Shiva Prakash" } } });

    mockService.updateByOwner.mockResolvedValue({ bio: "Hi" });
    const res = await read(await ownerPut(jsonReq({ bio: "Hi", languages: [], hosting_since: null })));
    expect(res.status).toBe(200);
    expect(mockService.updateByOwner).toHaveBeenCalledWith("o1", { bio: "Hi", languages: [], hosting_since: null });
  });

  it("returns the rule's own reason on a refused bio", async () => {
    mockSession.mockResolvedValue(OWNER);
    mockService.updateByOwner.mockRejectedValue(new HostProfileError("VALIDATION_ERROR", 400, "Remove the phone number — residents reach you through Stayo."));
    const res = await read(await ownerPut(jsonReq({ bio: "9876543210" })));
    expect(res).toEqual({
      status: 400,
      body: { success: false, error: { message: "Remove the phone number — residents reach you through Stayo.", code: "VALIDATION_ERROR" } },
    });
  });

  it("refuses a body that is not an object", async () => {
    mockSession.mockResolvedValue(OWNER);
    expect((await ownerPut(jsonReq(null))).status).toBe(400);
  });
});

describe("admin host-profile route", () => {
  it("is for admins only", async () => {
    mockSession.mockResolvedValue(OWNER);
    expect((await adminGet(jsonReq({}), ctx)).status).toBe(403);
    expect((await adminPatch(jsonReq({ bio_hidden: true }), ctx)).status).toBe(403);
  });

  it("passes the admin's id so the edit is attributed", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockService.updateByAdmin.mockResolvedValue({ bio_hidden: true });
    expect((await adminPatch(jsonReq({ bio_hidden: true }), ctx)).status).toBe(200);
    expect(mockService.updateByAdmin).toHaveBeenCalledWith("o1", "admin-1", { bio_hidden: true });
  });

  it("maps a missing owner to 404", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockService.getForAdmin.mockRejectedValue(new HostProfileError("NOT_FOUND", 404, "Owner not found"));
    expect((await adminGet(jsonReq({}), ctx)).status).toBe(404);
  });
});

describe("admin owner-photo route", () => {
  it("is for admins only", async () => {
    mockSession.mockResolvedValue(OWNER);
    expect((await adminPhotoPost(formReq({}), ctx)).status).toBe(403);
    expect((await adminPhotoDelete(jsonReq({}), ctx)).status).toBe(403);
  });

  it("refuses a bad file with the helper's reason", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockPhoto.checkOwnerPhoto.mockReturnValue("Photo must be under 2MB");
    const res = await read(await adminPhotoPost(formReq({ type: "image/png", size: 9e6 }), ctx));
    expect(res.status).toBe(400);
    expect(mockPhoto.saveOwnerPhoto).not.toHaveBeenCalled();
  });

  it("404s when the profile is not an owner", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockDb.profile.findFirst.mockResolvedValue(null);
    expect((await adminPhotoDelete(jsonReq({}), ctx)).status).toBe(404);
  });

  it("replaces and removes the owner's photo, and logs it", async () => {
    mockSession.mockResolvedValue(ADMIN);
    mockPhoto.checkOwnerPhoto.mockReturnValue(null);
    mockPhoto.saveOwnerPhoto.mockResolvedValue({ photo_url: "https://ik.example/new.jpg" });
    const file = { type: "image/png", size: 100 };
    expect(await read(await adminPhotoPost(formReq(file), ctx))).toEqual({
      status: 200, body: { success: true, data: { photo_url: "https://ik.example/new.jpg" } },
    });
    expect(mockPhoto.saveOwnerPhoto).toHaveBeenCalledWith("o1", file, ["ADMIN_REPLACED"]);

    mockPhoto.clearOwnerPhoto.mockResolvedValue({ photo_url: null });
    expect((await adminPhotoDelete(jsonReq({}), ctx)).status).toBe(200);
    expect(mockLog.log).toHaveBeenCalledWith("OWNER_HOST_PROFILE_ADMIN_EDIT", "o1", { fields: ["photo"], admin_id: "admin-1" });
  });
});
```

Add `'tests/host-profile-routes.test.ts',` to `vitest.pure.config.ts`.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/host-profile-routes.test.ts`
Expected: FAIL. Route modules not found.

- [ ] **Step 3: Implement the shared pieces**

```ts
// apps/backend/src/services/host-profile/route-errors.ts
import { apiError } from "@/lib/auth";
import { HostProfileError } from "./host-profile-service";

/** A HostProfileError carries its own status and owner-facing message; anything else is a 500. */
export function hostProfileFailure(error: unknown, where: string) {
  if (error instanceof HostProfileError) return apiError(error.message, error.code, error.status);
  console.error(`[${where}]`, error instanceof Error ? error.message : String(error));
  return apiError("Something went wrong. Please try again.");
}
```

```ts
// apps/backend/lib/owner-photo.ts
import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";

/**
 * One shape for "a photo of an owner", shared by the owner's own upload
 * (`owner/me/photo`) and an admin's replacement (`platform-admin/owners/[id]/photo`).
 * Stored on `profile_identity`, never on `profile` — see `owner/me/photo` for why.
 */

export const OWNER_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
export const OWNER_PHOTO_MAX_BYTES = 2 * 1024 * 1024;

export function checkOwnerPhoto(file: File | null): string | null {
  if (!file) return "file is required";
  if (!OWNER_PHOTO_TYPES.includes(file.type)) return "Photo must be JPEG, PNG, or WEBP";
  if (file.size > OWNER_PHOTO_MAX_BYTES) return "Photo must be under 2MB";
  return null;
}

export async function saveOwnerPhoto(profileId: string, file: File, extraTags: string[] = []) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const upload = await imagekit.files.upload({
    file: buffer.toString("base64"),
    fileName: file.name || "profile.jpg",
    folder: `owners/${profileId}/profile`,
    useUniqueFileName: true,
    tags: ["OWNER_PROFILE_PHOTO", profileId, ...extraTags],
  });
  // Upsert: an owner who has never filled in any identity field has no
  // `profile_identity` row yet, and a photo must not require one.
  return prisma.profile_identity.upsert({
    where: { profile_id: profileId },
    create: { profile_id: profileId, photo_url: upload.url },
    update: { photo_url: upload.url },
    select: { photo_url: true },
  });
}

/**
 * Clears the reference only; the ImageKit asset is left in place. Deleting
 * the remote file makes the action irreversible and couples it to an external
 * service being reachable, for no benefit anyone can see.
 */
export async function clearOwnerPhoto(profileId: string) {
  const existing = await prisma.profile_identity.findUnique({
    where: { profile_id: profileId },
    select: { profile_id: true },
  });
  if (!existing) return { photo_url: null };
  return prisma.profile_identity.update({
    where: { profile_id: profileId },
    data: { photo_url: null },
    select: { photo_url: true },
  });
}
```

- [ ] **Step 4: Refactor `owner/me/photo/route.ts` onto the helper**

Keep the file's header comment block. Replace the `ALLOWED`/`MAX_BYTES` constants, the body of `POST`'s `try`, and the body of `DELETE`'s `try` so the file reads:

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { checkOwnerPhoto, clearOwnerPhoto, saveOwnerPhoto } from "@/lib/owner-photo";

/* (existing 👤 OWNER PROFILE PHOTO comment block, unchanged — append one line:)
 * The upload/clear logic lives in `lib/owner-photo.ts`, shared with the
 * admin's replacement route (ADR-200).
 */

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const problem = checkOwnerPhoto(file);
    if (problem) return apiError(problem, "VALIDATION_ERROR", 400);

    const saved = await saveOwnerPhoto(session.sub, file as File);
    return apiResponse({ success: true, data: saved });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[owner.me.photo.POST]", msg);
    return apiError(msg || "Failed to upload photo");
  }
}

export async function DELETE(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const saved = await clearOwnerPhoto(session.sub);
    return apiResponse({ success: true, data: saved });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("[owner.me.photo.DELETE]", msg);
    return apiError(msg || "Failed to remove photo");
  }
}
```

- [ ] **Step 5: Implement the three routes**

```ts
// apps/backend/app/api/owner/me/host-profile/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { hostProfileService } from "@/src/services/host-profile/host-profile-service";
import { hostProfileFailure } from "@/src/services/host-profile/route-errors";

/**
 * 🪪 THE OWNER'S HOST PROFILE (ADR-200)
 * GET — how residents meet this owner, plus their own words even if hidden
 * PUT — { bio, languages, hosting_since }; live on save. The hide flags are
 *       admin-only and ignored if sent.
 */

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  try {
    return apiResponse({ data: await hostProfileService.getForOwner(session.sub) });
  } catch (error) {
    return hostProfileFailure(error, "owner.me.host-profile.GET");
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Invalid request body", "VALIDATION_ERROR", 400);
    }
    return apiResponse({ data: await hostProfileService.updateByOwner(session.sub, body) });
  } catch (error) {
    return hostProfileFailure(error, "owner.me.host-profile.PUT");
  }
}
```

```ts
// apps/backend/app/api/platform-admin/owners/[id]/host-profile/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { hostProfileService } from "@/src/services/host-profile/host-profile-service";
import { hostProfileFailure } from "@/src/services/host-profile/route-errors";

/**
 * GET   /api/platform-admin/owners/[id]/host-profile — the owner's public host card, with hide flags and last editor
 * PATCH /api/platform-admin/owners/[id]/host-profile — any of { name, bio, languages, hosting_since, bio_hidden, photo_hidden }
 *
 * ADR-200: owner edits are live on save; this is the override. Every write is
 * attributed (`updated_by`) and event-logged by the service.
 */

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return apiError("Admin access only", "FORBIDDEN", 403);
  try {
    return apiResponse({ data: await hostProfileService.getForAdmin(params.id) });
  } catch (error) {
    return hostProfileFailure(error, "platform-admin.owners.host-profile.GET");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return apiError("Admin access only", "FORBIDDEN", 403);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Invalid request body", "VALIDATION_ERROR", 400);
    }
    return apiResponse({ data: await hostProfileService.updateByAdmin(params.id, session.sub, body) });
  } catch (error) {
    return hostProfileFailure(error, "platform-admin.owners.host-profile.PATCH");
  }
}
```

```ts
// apps/backend/app/api/platform-admin/owners/[id]/photo/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { checkOwnerPhoto, clearOwnerPhoto, saveOwnerPhoto } from "@/lib/owner-photo";

/**
 * POST   /api/platform-admin/owners/[id]/photo — replace an owner's photo
 * DELETE /api/platform-admin/owners/[id]/photo — remove it
 *
 * ADR-200 admin override. Same helper, cap and types as the owner's own
 * upload. To keep a photo off the listing without deleting it, use the
 * host-profile `photo_hidden` flag instead.
 */

async function guard(req: NextRequest, ownerId: string) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return { error: apiError("Admin access only", "FORBIDDEN", 403) };
  const owner = await prisma.profile.findFirst({ where: { id: ownerId, role: "OWNER" }, select: { id: true } });
  if (!owner) return { error: apiError("Owner not found", "NOT_FOUND", 404) };
  return { session };
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { error, session } = await guard(req, params.id);
    if (error) return error;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    const problem = checkOwnerPhoto(file);
    if (problem) return apiError(problem, "VALIDATION_ERROR", 400);

    const saved = await saveOwnerPhoto(params.id, file as File, ["ADMIN_REPLACED"]);
    await eventLog.log("OWNER_HOST_PROFILE_ADMIN_EDIT", params.id, { fields: ["photo"], admin_id: session!.sub });
    return apiResponse({ data: saved });
  } catch (error: unknown) {
    console.error("[platform-admin.owners.photo.POST]", error instanceof Error ? error.message : String(error));
    return apiError("Failed to upload photo");
  }
}

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { error, session } = await guard(req, params.id);
    if (error) return error;
    const saved = await clearOwnerPhoto(params.id);
    await eventLog.log("OWNER_HOST_PROFILE_ADMIN_EDIT", params.id, { fields: ["photo"], admin_id: session!.sub });
    return apiResponse({ data: saved });
  } catch (error: unknown) {
    console.error("[platform-admin.owners.photo.DELETE]", error instanceof Error ? error.message : String(error));
    return apiError("Failed to remove photo");
  }
}
```

- [ ] **Step 6: Run the tests and confirm they pass**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/host-profile-routes.test.ts tests/host-profile-service.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/backend/src/services/host-profile/route-errors.ts apps/backend/lib/owner-photo.ts "apps/backend/app/api/owner/me/host-profile" "apps/backend/app/api/platform-admin/owners/[id]/host-profile" "apps/backend/app/api/platform-admin/owners/[id]/photo" apps/backend/app/api/owner/me/photo/route.ts apps/backend/tests/host-profile-routes.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(host-profile): owner and admin routes, shared owner-photo helper (ADR-200)"
```

---

### Task 5: Listing contract — `host` carries the host card

**Files:**
- Modify: `apps/backend/src/services/discovery/listing-projection.ts` (input type + `host` block)
- Modify: `apps/backend/src/services/discovery/discovery-service.ts` (`getListing`: select `owner_id`, read the host)
- Modify: `apps/backend/app/api/platform-admin/marketing-reviews/[revisionId]/preview/route.ts` (same read)
- Test: `apps/backend/tests/discovery-listing-projection.test.ts` (replace the `describe("host")` block)
- Test: `apps/backend/tests/discovery-service.test.ts` (mock the host-profile service; one new case)

**Interfaces:**
- Consumes: `hostProfileService.getPublicHost(ownerId): Promise<PublicHost>`, `type PublicHost` (Task 3).
- Produces: `ProjectListingInput.hostProfile?: PublicHost | null`. The listing's `host` becomes `{ platform_listed, name, photo_url, bio, languages, hosting_since, verified, listed_since, stats }`.

- [ ] **Step 1: Replace the projection's `describe("host")` tests**

In `apps/backend/tests/discovery-listing-projection.test.ts`, replace the whole `describe("host", ...)` block with:

```ts
describe("host", () => {
  const hostProfile = {
    name: "Shiva Prakash",
    photo_url: "https://ik.example/p.jpg",
    bio: "I started Sri Adithya in 2015.",
    languages: ["Telugu", "Hindi"],
    hosting_since: 2015,
    verified: true,
    listed_since: "2026-09-10T00:00:00.000Z",
    stats: { review_count: 36, rating: 4.8, residents: 240 },
  };

  it("carries the host card as the host-profile service built it — full name included (ADR-200)", () => {
    const out = projectListing({
      detail,
      visible: { ...visible, owner: { name: "Shiva Prakash" }, created_at: "2026-01-04T00:00:00Z" },
      marketing,
      hostProfile,
    });
    expect(out.host).toEqual({ platform_listed: false, ...hostProfile });
  });

  it("falls back to the owner's full name and the hostel's date when the host read failed", () => {
    const out = projectListing({
      detail,
      visible: { ...visible, owner: { name: "  Ravi   Kumar " }, created_at: "2026-01-04T00:00:00Z" },
      marketing,
      hostProfile: null,
    });
    expect(out.host).toEqual({
      platform_listed: false,
      name: "Ravi Kumar",
      photo_url: null,
      bio: null,
      languages: [],
      hosting_since: null,
      verified: false,
      listed_since: "2026-01-04T00:00:00Z",
      stats: { review_count: 0, rating: null, residents: null },
    });
  });

  it("never names the sentinel profile behind a platform listing", () => {
    // Nobody operates a PLATFORM_LISTED hostel inside Stayo; "managed by
    // Stayo Platform" would be a person who does not exist.
    const out = projectListing({
      detail,
      visible: { ...visible, listing_source: "PLATFORM_LISTED", owner: { name: "Stayo Platform" } },
      marketing,
      hostProfile,
    });
    expect(out.host.name).toBeNull();
    expect(out.host.bio).toBeNull();
    expect(out.host.photo_url).toBeNull();
    expect(out.host.platform_listed).toBe(true);
  });

  it("returns no name rather than a blank one", () => {
    expect(projectListing({ detail, visible: { ...visible, owner: { name: "  " } }, marketing }).host.name)
      .toBeNull();
    expect(projectListing({ detail, visible, marketing }).host.name).toBeNull();
  });
});
```

- [ ] **Step 2: Add a discovery-service case**

In `apps/backend/tests/discovery-service.test.ts`, add this mock after the existing `vi.mock("@/src/services/admissions/admissions-service", ...)` block:

```ts
const { mockGetPublicHost } = vi.hoisted(() => ({ mockGetPublicHost: vi.fn() }));
vi.mock("@/src/services/host-profile/host-profile-service", () => ({
  hostProfileService: { getPublicHost: mockGetPublicHost },
}));
```

Then add inside the `describe` that holds the existing `getListing` tests (next to the case at ~line 129 that stubs `hostels().findFirst` with `{ id: "h1", hostel_type: "BOYS", food_included: true }`):

```ts
  it("puts the owner's host card on the listing, and survives it failing", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", owner_id: "o1", hostel_type: "BOYS", food_included: true, profiles: { name: "Shiva Prakash" } });
    (prisma as any).hostel_marketing_revisions.findFirst.mockResolvedValueOnce(null);
    mockGetPublicHost.mockResolvedValueOnce({
      name: "Shiva Prakash", photo_url: null, bio: "Hello", languages: [], hosting_since: null,
      verified: false, listed_since: null, stats: { review_count: 0, rating: null, residents: null },
    });
    const listing: any = await discoveryService.getListing("sunrise-residency");
    expect(mockGetPublicHost).toHaveBeenCalledWith("o1");
    expect(listing.host.bio).toBe("Hello");
    expect(hostels().findFirst.mock.calls[0][0].select.owner_id).toBe(true);

    hostels().findFirst.mockResolvedValueOnce({ id: "h1", owner_id: "o1", hostel_type: "BOYS", food_included: true, profiles: { name: "Shiva Prakash" } });
    (prisma as any).hostel_marketing_revisions.findFirst.mockResolvedValueOnce(null);
    mockGetPublicHost.mockRejectedValueOnce(new Error("db down"));
    const degraded: any = await discoveryService.getListing("sunrise-residency");
    expect(degraded.host.name).toBe("Shiva Prakash");
    expect(degraded.host.bio).toBeNull();
  });
```

The existing file may construct `hostels` / `discoveryService` / `prisma` under other names. If so, reuse the helpers already used by the `getListing` cases at lines ~115–176; the assertions stay the same.

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/discovery-listing-projection.test.ts tests/discovery-service.test.ts`
Expected: FAIL. `host` has no `photo_url`/`stats`, the name is still abbreviated, and `getPublicHost` is never called.

- [ ] **Step 4: Update the projection**

In `listing-projection.ts`, add at the imports:

```ts
import type { PublicHost } from "../host-profile/host-profile-service";
```
(type-only: erased at runtime, so no database client enters the projection's imports)

Extend `ProjectListingInput`. Keep existing fields; add `owner_id` to `visible` and a new top-level input:

```ts
    owner_id?: string | null;
```
(inside the `visible` type, next to `owner?`)
```ts
  /**
   * The owner's host card from `hostProfileService.getPublicHost` — hidden
   * fields already dropped. Null when it could not be read (or for a platform
   * listing); the projection then falls back to the bare name so a host-card
   * failure never takes a listing down.
   */
  hostProfile?: PublicHost | null;
```

Change the signature to `export function projectListing({ detail, visible, marketing, hostProfile = null, preview = false }: ProjectListingInput)`.

Replace the `hostName` doc comment's first line so it reads "Ravi K." — the rule for a *review's author*. Since ADR-200 host cards use the full name (`fullName` in host-profile-service); this stays for reviewers.

Replace the whole `host:` property, including the comment above it, with:

```ts
    /**
     * Who runs this place — the "Meet your host" card (ADR-200).
     *
     * A listing with no human attached is a database row; every marketplace
     * that trades on trust puts a person on the page. Since ADR-200 that
     * person is named in full, with their photo, their own words and the
     * stats they earned — and still never a phone or email (the bio rules
     * refuse both). A PLATFORM_LISTED hostel has no real owner, so it says so
     * rather than naming the sentinel profile.
     */
    host: platformListed
      ? {
          platform_listed: true,
          name: null,
          photo_url: null,
          bio: null,
          languages: [],
          hosting_since: null,
          verified: false,
          listed_since: visible.created_at ?? null,
          stats: { review_count: 0, rating: null, residents: null },
        }
      : {
          platform_listed: false,
          name: hostProfile?.name ?? fullName(visible.owner?.name),
          photo_url: hostProfile?.photo_url ?? null,
          bio: hostProfile?.bio ?? null,
          languages: hostProfile?.languages ?? [],
          hosting_since: hostProfile?.hosting_since ?? null,
          verified: hostProfile?.verified ?? false,
          listed_since: hostProfile?.listed_since ?? visible.created_at ?? null,
          stats: hostProfile?.stats ?? { review_count: 0, rating: null, residents: null },
        },
```

and import the pure helper (not the service — that would pull `@/lib/db` into the projection's graph):

```ts
import { fullName } from "../host-profile/bio-rules";
```

- [ ] **Step 5: Wire `getListing`**

In `discovery-service.ts`, add the import:

```ts
import { hostProfileService } from "@/src/services/host-profile/host-profile-service";
```

In `getListing`'s `select`, add `owner_id: true,` directly above `created_at: true,`. Update the comment above those lines to: `// Who runs it — see the host card (ADR-200). The relation on \`hostels\` is \`profiles\`, not \`owner\`; its name is only the fallback when the host card cannot be read.`

Extend the `Promise.all` destructure to `[detail, marketing, navigation, hostProfile]` and add a fourth element after `readNavigationSafely(...)`:

```ts
      /**
       * The host card (ADR-200). Read beside the listing and tolerantly: a
       * failure here — including migration 083 not being applied — renders
       * the bare owner name instead of 500ing the page.
       */
      visible.listing_source === "PLATFORM_LISTED" || !visible.owner_id
        ? Promise.resolve(null)
        : hostProfileService.getPublicHost(visible.owner_id).catch((error: unknown) => {
            console.warn("[discovery.getListing] host card unavailable:", error instanceof Error ? error.message : error);
            return null;
          }),
```

Pass it through: `return projectListing({ detail, visible: { ...visible, owner: visible.profiles, navigation }, marketing, hostProfile });`

- [ ] **Step 6: Wire the admin preview**

In `platform-admin/marketing-reviews/[revisionId]/preview/route.ts`:
- Add the `hostProfileService` import (same path as above).
- Add `owner_id: true,` to the `hostels.findUnique` select.
- After `navigation` is read, add:

```ts
    // The same host card the live page shows (ADR-200), read the same tolerant way.
    const hostProfile =
      hostel.listing_source === "PLATFORM_LISTED" || !hostel.owner_id
        ? null
        : await hostProfileService.getPublicHost(hostel.owner_id).catch(() => null);
```

- Pass `hostProfile` into `projectListing({ ... })`.

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `cd apps/backend && npm run test:pure`
Expected: PASS for the whole pure suite, including the updated projection/discovery tests. If any other pure test failed before this change, confirm it by stashing onto a WIP commit and re-running.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/src/services/discovery/listing-projection.ts apps/backend/src/services/discovery/discovery-service.ts "apps/backend/app/api/platform-admin/marketing-reviews/[revisionId]/preview/route.ts" apps/backend/tests/discovery-listing-projection.test.ts apps/backend/tests/discovery-service.test.ts
git commit -m "feat(discover): listing host carries the full host card (ADR-200)"
```

---

### Task 6: Frontend host-card model, types, API wrapper

**Files:**
- Create: `apps/frontend/src/features/host-profile/model/types.ts`
- Create: `apps/frontend/src/features/host-profile/model/hostCardModel.ts`
- Test: `apps/frontend/src/features/host-profile/model/hostCardModel.test.ts`
- Create: `apps/frontend/src/features/host-profile/api/index.ts`
- Modify: `apps/frontend/src/lib/queryKeys.ts` (add `owner.hostProfile`)

**Interfaces:**
- Produces:
  - types `HostStats`, `PublicHost`, `EditableHost`, `AdminHost`, `HostDraft`, `HostAdminPatch`, constants `HOST_LANGUAGES`, `BIO_MAX_CHARS`, `LANGUAGES_MAX`
  - model `formatMonthYear`, `languagesPhrase`, `residentsLabel`, `hostFacts`, `hostStats`, `buildHostCard`, `buildMilestones`, `draftFrom`, `withDraft`, `publicView`, `toggleLanguage`, `hiddenNotice`, `hostingYears`; types `HostCardModel`, `HostStat`, `Milestone`
  - api `hostProfileService.{getMine, saveMine, getForOwner, updateForOwner, replaceOwnerPhoto, removeOwnerPhoto}`, `hostProfileErrorMessage(error, fallback)`
  - `queryKeys.owner.hostProfile()`

- [ ] **Step 1: Write the types**

```ts
// apps/frontend/src/features/host-profile/model/types.ts
/**
 * The host card's data (ADR-200). Mirrors `PublicHost` / `EditableHost` /
 * `AdminHost` in `apps/backend/src/services/host-profile/host-profile-service.ts`
 * — the listing's `host` object is `PublicHost` plus `platform_listed`.
 */

export interface HostStats {
  review_count: number;
  rating: number | null;
  /** Already rounded by the backend: null below 5, floored to the ten from 10. */
  residents: number | null;
}

export interface PublicHost {
  platform_listed?: boolean;
  name: string | null;
  photo_url: string | null;
  bio: string | null;
  languages: string[];
  hosting_since: number | null;
  verified: boolean;
  listed_since: string | null;
  stats: HostStats;
}

export interface EditableHost extends PublicHost {
  bio_hidden: boolean;
  photo_hidden: boolean;
}

export interface AdminHost extends EditableHost {
  updated_at: string | null;
  updated_by_name: string | null;
}

export interface HostDraft {
  bio: string;
  languages: string[];
  hosting_since: number | null;
}

export type HostAdminPatch = Partial<HostDraft> & { name?: string; bio_hidden?: boolean; photo_hidden?: boolean };

/** Same list and order as the backend's `bio-rules.ts`. */
export const HOST_LANGUAGES = [
  'Telugu', 'Hindi', 'English', 'Tamil', 'Kannada', 'Malayalam',
  'Marathi', 'Urdu', 'Bengali', 'Gujarati', 'Punjabi', 'Odia',
] as const;

export const BIO_MAX_CHARS = 500;
export const LANGUAGES_MAX = 6;
```

- [ ] **Step 2: Write the failing model test**

```ts
// apps/frontend/src/features/host-profile/model/hostCardModel.test.ts
import { describe, expect, it } from 'vitest';
import {
  buildHostCard, buildMilestones, draftFrom, formatMonthYear, hiddenNotice, hostFacts,
  hostingYears, languagesPhrase, publicView, residentsLabel, toggleLanguage, withDraft,
} from './hostCardModel';
import type { EditableHost, PublicHost } from './types';

const HOST: PublicHost = {
  platform_listed: false,
  name: 'Shiva Prakash',
  photo_url: 'https://ik.example/p.jpg',
  bio: 'I started Sri Adithya in 2015.',
  languages: ['Telugu', 'Hindi', 'English'],
  hosting_since: 2015,
  verified: true,
  listed_since: '2026-09-15T12:00:00.000Z',
  stats: { review_count: 36, rating: 4.8, residents: 240 },
};

describe('formatting', () => {
  it('names months without depending on the runtime locale', () => {
    expect(formatMonthYear('2026-09-15T12:00:00.000Z')).toBe('September 2026');
    expect(formatMonthYear('2026-09-15T12:00:00.000Z', 'short')).toBe('Sep 2026');
    expect(formatMonthYear(null)).toBeNull();
    expect(formatMonthYear('not a date')).toBeNull();
  });

  it('lists languages the way a person says them', () => {
    expect(languagesPhrase([])).toBeNull();
    expect(languagesPhrase(['Telugu'])).toBe('Telugu');
    expect(languagesPhrase(['Telugu', 'Hindi'])).toBe('Telugu and Hindi');
    expect(languagesPhrase(['Telugu', 'Hindi', 'English'])).toBe('Telugu, Hindi and English');
  });

  it('adds + only to the rounded resident figures', () => {
    expect(residentsLabel(7)).toBe('7');
    expect(residentsLabel(240)).toBe('240+');
  });

  it('states facts only when the owner gave them', () => {
    expect(hostFacts(HOST)).toEqual(['Running hostels since 2015', 'Speaks Telugu, Hindi and English']);
    expect(hostFacts({ hosting_since: null, languages: [] })).toEqual([]);
  });
});

describe('buildHostCard', () => {
  it('leads with the owner\'s own words when there are some', () => {
    const card = buildHostCard(HOST, { hostelName: 'Sri Adithya Boys Hostel' })!;
    expect(card.variant).toBe('note');
    expect(card.heading).toBe('A note from your host');
    expect(card.name).toBe('Shiva Prakash');
    expect(card.bio).toBe('I started Sri Adithya in 2015.');
    expect(card.role).toBe('Owner');
    expect(card.stats).toEqual([
      { key: 'rating', value: '4.8★', label: '36 reviews' },
      { key: 'residents', value: '240+', label: 'residents' },
      { key: 'since', value: 'Sep 2026', label: 'on Stayo since' },
    ]);
  });

  it('addresses the owner by full name on the button — never first name only', () => {
    expect(buildHostCard(HOST)!.ctaLabel).toBe('Enquire with Shiva Prakash');
    expect(buildHostCard({ ...HOST, name: null })!.ctaLabel).toBe('Enquire');
  });

  it('honours an owner with no words yet: no quote, name and hostel first', () => {
    const card = buildHostCard({ ...HOST, bio: '   ' }, { hostelName: 'Sri Adithya Boys Hostel' })!;
    expect(card.variant).toBe('compact');
    expect(card.heading).toBe('Meet your host');
    expect(card.bio).toBeNull();
    expect(card.role).toBe('Owner of Sri Adithya Boys Hostel · On Stayo since September 2026');
    // The role line already says since when — the stat would repeat it.
    expect(card.stats.map((s) => s.key)).toEqual(['rating', 'residents']);
  });

  it('never shows a zero or an unknown stat', () => {
    const card = buildHostCard({ ...HOST, stats: { review_count: 0, rating: null, residents: null } })!;
    expect(card.stats.map((s) => s.key)).toEqual(['since']);
    expect(buildHostCard({ ...HOST, stats: { review_count: 1, rating: 5, residents: null } })!.stats[0])
      .toEqual({ key: 'rating', value: '5.0★', label: '1 review' });
  });

  it('keeps a platform listing to "Listed by Stayo"', () => {
    const card = buildHostCard({ ...HOST, platform_listed: true, name: null, bio: null })!;
    expect(card.variant).toBe('platform');
    expect(card.heading).toBe('Listed by Stayo');
    expect(card.ctaLabel).toBeNull();
    expect(card.stats).toEqual([]);
  });

  it('renders nothing without a host', () => {
    expect(buildHostCard(null)).toBeNull();
    expect(buildHostCard(undefined)).toBeNull();
  });

  it('falls back to an initial, never an empty circle', () => {
    expect(buildHostCard(HOST)!.initial).toBe('S');
    expect(buildHostCard({ ...HOST, name: null })!.initial).toBe('S');
    expect(buildHostCard({ ...HOST, name: 'ravi kumar' })!.initial).toBe('R');
  });
});

describe('owner screen helpers', () => {
  const EDITABLE: EditableHost = { ...HOST, bio_hidden: false, photo_hidden: false };

  it('always shows three milestones, with a gentle placeholder instead of a zero', () => {
    expect(buildMilestones(HOST)).toEqual([
      { key: 'residents', value: '240+', label: 'residents welcomed' },
      { key: 'rating', value: '4.8★', label: 'from 36 reviews' },
      { key: 'since', value: 'Sep 2026', label: 'on Stayo since' },
    ]);
    expect(buildMilestones({ ...HOST, stats: { review_count: 0, rating: null, residents: null } })).toEqual([
      { key: 'residents', value: null, label: 'Shows once 5 residents have stayed' },
      { key: 'rating', value: null, label: 'Your first review will show here' },
      { key: 'since', value: 'Sep 2026', label: 'on Stayo since' },
    ]);
  });

  it('previews the draft exactly as the public will see it', () => {
    const draft = { ...draftFrom(EDITABLE), bio: '  New words  ', languages: ['Tamil'] };
    const preview = withDraft(EDITABLE, draft);
    expect(preview.bio).toBe('New words');
    expect(preview.languages).toEqual(['Tamil']);
    const hidden = publicView({ ...preview, bio_hidden: true, photo_hidden: true });
    expect(hidden.bio).toBeNull();
    expect(hidden.photo_url).toBeNull();
  });

  it('starts the draft from what is saved', () => {
    expect(draftFrom({ ...EDITABLE, bio: null, hosting_since: null, languages: [] }))
      .toEqual({ bio: '', languages: [], hosting_since: null });
  });

  it('toggles languages up to the limit', () => {
    expect(toggleLanguage(['Telugu'], 'Hindi')).toEqual(['Telugu', 'Hindi']);
    expect(toggleLanguage(['Telugu', 'Hindi'], 'Telugu')).toEqual(['Hindi']);
    const six = ['Telugu', 'Hindi', 'English', 'Tamil', 'Kannada', 'Malayalam'];
    expect(toggleLanguage(six, 'Odia')).toEqual(six);
  });

  it('tells the owner plainly what Stayo has hidden', () => {
    expect(hiddenNotice(EDITABLE)).toBeNull();
    expect(hiddenNotice({ ...EDITABLE, bio_hidden: true })).toBe(
      'Stayo has hidden your story from your public listing. Contact support if you think this is a mistake.',
    );
    expect(hiddenNotice({ ...EDITABLE, bio_hidden: true, photo_hidden: true })).toBe(
      'Stayo has hidden your story and photo from your public listing. Contact support if you think this is a mistake.',
    );
  });

  it('offers every year from now back to 1950', () => {
    const years = hostingYears(new Date('2026-09-14T00:00:00Z'));
    expect(years[0]).toBe(2026);
    expect(years[years.length - 1]).toBe(1950);
    expect(years).toHaveLength(77);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails**

Run: `cd apps/frontend && npx vitest run src/features/host-profile/model/hostCardModel.test.ts`
Expected: FAIL. Cannot resolve `./hostCardModel`.

- [ ] **Step 4: Implement the model**

```ts
// apps/frontend/src/features/host-profile/model/hostCardModel.ts
import { LANGUAGES_MAX, type EditableHost, type HostDraft, type PublicHost } from './types';

/**
 * "Meet your host" (ADR-200) — every decision the card makes, with no React.
 *
 * The respect rules live here so they are asserted, not remembered:
 * the owner is named in full (the button included), a stat that is zero or
 * unknown is left out rather than shown as nothing, and an owner with no
 * words yet still gets a card that leads with their face and name — never an
 * empty quote or "No description yet".
 *
 * `HostCard.tsx` renders this for the Discover listing, the owner's own
 * preview and the admin drawer; one model is why the three cannot drift.
 */

export type HostCardVariant = 'note' | 'compact' | 'platform';

export interface HostStat {
  key: 'rating' | 'residents' | 'since';
  value: string;
  label: string;
}

export interface HostCardModel {
  variant: HostCardVariant;
  heading: string;
  name: string | null;
  initial: string;
  photoUrl: string | null;
  verified: boolean;
  bio: string | null;
  role: string;
  facts: string[];
  stats: HostStat[];
  ctaLabel: string | null;
}

export interface Milestone {
  key: 'residents' | 'rating' | 'since';
  value: string | null;
  label: string;
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Own month names: `toLocaleDateString('en-IN')` says "Sept" on some runtimes and "Sep" on others. */
export function formatMonthYear(iso: string | null | undefined, style: 'long' | 'short' = 'long'): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const month = MONTHS[date.getMonth()];
  return `${style === 'short' ? month.slice(0, 3) : month} ${date.getFullYear()}`;
}

export function languagesPhrase(languages: string[]): string | null {
  const list = languages.filter(Boolean);
  if (list.length === 0) return null;
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/** The backend floors to the ten from 10 upward; "+" says so. */
export function residentsLabel(count: number): string {
  return count >= 10 ? `${count}+` : String(count);
}

export function hostFacts(host: Pick<PublicHost, 'hosting_since' | 'languages'>): string[] {
  const facts: string[] = [];
  if (host.hosting_since) facts.push(`Running hostels since ${host.hosting_since}`);
  const languages = languagesPhrase(host.languages ?? []);
  if (languages) facts.push(`Speaks ${languages}`);
  return facts;
}

const reviewsLabel = (count: number) => (count === 1 ? '1 review' : `${count} reviews`);

export function hostStats(host: PublicHost, { includeSince }: { includeSince: boolean }): HostStat[] {
  const stats: HostStat[] = [];
  const { review_count, rating, residents } = host.stats ?? { review_count: 0, rating: null, residents: null };
  if (review_count > 0 && rating !== null) {
    stats.push({ key: 'rating', value: `${rating.toFixed(1)}★`, label: reviewsLabel(review_count) });
  }
  if (residents !== null && residents > 0) {
    stats.push({ key: 'residents', value: residentsLabel(residents), label: 'residents' });
  }
  const since = includeSince ? formatMonthYear(host.listed_since, 'short') : null;
  if (since) stats.push({ key: 'since', value: since, label: 'on Stayo since' });
  return stats;
}

export function buildHostCard(
  host: PublicHost | null | undefined,
  { hostelName }: { hostelName?: string | null } = {},
): HostCardModel | null {
  if (!host) return null;

  const since = formatMonthYear(host.listed_since);
  if (host.platform_listed) {
    return {
      variant: 'platform', heading: 'Listed by Stayo', name: null, initial: 'S', photoUrl: null,
      verified: false, bio: null, role: since ? `On Stayo since ${since}` : 'On Stayo',
      facts: [], stats: [], ctaLabel: null,
    };
  }

  const name = host.name?.trim() || null;
  const bio = host.bio?.trim() || null;
  const variant: HostCardVariant = bio ? 'note' : 'compact';
  const role =
    variant === 'note'
      ? 'Owner'
      : [hostelName ? `Owner of ${hostelName}` : 'Owner', since ? `On Stayo since ${since}` : null]
          .filter(Boolean)
          .join(' · ');

  return {
    variant,
    heading: variant === 'note' ? 'A note from your host' : 'Meet your host',
    name,
    initial: (name ?? 'S').charAt(0).toUpperCase(),
    photoUrl: host.photo_url || null,
    verified: Boolean(host.verified),
    bio,
    role,
    facts: hostFacts(host),
    stats: hostStats(host, { includeSince: variant === 'note' }),
    ctaLabel: name ? `Enquire with ${name}` : 'Enquire',
  };
}

/** The owner's pride strip: always three tiles, a kind placeholder where a zero would be. */
export function buildMilestones(host: PublicHost): Milestone[] {
  const { review_count, rating, residents } = host.stats;
  return [
    residents !== null && residents > 0
      ? { key: 'residents', value: residentsLabel(residents), label: 'residents welcomed' }
      : { key: 'residents', value: null, label: 'Shows once 5 residents have stayed' },
    review_count > 0 && rating !== null
      ? { key: 'rating', value: `${rating.toFixed(1)}★`, label: `from ${reviewsLabel(review_count)}` }
      : { key: 'rating', value: null, label: 'Your first review will show here' },
    { key: 'since', value: formatMonthYear(host.listed_since, 'short'), label: 'on Stayo since' },
  ];
}

export function draftFrom(host: EditableHost): HostDraft {
  return { bio: host.bio ?? '', languages: host.languages ?? [], hosting_since: host.hosting_since ?? null };
}

export function withDraft<T extends PublicHost>(host: T, draft: HostDraft): T {
  return { ...host, bio: draft.bio.trim() || null, languages: draft.languages, hosting_since: draft.hosting_since };
}

/** What a stranger sees of an editable host — the hide flags applied. */
export function publicView(host: EditableHost): PublicHost {
  const { bio_hidden, photo_hidden, ...rest } = host;
  return { ...rest, bio: bio_hidden ? null : rest.bio, photo_url: photo_hidden ? null : rest.photo_url };
}

export function toggleLanguage(list: string[], language: string, max = LANGUAGES_MAX): string[] {
  if (list.includes(language)) return list.filter((item) => item !== language);
  if (list.length >= max) return list;
  return [...list, language];
}

export function hiddenNotice(host: Pick<EditableHost, 'bio_hidden' | 'photo_hidden'>): string | null {
  const parts = [host.bio_hidden ? 'story' : null, host.photo_hidden ? 'photo' : null].filter(Boolean);
  if (parts.length === 0) return null;
  return `Stayo has hidden your ${parts.join(' and ')} from your public listing. Contact support if you think this is a mistake.`;
}

export function hostingYears(now: Date = new Date()): number[] {
  const years: number[] = [];
  for (let year = now.getFullYear(); year >= 1950; year -= 1) years.push(year);
  return years;
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd apps/frontend && npx vitest run src/features/host-profile/model/hostCardModel.test.ts`
Expected: PASS.

- [ ] **Step 6: Write the API wrapper and the query key**

```ts
// apps/frontend/src/features/host-profile/api/index.ts
import api from '@lib/api-client';
import type { AdminHost, EditableHost, HostAdminPatch, HostDraft } from '../model/types';

/**
 * Meet your host (ADR-200) — the only layer that knows these endpoints.
 * One feature for both ends, like hostel-marketing: the owner's screen and the
 * admin's drawer read and write the same record.
 */

function unwrap<T>(response: { data: any }): T {
  const body = response.data;
  return (body && body.success !== undefined ? body.data : body) as T;
}

export const hostProfileService = {
  getMine: async () => unwrap<EditableHost>(await api.get('/owner/me/host-profile')),
  saveMine: async (draft: HostDraft) => unwrap<EditableHost>(await api.put('/owner/me/host-profile', draft)),
  getForOwner: async (ownerId: string) =>
    unwrap<AdminHost>(await api.get(`/platform-admin/owners/${ownerId}/host-profile`)),
  updateForOwner: async (ownerId: string, patch: HostAdminPatch) =>
    unwrap<AdminHost>(await api.patch(`/platform-admin/owners/${ownerId}/host-profile`, patch)),
  replaceOwnerPhoto: async (ownerId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return unwrap<{ photo_url: string | null }>(await api.post(`/platform-admin/owners/${ownerId}/photo`, form));
  },
  removeOwnerPhoto: async (ownerId: string) =>
    unwrap<{ photo_url: string | null }>(await api.delete(`/platform-admin/owners/${ownerId}/photo`)),
};

/** The server's own reason (e.g. "Remove the phone number — …"), or the fallback. */
export function hostProfileErrorMessage(error: unknown, fallback: string): string {
  const message = (error as any)?.response?.data?.error?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
}
```

In `apps/frontend/src/lib/queryKeys.ts`, inside `owner: { ... }` directly after `profile: () => ownerKey('profile'),`, add:

```ts
    /** Meet your host (ADR-200) — the owner's public host card and its draft source. */
    hostProfile: () => ownerKey('host-profile'),
```

- [ ] **Step 7: Commit**

```bash
git add apps/frontend/src/features/host-profile apps/frontend/src/lib/queryKeys.ts
git commit -m "feat(host-profile): host card model, types and API wrapper (ADR-200)"
```

---

### Task 7: `HostCard` renderer and the Discover listing

**Files:**
- Create: `apps/frontend/src/features/host-profile/components/HostCard.tsx`
- Modify: `apps/frontend/src/app/pages/discover/ListingPage.tsx` (replace the "Who runs it" block, ~lines 670–705)

**Interfaces:**
- Consumes: `buildHostCard`, `PublicHost` (Task 6); `C`, `FONT` from `@/app/pages/discover/discoverTheme`.
- Produces: `<HostCard host hostelName? onEnquire? />`. Without `onEnquire` the button renders but is inert, for previews.

- [ ] **Step 1: Implement `HostCard.tsx`**

```tsx
// apps/frontend/src/features/host-profile/components/HostCard.tsx
import { Check, ShieldCheck } from 'lucide-react';
import { C, FONT } from '@/app/pages/discover/discoverTheme';
import { buildHostCard, type HostCardModel } from '../model/hostCardModel';
import type { PublicHost } from '../model/types';

/**
 * "Meet your host" — the "In their own words" card (ADR-200).
 *
 * A thin renderer over `buildHostCard`; every decision (which variant, which
 * stats, what the button says) is made and tested there. Used unchanged by
 * the Discover listing, the owner's own preview and the admin drawer — so
 * what an owner previews is what a resident sees.
 *
 * Discover's hard-coded palette, deliberately: this is a public-surface
 * component, and it should look identical inside the owner and admin shells
 * that preview it.
 */

const SERIF = "Georgia, 'Times New Roman', serif";

function HostPhoto({ card, size }: { card: HostCardModel; size: number }) {
  const tick = Math.round(size * 0.36);
  return (
    <span className="relative flex-none" style={{ width: size, height: size }}>
      {card.photoUrl ? (
        <img
          src={card.photoUrl}
          alt={card.name ? `Photo of ${card.name}` : 'Photo of the host'}
          className="h-full w-full rounded-full object-cover"
        />
      ) : (
        <span
          className="flex h-full w-full items-center justify-center rounded-full font-extrabold"
          style={{ fontFamily: FONT.display, background: C.clayPaleBg, color: C.clayDeep, fontSize: size * 0.36 }}
        >
          {card.initial}
        </span>
      )}
      {card.verified && (
        <span
          className="absolute -bottom-0.5 -right-0.5 flex items-center justify-center rounded-full border-2 border-white"
          style={{ width: tick, height: tick, background: C.green }}
          title="ID verified by Stayo"
          aria-label="ID verified by Stayo"
          role="img"
        >
          <Check className="text-white" style={{ width: tick * 0.55, height: tick * 0.55 }} strokeWidth={3.5} />
        </span>
      )}
    </span>
  );
}

function Identity({ card }: { card: HostCardModel }) {
  return (
    <div className="min-w-0">
      <p className="text-[16.5px] font-extrabold leading-tight" style={{ fontFamily: FONT.display, color: C.text }}>
        {card.name ?? 'The owner'}
      </p>
      <p className="mt-0.5 text-[12px] leading-[1.45]" style={{ color: C.textMuted }}>{card.role}</p>
      {card.facts.map((fact) => (
        <p key={fact} className="mt-0.5 text-[11.5px] leading-[1.45]" style={{ color: C.textMuted }}>{fact}</p>
      ))}
    </div>
  );
}

export function HostCard({
  host,
  hostelName,
  onEnquire,
}: {
  host: PublicHost | null | undefined;
  hostelName?: string | null;
  /** Omit in previews: the button still renders, so the preview is faithful, but does nothing. */
  onEnquire?: () => void;
}) {
  const card = buildHostCard(host, { hostelName });
  if (!card) return null;

  if (card.variant === 'platform') {
    return (
      <div className="flex items-center gap-3">
        <HostPhoto card={card} size={44} />
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>{card.heading}</p>
          <p className="mt-0.5 text-[11.5px]" style={{ color: C.textMuted }}>{card.role}</p>
        </div>
      </div>
    );
  }

  return (
    <section aria-label={card.heading}>
      <h2 className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
        {card.heading}
      </h2>

      {card.variant === 'note' ? (
        <figure className="mt-3 rounded-[20px] border bg-white px-[18px] pb-[18px] pt-4" style={{ borderColor: C.line }}>
          <span aria-hidden className="block h-[26px] text-[54px] leading-[0.6]" style={{ fontFamily: SERIF, color: C.clay }}>
            “
          </span>
          <blockquote
            className="mt-1 whitespace-pre-line text-[15.5px] leading-[1.6]"
            style={{ fontFamily: SERIF, color: C.text }}
          >
            {card.bio}
          </blockquote>
          <figcaption className="mt-4 flex items-center gap-3 border-t pt-3.5" style={{ borderColor: C.line }}>
            <HostPhoto card={card} size={56} />
            <Identity card={card} />
          </figcaption>
        </figure>
      ) : (
        <div className="mt-3 flex items-center gap-3 rounded-[20px] border bg-white p-4" style={{ borderColor: C.line }}>
          <HostPhoto card={card} size={60} />
          <Identity card={card} />
        </div>
      )}

      {card.stats.length > 0 && (
        <dl className="mt-3.5 flex justify-between gap-3 px-1">
          {card.stats.map((stat) => (
            <div key={stat.key} className="flex min-w-0 flex-col-reverse">
              <dt className="text-[11px]" style={{ color: C.textMuted }}>{stat.label}</dt>
              <dd className="text-[16px] font-extrabold" style={{ fontFamily: FONT.display, color: C.text }}>{stat.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {card.ctaLabel && (
        <button
          type="button"
          onClick={onEnquire}
          disabled={!onEnquire}
          className="mt-4 block w-full rounded-[14px] border-[1.5px] bg-white px-4 py-3 text-center text-[14px] font-bold disabled:cursor-default"
          style={{ borderColor: C.text, color: C.text, fontFamily: FONT.display }}
        >
          {card.ctaLabel}
        </button>
      )}

      <p className="mt-3 flex items-start gap-2 text-[11.5px] leading-[1.45]" style={{ color: C.textMuted }}>
        <ShieldCheck className="mt-px h-3.5 w-3.5 flex-none" strokeWidth={1.8} />
        Pay and talk through Stayo, so there's a record of everything.
      </p>
    </section>
  );
}
```

Before relying on them, check that `C.clayPaleBg`, `C.clayDeep`, `C.clay`, `C.green`, `C.line`, `C.text` and `C.textMuted` all exist in `discoverTheme.ts`. They do on `origin/main` (clay 22, clayDeep 23, line 34, text 39, textMuted 41, green 46, clayPaleBg 51).

- [ ] **Step 2: Put it on the listing**

In `ListingPage.tsx`, add the import beside the other feature import:

```ts
import { HostCard } from '@features/host-profile/components/HostCard';
```

Replace the whole block from the comment `{/* ── Who runs it ─── */}` through the closing `)}` of `{(data?.host?.name || data?.host?.listed_since) && ( ... )}` with:

```tsx
          {/* ── Meet your host (ADR-200) ───────────────────────────────── */}
          {/*
            The person before the price: a listing with nobody attached is a
            database row. Full name, photo and the owner's own words — never a
            phone or email (the backend's bio rules refuse both). In an admin
            preview the Enquire button renders but stays inert.
          */}
          {data?.host && (
            <div className="mt-5 border-t pt-5" style={{ borderColor: C.line }}>
              <HostCard
                host={data.host}
                hostelName={hostel.name}
                onEnquire={
                  previewRevisionId
                    ? undefined
                    : () =>
                        navigate(`/discover/h/${slug}/enquire`, {
                          state: { roomCapacity: selectedOption?.capacity, hostelName: hostel.name },
                        })
                }
              />
            </div>
          )}
```

- [ ] **Step 3: Typecheck the touched files and the architecture check**

Run: `cd apps/frontend && npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "host-profile|ListingPage" ; npm run check:architecture`
Expected: no lines mention `host-profile/` or `ListingPage.tsx`, and the architecture check passes.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/features/host-profile/components/HostCard.tsx apps/frontend/src/app/pages/discover/ListingPage.tsx
git commit -m "feat(discover): 'In their own words' host card on the listing (ADR-200)"
```

---

### Task 8: Owner "Your host profile" screen

**Files:**
- Create: `apps/frontend/src/features/host-profile/pages/HostProfilePage.tsx`
- Modify: `apps/frontend/src/platforms/owner/router/OwnerRoutes.tsx` (lazy import + route)
- Modify: `apps/frontend/src/features/owner-more/pages/MoreConfigurationHubPage.tsx` (header links to the new screen)

**Interfaces:**
- Consumes: `hostProfileService.getMine/saveMine`, `hostProfileErrorMessage`, `queryKeys.owner.hostProfile`, model helpers (`buildMilestones`, `draftFrom`, `withDraft`, `publicView`, `toggleLanguage`, `hiddenNotice`, `hostingYears`), `HostCard`, `MoreScreenHeader`, `SaveBar`, `hasChanges`, `stayoToast`.
- Produces: route `/owner/more/host-profile`.

- [ ] **Step 1: Implement the page**

```tsx
// apps/frontend/src/features/host-profile/pages/HostProfilePage.tsx
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { queryKeys } from '@lib/queryKeys';
import { MoreScreenHeader } from '@features/owner-more/components/MoreScreenHeader';
import { SaveBar } from '@features/owner-more/components/SaveBar';
import { hasChanges } from '@features/owner-more/config/dirtyState';
import { hostProfileErrorMessage, hostProfileService } from '../api';
import { HostCard } from '../components/HostCard';
import {
  buildMilestones, draftFrom, hiddenNotice, hostingYears, publicView, toggleLanguage, withDraft,
} from '../model/hostCardModel';
import { BIO_MAX_CHARS, HOST_LANGUAGES, type HostDraft } from '../model/types';

const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';
const field =
  'w-full rounded-[11px] border border-border bg-card px-3.5 py-2.5 text-[14px] text-foreground outline-none focus:border-primary';

/**
 * Profile → Your host profile (ADR-200).
 *
 * Not a form field on Details. An owner's story is the one thing on their
 * account a resident reads, so it gets a screen that opens on what they have
 * earned (the milestones) and shows them — live, as they type — exactly the
 * card a resident will see. The preview is `HostCard` itself, fed through
 * `publicView`, so an admin hide shows here the way it shows on Discover.
 *
 * Saves live (no approval queue). The photo is changed on Details; this
 * screen links there rather than growing a second uploader.
 */
export function HostProfilePage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.owner.hostProfile(),
    queryFn: hostProfileService.getMine,
    staleTime: 60_000,
  });

  const [draft, setDraft] = useState<HostDraft>({ bio: '', languages: [], hosting_since: null });
  const [baseline, setBaseline] = useState<HostDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      const loaded = draftFrom(query.data);
      setDraft(loaded);
      setBaseline(loaded);
    }
  }, [query.data]);

  const save = useMutation({
    mutationFn: hostProfileService.saveMine,
    onSuccess: (saved) => {
      queryClient.setQueryData(queryKeys.owner.hostProfile(), saved);
      setError(null);
      stayoToast.success('Your host profile is live');
    },
    onError: (e) => setError(hostProfileErrorMessage(e, 'Could not save your host profile')),
  });

  const dirty = hasChanges(baseline, draft);
  const host = query.data;

  return (
    <div className={`flex flex-col gap-6 px-4 pt-6 sm:px-6 lg:mx-auto lg:w-full lg:max-w-[760px] lg:px-0 lg:pt-8 ${dirty ? 'pb-40' : 'pb-24'}`}>
      <MoreScreenHeader
        backTo="/owner/more"
        backLabel="Profile"
        title="Your host profile"
        subtitle="This is how residents meet you on Stayo."
      />

      {query.isLoading || !host ? (
        query.isError ? (
          <p className="text-[13px] text-destructive">Couldn't load your host profile. Pull down to try again.</p>
        ) : (
          <div className="h-64 animate-pulse rounded-2xl bg-muted" />
        )
      ) : (
        <>
          <section className="grid grid-cols-3 gap-2">
            {buildMilestones(host).map((m) => (
              <div key={m.key} className="rounded-[14px] border border-border bg-card px-2 py-3 text-center">
                {m.value ? (
                  <>
                    <p className="font-display text-[17px] font-extrabold text-foreground">{m.value}</p>
                    <p className="mt-0.5 text-[10.5px] leading-tight text-muted-foreground">{m.label}</p>
                  </>
                ) : (
                  <p className="text-[10.5px] leading-tight text-muted-foreground">{m.label}</p>
                )}
              </div>
            ))}
          </section>

          {hiddenNotice(host) && (
            <p className="rounded-[12px] border border-border bg-muted px-3.5 py-3 text-[12.5px] leading-[1.5] text-foreground">
              {hiddenNotice(host)}
            </p>
          )}

          <section className="flex flex-col gap-2">
            <h2 className={sectionLabel}>Live preview</h2>
            <div className="rounded-[18px] bg-[#F7F1EC] p-4">
              <HostCard host={publicView(withDraft(host, draft))} />
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className={sectionLabel}>Your story</h2>
            <p className="rounded-[10px] bg-primary/10 px-3 py-2 text-[12px] leading-[1.5] text-primary">
              Not sure what to write? Try: why you started your hostel · what you do for residents · where to find you.
            </p>
            <textarea
              value={draft.bio}
              onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
              maxLength={BIO_MAX_CHARS}
              rows={6}
              className={`${field} resize-y leading-[1.55]`}
              aria-describedby="host-bio-help"
            />
            <p id="host-bio-help" className="flex justify-between gap-3 px-0.5 text-[11px] text-muted-foreground">
              <span>No phone numbers or links — residents reach you through Stayo.</span>
              <span className="flex-none tabular-nums">{draft.bio.length} / {BIO_MAX_CHARS}</span>
            </p>
            {error && <p className="px-0.5 text-[12px] font-medium text-destructive">{error}</p>}
          </section>

          <section className="flex flex-col gap-2">
            <h2 className={sectionLabel}>Languages you speak</h2>
            <div className="flex flex-wrap gap-2">
              {HOST_LANGUAGES.map((language) => {
                const on = draft.languages.includes(language);
                return (
                  <button
                    key={language}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setDraft((d) => ({ ...d, languages: toggleLanguage(d.languages, language) }))}
                    className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium ${
                      on ? 'border-foreground bg-foreground text-background' : 'border-border bg-card text-foreground'
                    }`}
                  >
                    {language}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="flex flex-col gap-2">
            <h2 className={sectionLabel}>Running hostels since</h2>
            <select
              value={draft.hosting_since ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, hosting_since: e.target.value ? Number(e.target.value) : null }))}
              className={field}
            >
              <option value="">Not set</option>
              {hostingYears().map((year) => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </section>

          <section className="flex items-center justify-between gap-3 rounded-[14px] border border-border bg-card px-4 py-3">
            <span className="text-[13px] text-muted-foreground">Your photo comes from your Details.</span>
            <button
              type="button"
              onClick={() => navigate('/owner/more/profile')}
              className="flex-none text-[13px] font-semibold text-primary"
            >
              Change photo
            </button>
          </section>
        </>
      )}

      <SaveBar
        visible={dirty}
        pending={save.isPending}
        onSave={() => save.mutate(draft)}
        onDiscard={() => baseline && setDraft(baseline)}
        label="Save"
      />
    </div>
  );
}
```

Before relying on them, check `MoreScreenHeader`'s `subtitle` prop and `SaveBar`'s `label`/`pending` props exist. `MoreProfilePage` uses `SaveBar` with `visible/pending/onSave/onDiscard/label`, and `MoreScreenHeader` declares `subtitle`.

- [ ] **Step 2: Add the route**

In `OwnerRoutes.tsx`, beside the other `lazy` imports (after `MoreProfilePage`):

```ts
const HostProfilePage = lazy(() => import('@features/host-profile/pages/HostProfilePage').then((m) => ({ default: m.HostProfilePage })));
```

and directly under `<Route path="/owner/more/profile" element={<MoreProfilePage />} />`:

```tsx
        <Route path="/owner/more/host-profile" element={<HostProfilePage />} />
```

- [ ] **Step 3: Link from the Profile header**

In `MoreConfigurationHubPage.tsx`, replace the header's inner `<div className="flex min-w-0 flex-1 flex-col gap-0.5">…</div>` with:

```tsx
        <button
          type="button"
          onClick={() => navigate('/owner/more/host-profile')}
          className="flex min-w-0 flex-1 flex-col gap-0.5 text-left"
        >
          <h1 className="truncate font-display text-[22px] font-extrabold tracking-tight text-foreground">
            {identity.name}
          </h1>
          {identity.sub && <p className="truncate text-[12.5px] text-muted-foreground">{identity.sub}</p>}
          {/* ADR-200: the owner's name leads to how residents meet them —
              the Airbnb "Show profile" pattern, and the way to the pride
              screen without adding a fifth row to a list kept to four. */}
          <span className="mt-0.5 flex items-center gap-1 text-[12.5px] font-semibold text-primary">
            See how residents meet you
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={2.2} />
          </span>
        </button>
```

(`ChevronRight` and `navigate` are already in scope in this file.)

- [ ] **Step 4: Typecheck, architecture check, and run the frontend tests**

Run: `cd apps/frontend && npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "host-profile|OwnerRoutes|MoreConfigurationHubPage" ; npm run check:architecture && npx vitest run src/features/host-profile src/features/owner-more`
Expected: no tsc lines for these files; the architecture check passes; the tests pass (`hubSections.test.ts` untouched and green).

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/host-profile/pages/HostProfilePage.tsx apps/frontend/src/platforms/owner/router/OwnerRoutes.tsx apps/frontend/src/features/owner-more/pages/MoreConfigurationHubPage.tsx
git commit -m "feat(owner): 'Your host profile' screen with milestones and live preview (ADR-200)"
```

---

### Task 9: Admin — "Public host profile" in the Owners drawer

**Files:**
- Create: `apps/frontend/src/platforms/admin/drawer/HostProfileSection.tsx`
- Modify: `apps/frontend/src/platforms/admin/drawer/OwnerDrawerBody.tsx` (render the section after "Account & contact")

**Interfaces:**
- Consumes: `hostProfileService.{getForOwner, updateForOwner, replaceOwnerPhoto, removeOwnerPhoto}`, `hostProfileErrorMessage`, `HostCard`, `publicView`, `draftFrom`, `toggleLanguage`, `hostingYears`, `formatMonthYear`, `HOST_LANGUAGES`, `BIO_MAX_CHARS`, `DrawerSection`.

- [ ] **Step 1: Implement the section**

```tsx
// apps/frontend/src/platforms/admin/drawer/HostProfileSection.tsx
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { hostProfileErrorMessage, hostProfileService } from '@features/host-profile/api';
import { HostCard } from '@features/host-profile/components/HostCard';
import { draftFrom, formatMonthYear, hostingYears, publicView, toggleLanguage } from '@features/host-profile/model/hostCardModel';
import { BIO_MAX_CHARS, HOST_LANGUAGES, type AdminHost, type HostAdminPatch } from '@features/host-profile/model/types';
import { DrawerSection } from './AdminDrawer';

const input = 'w-full rounded-[10px] border border-[#E6DDD2] bg-white px-3 py-2 text-[13px] text-[#221E1A] outline-none focus:border-[#B46A55]';
const small = 'text-[11px] font-semibold text-[#8A7F75]';

/**
 * ADR-200 admin override for an owner's public host card. Owner edits are
 * live on save; this is where Stayo corrects the name, edits the words,
 * replaces the photo, or hides the bio/photo. A hide survives later owner
 * edits until it is lifted here. The preview is the public `HostCard`, with
 * hides applied, so the admin sees exactly what residents see.
 */
export function HostProfileSection({ ownerId }: { ownerId: string }) {
  const queryClient = useQueryClient();
  const key = ['admin', 'owner', ownerId, 'host-profile'];
  const query = useQuery({ queryKey: key, queryFn: () => hostProfileService.getForOwner(ownerId), staleTime: 30_000 });
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<{ name: string; bio: string; languages: string[]; hosting_since: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = (data?: AdminHost) => {
    if (data) queryClient.setQueryData(key, data);
    else queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['admin', 'owner', ownerId] });
  };

  const patch = useMutation({
    mutationFn: (body: HostAdminPatch) => hostProfileService.updateForOwner(ownerId, body),
    onSuccess: (data) => {
      refresh(data);
      setError(null);
      setEditing(false);
    },
    onError: (e) => setError(hostProfileErrorMessage(e, 'Could not update this host profile')),
  });
  const replacePhoto = useMutation({
    mutationFn: (file: File) => hostProfileService.replaceOwnerPhoto(ownerId, file),
    onSuccess: () => refresh(),
    onError: (e) => setError(hostProfileErrorMessage(e, 'Could not upload that photo')),
  });
  const removePhoto = useMutation({
    mutationFn: () => hostProfileService.removeOwnerPhoto(ownerId),
    onSuccess: () => refresh(),
    onError: (e) => setError(hostProfileErrorMessage(e, 'Could not remove the photo')),
  });

  const host = query.data;

  const startEdit = () => {
    if (!host) return;
    setForm({ name: host.name ?? '', ...draftFrom(host) });
    setError(null);
    setEditing(true);
  };

  const toggle = (flag: 'bio_hidden' | 'photo_hidden') => host && patch.mutate({ [flag]: !host[flag] });

  return (
    <DrawerSection
      title="Public host profile"
      action={
        host && !editing ? (
          <button type="button" onClick={startEdit} className="text-[11px] font-semibold text-[#B46A55]">Edit</button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-4 px-[18px] py-4">
        {query.isLoading && <p className="text-[12px] text-[#8A7F75]">Loading host profile…</p>}
        {query.isError && <p className="text-[12px] text-[#B3402F]">Couldn't load this host profile.</p>}

        {host && (
          <>
            <div className="rounded-2xl bg-[#F7F1EC] p-4">
              <HostCard host={publicView(host)} />
            </div>

            {editing && form ? (
              <div className="flex flex-col gap-3">
                <label className="flex flex-col gap-1">
                  <span className={small}>Name (the owner's account name)</span>
                  <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={small}>Story · {form.bio.length} / {BIO_MAX_CHARS}</span>
                  <textarea
                    className={`${input} resize-y`}
                    rows={5}
                    maxLength={BIO_MAX_CHARS}
                    value={form.bio}
                    onChange={(e) => setForm({ ...form, bio: e.target.value })}
                  />
                </label>
                <div className="flex flex-col gap-1">
                  <span className={small}>Languages</span>
                  <div className="flex flex-wrap gap-1.5">
                    {HOST_LANGUAGES.map((language) => {
                      const on = form.languages.includes(language);
                      return (
                        <button
                          key={language}
                          type="button"
                          aria-pressed={on}
                          onClick={() => setForm({ ...form, languages: toggleLanguage(form.languages, language) })}
                          className={`rounded-full border px-2.5 py-1 text-[11.5px] ${on ? 'border-[#221E1A] bg-[#221E1A] text-white' : 'border-[#E6DDD2] bg-white text-[#221E1A]'}`}
                        >
                          {language}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <label className="flex flex-col gap-1">
                  <span className={small}>Running hostels since</span>
                  <select
                    className={input}
                    value={form.hosting_since ?? ''}
                    onChange={(e) => setForm({ ...form, hosting_since: e.target.value ? Number(e.target.value) : null })}
                  >
                    <option value="">Not set</option>
                    {hostingYears().map((year) => <option key={year} value={year}>{year}</option>)}
                  </select>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={patch.isPending}
                    onClick={() => patch.mutate(form)}
                    className="rounded-[10px] bg-[#221E1A] px-4 py-2 text-[12.5px] font-semibold text-white disabled:opacity-60"
                  >
                    {patch.isPending ? 'Saving…' : 'Save'}
                  </button>
                  <button type="button" onClick={() => setEditing(false)} className="rounded-[10px] border border-[#E6DDD2] px-4 py-2 text-[12.5px] font-semibold text-[#4A433C]">
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-2.5">
                <label className="flex items-center justify-between gap-3 text-[12.5px] text-[#2A2521]">
                  Hide bio from public listing
                  <input type="checkbox" checked={host.bio_hidden} disabled={patch.isPending} onChange={() => toggle('bio_hidden')} />
                </label>
                <label className="flex items-center justify-between gap-3 text-[12.5px] text-[#2A2521]">
                  Hide photo from public listing
                  <input type="checkbox" checked={host.photo_hidden} disabled={patch.isPending} onChange={() => toggle('photo_hidden')} />
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => fileInput.current?.click()}
                    disabled={replacePhoto.isPending}
                    className="rounded-[10px] border border-[#E6DDD2] px-3 py-1.5 text-[12px] font-semibold text-[#4A433C]"
                  >
                    {replacePhoto.isPending ? 'Uploading…' : 'Replace photo'}
                  </button>
                  {host.photo_url && (
                    <button
                      type="button"
                      onClick={() => removePhoto.mutate()}
                      disabled={removePhoto.isPending}
                      className="rounded-[10px] border border-[#E6DDD2] px-3 py-1.5 text-[12px] font-semibold text-[#B3402F]"
                    >
                      Remove photo
                    </button>
                  )}
                  <input
                    ref={fileInput}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) replacePhoto.mutate(file);
                      e.target.value = '';
                    }}
                  />
                </div>
                {host.updated_at && (
                  <p className="text-[11px] text-[#9A8F84]">
                    Last edited{host.updated_by_name ? ` by ${host.updated_by_name}` : ''}, {formatMonthYear(host.updated_at)}
                  </p>
                )}
              </div>
            )}

            {error && <p className="text-[12px] font-medium text-[#B3402F]">{error}</p>}
          </>
        )}
      </div>
    </DrawerSection>
  );
}
```

- [ ] **Step 2: Render it in the drawer**

In `OwnerDrawerBody.tsx`, add `import { HostProfileSection } from './HostProfileSection';` and insert `<HostProfileSection ownerId={owner.id} />` directly after the closing `</DrawerSection>` of "Account & contact".

- [ ] **Step 3: Typecheck and architecture check**

Run: `cd apps/frontend && npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "HostProfileSection|OwnerDrawerBody" ; npm run check:architecture`
Expected: no tsc lines for these files; the check passes.

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/platforms/admin/drawer/HostProfileSection.tsx apps/frontend/src/platforms/admin/drawer/OwnerDrawerBody.tsx
git commit -m "feat(admin): public host profile override in the Owners drawer (ADR-200)"
```

---

### Task 10: Documentation (same change, per CLAUDE.md)

**Files:**
- Modify: `docs/obsidian/Features.md`, `docs/obsidian/APIs.md`, `docs/obsidian/Database.md`, `docs/obsidian/Business-Rules.md`, `docs/obsidian/Decisions.md`, `docs/obsidian/Changelog.md`
- Modify: `docs/data-models/schema.md`

- [ ] **Step 1: Re-check the ADR number against origin**

Run: `git fetch -q origin && git show origin/main:docs/obsidian/Decisions.md | grep -oE "ADR-[0-9]+" | sort -t- -k2 -n | uniq | tail -1 && git show origin/dev:docs/obsidian/Decisions.md | grep -oE "ADR-[0-9]+" | sort -t- -k2 -n | uniq | tail -1 && git ls-tree --name-only origin/dev migrations/ | tail -3`
Expected: the highest ADR is ADR-199 and the highest migration is 082. If either moved, renumber everywhere (code comments included) before continuing.

- [ ] **Step 2: Write the ADR in `Decisions.md`**

Append, following the file's existing ADR heading format (match the level and style of the ADR-199 entry exactly):

- **ADR-200 — Meet your host: the owner in full on a public listing.** Context: listings named the owner "Ravi K." with a letter avatar, and nothing else. Decision:
  - Host cards show `profiles.name` in full, with the photo, the owner's own words, languages, the running-since year, and stats counted live (published reviews, residents ≥ 5 rounded, verified ID).
  - The words are stored in a new backend-only `owner_host_profiles` table (migration 083, RLS on, no policies), not in `profile_identity`, which avoids the blast radius of reads with no `select`.
  - Moderation is live-on-save with an admin override: edit, hide the bio/photo, replace/remove the photo, correct the name. A hide survives owner edits.
  - The bio refuses phone numbers, emails, links and handles, for owners and admins alike.
  - Consequences: this supersedes the "first name + last initial" rule **for hosts only**; reviewers keep it. The public read degrades to the bare name on any host-card failure.
  - Links: [[Business-Rules]], [[APIs]], [[Database]], [[Features]].

- [ ] **Step 3: Update the other vault pages**

- `Features.md`: add a "Meet your host" entry covering the three surfaces (Discover card, owner `/owner/more/host-profile`, admin drawer section) → [[Decisions#ADR-200|ADR-200]].
- `APIs.md`: add the five routes from the spec's API table, and note that `GET /api/discover/...` listing `host` now carries `{ platform_listed, name, photo_url, bio, languages, hosting_since, verified, listed_since, stats }`.
- `Database.md`: add `owner_host_profiles` (columns, checks, RLS on/no policies, **migration 083 not yet applied to prod**), and the two relation fields on `profile`.
- `Business-Rules.md`: add "Host card" rules: full name; bio rules; residents rounding; rating threshold; verified definition; hides are admin-only and survive owner edits; platform listings unchanged.
- `Changelog.md`: a 2026-09-14 entry linking ADR-200.

- [ ] **Step 4: Update `docs/data-models/schema.md`**

Add an `owner_host_profiles` section in the file's existing table format, and mention migration 083 in its ordered migration list, if the file keeps one.

- [ ] **Step 5: Check vault links**

Run: `grep -oE "\[\[[^]|#]+" docs/obsidian/*.md | sed 's/.*\[\[//' | sort -u | while read p; do [ -f "docs/obsidian/$p.md" ] || echo "missing: $p"; done`
Expected: no output related to the pages you touched.

- [ ] **Step 6: Commit**

```bash
git add docs/obsidian docs/data-models/schema.md
git commit -m "docs: meet your host — ADR-200, APIs, schema, rules, changelog"
```

---

### Task 11: Final verification

- [ ] **Step 1: Backend pure suite + invariants**

Run: `cd apps/backend && npm run test:pure && npm run check:invariants`
Expected: all pass. If a pure test that this change doesn't touch fails, confirm it also fails on `origin/main` before moving on.

- [ ] **Step 2: Backend typecheck, filtered to our files**

Run: `cd apps/backend && npx tsc --noEmit 2>&1 | grep -E "host-profile|owner-photo|listing-projection|discovery-service|owners/\[id\]/(host-profile|photo)|owner/me/(host-profile|photo)|marketing-reviews" `
Expected: no output. (The repo has a pre-existing backlog; only our files matter.)

- [ ] **Step 3: Frontend tests, typecheck, build**

Run: `cd apps/frontend && npx vitest run && npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "host-profile|ListingPage|OwnerRoutes|MoreConfigurationHubPage|HostProfileSection|OwnerDrawerBody|queryKeys" ; npm run build`
Expected: tests pass; no tsc lines for our files; the build succeeds (architecture and branding checks included).

- [ ] **Step 4: Confirm the branch contents**

Run: `git log --oneline origin/main..HEAD`
Expected: only this feature's commits (spec, plan, Tasks 1–10).
