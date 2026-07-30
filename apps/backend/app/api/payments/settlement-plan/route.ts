export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { authService } from "@/lib/services/auth-service";
import { apiError, apiResponse } from "@/lib/utils/api-utils";
import { financialPaymentFacade } from "@/src/services/payments/financial-payment-facade";
import { resolveTenantSettlementAccess } from "@/src/services/payments/tenant-access-guard";

/**
 * POST /api/payments/settlement-plan
 *
 * Build a settlement plan with optional custom obligation selection.
 * Used by the frontend SettlementPlanner component for real-time
 * re-planning as the owner toggles obligation checkboxes.
 *
 * Unlike the GET /settlement-preview (which is a simple dry-run),
 * this endpoint supports owner-selected obligation filtering with
 * chronological validation.
 *
 * Body: {
 *   tenant_id: string,
 *   hostel_id?: string,
 *   amount: number,
 *   selected_obligation_ids?: string[]  // null = auto (suggested)
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) return apiError("Unauthorized", "UNAUTHORIZED", 401);

    const body = await req.json();
    const { tenant_id, hostel_id, amount, selected_obligation_ids } = body;

    if (!tenant_id) return apiError("tenant_id is required", "VALIDATION_ERROR", 400);

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      return apiError("amount must be a positive number", "VALIDATION_ERROR", 400);
    }

    const { effectiveHostelId } = await resolveTenantSettlementAccess(user, {
      tenantId: tenant_id,
      hostelId: hostel_id || undefined,
      enforceHostelMatch: false, // original settlement-plan behavior never checked this
    });

    // Same semantics as before: fetch ALL outstanding obligations (even with a
    // custom selection) — the planner needs the full set for chronology
    // validation — and pass selected_obligation_ids straight through to the planner.
    const plan = await financialPaymentFacade.previewSettlement({
      tenantId: tenant_id,
      hostelId: effectiveHostelId,
      amountRupees: parsedAmount,
      plannerAllowedObligationIds: selected_obligation_ids || undefined,
    });

    return apiResponse({
      tenant_id,
      hostel_id: effectiveHostelId,
      amount: parsedAmount,
      mode: selected_obligation_ids ? "custom" : "suggested",
      ...plan,
    });
  } catch (error: any) {
    const msg = String(error?.message ?? error);
    if (msg.includes("NOT_FOUND")) return apiError(msg.replace("NOT_FOUND: ", ""), "NOT_FOUND", 404);
    if (msg.includes("HOSTEL_ACCESS_DENIED")) return apiError(msg.replace("HOSTEL_ACCESS_DENIED: ", ""), "HOSTEL_ACCESS_DENIED", 403);
    if (msg.includes("HOSTEL_CONTEXT_REQUIRED")) return apiError(msg.replace("HOSTEL_CONTEXT_REQUIRED: ", ""), "HOSTEL_CONTEXT_REQUIRED", 400);
    if (msg.includes("FORBIDDEN")) return apiError(msg.replace("FORBIDDEN: ", ""), "FORBIDDEN", 403);
    return apiError("Internal error building settlement plan", "INTERNAL_ERROR", 500);
  }
}
