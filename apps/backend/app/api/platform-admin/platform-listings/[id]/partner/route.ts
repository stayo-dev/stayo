export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { partnerAdminService, PartnerAdminError } from "@/src/services/marketing/partner-admin-service";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") {
    throw new PartnerAdminError("Admin access only", "FORBIDDEN", 403);
  }
}

/**
 * POST /api/platform-admin/platform-listings/:id/partner
 * Body: { partner_id, announce? }
 *
 * Points a Stayo-authored listing's enquiries at the real owner. Refuses any
 * hostel a live owner already runs — those enquiries belong in that owner's
 * dashboard, and routing them to a "partner" would hand one business's leads
 * to a third party.
 *
 * `announce` defaults to true and sends `stayo_partner_listing_live`. Pass
 * false when the listing is not published yet, so the first thing the owner
 * hears is not an invitation to view a page that shows nothing.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    if (!body.partner_id) return apiError("partner_id is required", "VALIDATION_ERROR", 400);

    const result = await partnerAdminService.attachListing({
      hostelId: id,
      partnerId: String(body.partner_id),
      announce: body.announce,
    });
    return apiResponse(result, 201);
  } catch (error: any) {
    const status = error instanceof PartnerAdminError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
