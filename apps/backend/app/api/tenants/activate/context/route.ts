export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse } from "@/lib/auth";
import { activationWorkflowService } from "@/src/services/tenants/activation-workflow-service";
import { withOnboardingMetrics } from "@/lib/onboarding-metrics";

function mapActivationError(error: any) {
  const rawMessage = String(error?.message || "Failed to load activation context");
  const [maybeCode, ...rest] = rawMessage.split(":");
  const code = rest.length ? maybeCode.trim() : "ACTIVATION_ERROR";
  const message = rest.length ? rest.join(":").trim() : rawMessage;
  const statusMap: Record<string, number> = {
    INVALID: 410,
    EXPIRED: 410,
    ALREADY_ACTIVE: 409,
    CANCELLED: 410,
    INVALID_TRANSITION: 409,
    VALIDATION_ERROR: 400,
    NOT_FOUND: 404,
    INTERNAL_ERROR: 500,
    // `resolveByToken` throws this for a SUPERSEDED invitation whose
    // tenancy is OWNER_MANAGED (the owner adopted it while the invite sat
    // unopened) -- not a dead link, a redirect to the claim flow.
    // `ActivationPage.tsx` routes on this code rather than showing "link
    // expired". See tenant-invitation-lifecycle-service.ts's resolveByToken.
    CLAIM_REQUIRED: 409,
  };
  return { message, code, status: statusMap[code] || 500 };
}

export async function GET(req: NextRequest) {
  const startedAt = performance.now();
  try {
    const token = new URL(req.url).searchParams.get("token");
    if (!token) return withOnboardingMetrics(apiError("Activation token is required", "VALIDATION_ERROR", 400), { startedAt });

    const result = await activationWorkflowService.getContext(token);
    return withOnboardingMetrics(apiResponse(result, 200), { startedAt, payload: result });
  } catch (error: any) {
    const mapped = mapActivationError(error);
    return withOnboardingMetrics(apiError(mapped.message, mapped.code, mapped.status), { startedAt, payload: mapped });
  }
}
