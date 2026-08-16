export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { canClaimListing, buildClaimUpdate } from "@/src/services/marketing/platform-listing-rules";

function requireAdmin(session: any): asserts session is { sub: string; role: string } {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * POST /api/platform-admin/hostels/[id]/assign-owner
 * Body: { owner_id }
 *
 * Hands a Stayo-authored listing to the real owner once they join. Marketing
 * revisions, photos and rooms all key on `hostel_id`, so nothing moves — this
 * is one UPDATE plus the enquiries that were waiting for them.
 *
 * Refuses on any hostel a real owner already operates: transferring a live
 * hostel moves tenants, obligations and payouts, which is a different
 * operation and must not share this code path. See platform-listing-rules.ts.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json();
    const ownerId = String(body?.owner_id ?? "").trim();
    if (!ownerId) return apiError("owner_id is required", "VALIDATION_ERROR", 400);

    const hostel = await prisma.hostels.findUnique({
      where: { id },
      select: { id: true, name: true, listing_source: true, claimed_at: true },
    });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const guard = canClaimListing(hostel);
    if (!guard.ok) return apiError(guard.reason, "INVALID_TRANSITION", 409);

    const owner = await prisma.profile.findFirst({
      where: { id: ownerId, role: "OWNER", is_active: true },
      select: { id: true, name: true },
    });
    if (!owner) return apiError("That owner account was not found", "NOT_FOUND", 404);

    const claimed = await prisma.hostels.update({
      where: { id },
      data: buildClaimUpdate(owner.id, new Date()),
      select: { id: true, name: true, owner_id: true, listing_source: true, claimed_at: true },
    });

    return apiResponse({ hostel: claimed, owner: { id: owner.id, name: owner.name } });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to assign this listing");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
