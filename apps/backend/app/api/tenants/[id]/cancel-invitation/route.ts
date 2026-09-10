export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantService } from "@/src/services/tenants/tenant-service";
import { prisma } from "@/lib/db";

/**
 * POST /api/tenants/[id]/cancel-invitation
 *
 * Owner action: cancel an invitation the tenant has not personally accepted.
 *
 * Lifecycle: INVITED → CANCELLED, or ACTIVE + acceptance_status=PENDING → CANCELLED
 *
 * Effects:
 *   - tenant.status set to CANCELLED
 *   - Active room allocation ended (is_active=false, end_date=now) — room freed
 *   - Legacy INVITED: all PENDING/PARTIAL obligations waived
 *   - New-model PENDING (was operationally live): only FUTURE unpaid obligations
 *     voided; past dues and every recorded payment kept for settlement
 *   - Dashboard snapshot invalidated
 *   - Audit event INVITATION_CANCELLED_BY_OWNER written
 *
 * Rejects:
 *   - Accepted tenants and grandfathered owner-managed tenants (use the
 *     move-out workflow so settlement is enforced)
 *   - Cross-owner requests
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const result = await tenantService.cancelInvitation(params.id, session.sub);

    await prisma.owner_dashboard_snapshots.updateMany({
      where: { owner_id: session.sub },
      data: { is_stale: true },
    }).catch(() => {});

    return apiResponse(result);
  } catch (error: any) {
    const msg: string = error?.message || "Failed to cancel invitation";
    if (msg.startsWith("NOT_FOUND:"))  return apiError(msg, "NOT_FOUND", 404);
    if (msg.startsWith("FORBIDDEN:"))  return apiError(msg, "FORBIDDEN", 403);
    if (msg.startsWith("VALIDATION:")) return apiError(msg, "VALIDATION_ERROR", 400);
    return apiError(msg);
  }
}
