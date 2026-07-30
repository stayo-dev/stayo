export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse } from "@/lib/auth";
import { leadInvitationService } from "@/src/services/platform-leads/lead-invitation-service";

/**
 * POST /api/leads/invitation/[token]/complete — public. Called once by the
 * onboarding wizard's own publish flow, after floors/rooms have all been
 * created (the one auto-progression step with no natural server-side hook —
 * see lead-invitation-service.ts's markLive doc comment). No-ops quietly if
 * the lead isn't at HOSTEL_CREATED yet, so it can never move a lead
 * backwards or fail the owner's real flow.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  await leadInvitationService.markLive(token);
  return apiResponse({ success: true });
}
