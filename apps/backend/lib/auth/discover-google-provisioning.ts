/**
 * Discover's self-serve seeker account, provisioned for a brand-new Google
 * identity (ADR-204 follow-up, 2026-09-23).
 *
 * **Why this exists.** `resolveClerkSession` (unchanged, still the one
 * resolver — see its own header) deliberately answers `NO_STAYO_ACCOUNT` for
 * a Clerk identity with no linked `profiles` row: "authentication never
 * creates a Stayo account" (ADR-176 Phase 3.1). That is correct for owner and
 * invited-tenant onboarding, both of which are controlled (admin approval, an
 * owner's invitation) — but Discover's marketplace seeker account has never
 * worked that way. `authService.selfSignUpTenant()` already lets anyone
 * create one with a password, no invitation required; this module is the
 * same account, born the same shape, for someone who chose Google instead.
 *
 * **How this stays narrow, per the design constraints it was written to:**
 *   - `resolveClerkSession` is never modified and is always consulted first.
 *     Anyone already linked, disabled, or tenancy-gated gets exactly the
 *     answer they got before this module existed — this only ever adds a
 *     NEW path out of `NO_STAYO_ACCOUNT`, and only when a caller explicitly
 *     invokes it.
 *   - It is reachable from exactly one route,
 *     `POST /api/auth/discover/google-signup`, which itself is reachable
 *     from exactly one frontend call site: the Google button on Discover's
 *     sign-up tab (`LoginModal.tsx`, gated by `?flow=discover_signup` on the
 *     OAuth return URL). Owner login, tenant login, admin, and invitation
 *     flows never set that flag and never call this route, so they are
 *     unaffected regardless of what Clerk identity signs in through them.
 *   - Email is looked up to find a **verified** address on the Clerk side
 *     (the identity being provisioned, not a lookup key into someone else's
 *     account) and to refuse a collision — it is never used to attach to an
 *     unrelated existing profile. A `profiles.email` match is a rejection,
 *     not a link — the same "refuse, don't adopt" rule
 *     `createProfileWithLogin`'s own doc comment states for the
 *     mirror-image case.
 *   - Linking is by id only (`users.clerk_user_id` ↔ `users.profile_id`),
 *     exactly the relationship `resolveClerkSession` itself reads.
 */
import { randomUUID } from "crypto";
import { prisma } from "../db";
import { getClerkBackend } from "./clerk-backend";
import { resolveClerkSession, type ClerkResolveResult } from "./clerk-session-resolver";
import { getLogger } from "@/lib/logger";

const logger = getLogger("auth.discover_google_provisioning");

const CANNOT_PROVISION =
  "Google didn't share a verified email address, so we couldn't create your account. Please try again or sign up with email and password instead.";
const EMAIL_TAKEN =
  "An account already exists for this email. Sign in with your password, or use a different Google account.";
const PROVISIONING_FAILED = "Could not create your account. Please try again.";

/** The Clerk user's verified primary email, or null if there isn't one. */
async function verifiedPrimaryEmail(clerkUserId: string): Promise<string | null> {
  const user = await getClerkBackend().users.getUser(clerkUserId);
  const primary = user.emailAddresses.find((addr) => addr.id === user.primaryEmailAddressId);
  const candidate = primary ?? user.emailAddresses[0];
  if (!candidate || candidate.verification?.status !== "verified") return null;
  return candidate.emailAddress.trim().toLowerCase();
}

/**
 * Give the `users` row for `clerkUserId` a `profile_id`, but only if it does
 * not already have one — race-safe against a second, concurrent call for the
 * same Clerk user (two tabs, a double-fired callback effect). Mirrors the
 * retry-and-reconcile idiom `credential-service.ts::ensureLogin` already uses
 * for the analogous race on `users.clerk_user_id`.
 *
 * Returns the profile id that ended up linked — which may not be
 * `profileId` if a concurrent call won first.
 */
async function linkOrAdopt(clerkUserId: string, profileId: string, email: string): Promise<string> {
  const claimed = await prisma.users.updateMany({
    where: { clerk_user_id: clerkUserId, profile_id: null },
    data: { profile_id: profileId },
  });
  if (claimed.count === 1) return profileId;

  // No row updated: either no `users` row exists yet for this Clerk user
  // (the `user.created` webhook hasn't landed — Svix is at-least-once, not
  // immediate), or one exists and is already linked (a concurrent call to
  // this same function won the race).
  try {
    await prisma.users.create({
      data: { clerk_user_id: clerkUserId, profile_id: profileId, email },
    });
    return profileId;
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
    // Someone else created the row (or linked it) in the gap between the
    // updateMany above and this create — read what actually won.
    const existing = await prisma.users.findUnique({
      where: { clerk_user_id: clerkUserId },
      select: { profile_id: true },
    });
    if (existing?.profile_id) return existing.profile_id;
    // The row exists but is somehow still unlinked (shouldn't happen given
    // the P2002 was on clerk_user_id) — one more direct attempt, then give up
    // rather than looping forever.
    const retried = await prisma.users.updateMany({
      where: { clerk_user_id: clerkUserId, profile_id: null },
      data: { profile_id: profileId },
    });
    if (retried.count === 1) return profileId;
    throw new Error("INTERNAL: could not link the Clerk identity to a profile");
  }
}

/**
 * Provision (or find) the Discover seeker account for `clerkUserId`.
 *
 * Idempotent: calling this twice for the same, already-provisioned identity
 * just resolves and returns the existing account — no second profile, no
 * error. Safe under concurrency: see `linkOrAdopt`.
 */
export async function provisionDiscoverSeekerFromClerk(clerkUserId: string): Promise<ClerkResolveResult> {
  const initial = await resolveClerkSession({ clerkUserId, sessionId: null });
  // Already linked, disabled, or tenancy-gated: resolveClerkSession's answer
  // stands untouched. Provisioning only ever fires from NO_STAYO_ACCOUNT.
  if (initial.ok || initial.code !== "NO_STAYO_ACCOUNT") return initial;

  let email: string | null;
  try {
    email = await verifiedPrimaryEmail(clerkUserId);
  } catch (error) {
    logger.error("discover_google_provisioning.clerk_lookup_failed", {
      clerk_user_id: clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: "NO_STAYO_ACCOUNT", message: PROVISIONING_FAILED };
  }
  if (!email) return { ok: false, code: "NO_STAYO_ACCOUNT", message: CANNOT_PROVISION };

  // Never match — or attach to — an existing account by email. A collision
  // here means a real, unrelated Stayo account already owns this address;
  // refuse, exactly as createProfileWithLogin refuses the mirror-image case.
  const existingProfile = await prisma.profile.findUnique({ where: { email }, select: { id: true } });
  if (existingProfile) return { ok: false, code: "NO_STAYO_ACCOUNT", message: EMAIL_TAKEN };


  const profileId = randomUUID();
  try {
    await prisma.profile.create({
      data: {
        id: profileId,
        email,
        // A verified Clerk identity has no name Discover requires up front;
        // the profile page lets them set one later, same as any other
        // marketplace account born with minimal detail.
        name: email.split("@")[0],
        role: "TENANT",
        is_active: true,
        // Same shape selfSignUpTenant() creates (see its own doc comment,
        // and lib/services/auth-service.ts's reference to this module):
        // no owner_id, no tenants row, phone collected later at enquiry
        // time, no password — Clerk already authenticated them.
        phone: null,
        phone_verified: false,
        mobile_verified: false,
        is_profile_completed: true,
      },
    });
  } catch (error) {
    logger.error("discover_google_provisioning.profile_create_failed", {
      clerk_user_id: clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: "NO_STAYO_ACCOUNT", message: PROVISIONING_FAILED };
  }

  let linkedProfileId: string;
  try {
    linkedProfileId = await linkOrAdopt(clerkUserId, profileId, email);
  } catch (error) {
    // The link failed irrecoverably: remove the profile so no account is
    // left half-created with nothing able to sign into it — the same
    // cleanup createProfileWithLogin performs when Clerk refuses it.
    await prisma.profile.delete({ where: { id: profileId } }).catch((cleanupError: unknown) => {
      logger.error("discover_google_provisioning.cleanup_failed", {
        profile_id: profileId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    });
    logger.error("discover_google_provisioning.link_failed", {
      clerk_user_id: clerkUserId,
      error: error instanceof Error ? error.message : String(error),
    });
    return { ok: false, code: "NO_STAYO_ACCOUNT", message: PROVISIONING_FAILED };
  }

  if (linkedProfileId !== profileId) {
    // Lost the race: a concurrent call already linked this Clerk user to a
    // different (also freshly-created) profile. Discard the extra one this
    // call made rather than leaving two seeker accounts for one person.
    await prisma.profile.delete({ where: { id: profileId } }).catch((cleanupError: unknown) => {
      logger.error("discover_google_provisioning.duplicate_cleanup_failed", {
        profile_id: profileId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    });
  }

  logger.info("discover_google_provisioning.provisioned", {
    clerk_user_id: clerkUserId,
    profile_id: linkedProfileId,
    adopted_concurrent_winner: linkedProfileId !== profileId,
  });

  // Re-resolve rather than hand-building the payload: guarantees this
  // returns byte-identical shape to what /auth/me would now return for the
  // same identity, including the owner_id self-heal and tenancy gate
  // resolveClerkSession already performs.
  return resolveClerkSession({ clerkUserId, sessionId: null });
}
