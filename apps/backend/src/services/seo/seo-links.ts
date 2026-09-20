/**
 * Every public Stayo URL is built here, and nowhere else.
 *
 * PURE MODULE — no I/O.
 *
 * WHY ONE MODULE: a canonical tag, a sitemap entry, an internal link and a
 * JSON-LD `url` that disagree by so much as a trailing slash are, to a
 * crawler, different pages. Concentrating URL construction means the four
 * cannot drift, and changing a path shape later is one edit rather than a
 * search. `share-card.ts` built `/discover/h/${slug}` inline and that string
 * then had to be changed in three places when the canonical page moved.
 *
 * Origins always come from `frontendUrl()` — the PUBLIC origin — never from
 * this backend's own host. These pages are served through a rewrite from the
 * frontend Vercel project, so `api.yourstayo.com` must never appear in a
 * canonical, a sitemap or a link.
 */

import { frontendUrl } from "@/lib/config/domains";

export type SeoPath = string;

/** The canonical, indexable page for a hostel. ADR-224. */
export function hostelPath(slug: string): SeoPath {
  return `/hostels/${slug}`;
}

/** A locality or city page. Both are `areas` rows; only `kind` differs. */
export function areaPath(slug: string, intent?: string | null): SeoPath {
  return intent ? `/hostels-in/${slug}/${intent}` : `/hostels-in/${slug}`;
}

export function collegePath(slug: string, intent?: string | null): SeoPath {
  return intent ? `/hostels-near/${slug}/${intent}` : `/hostels-near/${slug}`;
}

/** The crawlable root of the engine. */
export function hubPath(): SeoPath {
  return "/hostels";
}

/**
 * The SPA's interactive listing — where a reader goes to enquire.
 * `noindex, follow`: it is the app, not the document. ADR-224.
 */
export function appListingPath(slug: string): SeoPath {
  return `/discover/h/${slug}`;
}

/** The share/unfurl URL. Stays 200 and keeps its own `og:url`. ADR-084. */
export function sharePath(slug: string): SeoPath {
  return `/h/${slug}`;
}

export function sitemapIndexPath(): SeoPath {
  return "/sitemap.xml";
}

export function sitemapShardPath(shard: string): SeoPath {
  return `/sitemaps/${shard}`;
}

/** Relative path → absolute public URL. */
export function absolute(path: SeoPath): string {
  return frontendUrl(path);
}

export const hostelUrl = (slug: string) => absolute(hostelPath(slug));
export const areaUrl = (slug: string, intent?: string | null) => absolute(areaPath(slug, intent));
export const collegeUrl = (slug: string, intent?: string | null) => absolute(collegePath(slug, intent));
export const hubUrl = () => absolute(hubPath());
export const appListingUrl = (slug: string) => absolute(appListingPath(slug));
export const shareUrl = (slug: string) => absolute(sharePath(slug));
export const siteUrl = () => frontendUrl();

/**
 * The paths that must never be indexed — the operated product, as opposed to
 * the read one.
 *
 * SINGLE SOURCE: `robots.txt` and the `X-Robots-Tag` headers in
 * `apps/frontend/vercel.json` are both derived from this list, and
 * `tests/seo-robots-parity.test.ts` fails the build if they drift apart. They
 * were written twice by hand once, and `/owner/*` ended up served
 * `X-Robots-Tag: index, follow` in production as a result.
 */
export const PRIVATE_PATH_PREFIXES = [
  "/owner",
  "/admin",
  "/tenant",
  "/profile",
  "/onboarding",
  "/stay",
  "/activate",
  "/activation",
  "/invite",
  "/owner-invite",
  "/lead-signup",
  "/complete-profile",
  "/reset-password",
  "/forgot-password",
  "/sign-in",
  "/sign-up",
  "/auth",
  "/pay",
  "/enquiry",
  "/verify",
  "/get-started",
  "/home-v2",
  "/welcome",
  "/login",
] as const;

/**
 * Public, but not the canonical copy: crawl them for their links, do not index
 * them. `follow` matters — these pages link to the canonical hostel pages.
 */
export const NOINDEX_FOLLOW_PREFIXES = ["/discover", "/visit"] as const;
