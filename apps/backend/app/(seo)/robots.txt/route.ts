import { NextResponse } from "next/server";

import { NOINDEX_FOLLOW_PREFIXES, PRIVATE_PATH_PREFIXES } from "@/src/services/seo/seo-links";
import { frontendUrl } from "@/lib/config/domains";

export const runtime = "nodejs";
export const revalidate = 86400;

/**
 * `yourstayo.com/robots.txt`, served through a rewrite.
 *
 * The disallow list is GENERATED from `PRIVATE_PATH_PREFIXES`, the same
 * constant the `X-Robots-Tag` headers in `apps/frontend/vercel.json` are
 * checked against by `tests/seo-robots-parity.test.ts`. Writing the two lists
 * by hand is how `/owner/*` came to be served `X-Robots-Tag: index, follow` in
 * production while everyone assumed the app was private.
 *
 * `/discover` and `/visit` are NOT disallowed here. They are `noindex, follow`
 * via header instead — a crawler has to be able to FETCH them to see that
 * directive and to follow their links through to the canonical pages. A
 * robots.txt Disallow would block the fetch and leave them as URLs Google
 * knows about but cannot evaluate, which is worse than either alternative.
 *
 * ## Why this is a route and not `public/robots.txt`
 *
 * It replaced two static files — one per app — that disagreed with each other
 * about the host (`yourstayo.com` vs `www.yourstayo.com`, which 301s away).
 * Both had to be DELETED rather than edited: a file in `public/` is served
 * before any route or rewrite is considered, so either one existing silently
 * defeats this handler on both hosts.
 *
 * ## The API host, and why this does NOT try to be clever about it
 *
 * These pages are reached through a rewrite, so this handler also answers on
 * `api.yourstayo.com`. The obvious refinement — serve `Disallow: /` when the
 * request arrives on the backend host — was written and then removed, because
 * it cannot be made safe here:
 *
 *   - On an EXTERNAL Vercel rewrite the upstream is not guaranteed to receive
 *     the original `Host`, so a request for `yourstayo.com/robots.txt` may
 *     reach this handler presenting `api.yourstayo.com`.
 *   - Getting that wrong serves `Disallow: /` on the public origin, which
 *     deindexes the entire site. There is no error, no alert, and recovery
 *     takes weeks of recrawling.
 *
 * The asymmetry is decisive: the downside of no host check is that the API
 * host may get crawled; the downside of a host check that misfires is total
 * deindexing. And the first is already handled — every page in this tree emits
 * `<link rel="canonical">` pointing at `yourstayo.com`, so a crawler reaching
 * a page by the API host consolidates it onto the public URL anyway.
 */
export async function GET() {
  const lines = [
    "# Stayo — https://yourstayo.com",
    "",
    "User-agent: *",
    "Allow: /",
    "",
    "# The operated product. Nothing here is a document worth ranking, and",
    "# several of these paths carry one-time tokens.",
    /**
     * No trailing slash: robots.txt matching is PREFIX-based, so `/login`
     * blocks both `/login` and `/login/anything`, while `/login/` blocks only
     * the latter and leaves the page itself crawlable. Several of these are
     * exact paths rather than trees (`/login`, `/welcome`, `/complete-profile`),
     * which is precisely where the trailing slash would have failed.
     */
    ...PRIVATE_PATH_PREFIXES.map((prefix) => `Disallow: ${prefix}`),
    "",
    "# Crawlable but not indexable — see the X-Robots-Tag headers. Left",
    "# fetchable on purpose so their links reach the canonical pages:",
    ...NOINDEX_FOLLOW_PREFIXES.map((prefix) => `# ${prefix}/ — noindex, follow`),
    "",
    `Sitemap: ${frontendUrl("/sitemap.xml")}`,
    "",
  ];

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
    },
  });
}
