import { z } from "zod";

/**
 * How to find a hostel's front door.
 *
 * In a dense cluster near a campus, a hostel's `address` resolves to the street
 * and not to the building — five hostels share it. Google's **Place ID**, collected
 * by hand from Google's Place ID Finder, resolves to *this* gate, and it is the
 * single source of truth here.
 *
 * Two things this deliberately does not do:
 *
 * 1. **It stores no Google Maps URL.** The link is derived from the Place ID at
 *    render time (`hostelNavigation.ts` on the frontend). A stored URL is a second
 *    source of truth that goes stale silently.
 * 2. **It is not owner content.** `hostel_marketing_revisions.content` is written by
 *    the owner and moves with the draft/review lifecycle. Navigation is entered by an
 *    admin at approval and lives on `hostels`, the same side of the line as
 *    `listing_status` (ADR-040) — an owner must not be able to write it.
 */

/** The campus a distance is measured from. Stored, not hardcoded in the UI. */
export const DEFAULT_REFERENCE_NAME = "SNIST";

/**
 * Google Place IDs are opaque. Historically `ChIJ…`, but the format is Google's
 * to change and older/alternative IDs exist, so this checks the alphabet and a
 * plausible length rather than asserting a prefix — rejecting a valid ID an admin
 * pasted from Google's own finder would be worse than accepting an odd-looking one.
 */
const PLACE_ID = /^[A-Za-z0-9_-]{15,512}$/;

export const NavigationSchema = z.object({
  placeId: z.string().trim().regex(PLACE_ID, "That does not look like a Google Place ID"),
  /** "Opposite SNIST Gate 2" — the sentence a senior would actually say. */
  landmark: z.string().trim().max(140).nullable().default(null),
  /** ImageKit URL of the entrance itself, captioned "Look for this entrance". */
  entrancePhoto: z.string().url().nullable().default(null),
  /**
   * Free text ("400m", "5 min walk"), matching how `places[].distance` already
   * reads. A metres column would invite a precision nobody measured.
   */
  distanceFromReference: z.string().trim().max(40).nullable().default(null),
  referenceName: z.string().trim().min(1).max(60).default(DEFAULT_REFERENCE_NAME),
});

export type HostelNavigation = z.infer<typeof NavigationSchema>;

/**
 * The read path, which must never throw.
 *
 * A row written under an older or hand-edited shape would otherwise take down a
 * public listing. Unparseable navigation degrades to `null`, which renders as a
 * listing with no directions block — the same state a hostel nobody has located
 * yet shows. That is the honest failure: no button beats a button that opens the
 * wrong building.
 */
export function parseNavigation(raw: unknown): HostelNavigation | null {
  if (raw == null) return null;
  const parsed = NavigationSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

/** Whether this hostel can offer one-tap directions at all. */
export function hasDirections(raw: unknown): boolean {
  return parseNavigation(raw) !== null;
}

/**
 * What an admin still owes this listing, in the order it is worth chasing.
 *
 * Only `placeId` blocks directions; the rest make the arrival legible. Used by
 * the admin drawer so "incomplete" is a specific list rather than a red dot.
 */
export function navigationGaps(raw: unknown): string[] {
  const navigation = parseNavigation(raw);
  if (!navigation) return ["Google Place ID"];
  const gaps: string[] = [];
  if (!navigation.landmark) gaps.push("Landmark");
  if (!navigation.entrancePhoto) gaps.push("Entrance photo");
  if (!navigation.distanceFromReference) gaps.push(`Distance from ${navigation.referenceName}`);
  return gaps;
}

/**
 * Read navigation without letting its absence take down the page around it.
 *
 * Migration 074 adds `hostels.navigation`, and code that selects the column can
 * reach production before the migration does — it did, on 2026-08-22, and every
 * listing detail page 500'd with "column `t1.navigation` does not exist" until
 * this existed. The listing is worth rendering without directions; it is not
 * worth losing because directions are unavailable.
 *
 * Takes a reader rather than a Prisma client so this module stays free of I/O
 * and keeps its place in `vitest.pure.config.ts`.
 *
 * Self-healing on purpose: the moment the column exists, the read succeeds and
 * the block appears. No redeploy, no flag to remember to flip.
 */
export async function readNavigationSafely(
  read: () => Promise<unknown>,
): Promise<HostelNavigation | null> {
  try {
    return parseNavigation(await read());
  } catch {
    return null;
  }
}
