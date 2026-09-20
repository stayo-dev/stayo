import { NextResponse } from "next/server";

import { countDiscoverableHostels } from "@/src/services/seo/seo-service";
import { renderSitemapIndex, shardPlan } from "@/src/services/seo/sitemap-xml";
import { frontendUrl } from "@/lib/config/domains";

export const runtime = "nodejs";
export const revalidate = 3600;

/**
 * The sitemap index, served at `yourstayo.com/sitemap.xml` through a rewrite.
 *
 * AN INDEX FROM DAY ONE, WITH ONE HOSTEL IN IT. The protocol caps a single
 * sitemap at 50,000 URLs, so a flat file has to become an index eventually,
 * and doing that later means changing the file Search Console has been
 * fetching for months. The shard count comes from a `COUNT(*)`, so this exact
 * code emits one shard today and fifty at a quarter of a million hostels.
 *
 * REPLACES two hand-written static files: `apps/frontend/public/sitemap.xml`
 * (9 URLs, no hostels) and `apps/backend/public/sitemap.xml` (12 URLs, on the
 * `www.` host that the frontend 301s away from). Both are deleted in the same
 * change — on Vercel a static file shadows a rewrite, so this route cannot be
 * reached while either exists. See ADR-226.
 */
export async function GET() {
  const site = frontendUrl();

  try {
    const total = await countDiscoverableHostels();

    const shards = [
      { name: "static.xml" },
      // Localities, cities and campuses. Separate from the hostel shards
      // because they change on curation rather than on onboarding, so they
      // invalidate on a different rhythm.
      { name: "places.xml" },
      ...shardPlan(total).map((name) => ({ name })),
    ];

    return new NextResponse(renderSitemapIndex(shards, site), {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    });
  } catch (error) {
    console.error("[sitemap] index failed:", error);

    // A crawler must always get valid XML. An index naming only the static
    // shard is honest and recoverable; a 500 teaches Search Console the
    // sitemap is broken and it backs off fetching it.
    return new NextResponse(renderSitemapIndex([{ name: "static.xml" }], site), {
      status: 200,
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, s-maxage=60",
      },
    });
  }
}
