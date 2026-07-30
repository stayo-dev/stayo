export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { hostelBillingPreferencesService } from "@/lib/services/hostel-billing-preferences-service";

function toApiError(error: any) {
  const msg = String(error?.message || "Failed to update billing defaults");
  if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(":")[1]?.trim() || msg, "FORBIDDEN", 403);
  if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(":")[1]?.trim() || msg, "NOT_FOUND", 404);
  if (msg.startsWith("VALIDATION")) return apiError(msg.split(":")[1]?.trim() || msg, "VALIDATION_ERROR", 400);
  return apiError(msg, "ERROR", 500);
}

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    await assertHostelBelongsToOwner(scope.owner_id, params.id);
    const billing_defaults = await hostelBillingPreferencesService.getBillingDefaults(params.id);
    return apiResponse({ billing_defaults });
  } catch (error: any) {
    return toApiError(error);
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    await assertHostelBelongsToOwner(scope.owner_id, params.id);
    const body = await req.json();
    const billing_defaults = await hostelBillingPreferencesService.updateBillingDefaults(
      params.id,
      body?.billing_defaults || body,
      scope.owner_id
    );
    return apiResponse({ billing_defaults });
  } catch (error: any) {
    return toApiError(error);
  }
}
