export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { projectListing } from "@/src/services/discovery/listing-projection";
import { normaliseContent } from "@/src/services/marketing/marketing-content";

function requireAdmin(session: any): asserts session is { sub: string; role: string } {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * GET /api/platform-admin/marketing-reviews/[revisionId]/preview
 *
 * Renders a *pending* marketing revision through the exact projection the
 * live Discovery listing uses (`projectListing`), so what an admin approves is
 * literally what a tenant will see.
 *
 * This is deliberately not a separate preview renderer. Two renderers over one
 * content model drift, and once they do the review gate is inspecting
 * something other than the thing that ships.
 *
 * Admin-only: it exposes unapproved content, which is precisely what must
 * never reach a public surface.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ revisionId: string }> },
) {
  const session = await getSession(req);
  const { revisionId } = await params;
  try {
    requireAdmin(session);

    const revision = await prisma.hostel_marketing_revisions.findUnique({
      where: { id: revisionId },
      select: { id: true, hostel_id: true, status: true, version: true, content: true },
    });
    if (!revision) return apiError("Revision not found", "NOT_FOUND", 404);

    const hostel = await prisma.hostels.findUnique({
      where: { id: revision.hostel_id },
      select: {
        id: true,
        public_slug: true,
        hostel_type: true,
        food_included: true,
        listing_source: true,
        // The preview must show the directions block exactly as the public page
        // will, so the admin can see whether the Place ID they entered actually
        // produces one before approving.
        navigation: true,
      },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);
    if (!hostel.public_slug) {
      // getPublicHostel keys on the slug. A hostel with none has never been
      // published at all, so there is nothing to render it against.
      return apiError("This hostel has no public listing yet", "NOT_PUBLISHABLE", 409);
    }

    const detail = await admissionsService.getPublicHostel(hostel.public_slug);

    // Same validation the live path applies, so a revision saved under an
    // older shape degrades exactly as it would in production rather than
    // previewing something the public page could not render.
    const content = normaliseContent(revision.content);

    return apiResponse({
      revision: { id: revision.id, version: revision.version, status: revision.status },
      listing: projectListing({ detail, visible: hostel, marketing: content, preview: true }),
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to build preview");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
