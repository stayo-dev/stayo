import { prisma } from "@/lib/db";
import { normaliseSlug } from "@/src/services/seo/slug";
import { invalidatePublicListing } from "@/lib/cache/public-listing-cache";

/**
 * What a public slug resolves to.
 *
 * A hostel's slug is in Google's index and in WhatsApp messages already sent.
 * Renaming one — which Phase 3 does, to the locality form — must not break
 * either, ever. `hostel_slug_history` keeps every retired value and this
 * resolves through it.
 *
 * The rule is a **301, not a rewrite**: serving the old URL's content under
 * the old URL would leave two addresses for one hostel, which is the
 * duplicate-content problem ADR-226 exists to close. A permanent redirect
 * moves both the reader and the index onto the canonical address.
 *
 * See ADR-226.
 */
export type SlugResolution =
  /** The slug is a hostel's current one. Serve the page. */
  | { kind: "current"; slug: string }
  /** Retired. 301 to `currentSlug`. */
  | { kind: "retired"; currentSlug: string }
  /** Never existed, or belongs to a hostel that is not public. 404. */
  | { kind: "unknown" };

/**
 * Deliberately does NOT apply the `DISCOVERABLE` predicate.
 *
 * This answers "what is this slug called now", which is a different question
 * from "may the public see it". A suspended hostel's retired slug should
 * still redirect to its current slug, and the page at the end of that
 * redirect is what decides to 404 — otherwise a rename plus a suspension
 * turns an old link into a dead end instead of an honest "not listed".
 */
export async function resolveHostelSlug(raw: string): Promise<SlugResolution> {
  const slug = normaliseSlug(raw);
  if (!slug) return { kind: "unknown" };

  const current = await prisma.hostels.findFirst({
    where: { public_slug: slug },
    select: { public_slug: true },
  });
  if (current?.public_slug) return { kind: "current", slug: current.public_slug };

  const retired = await prisma.hostel_slug_history.findFirst({
    where: { slug },
    select: { hostel: { select: { public_slug: true } } },
  });

  const currentSlug = retired?.hostel?.public_slug;
  if (currentSlug && currentSlug !== slug) return { kind: "retired", currentSlug };

  return { kind: "unknown" };
}

/**
 * Rename a hostel's public slug, retiring the old one in the same
 * transaction.
 *
 * Both writes or neither: a slug swapped without its history row is a 404 for
 * every link already in the world, and a history row without the swap is a
 * redirect loop. There is no ordering of two separate statements that is safe
 * here, which is why this is the only supported way to rename.
 */
export async function renameHostelSlug(input: {
  hostelId: string;
  nextSlug: string;
}): Promise<{ changed: boolean; from: string | null; to: string }> {
  const next = normaliseSlug(input.nextSlug);
  if (!next) throw new Error("renameHostelSlug: refusing to set an empty slug");

  return prisma.$transaction(async (tx: any) => {
    const hostel = await tx.hostels.findUnique({
      where: { id: input.hostelId },
      select: { public_slug: true },
    });
    if (!hostel) throw new Error("renameHostelSlug: hostel not found");

    const previous: string | null = hostel.public_slug ?? null;
    if (previous === next) return { changed: false, from: previous, to: next };

    // A slug may only be retired once — the column is globally unique so a
    // value cannot come to redirect to two different hostels.
    if (previous) {
      await tx.hostel_slug_history.upsert({
        where: { slug: previous },
        update: { hostel_id: input.hostelId },
        create: { hostel_id: input.hostelId, slug: previous },
      });
    }

    // Reclaiming: if this hostel is moving back to a slug it once used, that
    // history row must go, or the new current slug would also be a retired
    // one and redirect to itself.
    await tx.hostel_slug_history.deleteMany({ where: { slug: next } });

    await tx.hostels.update({
      where: { id: input.hostelId },
      data: { public_slug: next, updated_at: new Date() },
    });

    return { changed: true, from: previous, to: next };
  });
}

/**
 * Rename, then bust both slugs' caches.
 *
 * WHY THIS IS NOT OPTIONAL. `loadHostelPage` caches by slug for an hour. A
 * rename leaves the OLD slug's entry holding a perfectly valid payload, so
 * the old URL keeps rendering 200 instead of redirecting — for up to an hour,
 * with no error anywhere. Observed directly: after renaming the live hostel,
 * its old path was still served a fully-rendered page.
 *
 * Both slugs, and the sitemap: the set of URLs changed, which is exactly what
 * `visibilityChanged` is for.
 */
export async function renameHostelSlugAndRevalidate(input: {
  hostelId: string;
  nextSlug: string;
  areaSlug?: string | null;
  collegeSlugs?: string[];
}): Promise<{ changed: boolean; from: string | null; to: string }> {
  const result = await renameHostelSlug(input);
  if (!result.changed) return result;

  await invalidatePublicListing({
    hostelId: input.hostelId,
    slug: result.to,
    areaSlug: input.areaSlug ?? null,
    collegeSlugs: input.collegeSlugs ?? [],
    visibilityChanged: true,
  });

  // The retired slug's own cache entry, which is the one that would otherwise
  // keep serving the page instead of the redirect.
  if (result.from) {
    await invalidatePublicListing({ hostelId: input.hostelId, slug: result.from });
  }

  return result;
}
