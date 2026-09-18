import { prisma } from "@/lib/db";
import { DISCOVERABLE, discoveryService } from "./discovery-service";
import { applyCuration, normaliseLineup } from "./homepage-curation";

/**
 * The admin-curated homepage line-up.
 *
 * Reads compose `discoveryService.search()` rather than querying hostels
 * directly, so the DISCOVERABLE predicate stays the single definition of
 * "appears in Discover" (ADR-073 point 1) and curation cannot smuggle a
 * suspended hostel onto the front page.
 */

/** Enough to cover the cap with room for hostels that have dropped out. */
const CANDIDATE_LIMIT = 50;

export const homepageFeatureService = {
  async listOrderedIds(): Promise<string[]> {
    const rows = await prisma.homepage_features.findMany({
      orderBy: [{ position: "asc" }, { created_at: "asc" }],
      select: { hostel_id: true },
    });
    return rows.map((row: { hostel_id: string }) => row.hostel_id);
  },

  /**
   * What the public homepage shows. Falls back to the default recommended sort
   * when nothing is curated — forgetting to curate must never empty the page.
   */
  async homepageListings() {
    const [search, orderedIds] = await Promise.all([
      discoveryService.search({ limit: CANDIDATE_LIMIT, sort: "recommended" }),
      this.listOrderedIds(),
    ]);
    const result = applyCuration(search.results, orderedIds);
    return {
      results: result.cards,
      facets: search.facets,
      total: result.curated ? result.cards.length : search.total,
      curated: result.curated,
    };
  },

  /**
   * The admin view: the line-up in order, each row carrying enough hostel
   * state to explain itself — including a hostel that has stopped being
   * discoverable, which the homepage silently drops and the admin needs to see.
   */
  async listForAdmin() {
    const rows = await prisma.homepage_features.findMany({
      orderBy: [{ position: "asc" }, { created_at: "asc" }],
      select: {
        hostel_id: true,
        position: true,
        created_at: true,
        hostel: {
          select: {
            id: true,
            name: true,
            city: true,
            status: true,
            listing_status: true,
            verification_status: true,
            admissions_enabled: true,
            public_slug: true,
          },
        },
      },
    });

    const discoverableIds = new Set(
      (
        await prisma.hostels.findMany({
          where: { ...DISCOVERABLE, id: { in: rows.map((r: any) => r.hostel_id) } },
          select: { id: true },
        })
      ).map((h: { id: string }) => h.id),
    );

    return rows.map((row: any) => ({
      hostel_id: row.hostel_id,
      position: row.position,
      created_at: row.created_at,
      name: row.hostel?.name ?? null,
      city: row.hostel?.city ?? null,
      // Why it is not showing, in the vocabulary the admin already uses.
      live_on_homepage: discoverableIds.has(row.hostel_id),
      status: row.hostel?.status ?? null,
      listing_status: row.hostel?.listing_status ?? null,
      verification_status: row.hostel?.verification_status ?? null,
    }));
  },

  /** Hostels an admin may add: everything discoverable, minus what is listed. */
  async listCandidates() {
    const featured = new Set(await this.listOrderedIds());
    const hostels = await prisma.hostels.findMany({
      where: DISCOVERABLE,
      orderBy: { name: "asc" },
      select: { id: true, name: true, city: true },
      take: 200,
    });
    return hostels.filter((h: { id: string }) => !featured.has(h.id));
  },

  /**
   * Replace the whole line-up. Sent as an ordered list and rewritten wholesale,
   * so positions can never drift out of step with what the admin sees — the
   * alternative, patching one row's position, is how orderings develop gaps
   * and duplicates.
   */
  async setLineup(hostelIds: unknown, adminId: string | null) {
    const ids = normaliseLineup(hostelIds);

    // A hostel that is not discoverable would never render anyway; refusing it
    // here means the admin finds out at the moment they curate, not later when
    // they wonder why the homepage is short.
    const allowed = ids.length
      ? new Set(
          (
            await prisma.hostels.findMany({
              where: { ...DISCOVERABLE, id: { in: ids } },
              select: { id: true },
            })
          ).map((h: { id: string }) => h.id),
        )
      : new Set<string>();

    const accepted = ids.filter((id) => allowed.has(id));
    const rejected = ids.filter((id) => !allowed.has(id));

    await prisma.$transaction([
      prisma.homepage_features.deleteMany({}),
      ...accepted.map((hostelId, index) =>
        prisma.homepage_features.create({
          data: { hostel_id: hostelId, position: index, created_by: adminId },
        }),
      ),
    ]);

    return { accepted, rejected };
  },
};
