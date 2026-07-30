export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { ownerWhatsAppAssistantService } from "@/lib/services/notifications/owner-whatsapp-assistant";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Only owners can view WhatsApp connections", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const connections = await ownerWhatsAppAssistantService.listConnections(scope.owner_id);
    return apiResponse({ connections });
  } catch (error: any) {
    const message = String(error?.message || "Failed to load WhatsApp connections");
    return apiError(message, "WHATSAPP_CONNECTIONS_FAILED", 500);
  }
}
