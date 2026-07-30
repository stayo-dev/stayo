export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { financialReadModelService } from "@/src/services/payments/financial-read-model-service";

/**
 * GET /api/tenants/me/financial-read-model
 * Returns the canonical FinancialReadModel (outstanding, overdue, current
 * payable, future rent credit, security deposit, payment status) for the
 * authenticated tenant — the same composed source the owner side reads via
 * getOwnerTenantOverview(), so owner and tenant screens agree by construction.
 *
 * Auth: TENANT only — derives tenant record from JWT sub (profile_id).
 * A tenant can ONLY see their own financial state. No cross-tenant access possible.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);
  if (session.role !== "TENANT") return apiError("Forbidden — tenant access only", "FORBIDDEN", 403);

  try {
    const result = await financialReadModelService.getFinancialReadModelForTenant(session.sub);
    return apiResponse(result);
  } catch (error: any) {
    const msg = String(error?.message ?? error);
    if (msg.includes("NOT_FOUND")) return apiError(msg, "NOT_FOUND", 404);
    return apiError(msg, "INTERNAL_ERROR", 500);
  }
}
