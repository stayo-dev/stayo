export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { paymentService } from "@/src/services/payments/payment-service";
import { getSession } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { requireHostelBelongsToOwner, assertTenantBelongsToOwner } from "@/lib/security/scoped-query";
import { safePagination, assertBodySize } from "@/lib/security/api-guard";
import { RecordPaymentSchema } from "@/src/validators";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "OWNER") {
      return ApiResponse.error(ApiError.forbidden("Unauthorized"));
    }

    let ownerId: string;
    const { searchParams } = new URL(req.url);
    const { limit, offset } = safePagination(searchParams.get("limit"), searchParams.get("offset"));
    const tenantId = searchParams.get("tenant_id") || undefined;
    const status = searchParams.get("status") || undefined;
    const method = searchParams.get("method") || undefined;
    const month = searchParams.get("month") || undefined;
    const hostelId = searchParams.get("hostelId") || undefined;
    const isUuid = hostelId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostelId);
    if (!isUuid) return ApiResponse.error(ApiError.badRequest("hostelId must be a valid UUID"));

    const scope = resolveOwnerScope(session);
    ownerId = scope.owner_id;
    await requireHostelBelongsToOwner(ownerId, hostelId);

    const result = await paymentService.getAllPayments(
      ownerId,
      hostelId,
      limit,
      offset,
      { tenantId, status, method, month },
    );

    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error fetching payments:", error);
    if (error?.code === "FORBIDDEN") return ApiResponse.error(ApiError.forbidden(error.message));
    return ApiResponse.error(ApiError.internal("Failed to fetch payments", error));
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session) {
      return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    }
    if (session.role !== "OWNER") {
      return ApiResponse.error(ApiError.forbidden("Only owners can record manual payments"));
    }

    const sizeError = assertBodySize(req);
    if (sizeError) return sizeError;

    const data = await req.json().catch(() => ({}));

    const hostelId: string | undefined = data.hostelId || data.hostel_id;
    const isUuid = hostelId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostelId);
    if (!isUuid) {
      return ApiResponse.error(ApiError.badRequest("hostelId must be a valid UUID"));
    }

    const scope = resolveOwnerScope(session);
    const ownerId: string = scope.owner_id;
    await requireHostelBelongsToOwner(ownerId, hostelId);

    // ── Zod validation ─────────────────────────────────────────────────────
    const validated = RecordPaymentSchema.safeParse(data);
    if (!validated.success) {
      return ApiResponse.error(ApiError.validationError("Validation error", { issues: validated.error.errors }));
    }

    // ── Ownership check: obligation must belong to this owner + hostel ─────
    const obligation = await prisma.rent_obligations.findUnique({
      where: { id: validated.data.obligation_id },
      select: { owner_id: true, hostel_id: true, status: true },
    });
    if (!obligation) {
      return ApiResponse.error(ApiError.notFound("Obligation not found"));
    }
    if (obligation.owner_id !== ownerId) {
      return ApiResponse.error(ApiError.forbidden("Obligation does not belong to this owner"));
    }
    if (obligation.hostel_id !== hostelId) {
      return ApiResponse.error(ApiError.forbidden("Obligation does not belong to the requested hostel"));
    }
    if (obligation.status === "PAID") {
      return ApiResponse.success({ idempotent: true, message: "Obligation is already fully paid." });
    }

    const result = await paymentService.recordPayment({
      hostelId,
      obligationId: validated.data.obligation_id,
      amountPaid: validated.data.amount_paid,
      paymentMethod: validated.data.payment_method,
      referenceNumber: validated.data.reference_number ?? undefined,
      paymentDate: validated.data.payment_date ? new Date(validated.data.payment_date) : undefined,
      userId: session.sub,
      ownerId: ownerId,
    });

    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error recording payment:", error);
    if (error?.code === "FORBIDDEN") return ApiResponse.error(ApiError.forbidden(error.message));
    if (error?.code === "NOT_FOUND") return ApiResponse.error(ApiError.notFound(error.message));
    return ApiResponse.error(ApiError.internal("Failed to record payment", error));
  }
}
