import { NextResponse } from "next/server";

import { listSitemapHostels, listCollectionUrls } from "@/src/services/seo/seo-service";
import {
  parseHostelShard,
  renderUrlSet,
  shardWindow,
  type SitemapEntry,
} from "@/src/services/seo/sitemap-xml";
import { hostelUrl } from "@/src/services/seo/seo-links";
import { frontendUrl } from "@/lib/config/domains";

export const runtime = "nodejs";
export const revalidate = 3600;

/**
 * One shard of the sitemap.
 *
 * `static.xml` carries the hand-known public pages; `hostels-N.xml` carries
 * 5,000 hostels each, ordered by creation so that onboarding a hostel appends
 * to the last shard rather than reshuffling every shard at once.
 *
 * An unknown shard name 404s rather than rendering an empty urlset — an empty
 * file at an arbitrary path invites a crawler to keep asking for more.
 */

/**
 * The public marketing pages. Deliberately NOT `/login`, which the previous
 * hand-written sitemap listed at priority 0.3: a sign-in form has nothing to
 * rank for and spends crawl budget to prove it.
 */
const STATIC_PATHS: { path: string; priority: number; changefreq: SitemapEntry["changefreq"] }[] = [
  { path: "/", priority: 1.0, changefreq: "weekly" },
  { path: "/hostels", priority: 0.9, changefreq: "daily" },
  { path: "/owners", priority: 0.9, changefreq: "weekly" },
  { path: "/about", priority: 0.6, changefreq: "monthly" },
  { path: "/company", priority: 0.5, changefreq: "monthly" },
  { path: "/contact", priority: 0.5, changefreq: "monthly" },
  { path: "/legal", priority: 0.3, changefreq: "yearly" },
  { path: "/legal/terms", priority: 0.3, changefreq: "yearly" },
  { path: "/legal/privacy", priority: 0.3, changefreq: "yearly" },
  { path: "/legal/refund-policy", priority: 0.3, changefreq: "yearly" },
];

export async function GET(_request: Request, { params }: { params: { shard: string } }) {
  const shard = String(params.shard ?? "");

  if (shard === "static.xml") {
    const site = frontendUrl();
    return xml(
      renderUrlSet(
        STATIC_PATHS.map((entry) => ({
          loc: `${site}${entry.path === "/" ? "" : entry.path}` || site,
          priority: entry.priority,
          changefreq: entry.changefreq,
        })),
      ),
    );
  }

  if (shard === "places.xml") {
    try {
      // Resolved through the SAME loader the pages use, so a URL can only
      // appear here if the page would actually render. A sitemap that
      // advertises 404s teaches Google to distrust the sitemap.
      const entries = await listCollectionUrls();
      return xml(
        renderUrlSet(
          entries.map((entry) => ({
            loc: entry.loc,
            lastmod: entry.lastmod,
            changefreq: "weekly" as const,
            priority: 0.7,
          })),
        ),
      );
    } catch (error) {
      console.error("[sitemap] places shard failed:", error);
      // An empty urlset rather than a 404: the index names this shard, and a
      // named shard that 404s is a broken sitemap rather than an empty one.
      return xml(renderUrlSet([]));
    }
  }

  const shardNumber = parseHostelShard(shard);
  if (shardNumber === null) {
    return new NextResponse("Not found", { status: 404 });
  }

  try {
    const { offset, limit } = shardWindow(shardNumber);
    const rows = await listSitemapHostels(offset, limit);

    return xml(
      renderUrlSet(
        rows.map((row) => ({
          loc: hostelUrl(row.slug),
          // A real row timestamp. `new Date()` here would tell Google every
          // page changed on every fetch, which is how lastmod stops being
          // believed at all.
          lastmod: row.updatedAt,
          changefreq: "weekly" as const,
          priority: 0.8,
        })),
      ),
    );
  } catch (error) {
    console.error("[sitemap] shard failed:", shard, error);
    return new NextResponse("Not found", { status: 404 });
  }
}

function xml(body: string) {
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
