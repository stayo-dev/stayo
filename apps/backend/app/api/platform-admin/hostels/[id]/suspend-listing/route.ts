export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { invalidatePublicListing } from "@/lib/cache/public-listing-cache";

/** POST /api/platform-admin/hostels/[id]/suspend-listing — SUSPENDED. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;

  try {
    const existing = await prisma.hostels.findUnique({ where: { id }, select: { id: true } });
    if (!existing) return apiError("Hostel not found", "NOT_FOUND", 404);

    const updated = await prisma.hostels.update({
      where: { id },
      data: { listing_status: "SUSPENDED" },
      select: { id: true, verification_status: true, listing_status: true, public_slug: true },
    });
    /**
     * The hostel leaves Discovery entirely (ADR-089's blunt lever), so its
     * page must stop resolving and must leave the sitemap. A suspended hostel
     * whose detail page stayed reachable by direct URL is the exact failure
     * ADR-073 centralised `DISCOVERABLE` to prevent.
     */
    await invalidatePublicListing({
      hostelId: id,
      slug: updated.public_slug,
      visibilityChanged: true,
    });

    return apiResponse(updated);
  } catch (error: any) {
    return apiError(error?.message || "Failed to suspend listing");
  }
}
