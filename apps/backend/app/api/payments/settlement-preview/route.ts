export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { authService } from "@/lib/services/auth-service";
import { apiError, apiResponse } from "@/lib/utils/api-utils";
import { financialPaymentFacade } from "@/src/services/payments/financial-payment-facade";
import { resolveTenantSettlementAccess } from "@/src/services/payments/tenant-access-guard";

/**
 * GET /api/payments/settlement-preview?tenant_id=...&amount=...&hostelId=...
 *
 * V2 Settlement Preview — read-only dry run.
 * Shows where a given amount WOULD be allocated without creating any records.
 * Consumes the central buildSettlementPlan domain service via FinancialPaymentFacade.
 *
 * No locks, no writes. Pure computation against current obligation state.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) return apiError("Unauthorized", "UNAUTHORIZED", 401);

    const url = new URL(req.url);
    const tenantId = url.searchParams.get("tenant_id") || url.searchParams.get("tenantId") || "";
    const amountStr = url.searchParams.get("amount") || "";
    const hostelId = url.searchParams.get("hostelId") || url.searchParams.get("hostel_id") || "";

    if (!tenantId) return apiError("tenant_id is required", "VALIDATION_ERROR", 400);

    const amount = Number(amountStr);
    if (!Number.isFinite(amount) || amount <= 0) {
      return apiError("amount must be a positive number", "VALIDATION_ERROR", 400);
    }

    const { effectiveHostelId } = await resolveTenantSettlementAccess(user, {
      tenantId,
      hostelId: hostelId || undefined,
    });

    const allowedObligationIdsStr = url.searchParams.get("allowed_obligation_ids") || url.searchParams.get("allowedObligationIds") || "";
    const allowedObligationIds = allowedObligationIdsStr ? allowedObligationIdsStr.split(",") : null;

    // Same semantics as before: allowedObligationIds only pre-filters the obligation
    // fetch — it is NOT passed to the planner, so chronology validation never applies here.
    const plan = await financialPaymentFacade.previewSettlement({
      tenantId,
      hostelId: effectiveHostelId,
      amountRupees: amount,
      obligationIdFilter: allowedObligationIds,
    });

    return apiResponse({
      tenant_id: tenantId,
      amount,
      ...plan,
    });
  } catch (error: any) {
    const msg = String(error?.message ?? error);
    if (msg.includes("NOT_FOUND")) return apiError(msg.replace("NOT_FOUND: ", ""), "NOT_FOUND", 404);
    if (msg.includes("HOSTEL_ACCESS_DENIED")) return apiError(msg.replace("HOSTEL_ACCESS_DENIED: ", ""), "HOSTEL_ACCESS_DENIED", 403);
    if (msg.includes("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.replace("HOSTEL_CONTEXT_REQUIRED: ", ""), "HOSTEL_CONTEXT_REQUIRED", 400);
    if (msg.includes("FORBIDDEN")) return apiError(msg.replace("FORBIDDEN: ", ""), "FORBIDDEN", 403);
    return apiError("Internal error previewing settlement", "INTERNAL_ERROR", 500);
  }
}
