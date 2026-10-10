export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { specialMealService } from "@/src/services/meals/special-meal-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/**
 * POST { choice: VEG | NON_VEG | BOTH } — "food's ready". WhatsApps the residents
 * this choice was cooked for, once per choice per serving, on the serving day
 * only. → { alerts: [{ choice, sent, failed, alreadySent }] }; 409 if every
 * requested choice was already announced.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; occasionId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, occasionId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    return apiResponse(await specialMealService.sendReadyAlert({ hostelId: id, occasionId, choice: body?.choice, sentBy: session.sub }));
  } catch (error) {
    return mealErrorResponse(error);
  }
}
