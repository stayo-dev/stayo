export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { propertyService } from "@/lib/services/property-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

/**
 * 🏢 HOSTEL — Delete for good
 * DELETE /api/hostels/[id]/permanent
 *
 * Deliberately **not** the same path as `DELETE /api/hostels/[id]`, which
 * archives and must keep doing so. Archiving is the ordinary "remove": right
 * for a property that carried real tenancies, whose payments and agreements
 * have to outlive it. This is the narrow second door, for a hostel that never
 * carried anything — a test entry, a typo, a duplicate — which otherwise sits
 * in the owner's Archived tab forever with Reactivate as its only action.
 *
 * A separate path rather than a `?permanent=true` flag so it cannot be reached
 * by accident, and so the archive route's contract is unchanged for every
 * existing caller.
 *
 * The hostel must already be ARCHIVED and have **no** operational history —
 * `planHostelDeletion` decides. Nothing with a payment, obligation, agreement
 * or past tenant can reach this.
 */
export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Forbidden"));
  }

  try {
    const scope = resolveOwnerScope(session);
    const deleted = await propertyService.permanentlyDeleteHostel(params.id, scope.owner_id);
    return ApiResponse.success(deleted, `${deleted.name} deleted`);
  } catch (error: any) {
    const message = typeof error?.message === "string" ? error.message : String(error);
    if (message.startsWith("NOT_FOUND")) {
      return ApiResponse.error(ApiError.notFound(message.split(": ")[1] ?? message));
    }
    if (message.startsWith("CONFLICT")) {
      return ApiResponse.error(ApiError.conflict(message.split(": ")[1] ?? message));
    }
    if (message.startsWith("VALIDATION")) {
      return ApiResponse.error(ApiError.validationError(message.split(": ")[1] ?? message));
    }
    // A foreign key we did not think to count is the one real risk here, and
    // it must read as "keep it archived", not as a mystery 500.
    console.error(`[hostels.permanent.DELETE] Failed for hostel ${params.id}:`, error);
    return ApiResponse.error(
      ApiError.conflict(
        "This hostel still has records attached to it, so it cannot be deleted. It stays archived.",
      ),
    );
  }
}
