export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { ownerWhatsAppAssistantService } from "@/lib/services/notifications/owner-whatsapp-assistant";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(
  req: NextRequest,
  { params }: { params: { connectionId: string } }
) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Only owners can disconnect WhatsApp connections", "FORBIDDEN", 403);
  }

  if (!UUID_RE.test(params.connectionId)) {
    return apiError("Invalid WhatsApp connection", "VALIDATION_ERROR", 400);
  }

  try {
    const scope = resolveOwnerScope(session);
    const disconnected = await ownerWhatsAppAssistantService.disconnectConnection(
      scope.owner_id,
      params.connectionId
    );
    return apiResponse({ disconnected });
  } catch (error: any) {
    const message = String(error?.message || "Failed to disconnect WhatsApp connection");
    if (message.startsWith("NOT_FOUND")) {
      return apiError(message.split(": ")[1] || message, "NOT_FOUND", 404);
    }
    return apiError(message, "WHATSAPP_DISCONNECT_FAILED", 500);
  }
}
