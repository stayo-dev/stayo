export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantTransferService } from "@/src/services/tenants/tenant-transfer-service";

/**
 * 🔄 POST /api/tenants/transfer
 *
 * Transfer a tenant from one hostel to another.
 * Creates new allocation, closes old, updates Tenant.hostel_id, logs audit trail.
 *
 * Body: { tenantId, targetRoomId, reason?, notes? }
 * Access: Owner/Admin only
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const { tenantId, targetRoomId, reason, notes } = body;

    if (!tenantId || !targetRoomId) {
      return apiError("tenantId and targetRoomId are required", "VALIDATION_ERROR", 400);
    }

    const result = await tenantTransferService.transferTenant({
      tenantId,
      targetRoomId,
      transferredBy: session.sub,
      reason,
      notes,
    });

    return apiResponse(result);
  } catch (error: any) {
    const msg = error.message || "Transfer failed";
    if (msg.startsWith("NOT_FOUND:")) return apiError(msg, "NOT_FOUND", 404);
    if (msg.startsWith("VALIDATION_ERROR:")) return apiError(msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("FORBIDDEN:")) return apiError(msg, "FORBIDDEN", 403);
    return apiError(msg, "INTERNAL_ERROR", 500);
  }
}

/**
 * GET /api/tenants/transfer?tenantId=xxx
 *
 * Get transfer history for a tenant.
 * Access: Owner/Admin only
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) {
    return apiError("tenantId query parameter is required", "VALIDATION_ERROR", 400);
  }

  try {
    const history = await tenantTransferService.getTransferHistory(tenantId);
    return apiResponse({ transfers: history });
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch transfer history");
  }
}
