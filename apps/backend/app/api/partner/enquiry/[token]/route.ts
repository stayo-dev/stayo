export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { partnerPortalService } from "@/src/services/marketing/partner-portal-service";

/**
 * GET /api/partner/enquiry/:token — one enquiry, with the student's number.
 *
 * This is where the contact exchange actually happens. The public listing
 * never shows the owner's number and this page never shows anything but the
 * one student, so a forwarded link leaks a single enquiry rather than the
 * whole listing.
 *
 * Opening it is the real engagement signal — far more honest than WhatsApp's
 * read receipt — so the first open is recorded.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    return apiResponse(await partnerPortalService.getEnquiry(token));
  } catch (error: any) {
    return apiError(error.message || "Invalid link", error.code || "INVALID_TOKEN", error.status || 404);
  }
}
