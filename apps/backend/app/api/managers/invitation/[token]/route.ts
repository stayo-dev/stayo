export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@/lib/auth";
import { managerInvitationService } from "@/src/services/managers/manager-invitation-service";
import { ManagerServiceError } from "@/src/services/managers/manager-service";

/** GET /api/managers/invitation/[token] — public, token-gated context for the manager activation landing page. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const context = await managerInvitationService.getInvitationContext(token);
    return apiResponse(context);
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
