export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { paymentService } from "@/src/services/payments/payment-service";
import { resolveTenantSettlementAccess } from "@/src/services/payments/tenant-access-guard";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) return ApiResponse.error(ApiError.unauthorized("Unauthorized"));

  try {
    const tenantId = params.id;

    if (session.role === "TENANT" || session.role === "OWNER") {
      await resolveTenantSettlementAccess(
        { id: session.sub, role: session.role, owner_id: (session as any).owner_id },
        { tenantId, enforceHostelMatch: false }
      );
    }

    const history = await paymentService.getTenantPaymentHistory(tenantId);
    return ApiResponse.success(history);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(msg.split(": ")[1] ?? msg));
    if (msg.startsWith("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(msg.split(": ")[1] ?? msg));
    return ApiResponse.error(ApiError.internal(msg || "Failed to fetch payment history"));
  }
}
