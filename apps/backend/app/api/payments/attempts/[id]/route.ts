import { NextRequest } from "next/server";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { paymentService } from "@/src/services/payments/payment-service";
import { authService } from "@/lib/services/auth-service";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user) {
      return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    }

    // user.id is profile_id, but payment attempts store tenant_id (tenants table PK).
    // Look up the real tenant ID for TENANT role.
    let tenantId: string | undefined;
    if (user.role === "TENANT") {
      const tenant = await prisma.tenants.findUnique({
        where: { profile_id: user.id },
        select: { id: true },
      });
      tenantId = tenant?.id;
    }

    const result = await paymentService.getPaymentAttempt(
      params.id,
      user.id,
      user.role,
      tenantId
    );

    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error fetching attempt:", error);
    const message = String(error?.message ?? error);
    if (message.includes("FORBIDDEN")) return ApiResponse.error(ApiError.forbidden(message.split(": ")[1] ?? message));
    if (message.includes("NOT_FOUND")) return ApiResponse.error(ApiError.notFound(message.split(": ")[1] ?? message));
    return ApiResponse.error(ApiError.internal(message));
  }
}
