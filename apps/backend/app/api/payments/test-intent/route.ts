export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { authService } from "@/lib/services/auth-service";
import { paymentService } from "@/src/services/payments/payment-service";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { apiError } from "@/lib/utils/api-utils";

import { getActivePaymentProvider } from "@/src/services/payments/payment-env";

function startOfTodayUtc() {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export async function POST(req: Request) {
  try {
    // V2: Gate test payments behind development environment
    if (process.env.NODE_ENV === "production") {
      return apiError("Test payments are disabled in production", "FORBIDDEN", 403);
    }

    const user = await authService.getCurrentUser(req);
    if (!user) {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    const isTenant = user.role === "TENANT";
    const isOwnerOrAdmin = ["OWNER", "ADMIN"].includes(user.role);

    if (!isTenant && !isOwnerOrAdmin) {
      return apiError("Unauthorized", "UNAUTHORIZED", 401);
    }

    const body = await req.json().catch(() => ({}));
    const amount = Number(body.amount ?? 1);

    if (!Number.isFinite(amount) || amount < 1 || amount > 100) {
      return apiError("Test payment amount must be between ₹1 and ₹100", "VALIDATION_ERROR", 400);
    }

    const activeProvider = getActivePaymentProvider();
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
      return apiError("Sri Adithya Boys Hostel Razorpay credentials are not configured", "CONFIG_ERROR", 422);
    }

    let tenantId = "";
    let hostelId = "";
    let ownerId = "";
    let tenant: any = null;

    if (isTenant) {
      tenant = await prisma.tenants.findFirst({
        where: { profile_id: user.id },
        select: {
          id: true,
          owner_id: true,
          hostel_id: true,
          profiles: { select: { name: true, email: true } },
          room_allocations: {
            where: { is_active: true, end_date: null },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { id: true, hostel_id: true, room: { select: { room_no: true, hostel_id: true } } },
          },
        },
      });
      if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);
      tenantId = tenant.id;
      hostelId = tenant.hostel_id || "";
      ownerId = tenant.owner_id || "";
    } else {
      tenantId = String(body.tenant_id || body.tenantId || "");
      hostelId = String(body.hostelId || body.hostel_id || "");
      ownerId = user.id;

      if (!tenantId) return apiError("tenant_id is required", "VALIDATION_ERROR", 400);
      if (!hostelId) return apiError("hostelId is required", "HOSTEL_CONTEXT_REQUIRED", 400);

      await requireHostelBelongsToOwner(ownerId, hostelId);

      tenant = await prisma.tenants.findUnique({
        where: { id: tenantId },
        select: {
          id: true,
          owner_id: true,
          hostel_id: true,
          profiles: { select: { name: true, email: true } },
          room_allocations: {
            where: { is_active: true, end_date: null },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { id: true, hostel_id: true, room: { select: { room_no: true, hostel_id: true } } },
          },
        },
      });
      if (!tenant) return apiError("Tenant not found", "NOT_FOUND", 404);
      if (tenant.owner_id !== ownerId || tenant.hostel_id !== hostelId) {
        return apiError("Tenant does not belong to this hostel", "FORBIDDEN", 403);
      }
    }

    const allocation = tenant.room_allocations[0] || null;
    if (allocation && (allocation.hostel_id !== hostelId || allocation.room?.hostel_id !== hostelId)) {
      return apiError("Active allocation hostel does not match tenant hostel", "HOSTEL_CONTEXT_MISMATCH", 409);
    }

    const dueDate = startOfTodayUtc();
    const obligation = await prisma.rent_obligations.create({
      data: {
        id: randomUUID(),
        tenant_id: tenant.id,
        owner_id: ownerId,
        hostel_id: hostelId,
        allocation_id: null,
        obligation_type: "EXTRA_CHARGE",
        amount,
        late_fee: 0,
        total_amount: amount,
        rent_month: dueDate,
        due_date: dueDate,
        status: "PENDING",
      },
      select: {
        id: true,
        tenant_id: true,
        owner_id: true,
        hostel_id: true,
        obligation_type: true,
        amount: true,
        total_amount: true,
        rent_month: true,
        due_date: true,
        status: true,
      },
    });

    const rawAttempt = await paymentService.createMultiObligationPaymentIntent(
      [obligation.id],
      isTenant ? user.id : ownerId,
      isTenant ? tenantId : undefined,
      { bypassCollectionPolicy: true, source: isTenant ? "TENANT_TEST_PAYMENT" : "OWNER_TEST_PAYMENT" }
    );
    const attempt = (rawAttempt as any).isReused === true ? (rawAttempt as any).attempt : rawAttempt;

    return NextResponse.json({
      success: true,
      obligation,
      attempt,
      tenant: {
        id: tenant.id,
        name: tenant.profiles?.name || "Tenant",
        email: tenant.profiles?.email || "",
        room: allocation?.room?.room_no || "N/A",
      },
    });
  } catch (error: any) {
    console.error("Error creating owner test payment:", error);
    const message = String(error?.message ?? error);
    if (message.includes("FORBIDDEN")) return apiError(message, "FORBIDDEN", 403);
    if (message.includes("NOT_FOUND")) return apiError(message, "NOT_FOUND", 404);
    if (message.includes("BAD_REQUEST") || message.includes("VALIDATION")) return apiError(message, "VALIDATION_ERROR", 400);
    if (message.includes("HOSTEL_CONTEXT")) return apiError(message, "HOSTEL_CONTEXT_MISMATCH", 409);
    if (message.includes("CONFIG_ERROR")) return apiError(message, "CONFIG_ERROR", 422);
    return apiError(message, "INTERNAL_ERROR", 500);
  }
}
