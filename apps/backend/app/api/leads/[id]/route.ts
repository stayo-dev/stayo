export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) return ApiResponse.error(ApiError.forbidden());
  try {
    const scope = resolveOwnerScope(session);
    return ApiResponse.success(await admissionsService.getLeadForOwner(params.id, scope.owner_id));
  } catch (error) {
    return ApiResponse.error(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) return ApiResponse.error(ApiError.forbidden());
  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    return ApiResponse.success(await admissionsService.updateStatus(params.id, scope.owner_id, body));
  } catch (error) {
    return ApiResponse.error(error);
  }
}
