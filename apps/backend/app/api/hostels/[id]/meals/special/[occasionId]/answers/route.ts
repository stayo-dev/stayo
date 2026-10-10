export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { specialMealService } from "@/src/services/meals/special-meal-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/** PUT { tenantId, serveDate, choice: VEG|NON_VEG|AWAY|SKIP|null } — the warden's correction, allowed after the cutoff. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; occasionId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, occasionId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    if (typeof body?.tenantId !== "string") return apiError("tenantId is required", "INVALID_REQUEST", 400);
    await specialMealService.setOwnerAnswer({
      hostelId: id, occasionId, tenantId: body.tenantId, serveDate: body.serveDate, choice: body.choice ?? null, recordedBy: session.sub,
    });
    return apiResponse({ count: (await specialMealService.getCount(id, occasionId, body.serveDate)).count });
  } catch (error) {
    return mealErrorResponse(error);
  }
}
