export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { randomUUID } from "crypto";
import { getLogger } from "@/lib/logger";
import { verifyClerkSession } from "@/lib/auth/clerk-session";
import { ensureUserForClerkSession } from "@/src/services/auth/clerk-user-sync-service";

const logger = getLogger("api.me");

/**
 * The canonical Clerk handshake (ADR-176, Phase 2.6).
 *
 * GET /me
 * Production URL: https://api.yourstayo.com/me
 *
 * Answers "who is this Clerk session, in our terms?" — our `users.id`, the
 * business role if the account has one, whether it is linked to a `profiles`
 * row, and whether it is active. It is the seam Phase 3 builds on: once the
 * frontend can ask this, `decideRouteAccess` can start honouring a Clerk
 * session instead of ignoring it.
 *
 * ── Why this path is NOT under /api ────────────────────────────────────────
 * `middleware.ts` matches `/api/:path*` and gates it on a **Supabase** session,
 * so an `/api/me` would 401 every Clerk-authenticated caller. Making it public
 * instead is worse than it sounds: `PUBLIC_ROUTES` is prefix-matched, so an
 * `/api/me` entry would also expose the existing `/api/metrics`. Sitting
 * outside the matcher — like `/webhooks/clerk` — needs no security config at
 * all, and this route does its own Clerk verification.
 *
 * The trade-off is the same as the webhook's: `yourstayo.com` rewrites only
 * `/api/:path*` to this backend, so the SPA cannot reach `/me` through its
 * existing API client. Phase 3 must either add a rewrite for `/me` or call the
 * api. subdomain directly. Nothing calls this endpoint yet.
 *
 * ── What it deliberately does not do ───────────────────────────────────────
 * Assign a role, or create a `profiles` row. It creates at most one `users`
 * row, carrying identity only. Authorisation stays in the database, decided
 * from `profiles.role`, exactly as before Clerk existed.
 */
export async function GET(req: Request) {
  const requestId = req.headers.get("x-request-id") || randomUUID();

  const session = await verifyClerkSession(req);

  if (!session.ok) {
    // A missing secret is our misconfiguration, not a bad caller: 500 so it is
    // visible and retryable, rather than a 401 that looks like the user's fault.
    if (session.reason === "missing_secret") {
      logger.error("me.misconfigured", { request_id: requestId, detail: session.detail });
      return Response.json({ error: "Auth not configured" }, { status: 500 });
    }

    logger.info("me.unauthenticated", { request_id: requestId, reason: session.reason });
    return Response.json({ error: "Unauthenticated" }, { status: 401 });
  }

  try {
    const snapshot = await ensureUserForClerkSession(session.identity);

    logger.info("me.resolved", {
      request_id: requestId,
      clerk_user_id: snapshot.clerkUserId,
      created: snapshot.created,
      profile_linked: snapshot.profileLinked,
      // The role is logged as presence, not value — this line is not the place
      // to build a searchable index of who is an owner.
      has_role: Boolean(snapshot.role),
    });

    return Response.json(
      {
        userId: snapshot.userId,
        clerkUserId: snapshot.clerkUserId,
        role: snapshot.role,
        profile: {
          id: snapshot.profileId,
          linked: snapshot.profileLinked,
        },
        isActive: snapshot.isActive,
      },
      { status: 200 },
    );
  } catch (error) {
    logger.error("me.failed", {
      request_id: requestId,
      error: error instanceof Error ? error.message : String(error),
    });
    return Response.json({ error: "Handshake failed" }, { status: 500 });
  }
}
