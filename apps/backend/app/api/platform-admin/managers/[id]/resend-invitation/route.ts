export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { ManagerServiceError } from "@/src/services/managers/manager-service";
import { managerInvitationService } from "@/src/services/managers/manager-invitation-service";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") {
    throw new ManagerServiceError("Admin access only", "FORBIDDEN", 403);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);

    /**
     * Nudge first, re-issue second.
     *
     * A resend used to always mint a new token, which silently invalidated
     * the link already sitting in the manager's WhatsApp — so an admin
     * clicking "resend" because the manager had not replied would break the
     * very link they were about to use. When the current invitation is still
     * live we send `stayo_admin_invitation_reminder` against that same token
     * instead; only an expired or missing one earns a fresh invitation.
     */
    const reminder = await managerInvitationService.sendInvitationReminder(id);
    if (reminder.sent) {
      return apiResponse({ invitation: { reminded: true, expiresAt: reminder.expiresAt } });
    }

    const invitation = await managerInvitationService.sendInvitation(id);
    return apiResponse({ invitation });
  } catch (error: any) {
    const status = error instanceof ManagerServiceError ? error.status : 500;
    return apiError(error.message, error.code || "ERROR", status);
  }
}
