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

/** GET /api/platform-admin/partners — every marketplace partner, with their lead tally. */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    return apiResponse({ partners: await partnerAdminService.listPartners() });
  } catch (error: any) {
    const status = error instanceof PartnerAdminError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}

/**
 * POST /api/platform-admin/partners
 * Body: { name, phone, email?, consent_channel, consent_note? }
 *
 * Records the person and their consent together — they are not separable.
 * `consent_by` is the admin making the call, so the opt-in has a name
 * attached to it and not just a timestamp.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const partner = await partnerAdminService.createPartner({
      name: body.name,
      phone: body.phone,
      email: body.email,
      consentChannel: body.consent_channel,
      consentNote: body.consent_note,
      capturedBy: session!.sub,
    });
    return apiResponse({ partner }, 201);
  } catch (error: any) {
    const status = error instanceof PartnerAdminError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
