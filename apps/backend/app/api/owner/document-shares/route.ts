export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { documentVaultService } from "@/src/services/profile/document-vault-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/**
 * The owner's view of vault documents shared with one of their hostels.
 *
 * `hostel_id` is required and never defaulted. Falling back to "the owner's
 * first hostel" is the exact pattern `check:invariants` forbids, and it would
 * be worse here than usual: the wrong default would show a multi-hostel owner
 * documents a tenant shared with a different property.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
      throw ApiError.forbidden("Owner access required");
    }

    const hostelId = req.nextUrl.searchParams.get("hostel_id");
    if (!hostelId) throw ApiError.validationError("hostel_id is required");

    const profileId = req.nextUrl.searchParams.get("profile_id") ?? undefined;

    const shares = await documentVaultService.listForHostel(session.sub, hostelId, profileId);
    return ApiResponse.success(shares);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
