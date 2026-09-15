/**
 * Resolve a verified Clerk session to the profile it speaks for (ADR-204).
 *
 * The chain is id → id → id, and nothing else:
 *
 *   Clerk `sub` ──▶ users.clerk_user_id (unique) ──▶ users.profile_id (unique) ──▶ profiles
 *
 * **There is no email fallback.** The Supabase-era resolver matched an
 * unlinked login to a profile by email and then *wrote* the link — which, with
 * any path that could change a profile's email, was an account-takeover
 * primitive (the C1 chain in the 2026-09-14 audit). A Clerk login with no
 * `users.profile_id` is simply not a Stayo account yet: `NO_STAYO_ACCOUNT`.
 * Links are created only by our own code, by id — `credential-service`
 * provisioning a Clerk user with `externalId = profiles.id`, or the webhook
 * honouring that same `externalId`.
 *
 * Roles, owner and tenancy come from our database, exactly as before Clerk.
 */
import { prisma } from "../db";
import type { AuthPayload } from "../auth-edge";
import { getActiveTenancy } from "@/lib/tenancy/active-tenancy";

export type ClerkResolveResult =
  | { ok: true; payload: AuthPayload }
  | {
      ok: false;
      code: "NO_STAYO_ACCOUNT" | "ACCOUNT_DISABLED" | "TENANCY_NOT_ACTIVATED";
      message: string;
    };

const NO_ACCOUNT = "No Stayo account is linked to this sign-in.";
const DISABLED = "This account has been disabled. Please contact your hostel owner.";
const NOT_ACTIVATED = "Your account isn't activated yet. Please use the activation link sent to you, then sign in.";

export async function resolveClerkSession(ctx: {
  clerkUserId: string;
  sessionId: string | null;
}): Promise<ClerkResolveResult> {
  const login = await prisma.users.findUnique({
    where: { clerk_user_id: ctx.clerkUserId },
    select: { is_active: true, profile_id: true },
  });

  if (!login || !login.profile_id) return { ok: false, code: "NO_STAYO_ACCOUNT", message: NO_ACCOUNT };
  if (!login.is_active) return { ok: false, code: "ACCOUNT_DISABLED", message: DISABLED };

  const profile = await prisma.profile.findUnique({ where: { id: login.profile_id } });
  if (!profile) return { ok: false, code: "NO_STAYO_ACCOUNT", message: NO_ACCOUNT };
  if (!profile.is_active) return { ok: false, code: "ACCOUNT_DISABLED", message: DISABLED };

  // The same activation gate password login applies: an invited tenant who
  // has not finished onboarding cannot reach a dashboard by any sign-in.
  const liveTenancy = await getActiveTenancy(profile.id);
  if (profile.role === "TENANT" && liveTenancy?.status === "INVITED") {
    return { ok: false, code: "TENANCY_NOT_ACTIVATED", message: NOT_ACTIVATED };
  }

  // Same owner_id self-heal the session-minting path has always done.
  let ownerId = profile.owner_id;
  if (profile.role === "OWNER" && (!ownerId || String(ownerId).trim() === "")) {
    const updated = await prisma.profile.update({
      where: { id: profile.id },
      data: { owner_id: profile.id },
      select: { owner_id: true },
    });
    ownerId = updated.owner_id;
  }

  return {
    ok: true,
    payload: {
      sub: profile.id,
      role: profile.role,
      email: profile.email,
      owner_id: ownerId || null,
      tenant_id: liveTenancy?.id || null,
      sid: ctx.sessionId,
    },
  };
}

/**
 * Has this profile moved onto Clerk? Once it has, Clerk is its only session
 * authority: `getSession()` refuses a Supabase or legacy token for it, which
 * is how a password reset kills a pre-Clerk session without calling Supabase.
 */
export async function profileHasClerkLogin(profileId: string): Promise<boolean> {
  const row = await prisma.users.findUnique({ where: { profile_id: profileId }, select: { clerk_user_id: true } });
  return Boolean(row);
}
