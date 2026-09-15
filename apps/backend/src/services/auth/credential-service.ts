/**
 * Credentials and sessions — the one module that knows where they live (ADR-204).
 *
 * **Clerk is the only authentication provider. Supabase is only a database.**
 * Every password is set, checked and changed here, through Clerk's Backend API,
 * and every "sign this person out everywhere" goes through here too. Nothing in
 * this file touches `supabase.auth`, `auth.users`, `auth.sessions` or
 * `auth.refresh_tokens`, and `tests/credential-service.test.ts` fails if that
 * ever changes.
 *
 * Identity is resolved by id, never by email:
 *
 *   profiles.id ──(users.profile_id, unique)──▶ users.clerk_user_id ──▶ Clerk user
 *
 * A Clerk user this module creates carries `externalId = profiles.id`, so the
 * link can be re-derived from Clerk's side without trusting an email match.
 *
 * **The transition, and the only reason `password_hash` is still read.** A
 * profile that has not yet been moved onto Clerk still has its bcrypt hash in
 * `profiles.password_hash`, and nothing else. `verifyPassword` falls back to
 * that hash for such a profile only; the first successful sign-in or password
 * set moves the profile onto Clerk and nulls the hash (`retireLegacyCredential`).
 * No code path writes a non-null `password_hash` any more — there is no second
 * password store, only a shrinking legacy one. See the removal checklist in
 * `docs/design/2026-09-15-clerk-only-auth.md`.
 */
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getClerkBackend } from "@/lib/auth/clerk-backend";
import { markUserSessionsRevokedAfter } from "@/lib/redis/session-revocation";
import { sessionLifecycleService } from "@/lib/services/session-lifecycle-service";
import { realEmailOrNull } from "@/src/services/tenants/invited-profile-resolver";
import { getLogger } from "@/lib/logger";

const logger = getLogger("auth.credentials");

/** What this module needs to know about a profile. */
export interface CredentialProfile {
  id: string;
  email: string;
  /** Read only for a profile not yet on Clerk. */
  password_hash?: string | null;
}

/**
 * How long a sign-in ticket may wait to be redeemed by the browser. It is
 * handed back in the same response that proved the password, so it only has
 * to survive one round trip; a short life keeps a leaked response useless.
 */
export const SIGN_IN_TICKET_TTL_SECONDS = 120;

// ── Clerk error handling ───────────────────────────────────────────────────

type ClerkErrorLike = { status?: number; errors?: Array<{ code?: string; message?: string; longMessage?: string }> };

function clerkStatus(error: unknown): number | null {
  const status = (error as ClerkErrorLike)?.status;
  return typeof status === "number" ? status : null;
}

function clerkErrorCode(error: unknown): string {
  return String((error as ClerkErrorLike)?.errors?.[0]?.code || "");
}

/**
 * Clerk refuses a password it considers weak or breached with a 422 whose code
 * starts `form_password`. That is the user's problem to fix, not ours, so it
 * becomes a VALIDATION_ERROR with Clerk's own explanation; anything else is
 * re-thrown and surfaces as a server error — a password write that failed for
 * an unknown reason must never look like success.
 */
function rethrowAsValidationIfPasswordRejected(error: unknown): never {
  if (clerkStatus(error) === 422 && clerkErrorCode(error).startsWith("form_password")) {
    const detail = (error as ClerkErrorLike).errors?.[0];
    throw new Error(`VALIDATION_ERROR: ${detail?.longMessage || detail?.message || "Choose a stronger password"}`);
  }
  throw error;
}

// ── identity links ─────────────────────────────────────────────────────────

export interface LoginLink {
  clerkUserId: string;
  isActive: boolean;
}

/** The Clerk login bound to this profile, if the profile has moved onto Clerk. */
export async function findLogin(profileId: string): Promise<LoginLink | null> {
  const row = await prisma.users.findUnique({
    where: { profile_id: profileId },
    select: { clerk_user_id: true, is_active: true },
  });
  return row ? { clerkUserId: row.clerk_user_id, isActive: row.is_active } : null;
}

/** True when the profile can sign in at all — through Clerk, or (legacy) a hash. */
export async function hasCredential(profile: CredentialProfile): Promise<boolean> {
  const login = await findLogin(profile.id);
  if (login) return login.isActive;
  return Boolean(profile.password_hash);
}

function assertActive(login: LoginLink): string {
  if (!login.isActive) throw new Error("FORBIDDEN: This sign-in has been disabled");
  return login.clerkUserId;
}

/**
 * A Clerk user created by an earlier attempt that failed before our `users`
 * row was written. Looked up by `externalId` — our own profile id — so a retry
 * adopts it instead of failing on "email already exists" forever.
 */
async function findClerkUserByExternalId(profileId: string): Promise<string | null> {
  const { data } = await getClerkBackend().users.getUserList({ externalId: [profileId], limit: 2 });
  const match = data.find((u) => u.externalId === profileId);
  return match?.id ?? null;
}

type PasswordSeed =
  /** A password the person just chose: Clerk's strength and breach checks apply. */
  | { kind: "new"; password: string }
  /**
   * A password the person has already been using, being carried across on
   * their first sign-in after the move. It was accepted under the old rules,
   * so Clerk's checks are skipped — refusing it would lock them out mid-login.
   */
  | { kind: "existing"; password: string }
  /** A bcrypt digest imported in bulk (scripts/migrate-logins-to-clerk.ts). */
  | { kind: "bcrypt_digest"; digest: string };

function passwordParams(seed: PasswordSeed): Record<string, unknown> {
  switch (seed.kind) {
    case "new":
      return { password: seed.password };
    case "existing":
      return { password: seed.password, skipPasswordChecks: true };
    case "bcrypt_digest":
      return { passwordDigest: seed.digest, passwordHasher: "bcrypt" };
  }
}

/**
 * Give this profile a Clerk login, or return the one it has.
 *
 * Idempotent and race-safe: the unique indexes on `users.clerk_user_id` and
 * `users.profile_id` are the guarantee, not the read. The Clerk user carries
 * `externalId = profile.id`; its email is set only when it is a real address
 * (a `<phone>@hms.temp` placeholder is a storage key, not an identity, and
 * must never reach Clerk).
 */
export async function ensureLogin(profile: CredentialProfile, seed: PasswordSeed): Promise<string> {
  const existing = await findLogin(profile.id);
  if (existing) return assertActive(existing);

  const email = realEmailOrNull(profile.email)?.toLowerCase() ?? null;
  const adoptable = await findClerkUserByExternalId(profile.id);
  let clerkUserId = adoptable ?? "";

  try {
    if (adoptable) {
      // Adopting a user an interrupted earlier attempt created: its password
      // is whatever that attempt set, so apply this one — otherwise a reset
      // that happened to adopt would leave the password unchanged.
      await getClerkBackend().users.updateUser(clerkUserId, passwordParams(seed));
    } else {
      const created = await getClerkBackend().users.createUser({
        externalId: profile.id,
        ...(email ? { emailAddress: [email] } : {}),
        ...passwordParams(seed),
        skipLegalChecks: true,
      });
      clerkUserId = created.id;
    }
  } catch (error) {
    rethrowAsValidationIfPasswordRejected(error);
  }

  try {
    await prisma.users.create({
      data: { clerk_user_id: clerkUserId, profile_id: profile.id, email },
    });
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
    // Either a concurrent request linked this profile first, or Clerk's
    // `user.created` webhook beat us to the row (it links by the same
    // externalId). Re-read and accept only a link that says the same thing.
    const byClerkId = await prisma.users.findUnique({
      where: { clerk_user_id: clerkUserId },
      select: { profile_id: true, is_active: true },
    });
    if (byClerkId && byClerkId.profile_id === null) {
      await prisma.users.update({ where: { clerk_user_id: clerkUserId }, data: { profile_id: profile.id } });
      return clerkUserId;
    }
    if (byClerkId && byClerkId.profile_id === profile.id) {
      return assertActive({ clerkUserId, isActive: byClerkId.is_active });
    }
    const raced = await findLogin(profile.id);
    if (raced) return assertActive(raced);
    throw new Error("CONFLICT: This sign-in is already bound to a different account");
  }

  logger.info("auth.credentials.login_created", { profile_id: profile.id, seed: seed.kind });
  return clerkUserId;
}

// ── passwords ──────────────────────────────────────────────────────────────

export type PasswordCheck = { ok: boolean; via: "clerk" | "legacy_hash" };

async function verifyLegacyHash(stored: string | null | undefined, candidate: string): Promise<boolean> {
  if (!stored) return false;
  try {
    return await bcrypt.compare(candidate, stored);
  } catch {
    // Parity with the pre-Clerk login: a handful of very old rows stored the
    // password itself rather than a hash. Such a row is moved onto Clerk on
    // this same sign-in and the column is nulled, so this branch retires
    // itself one account at a time.
    return stored === candidate;
  }
}

/**
 * Does `candidate` match this profile's password?
 *
 * Clerk answers for any profile that has a Clerk login. Only a profile still
 * waiting to be moved falls back to its legacy hash — and never both: once a
 * Clerk login exists the hash is not consulted even if a stale one survived.
 */
export async function verifyPassword(profile: CredentialProfile, candidate: string): Promise<PasswordCheck> {
  const login = await findLogin(profile.id);
  if (login) {
    if (!login.isActive) return { ok: false, via: "clerk" };
    try {
      await getClerkBackend().users.verifyPassword({ userId: login.clerkUserId, password: candidate });
      return { ok: true, via: "clerk" };
    } catch (error) {
      const status = clerkStatus(error);
      // 4xx = wrong password / no password set: a normal "no". Anything else
      // (5xx, network, 429) is thrown so the caller fails closed as an error
      // rather than telling the user their correct password was wrong.
      if (status !== null && status >= 400 && status < 500 && status !== 429) return { ok: false, via: "clerk" };
      throw error;
    }
  }
  return { ok: await verifyLegacyHash(profile.password_hash, candidate), via: "legacy_hash" };
}

/**
 * Move a profile that just proved its legacy password onto Clerk, carrying
 * that same password across. Called only after `verifyPassword` returned
 * `via: "legacy_hash"`. Returns the Clerk user id.
 */
export async function migrateOnSignIn(profile: CredentialProfile, provenPassword: string): Promise<string> {
  const clerkUserId = await ensureLogin(profile, { kind: "existing", password: provenPassword });
  await retireLegacyCredential(profile.id);
  return clerkUserId;
}

/**
 * Set a new password and end every session the old one could still ride.
 *
 * Used by password reset (email link or WhatsApp code), change password,
 * the onboarding first-password step, and tenant activation. In order:
 *
 *   1. Clerk gets the new password — with `signOutOfOtherSessions`, so Clerk
 *      itself revokes the user's sessions as part of the same write. A profile
 *      with no Clerk login yet is given one, the new password as its first.
 *   2. Every remaining active session is listed and revoked explicitly. (1)
 *      should have done it; this makes the outcome not depend on it.
 *   3. The Clerk user id is deny-listed in Redis. A revoked Clerk session can
 *      no longer mint tokens, but one minted in the last minute is still a
 *      valid JWT until it expires; middleware rejects it via this entry.
 *   4. The legacy credential is retired: `password_hash` nulled, legacy
 *      HS256 tokens deny-listed. A Supabase session for this profile needs no
 *      Supabase call to kill — `getSession()` refuses every non-Clerk token
 *      for a profile that has a Clerk login.
 *
 * Throws if Clerk cannot be reached or refuses the write. A reset that did not
 * reset must never report success.
 */
export async function setPassword(profile: CredentialProfile, newPassword: string): Promise<{ clerkUserId: string }> {
  const login = await findLogin(profile.id);
  let clerkUserId: string;

  if (login) {
    clerkUserId = assertActive(login);
    try {
      await getClerkBackend().users.updateUser(clerkUserId, {
        password: newPassword,
        signOutOfOtherSessions: true,
      });
    } catch (error) {
      rethrowAsValidationIfPasswordRejected(error);
    }
  } else {
    clerkUserId = await ensureLogin(profile, { kind: "new", password: newPassword });
  }

  await revokeAllSessions(clerkUserId);
  await retireLegacyCredential(profile.id);

  logger.info("auth.credentials.password_set", { profile_id: profile.id });
  return { clerkUserId };
}

// ── sessions ───────────────────────────────────────────────────────────────

/** Session statuses that can still mint a token. */
const LIVE_SESSION_STATUSES = new Set(["active", "pending"]);

/**
 * Revoke every live Clerk session for this user, then deny-list the user id
 * for tokens already issued. Returns how many sessions were revoked.
 */
export async function revokeAllSessions(clerkUserId: string): Promise<number> {
  const clerk = getClerkBackend();
  let revoked = 0;

  // Revoking changes the listing, so re-list from the top until nothing live
  // remains, rather than paginating a set that is shrinking under us. Bounded,
  // so a Clerk that keeps reporting a session as live cannot loop forever.
  for (let pass = 0; pass < 10; pass += 1) {
    const { data } = await clerk.sessions.getSessionList({ userId: clerkUserId, limit: 100 });
    const live = data.filter((s: { id: string; status?: string }) => LIVE_SESSION_STATUSES.has(String(s.status ?? "active")));
    if (live.length === 0) break;
    for (const session of live) {
      await clerk.sessions.revokeSession(session.id);
      revoked += 1;
    }
    if (live.length < 100) break;
  }

  const denied = await markUserSessionsRevokedAfter(clerkUserId);
  if (!denied) {
    // Clerk has already revoked the sessions, so nothing can refresh; only a
    // token minted in the last minute survives until its own expiry.
    logger.warn("auth.credentials.deny_list_unavailable", { clerk_user_id: clerkUserId });
  }
  return revoked;
}

/** Revoke one Clerk session (sign-out on this device). Already-gone is fine. */
export async function revokeSession(sessionId: string): Promise<void> {
  try {
    await getClerkBackend().sessions.revokeSession(sessionId);
  } catch (error) {
    const status = clerkStatus(error);
    if (status === 404 || status === 400) return;
    throw error;
  }
}

/**
 * A single-use ticket the browser redeems with Clerk's `ticket` sign-in
 * strategy. This is how a backend-mediated sign-in (rate limits, the
 * activation gate and the other checks in `authService`) ends in a real Clerk
 * session without the browser ever handing Clerk the password itself.
 */
export async function issueSignInTicket(clerkUserId: string): Promise<string> {
  const { token } = await getClerkBackend().signInTokens.createSignInToken({
    userId: clerkUserId,
    expiresInSeconds: SIGN_IN_TICKET_TTL_SECONDS,
  });
  return token;
}

/**
 * Retire what the pre-Clerk login left behind for this profile: the bcrypt
 * hash, and any legacy HS256 token (subject = profile id). Supabase needs no
 * call — see step 4 of `setPassword`.
 */
export async function retireLegacyCredential(profileId: string): Promise<void> {
  await prisma.profile.update({ where: { id: profileId }, data: { password_hash: null } });
  await sessionLifecycleService.revokeSession(undefined, profileId);
}

/**
 * Account closure: end every session, delete the Clerk user (it holds the
 * person's email and sign-in methods, which closure promises to remove), and
 * deactivate our `users` row. The row itself is kept — obligations, payments
 * and receipts outlive the login (ADR-176) — but can no longer resolve.
 */
export async function closeLogin(profileId: string): Promise<void> {
  const login = await findLogin(profileId);
  if (!login) return;
  await revokeAllSessions(login.clerkUserId);
  try {
    await getClerkBackend().users.deleteUser(login.clerkUserId);
  } catch (error) {
    if (clerkStatus(error) !== 404) throw error;
  }
  await prisma.users.update({
    where: { clerk_user_id: login.clerkUserId },
    data: { is_active: false, deactivated_at: new Date(), updated_at: new Date() },
  });
}

export const credentialService = {
  findLogin,
  hasCredential,
  ensureLogin,
  verifyPassword,
  migrateOnSignIn,
  setPassword,
  revokeAllSessions,
  revokeSession,
  issueSignInTicket,
  retireLegacyCredential,
  closeLogin,
};
