export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { authService } from "@/lib/services/auth-service";
import { billingTransitionService } from "@/lib/services/billing-transition-service";
import { prisma } from "@/lib/db";
import { hostelPolicyService } from "@/lib/services/hostel-policy-service";

export async function GET(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user || user.role !== "TENANT") return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    const tenant = await prisma.tenants.findUnique({
      where: { profile_id: user.id },
      select: {
        id: true,
        hostel_id: true,
        payment_frequency: true,
        payment_frequency_effective_from: true,
        payment_frequency_updated_at: true,
      },
    });
    if (!tenant) return ApiResponse.error(ApiError.notFound("Tenant not found"));
    const policy = await hostelPolicyService.getHostelPolicy(tenant.hostel_id).catch(() => null);
    const requests = await billingTransitionService.listForTenant(user.id);
    return ApiResponse.success({
      active_frequency: tenant.payment_frequency || "MONTHLY",
      effective_from: tenant.payment_frequency_effective_from,
      updated_at: tenant.payment_frequency_updated_at,
      allowed_frequencies: policy?.policy?.billing?.payment_frequency?.allowed_frequencies || ["MONTHLY", "QUARTERLY"],
      policy: policy?.policy?.billing?.payment_frequency || null,
      requests,
    });
  } catch (error: any) {
    console.error("Billing frequency context error:", error);
    return ApiResponse.error(ApiError.internal(String(error?.message ?? error)));
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user || user.role !== "TENANT") return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    const body = await req.json().catch(() => ({}));
    if (!body?.requested_frequency) return ApiResponse.error(ApiError.badRequest("requested_frequency is required"));
    const request = await billingTransitionService.createRequest(user.id, {
      requested_frequency: body.requested_frequency,
      reason: body.reason,
    });
    return ApiResponse.success({ request });
  } catch (error: any) {
    console.error("Create billing frequency request error:", error);
    const message = String(error?.message ?? error);
    const badRequestCodes = [
      "UNSUPPORTED_PAYMENT_FREQUENCY",
      "CUSTOM_INSTALLMENTS_NOT_AVAILABLE_IN_V1",
      "ONLY_ACTIVE_TENANTS_CAN_CHANGE_FREQUENCY",
      "PENDING_FREQUENCY_CHANGE_EXISTS",
      "REQUESTED_FREQUENCY_ALREADY_ACTIVE",
      "FREQUENCY_NOT_ALLOWED_BY_HOSTEL",
      "UNCLEAN_BILLING_PERIOD",
      "FREQUENCY_CHANGE_COOLDOWN_ACTIVE",
      "MINIMUM_COMMITMENT_NOT_MET",
    ];
    if (badRequestCodes.some((code) => message.includes(code))) {
      return ApiResponse.error(ApiError.badRequest(message));
    }
    return ApiResponse.error(ApiError.internal(message));
  }
}
