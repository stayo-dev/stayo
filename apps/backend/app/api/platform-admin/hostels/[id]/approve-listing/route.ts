export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { invalidatePublicListing } from "@/lib/cache/public-listing-cache";

/** POST /api/platform-admin/hostels/[id]/approve-listing — VERIFIED + LIVE. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;

  try {
    const existing = await prisma.hostels.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return apiError("Hostel not found", "NOT_FOUND", 404);

    const updated = await prisma.hostels.update({
      where: { id },
      data: { verification_status: "VERIFIED", listing_status: "LIVE" },
      select: { id: true, verification_status: true, listing_status: true, public_slug: true },
    });
    /**
     * This is what makes a hostel's page EXIST. The sitemap must learn about
     * it, so `visibilityChanged` is set — that is the difference between this
     * and a content edit, which changes a page rather than the set of pages.
     */
    await invalidatePublicListing({
      hostelId: id,
      slug: updated.public_slug,
      visibilityChanged: true,
    });

    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to approve listing");
  }
}
