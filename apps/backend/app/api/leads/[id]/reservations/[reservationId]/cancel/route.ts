export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

export async function PATCH(_req: NextRequest, { params }: { params: { id: string; reservationId: string } }) {
  const session = await getSession(_req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) return ApiResponse.error(ApiError.forbidden());
  try {
    const scope = resolveOwnerScope(session);
    return ApiResponse.success(await admissionsService.cancelReservation(params.id, params.reservationId, scope.owner_id));
  } catch (error) {
    return ApiResponse.error(error);
  }
}
