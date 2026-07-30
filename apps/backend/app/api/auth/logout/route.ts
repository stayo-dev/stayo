export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { supabase } from "@/lib/db";
import { sessionLifecycleService } from "@/lib/services/session-lifecycle-service";
import { clearCsrfCookie } from "@/lib/security/csrf";

function clearAuthCookies(response: NextResponse) {
  response.cookies.set("hms_session", "", { httpOnly: true, expires: new Date(0), path: "/" });
  response.cookies.set("hms_refresh_token", "", { httpOnly: true, expires: new Date(0), path: "/" });
  clearCsrfCookie(response);
}

/**
 * Revocation is dual (ADR-031): the Redis deny-list (checked by
 * middleware.ts on every subsequent request, for both legacy and
 * Supabase-mode sessions — the thing Supabase's own stateless access
 * tokens have no equivalent for, since they stay valid until `exp`
 * regardless of sign-out) plus, for Supabase-mode sessions specifically,
 * `supabase.auth.admin.signOut()` so the refresh token dies server-side
 * too. Net effect is stronger than the pre-migration behavior, not weaker.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (session) {
      await sessionLifecycleService.revokeSession(session.sid || undefined, session.sub);
    }

    if (req.headers.get("x-auth-mode") === "supabase") {
      const authHeader = req.headers.get("authorization");
      const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : req.cookies.get("hms_session")?.value;
      if (token) {
        try {
          await supabase.auth.admin.signOut(token, "local");
        } catch (e) {
          console.warn("[auth.logout] Supabase signOut failed", e);
        }
      }
    }

    const response = NextResponse.json({ success: true });
    clearAuthCookies(response);
    return response;
  } catch (error: any) {
    console.error("Detailed API Error [auth.logout]:", error);

    // Even if revocation fails, clear cookies and return success so the
    // client-side session is torn down regardless.
    const response = NextResponse.json({
      success: true,
      warning: "Session partially cleared",
    });
    clearAuthCookies(response);
    return response;
  }
}
