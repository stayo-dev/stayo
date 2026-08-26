export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import {
  ContactVerificationError,
  confirmEmailVerification,
} from "@/lib/services/auth/contact-verification-service";

/**
 * POST /api/profile/contact/email/confirm — check the code.
 *
 * On success this only records that the address is proved; it does not save
 * anything. The profile PATCH that follows is what writes the new email, and
 * it re-checks the proof itself — so a client cannot skip this step by
 * skipping this call.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const body = await req.json().catch(() => ({}));
    await confirmEmailVerification({
      profileId: session.sub,
      email: String(body?.email ?? ""),
      code: String(body?.code ?? ""),
    });
    return apiResponse({ verified: true });
  } catch (error: any) {
    if (error instanceof ContactVerificationError) {
      return apiError(error.message, error.code, error.status);
    }
    return apiError("Could not verify that code", "INTERNAL_ERROR", 500);
  }
}
