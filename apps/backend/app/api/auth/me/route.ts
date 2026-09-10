export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@lib/auth";
import { getLogger } from "@/lib/logger";
import { prisma } from "@lib/db";
import { sessionLifecycleService } from "@/lib/services/session-lifecycle-service";
import { resolveSupabaseSession } from "@/lib/auth/supabase-session";
import { verifyClerkSession } from "@/lib/auth/clerk-session";
import { ensureUserForClerkSession } from "@/src/services/auth/clerk-user-sync-service";

const logger = getLogger("api.auth.me");

/**
 * Why this route resolves the Supabase session itself instead of only calling
 * `getSession()`: `getSession()` collapses every rejection reason to `null`,
 * which is right for the ~200 other routes (they should say nothing) but
 * useless here. `/auth/callback` is where a Google sign-in lands, and it needs
 * the *specific* reason — no Stayo account for this email, account disabled,
 * tenancy not activated — or the user is left with a flat "Unauthorized" and
 * no idea what to do. lib/auth/supabase-session.ts always documented this
 * split; it just was never wired up, so every Google rejection looked
 * identical (see docs/obsidian/Bugs.md).
 */
async function supabaseRejection(req: NextRequest) {
  if (req.headers.get("x-auth-mode") !== "supabase") return null;
  const authUserId = req.headers.get("x-auth-user-id");
  if (!authUserId) return null;

  const result = await resolveSupabaseSession({
    authUserId,
    email: req.headers.get("x-auth-email") || "",
    emailVerified: true,
    sessionId: req.headers.get("x-auth-session-id"),
    provider: req.headers.get("x-auth-provider"),
  });

  return result.ok ? null : result;
}

/**
 * Resolve a **Clerk** bearer token to the profile it speaks for
 * (ADR-176 Phase 3, minimal dual session authority).
 *
 * Runs only when the Supabase path found nothing, so the existing behaviour is
 * untouched: a Supabase session never reaches this function. `middleware.ts`
 * lets an unverifiable token through on this one path precisely so that it can
 * be tried here (see CLERK_BEARER_ROUTES there) — which means this function is
 * the *only* thing authenticating such a request, and it must be strict.
 *
 * Returns the profile id to continue with, or a rejection to surface. It never
 * creates a profile: `ensureUserForClerkSession` creates at most a `users` row
 * (identity), and a Clerk account with no `profiles` row is a real, expected
 * state — someone who signed in with Google but has no Stayo account. That is
 * reported as NO_STAYO_ACCOUNT, the same code the Supabase path uses, so
 * `/auth/callback` shows the message it already has for it.
 */
async function clerkResolution(req: NextRequest) {
  const session = await verifyClerkSession(req);
  if (!session.ok) return { ok: false as const, profileId: null, rejection: null };

  const snapshot = await ensureUserForClerkSession(session.identity);

  if (!snapshot.isActive) {
    return {
      ok: false as const,
      profileId: null,
      rejection: {
        message: "This account has been disabled. Please contact your hostel owner.",
        code: "ACCOUNT_DISABLED",
      },
    };
  }

  if (!snapshot.profileId) {
    return {
      ok: false as const,
      profileId: null,
      rejection: {
        message: "No Stayo account exists for this email.",
        code: "NO_STAYO_ACCOUNT",
      },
    };
  }

  return { ok: true as const, profileId: snapshot.profileId, rejection: null };
}

/**
 * Which tenancy speaks for a person who has more than one.
 *
 * This used to be a bare `findFirst({ where: { profile_id } })` — no
 * `orderBy`, no status filter — so Postgres returned whichever row it liked.
 * Someone re-admitted after a previous stay could be handed the OLD,
 * `FORMER_TENANT` row, and every `hasLiveTenancy` gate downstream then locked
 * them out of the hostel they had just joined.
 *
 * The precedence is the same one `profile-identity-service.ts` already uses
 * (`selectFallbackTenancy`): the live tenancy wins, else the most recently
 * created one. Deliberately NOT `orderBy: { status: 'asc' }` — `TenantStatus`
 * declares `INVITED` before `ACTIVE`, so sorting on the enum would prefer a
 * tenancy the person never activated over the one they actually live in.
 */
async function selectRepresentativeTenancy(profileId: string) {
  const withRoom = {
    room_allocations: {
      where: { is_active: true },
      orderBy: { created_at: "desc" as const },
      take: 1,
      include: { room: true },
    },
  };

  const live = await prisma.tenants.findFirst({
    where: { profile_id: profileId, status: { in: ["INVITED", "ACTIVE"] } },
    orderBy: { created_at: "desc" },
    include: withRoom,
  });
  if (live) return live;

  return prisma.tenants.findFirst({
    where: { profile_id: profileId },
    orderBy: { created_at: "desc" },
    include: withRoom,
  });
}

export async function GET(req: NextRequest) {
  // Supabase first, unchanged. Clerk is only consulted when it finds nothing,
  // so an existing session behaves exactly as it did before Clerk existed.
  const session = await getSession(req);
  let profileId = session?.sub ?? null;

  if (!session) {
    const rejection = await supabaseRejection(req);
    if (rejection) return apiError(rejection.message, rejection.code, 403);

    /*
     * Guarded, and loudly. This block sat outside the try/catch below, so
     * anything it threw became an opaque 500 with no log line — which is
     * exactly what happened on the first real Clerk sign-in, and left the
     * cause un-diagnosable from the outside. A failure here is ours, not the
     * caller's, so it says so and records why.
     */
    let clerk: Awaited<ReturnType<typeof clerkResolution>>;
    try {
      clerk = await clerkResolution(req);
    } catch (error) {
      logger.error("auth.me.clerk_resolution_failed", {
        error: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : undefined,
        // Prisma surfaces its own codes here (P2021 = table missing, P2022 =
        // column missing); they name a migration gap far faster than a stack.
        code: (error as { code?: string })?.code,
      });
      return apiError("Could not resolve your session.", "CLERK_RESOLUTION_FAILED", 500);
    }

    if (clerk.rejection) return apiError(clerk.rejection.message, clerk.rejection.code, 403);
    if (!clerk.ok) return apiError("Unauthorized", "UNAUTHORIZED", 401);
    profileId = clerk.profileId;
  }

  try {
    // Legacy-mode only (ADR-031): this validates against `refresh_tokens`,
    // which Supabase-minted sessions never write a row to — middleware.ts
    // already does the equivalent idle-touch/check for Supabase-mode
    // sessions via Redis directly, so running this here too would 401 every
    // fresh Supabase login (no matching refresh_tokens row = "expired").
    if (session?.sid && req.headers.get("x-auth-mode") === "legacy") {
      const touched = await sessionLifecycleService.touchSession(session.sid, session.sub);
      if (!touched) {
        return apiError(
          "Your secure session has expired. Please sign in again.",
          "SESSION_EXPIRED",
          401,
        );
      }
    }

    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        owner_id: true,
        is_profile_completed: true,
        phone: true,
        phone_verified: true,
      }
    });

    if (!profile) return apiError("Session expired. Please log in again.", "UNAUTHORIZED", 401);

    const extra: any = {};
    let tenantId: string | null = null;

    if (profile.role === "TENANT") {
      const tenant = await selectRepresentativeTenancy(profile.id);

      if (tenant) {
        tenantId = tenant.id;
        extra.monthly_rent = tenant.monthly_rent;
        extra.tenant_status = tenant.status;
        extra.is_profile_completed = tenant.profile_completed || profile.is_profile_completed;

        const activeAlloc = (tenant as any).room_allocations[0];
        if (activeAlloc) {
          extra.room_id = activeAlloc.room_id;
          extra.room_no = activeAlloc.room.room_no;
          extra.room_capacity = activeAlloc.room.capacity;
        }

        /*
         * Exit state, for the tenant app's read-only window (ADR-122).
         *
         * `tenant_status` alone cannot answer "may this person still open
         * their dashboard?". A FORMER_TENANT whose settlement is still open
         * has money in flight and MUST keep read access — locking them out
         * the moment the bed is released (which is what `vacate` does, a
         * whole step before the money settles) evicted people from the app
         * while they were still owed a refund.
         *
         * So the frontend gets a third value instead of a boolean: LIVE /
         * EXITING / EXITED. `exit_request_id` lets the farewell screen and
         * the read-only dashboard fetch the settlement without first
         * listing every request in the hostel.
         */
        const openExit = await prisma.move_out_requests.findFirst({
          where: { tenant_id: tenant.id, status: { notIn: ["COMPLETED", "REJECTED"] } },
          orderBy: { created_at: "desc" },
          select: { id: true, status: true },
        });

        const isLive = tenant.status === "INVITED" || tenant.status === "ACTIVE";
        extra.tenancy_state = isLive ? "LIVE" : openExit ? "EXITING" : "EXITED";
        extra.exit_request_id = openExit?.id ?? null;

        if (!openExit && !isLive) {
          // Settled and gone — the farewell screen needs the last completed
          // request to show the receipt, not just the fact that they left.
          const lastExit = await prisma.move_out_requests.findFirst({
            where: { tenant_id: tenant.id, status: "COMPLETED" },
            orderBy: { completed_at: "desc" },
            select: { id: true },
          });
          extra.exit_request_id = lastExit?.id ?? null;
        }
      } else {
        // A TENANT with no tenancy is a Stayo Discover account — someone who
        // signed up to browse and enquire but has not moved in anywhere
        // (`authService.selfSignUpTenant`). This branch used to fall through
        // leaving `is_profile_completed` undefined, so every guard reading it
        // treated a complete profile as incomplete and bounced them to
        // /complete-profile on reload. See Bugs.md.
        extra.is_profile_completed = profile.is_profile_completed;
        extra.tenant_status = null;
        extra.tenancy_state = "NONE";
        extra.exit_request_id = null;
      }
    } else {
      extra.is_profile_completed = profile.is_profile_completed;
    }

    const response = apiResponse({
      user_id: profile.id,
      owner_id: profile.role === "OWNER" ? profile.id : profile.owner_id,
      email: profile.email,
      name: profile.name,
      role: profile.role,
      tenant_id: tenantId,
      is_admin: profile.role === "ADMIN",
      is_owner: profile.role === "OWNER",
      is_tenant: profile.role === "TENANT",
      phone: profile.phone,
      phone_verified: profile.phone_verified,
      ...extra
    });
    // Deliberately NOT rotating the CSRF token here. `/auth/me` is a GET that
    // AuthContext calls on every Supabase auth-state change (mount, tab focus,
    // token refresh), so minting a new token here made it a moving target for
    // any unsafe request already in flight — an owner pressing "Send
    // invitation" could be rejected with "Security check failed". Rotation now
    // happens only at auth boundaries (login / logout / signup / activation /
    // password reset), which is where it actually matters. The token is still
    // issued on demand by GET /api/auth/csrf.
    return response;
  } catch (error) {
    return apiError("Internal server error");
  }
}
