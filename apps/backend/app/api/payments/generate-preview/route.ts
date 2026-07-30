export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { rentGenerationService } from "@/src/services/payments/rent-generation-service";
import { authService } from "@/lib/services/auth-service";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";

/**
 * 🔧 FIX C1: Redirected from old paymentService.previewMonthlyRent to canonical rentGenerationService.
 * The old preview used different logic (prorated rent, no preferences) vs the actual generator.
 */
export async function GET(req: NextRequest) {
  try {
    const user = await authService.getCurrentUser(req);
    if (!user || (user.role !== "OWNER" && user.role !== "ADMIN")) {
      return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    }

    const rentMonth = req.nextUrl.searchParams.get("rent_month");
    const hostelId = req.nextUrl.searchParams.get("hostelId") || undefined;
    if (!hostelId) {
      return ApiResponse.error(ApiError.badRequest("hostelId is required"));
    }
    await requireHostelBelongsToOwner(user.id, hostelId);

    let targetDate: Date | undefined;
    if (rentMonth) {
      targetDate = new Date(rentMonth);
    }

    const result = await rentGenerationService.previewMonthlyRent(
      targetDate,
      user.id,
      hostelId
    );

    return ApiResponse.success(result);
  } catch (error: any) {
    console.error("Error previewing rent generation:", error);
    return ApiResponse.error(ApiError.internal(String(error?.message ?? error)));
  }
}
