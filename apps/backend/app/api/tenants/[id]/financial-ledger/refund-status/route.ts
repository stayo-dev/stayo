export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantFinancialLedgerService } from "@/src/services/payments/tenant-financial-ledger-service";

/**
 * PATCH /api/tenants/[id]/financial-ledger/refund-status
 * Mark a REFUND ledger entry as COMPLETED or FAILED once the bank transfer is confirmed.
 *
 * Body: { entry_id, refund_status: "COMPLETED" | "FAILED" }
 * Auth: OWNER or ADMIN only
 *
 * This is the critical separation:
 *   debit(reason=REFUND) = intent recorded, balance reduced (refund_status: PENDING)
 *   PATCH refund-status   = physical transfer confirmed (refund_status: COMPLETED)
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const { entry_id, refund_status } = body;

    if (!entry_id) return apiError("entry_id is required", "VALIDATION_ERROR", 400);
    if (!["COMPLETED", "FAILED"].includes(refund_status)) {
      return apiError("refund_status must be COMPLETED or FAILED", "VALIDATION_ERROR", 400);
    }

    const ownerId = session.role === "OWNER" ? session.sub : session.sub;
    const updated = await tenantFinancialLedgerService.updateRefundStatus(entry_id, ownerId, refund_status);
    return apiResponse(updated);
  } catch (error: any) {
    const msg = String(error?.message ?? error);
    if (msg.includes("NOT_FOUND")) return apiError(msg, "NOT_FOUND", 404);
    if (msg.includes("FORBIDDEN")) return apiError(msg, "FORBIDDEN", 403);
    if (msg.includes("BAD_REQUEST")) return apiError(msg, "VALIDATION_ERROR", 400);
    return apiError(msg, "INTERNAL_ERROR", 500);
  }
}
