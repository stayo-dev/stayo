export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse, getSession } from "@/lib/auth";
import { sessionLifecycleService } from "@/lib/services/session-lifecycle-service";

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Authentication required", "UNAUTHORIZED", 401);

  // Legacy-mode only (ADR-031) — see the identical comment in
  // app/api/auth/me/route.ts. Supabase-mode idle activity is touched by
  // middleware.ts on every request already.
  if (req.headers.get("x-auth-mode") === "legacy") {
    const touched = await sessionLifecycleService.touchSession(session.sid, session.sub);
    if (!touched) {
      return apiError(
        "Your secure session has expired. Please sign in again.",
        "SESSION_EXPIRED",
        401,
      );
    }
  }

  return apiResponse({ success: true, last_active_at: new Date().toISOString() });
}
