export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import {
  ContactVerificationError,
  startEmailVerification,
} from "@/lib/services/auth/contact-verification-service";

/**
 * POST /api/profile/contact/email/start — send a code to an email the user is
 * changing *to*. The mirror of `send-phone-otp` for the email leg.
 *
 * `verification_required: false` means no code is coming (Resend or Redis not
 * configured) and the caller should save the change rather than wait — same
 * contract as the WhatsApp leg (ADR-034).
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const body = await req.json().catch(() => ({}));
    const result = await startEmailVerification({
      profileId: session.sub,
      email: String(body?.email ?? ""),
    });
    return apiResponse({ success: true, ...result });
  } catch (error: any) {
    if (error instanceof ContactVerificationError) {
      return apiError(error.message, error.code, error.status);
    }
    return apiError("Could not send a code", "INTERNAL_ERROR", 500);
  }
}
