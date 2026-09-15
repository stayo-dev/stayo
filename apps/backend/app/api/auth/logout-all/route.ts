export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { apiError, getSession } from "@/lib/auth";
import { supabase } from "@/lib/db";
import { sessionLifecycleService } from "@/lib/services/session-lifecycle-service";
import { credentialService } from "@/src/services/auth/credential-service";
import { clearCsrfCookie } from "@/lib/security/csrf";

export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session) return apiError("Authentication required", "UNAUTHORIZED", 401);

  await sessionLifecycleService.revokeSession(undefined, session.sub);

  // Clerk (ADR-204): every session this person has, on every device, plus a
  // deny-list entry for tokens already minted. Resolved from our own link,
  // so it works whichever kind of token made this request.
  const login = await credentialService.findLogin(session.sub);
  if (login) await credentialService.revokeAllSessions(login.clerkUserId);

  // Transition only (removed in Phase 4): a pre-Clerk Supabase session.
  if (req.headers.get("x-auth-mode") === "supabase") {
    const authHeader = req.headers.get("authorization");
    const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : req.cookies.get("hms_session")?.value;
    if (token) {
      try {
        await supabase.auth.admin.signOut(token, "global");
      } catch (e) {
        console.warn("[auth.logout-all] Supabase signOut failed", e);
      }
    }
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set("hms_session", "", { httpOnly: true, expires: new Date(0), path: "/" });
  response.cookies.set("hms_refresh_token", "", { httpOnly: true, expires: new Date(0), path: "/" });
  clearCsrfCookie(response);
  return response;
}
