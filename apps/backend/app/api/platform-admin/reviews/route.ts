export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { reviewsService } from "@/src/services/discovery/reviews-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

/** The review moderation queue. Admin only — this is the gate itself. */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session || session.role !== "ADMIN") throw ApiError.forbidden("Admin access required");

    const status = new URL(req.url).searchParams.get("status") ?? "PENDING";
    return ApiResponse.success(await reviewsService.listForAdmin(status));
  } catch (error) {
    return ApiResponse.error(error);
  }
}
