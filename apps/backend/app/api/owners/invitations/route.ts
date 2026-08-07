export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { invitationService } from "@/src/services/tenants/invitation-service";
import { InvitationSchema } from "@/lib/validators";


/**
 * 📧 Tenant Invitation System
 * Access: Owner only
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") {
    return apiError("Only owners can invite tenants", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const validatedData = InvitationSchema.safeParse(body);
    if (!validatedData.success) {
      return apiError("Validation failed", "VALIDATION_ERROR", 400);
    }

    const result = await invitationService.inviteTenant(validatedData.data, session.sub);
    
    return apiResponse(result, (result?.whatsapp_sent || result?.email_sent) ? 201 : 202);
  } catch (error: any) {
    // The tenancy-eligibility refusal carries a structured payload the invite form
    // renders as "already a tenant at …" — flattening it into a message string
    // would throw away the disclosure scope that decides what the owner may see.
    if (error?.name === "TenancyEligibilityError") {
      return apiError(error.message, error.code, error.status ?? 409, error.disclosure);
    }

    const rawMessage = String(error?.message || "Failed to send invitation");
    const [maybeCode, ...rest] = rawMessage.split(":");
    const normalizedCode = maybeCode?.trim();
    const normalizedMessage = rest.length > 0 ? rest.join(":").trim() : rawMessage;

    const statusMap: Record<string, number> = {
      VALIDATION_ERROR: 400,
      VALIDATION: 400,
      BAD_REQUEST: 400,
      FORBIDDEN: 403,
      NOT_FOUND: 404,
      ALREADY_EXISTS: 409,
      INTERNAL_ERROR: 500,
    };

    const status = statusMap[normalizedCode] || 500;
    return apiError(normalizedMessage, normalizedCode || "INVITATION_ERROR", status);
  }
}
