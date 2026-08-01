export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { activationWorkflowService } from "@/src/services/tenants/activation-workflow-service";

/**
 * 📍 GET /api/tenants/[id]/activation-state
 *
 * Where an invited tenant currently is in the activation workflow, for the
 * owner. Read-only: it reuses `computeState()` — the same state machine the
 * tenant's own activation wizard runs on — so the two surfaces cannot
 * disagree, and it performs no writes.
 *
 * Deliberately not the tenant-facing `GET /api/tenants/activate/context`,
 * which is keyed by the tenant's secret token *and* mutates (marks the
 * invitation OPENED, auto-accepts hostel rules).
 *
 * KYC is not part of this response's step logic — `document_verified` is an
 * independent state machine and never gates activation.
 *
 * Access: Owner/Admin only, scoped to their own tenants.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const state = await activationWorkflowService.getOwnerActivationState(params.id, session.sub);
    return apiResponse({ activation_state: state });
  } catch (error: any) {
    const message = String(error?.message || "Failed to load activation state");
    if (message.startsWith("NOT_FOUND")) {
      return apiError(message.replace(/^NOT_FOUND:\s*/, ""), "NOT_FOUND", 404);
    }
    console.error("Detailed API Error [tenants.activation-state.GET]:", error);
    return apiError(message, "ACTIVATION_STATE_ERROR", 500);
  }
}
