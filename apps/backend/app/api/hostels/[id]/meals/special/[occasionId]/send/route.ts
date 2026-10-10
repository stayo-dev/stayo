export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { specialMealService } from "@/src/services/meals/special-meal-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/**
 * POST { kind: ASK | REMIND } — the owner's "Ask now" / "Remind now". Sends the
 * question for the occasion's next serving immediately instead of waiting for
 * the 18:00 / 08:00 crons, while answers are open. Shares the crons' per-resident
 * keys, so nobody is messaged twice for the same serving.
 * → { serveDate, sent, skipped, failed }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; occasionId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, occasionId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    return apiResponse(await specialMealService.sendNow({ hostelId: id, occasionId, kind: body?.kind }));
  } catch (error) {
    return mealErrorResponse(error);
  }
}
