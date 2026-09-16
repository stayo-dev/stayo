export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { sendGuardianVerifyRequest } from "@/lib/services/notifications/command-center/guardian-verify-request";

/**
 * "Ask my guardian to confirm" (ADR-212).
 *
 * The tenant's whole part in verification is this one tap. What used to happen
 * instead — obtain a six-digit code from someone else's handset and type it in
 * — is still available and still works, but it only ever works when the two
 * people are together.
 *
 * The response distinguishes "could not send" from "send it the old way": the
 * template needs Meta's approval, which has a lead time, and until it lands
 * `fallback_to_otp` tells the screen to offer the code path rather than an
 * error.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findFirst({
      where: {
        OR: [{ profile_id: session.sub }, ...(session.tenant_id ? [{ id: session.tenant_id }] : [])],
      },
      select: { id: true },
    });
    if (!tenant) return apiError("Tenant not found", "TENANT_NOT_FOUND", 404);

    const result = await sendGuardianVerifyRequest(tenant.id);

    if (!result.sent && !result.fallbackToOtp) {
      // A real refusal — no guardian on file, the same handset as the resident,
      // or already verified. Named rather than generic, because each one needs
      // the tenant to do something different next.
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

    return apiResponse({ sent: result.sent, fallback_to_otp: result.fallbackToOtp });
  } catch (error: any) {
    return apiError(error?.message || "Failed to send the confirmation request", "ERROR", 500);
  }
}
