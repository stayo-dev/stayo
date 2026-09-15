export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { hostProfileService } from "@/src/services/host-profile/host-profile-service";
import { hostProfileFailure } from "@/src/services/host-profile/route-errors";

/**
 * GET   /api/platform-admin/owners/[id]/host-profile — the owner's public host card, with hide flags and last editor
 * PATCH /api/platform-admin/owners/[id]/host-profile — any of { name, bio, languages, hosting_since, bio_hidden, photo_hidden }
 *
 * ADR-200: owner edits are live on save; this is the override. Every write is
 * attributed (`updated_by`) and event-logged by the service.
 */

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return apiError("Admin access only", "FORBIDDEN", 403);
  try {
    return apiResponse({ data: await hostProfileService.getForAdmin(params.id) });
  } catch (error) {
    return hostProfileFailure(error, "platform-admin.owners.host-profile.GET");
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") return apiError("Admin access only", "FORBIDDEN", 403);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Invalid request body", "VALIDATION_ERROR", 400);
    }
    return apiResponse({ data: await hostProfileService.updateByAdmin(params.id, session.sub, body) });
  } catch (error) {
    return hostProfileFailure(error, "platform-admin.owners.host-profile.PATCH");
  }
}
