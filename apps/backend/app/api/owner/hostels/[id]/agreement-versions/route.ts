export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { summariseVersionChange } from "@/src/services/agreements/agreement-version-history";

/**
 * Every version of a hostel's agreement that was ever live, newest first.
 *
 * Publishing archives the outgoing version rather than deleting it, and
 * `Agreement.template_id` pins each signed agreement to the row it was signed
 * under — so this lineage is not a convenience, it is the evidence of what
 * each tenant agreed to. It has always been stored and never shown.
 *
 * Distinct from `/agreement-templates`, which lists template rows for a
 * different screen and deliberately omits `rules_content`. This one **reads**
 * the content, because the change summary per version is derived from it
 * rather than stored (see `agreement-version-history.ts`), and then returns
 * counts and summaries — never the bodies. One version's text is fetched on
 * demand from the sibling `[versionId]` route.
 *
 * Ordering is stated explicitly, `version_number asc` for the diff walk and
 * reversed for the response. `/agreement-templates` orders by `status: "asc"`,
 * which puts DRAFT first because that is where `TemplateStatus` begins — the
 * trap that once made every owner's "tenants signed" figure read zero.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    // Ownership on the hostel, not just the session role — an owner must not
    // reach another owner's agreements by guessing a hostel id.
    const hostel = await prisma.hostels.findFirst({
      where: { id: params.id, owner_id: session.sub },
      select: { id: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const rows = await prisma.agreementTemplate.findMany({
      where: {
        hostel_id: params.id,
        type: "RESIDENCY",
        // A draft was never live and is not a version. It is the editor's
        // working copy and already on screen.
        status: { in: ["PUBLISHED", "ARCHIVED"] },
      },
      orderBy: { version_number: "asc" },
      select: {
        id: true,
        version_number: true,
        status: true,
        published_at: true,
        created_at: true,
        rules_content: true,
        _count: { select: { agreements: true } },
      },
    });

    const versions = (rows as any[]).map((row, index) => {
      const previous = index === 0 ? null : (rows as any[])[index - 1].rules_content;
      const change = summariseVersionChange(previous, row.rules_content);
      return {
        id: row.id,
        version_number: row.version_number,
        /** The one new tenants sign right now. */
        is_live: row.status === "PUBLISHED",
        published_at: row.published_at ?? row.created_at,
        /** How many tenants signed this exact wording. */
        agreements_count: row._count?.agreements ?? 0,
        change_summary: change.summary,
        added: change.added,
        reworded: change.reworded,
        removed: change.removed,
      };
    });

    return apiResponse({ versions: versions.reverse() });
  } catch (error: any) {
    console.error("[owner.agreement-versions] failed", { error: error?.message });
    return apiError("Could not load the version history", "AGREEMENT_VERSIONS_ERROR", 500);
  }
}
