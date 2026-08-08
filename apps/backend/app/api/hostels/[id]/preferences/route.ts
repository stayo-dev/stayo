export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { compatibilityPreferencesToPolicyPatch, hostelPolicyService } from "@/lib/services/hostel-policy-service";
import { recordPolicyChanges } from "@/lib/services/config/config-change-log-service";
function toApiError(error: any) {
  const msg = String(error?.message || "Failed to process hostel policy");
  if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(":")[1]?.trim() || msg, "FORBIDDEN", 403);
  if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(":")[1]?.trim() || msg, "NOT_FOUND", 404);
  if (msg.startsWith("VALIDATION")) return apiError(msg.split(":")[1]?.trim() || msg, "VALIDATION_ERROR", 400);
  return apiError(msg, "ERROR", 500);
}

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const result = await hostelPolicyService.getHostelPolicy(params.id, scope.owner_id);
    return apiResponse(result);
  } catch (error: any) {
    return toApiError(error);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json();
    const patch = body?.policy && typeof body.policy === "object"
      ? body.policy
      : compatibilityPreferencesToPolicyPatch(body);

    // Read the stored policy first so the change log can describe what actually
    // moved ("Late fee raised to ₹50"), not just that something was written.
    // This is the one chokepoint every policy domain is written through, so
    // hooking here covers Finance, Hostel, Automation and Notifications at once.
    const previous = await hostelPolicyService.getHostelPolicy(params.id, scope.owner_id).catch(() => null);

    const result = await hostelPolicyService.updateHostelPolicy(params.id, scope.owner_id, patch, scope.actor_id);

    // Deliberately after the write and never awaited into the response path:
    // a logging failure must not fail the change the owner asked for.
    recordPolicyChanges({
      hostelId: params.id,
      ownerId: scope.owner_id,
      userId: scope.actor_id,
      before: (previous?.policy ?? {}) as Record<string, unknown>,
      patch: patch as Record<string, unknown>,
    }).catch((error) => {
      console.warn("[hostels.preferences] config change logging failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return apiResponse(result);
  } catch (error: any) {
    return toApiError(error);
  }
}
