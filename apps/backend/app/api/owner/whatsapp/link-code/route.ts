export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { ownerWhatsAppAssistantService } from "@/lib/services/notifications/owner-whatsapp-assistant";

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Only owners can connect WhatsApp", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    const result = await ownerWhatsAppAssistantService.createLinkCode(scope.owner_id);
    return apiResponse({
      ...result,
      instruction: `Send LINK ${result.link_code} from the owner's WhatsApp number.`,
    });
  } catch (error: any) {
    const message = String(error?.message || "Failed to generate WhatsApp link code");
    if (message.startsWith("FORBIDDEN")) {
      return apiError(message.split(": ")[1] || message, "FORBIDDEN", 403);
    }
    return apiError(message, "WHATSAPP_LINK_CODE_FAILED", 500);
  }
}
