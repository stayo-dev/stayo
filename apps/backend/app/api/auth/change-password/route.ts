export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { authService } from "@/lib/services/auth-service";
import { ChangePasswordSchema } from "@/lib/validators";


/**
 * 🔒 AUTH CHANGE PASSWORD
 * Requires authentication.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) {
    console.warn("[auth.change-password] Unauthorized access attempt");
    return apiError("Unauthorized", "UNAUTHORIZED", 401);
  }

  try {
    const body = await req.json().catch(() => ({}));
    console.log(`[auth.change-password] Attempting password change for user ${session.sub}`);
    
    const validated = ChangePasswordSchema.safeParse(body);

    if (!validated.success) {
      console.warn(`[auth.change-password] Validation failed for user ${session.sub}`);
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }

    const result = await authService.changePassword(
      session.sub,
      validated.data.old_password,
      validated.data.new_password
    );

    console.log(`[auth.change-password] Password changed successfully for user ${session.sub}`);
    return apiResponse({
      success: true,
      ...result
    });
  } catch (error: any) {
    console.error("Detailed API Error [auth.change-password]:", error);
    const msg = String(error?.message ?? error ?? "Password change failed");
    
    if (msg.startsWith("UNAUTHORIZED"))
      return apiError(msg.split(": ")[1] ?? msg, "UNAUTHORIZED", 401);
    if (msg.startsWith("NOT_FOUND"))
      return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    
    return Response.json(
      {
        success: false,
        error: "Internal Server Error"
      },
      { status: 500 }
    );
  }
}
