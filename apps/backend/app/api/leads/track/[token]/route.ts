export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { buildLeadTimeline, mapLeadStatusToStage } from "@/src/services/platform-leads/lead-stage-mapper";

/**
 * GET /api/leads/track/[token] — public enquiry status.
 *
 * Deliberately unauthenticated: a prospective owner has no account yet. The
 * token is a 32-byte bearer secret delivered over WhatsApp, the same trust
 * model as /api/leads/invitation/[token].
 *
 * The response is an explicit allowlist, not a spread of the row. `notes`
 * (the admin's private scratchpad), the row id, `converted_owner_id`, and
 * the raw status string must never reach this surface — see the design doc
 * D2. If you add a column to platform_leads, it does NOT appear here unless
 * someone deliberately adds it below.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const lead = await prisma.platform_leads.findUnique({
      where: { tracking_token: token },
      select: {
        hostel_name: true,
        status: true,
        created_at: true,
        applicant_message: true,
      },
    });

    if (!lead) {
      return apiError("We couldn't find that enquiry.", "NOT_FOUND", 404);
    }

    const stage = mapLeadStatusToStage(lead.status);

    return apiResponse({
      hostel_name: lead.hostel_name,
      submitted_at: lead.created_at,
      stage: stage.label,
      is_terminal: stage.isTerminal,
      timeline: buildLeadTimeline(lead.status),
      applicant_message: lead.applicant_message,
    });
  } catch (error: any) {
    console.error("Detailed API Error [leads.track]:", error);
    return apiError("Could not load your enquiry status.", "INTERNAL_ERROR", 500);
  }
}
