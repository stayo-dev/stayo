export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

/**
 * GET /api/hostels/[id]/stay — the owner's Stay board for one hostel:
 * here tonight, meals, back today, late, rooms to check, beds free.
 * Answers, not states. See ADR-193.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    return apiResponse(await stayService.getHostelBoard(id));
  } catch (error) {
    return stayErrorResponse(error);
  }
}
