export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { discoveryService } from "@/src/services/discovery/discovery-service";
import { buildShareCard, renderSharePage, renderUnlistedPage } from "@/src/services/discovery/share-card";
import { frontendUrl } from "@/lib/config/domains";
import { getLogger } from "@/lib/logger";

const logger = getLogger("api.discover.share");

/**
 * The page behind a shared hostel link.
 *
 * Reached as `yourstayo.com/h/:slug` through a rewrite in the frontend's
 * `vercel.json` — the same arrangement `/pay/:token` uses. It exists because
 * the SPA cannot carry per-hostel Open Graph tags: it is one `index.html` for
 * every path, and link crawlers do not run JavaScript. See ADR-084.
 *
 * Returns **HTML, not JSON**, and is deliberately unauthenticated — the whole
 * point is that a stranger's WhatsApp can fetch it. It exposes nothing the
 * public listing page does not already show.
 */
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const site = frontendUrl();

  try {
    const hostel = await discoveryService.getShareCard(params.slug);

    if (!hostel) {
      return new NextResponse(renderUnlistedPage(site), {
        status: 404,
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          // Never cached: a hostel that comes back on to Stayo should preview
          // again immediately, and a crawler that cached a 404 would not ask.
          "Cache-Control": "no-store",
        },
      });
    }

    const card = buildShareCard({ ...hostel, siteUrl: site });

    return new NextResponse(renderSharePage(card), {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        /**
         * A link dropped into a group chat is fetched once per recipient's
         * client, so this is cached at the edge. Five minutes is short enough
         * that a de-listed hostel stops previewing quickly and long enough
         * that a forwarded link does not become a DB query per person.
         */
        "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      },
    });
  } catch (error) {
    // A crawler gets HTML whatever happens — a JSON error body renders as a
    // broken preview in the chat, which is worse than the generic card.
    logger.error("Share preview failed", { slug: params.slug, error });
    return new NextResponse(renderUnlistedPage(site), {
      status: 500,
      headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
}
