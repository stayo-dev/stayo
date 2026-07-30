export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "ADMIN") {
    return apiError("Admin access required", "FORBIDDEN", 403);
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || undefined;
  const paymentDomain = searchParams.get("paymentDomain") || undefined;
  const hostelId = searchParams.get("hostelId") || undefined;
  const ownerId = searchParams.get("ownerId") || undefined;
  const q = searchParams.get("q") || undefined;
  const take = Math.min(Math.max(Number(searchParams.get("limit") || 50), 1), 200);

  try {
    const attempts = await prisma.paymentAttempt.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        ...(paymentDomain ? { payment_domain: paymentDomain } : {}),
        ...(hostelId ? { hostel_id: hostelId } : {}),
        ...(ownerId ? { owner_id: ownerId } : {}),
        ...(q ? {
          OR: [
            { id: q },
            { merchant_txn_id: q },
            { merchant_transaction_id: q },
            { gateway_txn_id: q },
            { provider_transaction_id: q },
            { provider_order_id: q },
            { provider_reference_id: q },
          ],
        } : {}),
      },
      select: {
        id: true,
        owner_id: true,
        tenant_id: true,
        hostel_id: true,
        provider: true,
        payment_domain: true,
        flow_type: true,
        scope_type: true,
        merchant_context_type: true,
        merchant_context_id: true,
        merchant_txn_id: true,
        merchant_transaction_id: true,
        provider_transaction_id: true,
        provider_order_id: true,
        provider_reference_id: true,
        amount: true,
        status: true,
        settlement_status: true,
        settled_at: true,
        created_at: true,
        updated_at: true,
        expires_at: true,
        _count: {
          select: {
            payments: true,
            obligations: true,
          },
        },
      },
      orderBy: { created_at: "desc" },
      take,
    });

    return apiResponse({ attempts });
  } catch (error: any) {
    console.error("[FINANCE_OPS_ATTEMPTS]", error);
    return apiError(error?.message || "Failed to fetch payment attempts");
  }
}
