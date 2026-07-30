export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { invitationService } from "@/src/services/tenants/invitation-service";


/**
 * 📧 RESEND INVITATION
 * POST /api/tenants/resend-invitation
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Only owners/admins can resend invitations", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const identifier = body.identifier || body.email || body.phone;
    if (!identifier) {
      return apiError("Email or Phone number is required", "VALIDATION_ERROR", 400);
    }

    // Call invitation service to resend with overrides
    const result = await invitationService.resendInvitation(identifier, {
      id: session.sub,
      role: session.role,
    }, body);

    if (result?.whatsapp_sent === false && result?.email_sent === false) {
      return NextResponse.json(
        {
          error: {
            message: result.whatsapp_error || result.email_error || result.message || "Delivery failed",
            code: result.needs_email ? "EMAIL_FALLBACK_REQUIRED" : "DELIVERY_FAILED",
          },
        },
        { status: result.needs_email ? 202 : 502 }
      );
    }
    
    return apiResponse(result, 200);
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("NOT_FOUND")) return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    if (msg.startsWith("BAD_REQUEST")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("INTERNAL_ERROR")) return apiError(msg.split(": ")[1] ?? msg, "INTERNAL_ERROR", 500);
    return apiError(msg || "Failed to resend invitation");
  }
}
