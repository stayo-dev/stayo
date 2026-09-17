export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { managerInvitationService } from "@/src/services/managers/manager-invitation-service";
import { ManagerServiceError } from "@/src/services/managers/manager-service";

/** POST /api/managers/invitation/[token]/send-otp — public, token-gated. Wraps the existing phone-OTP service. */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const result = await managerInvitationService.sendPhoneOtp(token);
    return apiResponse(result);
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : error?.status || 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
