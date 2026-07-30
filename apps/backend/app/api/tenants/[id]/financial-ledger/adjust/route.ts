export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { financialPaymentFacade } from "@/src/services/payments/financial-payment-facade";

/**
 * POST /api/tenants/[id]/financial-ledger/adjust
 * Apply tenant future rent credit balance against an outstanding obligation.
 *
 * Body: { obligation_id, amount, notes? }
 * Auth: OWNER or ADMIN only
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
    const body = await req.json();
    const { obligation_id, amount, notes } = body;

    if (!obligation_id || typeof obligation_id !== "string") {
      return apiError("obligation_id is required", "VALIDATION_ERROR", 400);
    }
    if (!amount || typeof amount !== "number" || amount <= 0) {
      return apiError("amount must be a positive number", "VALIDATION_ERROR", 400);
    }

    const ownerId = session.role === "OWNER" ? session.sub : session.sub;

    const tenant = await prisma.tenants.findUnique({
      where: { id: params.id },
      select: { hostel_id: true, owner_id: true },
    });
    if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);
    if (tenant.owner_id !== ownerId) return apiError("Forbidden", "FORBIDDEN", 403);
    if (!tenant.hostel_id) return apiError("Tenant has no hostel context", "VALIDATION_ERROR", 400);

    const result = await prisma.$transaction(async (tx: any) => {
      return financialPaymentFacade.applyAvailableCredits(tx, {
        tenantId: params.id,
        hostelId: tenant.hostel_id!,
        ownerId,
        actorId: session.sub,
        obligationIdFilter: [obligation_id],
        amountRupees: amount,
        notes,
      });
    });

    return apiResponse(result, 200);
  } catch (error: any) {
    const msg = String(error?.message ?? error);
    if (msg.includes("NOT_FOUND")) return apiError(msg, "NOT_FOUND", 404);
    if (msg.includes("FORBIDDEN")) return apiError(msg, "FORBIDDEN", 403);
    if (msg.includes("BAD_REQUEST")) return apiError(msg, "VALIDATION_ERROR", 400);
    return apiError(msg, "INTERNAL_ERROR", 500);
  }
}
