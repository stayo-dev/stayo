export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiResponse, apiError } from "@lib/auth";
import { getLogger } from "@/lib/logger";
import { getClientIp } from "@/lib/security/api-guard";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { provisionDiscoverSeekerFromClerk } from "@/lib/auth/discover-google-provisioning";

const logger = getLogger("api.auth.discover_google_signup");

/**
 * "Ensure a Discover seeker account exists for the Clerk identity that just
 * signed in, and link it" — nothing more. This route does not itself return
 * the rich profile/tenancy shape `/auth/me` does; the frontend calls that
 * afterward (`AuthCallbackPage.tsx`), now that a link exists for it to find.
 * Keeping this endpoint's own response minimal means the one place that
 * builds the "what does a signed-in Discover user look like" shape stays
 * `/auth/me`, not two places drifting apart.
 *
 * Reachable from exactly one frontend call site — the Google button on
 * Discover's sign-up tab (`LoginModal.tsx`) — but that is a *routing* fact,
 * not a *security* one: this route is itself narrow regardless of who calls
 * it, because `provisionDiscoverSeekerFromClerk` only ever creates a fresh,
 * low-privilege marketplace-seeker `TENANT` account (the same one
 * `POST /api/auth/tenant-signup` already lets anyone create with a password,
 * no invitation required) and never touches an existing account. See that
 * module's header for the full reasoning.
 */
export async function POST(req: NextRequest) {
  try {
    // Clerk-only, by construction: middleware verifies whichever token this
    // request carries and sets x-auth-mode to say which it was. A Supabase
    // or legacy caller has nothing to provision *from* — there is no Clerk
    // identity to attach a profile to — so this is a real precondition, not
    // an extra gate layered on top of one.
    if (req.headers.get("x-auth-mode") !== "clerk") {
      return apiError("Sign in with Google to continue", "UNAUTHORIZED", 401);
    }
    const clerkUserId = req.headers.get("x-auth-user-id");
    if (!clerkUserId) return apiError("Sign in with Google to continue", "UNAUTHORIZED", 401);

    // Per-identity, not per-IP: the thing worth limiting is repeated
    // provisioning attempts for one Clerk user, not shared campus wifi.
    const limit = await checkFixedWindowLimit({
      scope: "discover-google-signup",
      identifier: `${clerkUserId}:${getClientIp(req) ?? "unknown"}`,
      maxAttempts: 10,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) {
      return apiError("Too many attempts. Please try again a bit later.", "RATE_LIMITED", 429, {
        retry_after_seconds: limit.retryAfterSeconds,
      });
    }

    const result = await provisionDiscoverSeekerFromClerk(clerkUserId);
    if (!result.ok) return apiError(result.message, result.code, 403);

    return apiResponse({ success: true });
  } catch (error) {
    // Never surfaces DB/internal detail — same posture as every other auth
    // route's catch-all.
    logger.error("discover_google_signup.unhandled", {
      error: error instanceof Error ? error.message : String(error),
    });
    return apiError("Could not create your account. Please try again.", "INTERNAL_ERROR", 500);
  }
}
