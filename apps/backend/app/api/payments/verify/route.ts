export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { apiError, apiResponse } from "@/lib/utils/api-utils";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";

const logger = getLogger("verify");

export async function POST(req: Request) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      console.warn("[verify] Unauthorized access attempt");
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    // user.id is profile_id, but payment attempts store tenant_id (tenants table PK).
    let tenantId: string | undefined;
    if (user.role === "TENANT") {
      const tenant = await prisma.tenants.findFirst({
        where: liveTenancyWhere(user.id),
        select: { id: true },
      });
      tenantId = tenant?.id;
    }

    const body = await req.json().catch(() => ({}));
    
    console.log(`[verify] Request by user ${user.id} (${user.role})`, body);

    logger.info("verify_started", {
      userId: user.id,
      userRole: user.role,
      attemptId: body?.attempt_id,
      merchantTxnId: body?.merchant_txn_id || body?.merchantTransactionId,
    });

    const result = await paymentService.verifyPaymentStatus({
      userId: user.id,
      role: user.role,
      tenantId,
      attemptId: body?.attempt_id,
      merchantTxnId: body?.merchant_txn_id || body?.merchantTransactionId,
      gatewayTxnId: body?.gateway_txn_id || body?.transactionId || body?.gateway_transaction_id,
      razorpay_payment_id: body?.razorpay_payment_id,
      razorpay_order_id: body?.razorpay_order_id,
      razorpay_signature: body?.razorpay_signature,
    });

    return apiResponse({
      success: true,
      ...result
    });
  } catch (error: any) {
    console.error("Detailed API Error [verify]:", error);
    const message = String(error?.message ?? error);
    
    if (message.includes("FORBIDDEN")) return apiError(message, "FORBIDDEN", 403);
    if (message.includes("NOT_FOUND")) return apiError(message, "NOT_FOUND", 404);
    if (message.includes("BAD_REQUEST")) return apiError(message, "VALIDATION_ERROR", 400);
    if (message.includes("CONFIG_ERROR")) return apiError(message, "CONFIG_ERROR", 422);
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
