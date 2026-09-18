export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { getSession, apiResponse } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { homepageFeatureService } from "@/src/services/discovery/homepage-feature-service";

/**
 * The homepage line-up, curated by admin.
 *
 * Gated on MANAGE_HOSTELS rather than MANAGE_LEADS: choosing what the public
 * front page shows is a decision about listings, not about the sales pipeline.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_HOSTELS");
    const [features, candidates] = await Promise.all([
      homepageFeatureService.listForAdmin(),
      homepageFeatureService.listCandidates(),
    ]);
    return apiResponse({ features, candidates });
  } catch (error) {
    return ApiResponse.error(error);
  }
}

/**
 * Replace the line-up with the ordered list sent.
 *
 * Wholesale rather than per-row: positions cannot drift out of step with what
 * the admin is looking at, which is how orderings develop gaps and duplicates.
 * Hostels that are not discoverable come back in `rejected` rather than being
 * stored to fail silently later.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_HOSTELS");
    const body = await req.json().catch(() => ({}));
    const result = await homepageFeatureService.setLineup(body?.hostel_ids, session?.sub ?? null);
    const features = await homepageFeatureService.listForAdmin();
    return apiResponse({ ...result, features });
  } catch (error) {
    return ApiResponse.error(error);
  }
}
