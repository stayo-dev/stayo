export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { managerInvitationService } from "@/src/services/managers/manager-invitation-service";
import { ManagerServiceError } from "@/src/services/managers/manager-service";

/** POST /api/managers/invitation/[token]/activate — public, token-gated. body { password }. Requires phone already verified. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const body = await req.json();
    const result = await managerInvitationService.completeActivation(token, body?.password);
    return apiResponse(result);
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
