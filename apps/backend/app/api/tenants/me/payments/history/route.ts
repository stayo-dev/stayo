export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { paymentService } from "@/src/services/payments/payment-service";
import { prisma } from "@/lib/db";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";


/**
 * 👨‍🎓 TENANT ME PAYMENT HISTORY
 * GET /api/tenants/me/payments/history
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden: Only tenants can access this endpoint", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: liveTenancyWhere(session.sub),
      select: { id: true }
    });

    if (!tenant) {
      return apiError("Tenant record not found", "NOT_FOUND", 404);
    }

    const history = await paymentService.getTenantPaymentHistory(tenant.id);
    return apiResponse(history);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    return apiError(msg || "Failed to fetch payment history");
  }
}
