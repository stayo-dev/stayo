export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { hostProfileService } from "@/src/services/host-profile/host-profile-service";
import { hostProfileFailure } from "@/src/services/host-profile/route-errors";

/**
 * 🪪 THE OWNER'S HOST PROFILE (ADR-200)
 * GET — how residents meet this owner, plus their own words even if hidden
 * PUT — { bio, languages, hosting_since }; live on save. The hide flags are
 *       admin-only and ignored if sent.
 */

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  try {
    return apiResponse({ data: await hostProfileService.getForOwner(session.sub) });
  } catch (error) {
    return hostProfileFailure(error, "owner.me.host-profile.GET");
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  try {
    const body = await req.json().catch(() => null);
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return apiError("Invalid request body", "VALIDATION_ERROR", 400);
    }
    return apiResponse({ data: await hostProfileService.updateByOwner(session.sub, body) });
  } catch (error) {
    return hostProfileFailure(error, "owner.me.host-profile.PUT");
  }
}
