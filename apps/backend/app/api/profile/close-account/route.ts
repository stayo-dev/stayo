export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import {
  AccountClosureBlocked,
  closeAccount,
} from "@/src/services/profile/account-closure-service";

/**
 * POST /api/profile/close-account — the user closes their own account.
 *
 * Available to any signed-in profile, owner or tenant. The confirmation phrase
 * is required *here* as well as in the UI: a destructive, irreversible call
 * must not be one stray fetch away, and a client is exactly where a guard
 * would be removed.
 *
 * A reason is required and the free-text note is not — see
 * `accountClosure.ts` for why. It is recorded to `system_event_logs` before
 * anything is scrubbed.
 */
const CONFIRM_PHRASE = "DELETE";
const MAX_NOTE_LENGTH = 2000;

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Unauthorized", "UNAUTHORIZED", 401);

  try {
    const body = await req.json().catch(() => ({}));
    const confirm = String(body?.confirm ?? "").trim().toUpperCase();
    const reason = String(body?.reason ?? "").trim();
    const note = String(body?.note ?? "").trim().slice(0, MAX_NOTE_LENGTH);

    if (confirm !== CONFIRM_PHRASE) {
      return apiError(`confirm must be "${CONFIRM_PHRASE}"`, "VALIDATION_ERROR", 400);
    }
    if (!reason) {
      return apiError("reason is required", "VALIDATION_ERROR", 400);
    }

    await closeAccount({ profileId: session.sub, reason, note: note || null });

    return apiResponse({ closed: true });
  } catch (error: any) {
    if (error instanceof AccountClosureBlocked) {
      // 409, not 403: nothing is forbidden — something has to happen first.
      return apiError(error.message, error.kind, 409);
    }
    if (String(error?.message || "").startsWith("NOT_FOUND")) {
      return apiError("Account not found", "NOT_FOUND", 404);
    }
    console.error("[close-account] failed", error?.message || error);
    return apiError("Could not close the account", "INTERNAL_ERROR", 500);
  }
}
