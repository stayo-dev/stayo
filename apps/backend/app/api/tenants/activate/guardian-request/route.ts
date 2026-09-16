export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { tenantInvitationLifecycleService } from "@/src/services/tenants/tenant-invitation-lifecycle-service";
import { activationSubjectFromRequest } from "@/src/services/tenants/activation-request-subject";
import { sendGuardianVerifyRequest } from "@/lib/services/notifications/command-center/guardian-verify-request";

/**
 * "Ask my guardian to confirm", from inside onboarding (ADR-212).
 *
 * The same action as `POST /api/tenants/me/guardian-verification/request`, for
 * someone who does not have a session yet: mid-activation a tenant is
 * identified by their invitation token, not a cookie. Resolved through
 * `activationSubjectFromRequest` so a claimed tenant coming back under a real
 * session works too (ADR-154), rather than being told their own link is
 * invalid.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = body?.token ? String(body.token) : null;

    const subject = await activationSubjectFromRequest(req, token);
    if (!subject.ok) return apiError("token is required", "VALIDATION_ERROR", 400);

    const resolved = subject.mode === "session"
      ? await tenantInvitationLifecycleService.resolveForSession(String(subject.tenantId || ""))
      : await tenantInvitationLifecycleService.resolveByToken(String(subject.token || ""));
    if (!resolved.tenant) {
      return apiError("Invalid or expired activation link", "INVALID", 410);
    }

    const result = await sendGuardianVerifyRequest(resolved.tenant.id);

    if (!result.sent && !result.fallbackToOtp) {
      return apiError(
        result.reason === "ALREADY_VERIFIED"
          ? "This guardian number is already verified"
          : result.reason === "NO_GUARDIAN_PHONE"
            ? "Add a parent or guardian number first"
            : "That number cannot be used as a guardian number",
        result.reason || "ERROR",
        400,
      );
    }

    // `fallback_to_otp` is not a failure. Until Meta approves the template, the
    // screen quietly offers the code path instead — which is what every tenant
    // does today, so it is a known-working route, not a degraded one.
    return apiResponse({ sent: result.sent, fallback_to_otp: result.fallbackToOtp });
  } catch (error: any) {
    return apiError(error?.message || "Failed to send the confirmation request", "ERROR", 500);
  }
}
