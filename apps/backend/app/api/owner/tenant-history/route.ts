export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { residencyHistoryService } from "@/src/services/profile/residency-history-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * A prospective or current tenant's stay history, as this hostel may see it.
 *
 * `hostel_id` and `profile_id` are both **required and never defaulted**.
 * Defaulting the hostel would be the "first hostel" pattern `check:invariants`
 * forbids, and here it would additionally decide a disclosure question — a
 * multi-hostel owner could otherwise read history earned by a different
 * property of theirs.
 *
 * Returns `allowed: false` with a reason rather than a 403, so the owner UI can
 * tell "they haven't engaged you yet, ask them" apart from "they said no" —
 * without either case revealing whether the person has any history at all.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      throw ApiError.forbidden("Owner access required");
    }

    // Two ways in. `tenant_id` is what owner screens actually hold, and it
    // resolves to both ids server-side so no person-identifier has to travel
    // through owner-facing UI state. `profile_id` + `hostel_id` is the
    // enquiry/invite path, where there is no tenancy yet.
    const tenantId = req.nextUrl.searchParams.get("tenant_id");

    let hostelId = req.nextUrl.searchParams.get("hostel_id");
    let profileId = req.nextUrl.searchParams.get("profile_id");

    if (tenantId) {
      const resolved = await residencyHistoryService.resolveProfileFromTenancy(session.sub, tenantId);
      profileId = resolved.profileId;
      hostelId = resolved.hostelId;
    }

    if (!hostelId) throw ApiError.validationError("hostel_id is required");
    if (!profileId) throw ApiError.validationError("profile_id or tenant_id is required");

    const history = await residencyHistoryService.getDisclosedHistory(session.sub, hostelId, profileId);
    return ApiResponse.success(history);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
