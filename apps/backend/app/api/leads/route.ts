export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Only owners can view admissions leads"));
  }
  try {
    const scope = resolveOwnerScope(session);
    const query = Object.fromEntries(new URL(req.url).searchParams.entries());
    return ApiResponse.success(await admissionsService.listLeads(scope.owner_id, query));
  } catch (error) {
    return ApiResponse.error(error);
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return ApiResponse.error(ApiError.forbidden("Only owners can create admissions leads"));
  }
  try {
    const body = await req.json();
    return ApiResponse.success(await admissionsService.createDirectLead(session.sub, body));
  } catch (error) {
    return ApiResponse.error(error);
  }
}
