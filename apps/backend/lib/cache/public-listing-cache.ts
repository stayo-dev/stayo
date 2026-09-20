import { revalidateTag } from "next/cache";

import { invalidateTag } from "@/lib/redis/cache";
import { redisKeys } from "@/lib/redis/keys";

/**
 * The one way to make a public, indexable page reflect new data.
 *
 * ## Why a blessed helper rather than `revalidateTag` at each call site
 *
 * The same reason `invalidateDashboardCache` exists. A public hostel page is
 * cached in TWO places that must be busted together:
 *
 *   1. Next's ISR cache, keyed by the tags the page declared.
 *   2. The Redis cache inside `admissionsService.getPublicHostel` (180s), which
 *      the page reads THROUGH.
 *
 * Busting only Next's copy re-renders the page from a stale Redis read, so the
 * owner sees their change ignored and nothing anywhere reports an error. That
 * failure is invisible — no exception, no log, just a photo that did not
 * change — which is exactly the kind that needs a single chokepoint rather
 * than discipline at twenty call sites.
 *
 * `scripts/architectural-invariants-check.ts` fails the build on a direct
 * `revalidateTag(` anywhere in the service layer for this reason.
 *
 * ## What it cannot do
 *
 * It catches a WRONG invalidation, not a MISSING one. Nothing here can tell
 * that a new write path forgot to call it; `tests/seo-cache-invalidation.test.ts`
 * reads the write-path services as text as a cheap backstop, and the one-hour
 * ISR ceiling is the floor on how stale a page can get regardless.
 *
 * See ADR-226.
 */

export const seoTags = {
  /** One hostel's canonical page. */
  hostel: (slug: string) => `seo:hostel:${slug}`,
  /** A locality or city collection page. */
  area: (slug: string) => `seo:area:${slug}`,
  /** A college collection page. */
  college: (slug: string) => `seo:college:${slug}`,
  /** The sitemap index and every shard. */
  sitemap: () => "seo:sitemap",
} as const;

export interface PublicListingInvalidation {
  hostelId: string;
  /** The hostel's current slug. Null when it has never been listed. */
  slug: string | null;
  /** Its curated locality, when it has one. */
  areaSlug?: string | null;
  /** Every college it is linked to. */
  collegeSlugs?: string[];
  /**
   * Set when the change could add or remove this hostel from `DISCOVERABLE`
   * — an admin approving, suspending or unverifying a listing.
   *
   * This is the only thing that busts the sitemap, and it must: a hostel
   * entering or leaving the discoverable set changes which URLs exist, and can
   * push a collection page across its threshold in either direction. An
   * ordinary content edit changes a page but not the set of pages, so it
   * leaves the sitemap alone — otherwise every photo upload would invalidate
   * every shard.
   */
  visibilityChanged?: boolean;
}

/**
 * Never throws. A cache that cannot be busted must not fail the write that
 * prompted it — the page goes stale for at most an hour, whereas a thrown
 * error here would roll back an approval an admin just made.
 */
export async function invalidatePublicListing(
  input: PublicListingInvalidation,
): Promise<void> {
  const tasks: Promise<unknown>[] = [];

  try {
    if (input.slug) {
      revalidateTag(seoTags.hostel(input.slug));
      // The Redis read the page renders through. Without this the page
      // re-renders from a cache up to 180s stale and looks unchanged.
      tasks.push(invalidateTag(redisKeys.admissions.publicHostelTag(input.slug)));
    }

    if (input.areaSlug) revalidateTag(seoTags.area(input.areaSlug));
    for (const college of input.collegeSlugs ?? []) revalidateTag(seoTags.college(college));

    if (input.visibilityChanged) revalidateTag(seoTags.sitemap());
  } catch (error) {
    console.warn(
      "[public-listing-cache] invalidation failed:",
      error instanceof Error ? error.message : error,
    );
  }

  await Promise.allSettled(tasks);
}

/**
 * For a change to a curated row itself — an area renamed, a college's hostel
 * links edited. Always busts the sitemap: curation is what decides whether a
 * collection page exists at all.
 */
export async function invalidateCollection(input: {
  areaSlug?: string | null;
  collegeSlug?: string | null;
}): Promise<void> {
  try {
    if (input.areaSlug) revalidateTag(seoTags.area(input.areaSlug));
    if (input.collegeSlug) revalidateTag(seoTags.college(input.collegeSlug));
    revalidateTag(seoTags.sitemap());
  } catch (error) {
    console.warn(
      "[public-listing-cache] collection invalidation failed:",
      error instanceof Error ? error.message : error,
    );
  }
}
