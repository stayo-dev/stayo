export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { paymentService } from "@/src/services/payments/payment-service";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const hostelId = req.nextUrl.searchParams.get("hostelId") || undefined;
  if (!hostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);

  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, hostelId);
    const detail = await paymentService.getPaymentDetail(params.id, scope.owner_id, hostelId);
    return apiResponse(detail);
  } catch (error: any) {
    if (error?.message?.includes("NOT_FOUND")) {
      return apiError("Obligation not found", "NOT_FOUND", 404);
    }
    return apiError(error.message || "Failed to fetch payment detail", "INTERNAL_ERROR", 500);
  }
}
