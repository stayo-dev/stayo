export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return ApiResponse.error(ApiError.forbidden("Only owners can convert leads"));
  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    return ApiResponse.success(await admissionsService.convertToInvitation(params.id, scope.owner_id, body), "Invitation created", { status: 201 });
  } catch (error) {
    return ApiResponse.error(error);
  }
}
