export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { compatibilityPreferencesToPolicyPatch, hostelPolicyService } from "@/lib/services/hostel-policy-service";

function toApiError(error: any) {
  const msg = String(error?.message || "Failed to process preferences");
  if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(":")[1]?.trim() || msg, "FORBIDDEN", 403);
  if (msg.startsWith("VALIDATION")) return apiError(msg.split(":")[1]?.trim() || msg, "VALIDATION_ERROR", 400);
  if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(":")[1]?.trim() || msg, "NOT_FOUND", 404);
  return apiError(msg, "ERROR", 500);
}

function explicitHostelId(req: NextRequest, body?: any) {
  return req.nextUrl.searchParams.get("hostelId") || body?.hostel_id || body?.hostelId || null;
}

async function resolveLegacyHostelId(ownerId: string, hostelId: string | null) {
  if (hostelId) return hostelId;

  const activeHostels = await prisma.hostels.findMany({
    where: { owner_id: ownerId, status: { in: ["ACTIVE", "INACTIVE"] } },
    select: { id: true },
    orderBy: { created_at: "asc" },
    take: 2,
  });

  return activeHostels.length === 1 ? activeHostels[0].id : null;
}

/**
 * Legacy compatibility endpoint. It resolves no-id calls only when the owner
 * has exactly one active hostel, which keeps onboarding compatible without
 * guessing across multi-hostel accounts.
 * New code should use /api/hostels/:id/preferences directly.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const hostelId = await resolveLegacyHostelId(scope.owner_id, explicitHostelId(req));
    if (!hostelId) return apiError("hostelId is required for preference reads", "HOSTEL_CONTEXT_REQUIRED", 400);
    const result = await hostelPolicyService.getHostelPolicy(hostelId, scope.owner_id);
    return apiResponse(result.compatibility_preferences);
  } catch (error: any) {
    return toApiError(error);
  }
}

export async function PATCH(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json();
    const hostelId = await resolveLegacyHostelId(scope.owner_id, explicitHostelId(req, body));
    if (!hostelId) return apiError("hostel_id is required for preference updates", "HOSTEL_CONTEXT_REQUIRED", 400);
    const { hostel_id, hostelId: ignoredHostelId, ...patch } = body;
    const result = await hostelPolicyService.updateHostelPolicy(
      hostelId,
      scope.owner_id,
      patch?.policy && typeof patch.policy === "object" ? patch.policy : compatibilityPreferencesToPolicyPatch(patch),
      scope.actor_id,
    );
    return apiResponse(result);
  } catch (error: any) {
    return toApiError(error);
  }
}
