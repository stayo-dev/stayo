/**
 * Slug rules for every public Stayo URL.
 *
 * PURE MODULE — no I/O. The database reads live in `slug-resolution.ts`.
 *
 * A slug is a promise: once Google has indexed it and once it has been pasted
 * into a WhatsApp group, it has to keep resolving. Everything here is
 * therefore deterministic and additive — `buildHostelSlug` never returns a
 * different answer for the same inputs, and when a hostel is renamed the old
 * slug is retired into `hostel_slug_history` rather than forgotten. See
 * ADR-226 and ADR-225.
 */

/** The id fragment appended to every hostel slug. Matches `ensureHostelSlug`. */
export const ID_FRAGMENT_LENGTH = 8;

/** Matches `slugify` in `admissions-service.ts` — one rule, two call sites. */
const MAX_SEGMENT = 60;

/**
 * Lowercase, ASCII, hyphen-separated. Anything that is not `[a-z0-9]` becomes
 * a single hyphen, and leading/trailing hyphens are dropped.
 */
export function slugifySegment(value: string, max = MAX_SEGMENT): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, max)
    .replace(/-$/, "");
}

/**
 * The form a slug must be in to be canonical.
 *
 * Applied before every lookup so `/hostels/Sri-Adithya-...` and
 * `/hostels/sri-adithya-.../` do not become two indexable addresses for one
 * hostel. A route that finds the incoming slug differs from this redirects to
 * it rather than serving both.
 */
export function normaliseSlug(raw: string): string {
  return String(raw ?? "")
    .trim()
    .toLowerCase()
    .replace(/^\/+|\/+$/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/(^-|-$)/g, "");
}

export function isNormalisedSlug(raw: string): boolean {
  return raw === normaliseSlug(raw);
}

/**
 * A hostel's permanent address.
 *
 * `name-locality-id8`, e.g. `sri-adithya-boys-hostel-yamnampet-36094ab4`.
 *
 * WHY THE ID FRAGMENT STAYS: two owners genuinely do name hostels the same
 * thing in the same locality, and the alternative — a `-2` suffix decided by
 * whoever was inserted first — makes a slug depend on the order rows were
 * created, which is not a property a permanent URL should have. Eight hex
 * characters make a collision a non-event and cost nothing in ranking terms.
 *
 * The locality segment is omitted rather than faked when a hostel has no area
 * yet: a slug is permanent, so inventing `-unknown` would be permanent too.
 */
export function buildHostelSlug(input: {
  name: string;
  locality?: string | null;
  id: string;
}): string {
  const name = slugifySegment(input.name || "hostel");
  const locality = input.locality ? slugifySegment(input.locality, 40) : "";
  const fragment = String(input.id ?? "").replace(/-/g, "").slice(0, ID_FRAGMENT_LENGTH);

  // The name is truncated, never the fragment — an id8 that lost characters to
  // a long hostel name would stop being the thing that guarantees uniqueness.
  const parts = [name || "hostel", locality, fragment].filter(Boolean);
  return parts.join("-");
}

/** Area and college slugs carry no id fragment — they are curated, not minted. */
export function buildAreaSlug(name: string): string {
  return slugifySegment(name);
}

export function buildCollegeSlug(input: { shortName?: string | null; name: string }): string {
  // "SNIST" beats "sreenidhi-institute-of-science-and-technology": it is what
  // a student types, and it is what the hostel's own navigation data records.
  return slugifySegment(input.shortName || input.name, 40);
}
