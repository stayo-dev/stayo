/**
 * Just-in-time Supabase identity provisioning (ADR-031).
 *
 * On every successful password login, silently create-or-link a real
 * Supabase `auth.users` row using the plaintext password available for
 * exactly this one request (never persisted anywhere new), so the app
 * converges onto Supabase as the sole auth provider by attrition rather
 * than a forced mass password reset. Every TENANT and ADMIN profile has
 * zero Supabase identity today, and even OWNER linkage is unreliable — see
 * ADR-031 for the full reasoning.
 *
 * Deliberately does NOT silently fall back to a local UUID / skip linking
 * on Supabase failure the way the old `registerOwner`/`selfSignUpOwner`
 * did — that silent fallback is the root cause of today's unreliable
 * linkage and this migration removes it rather than repeating it.
 */
import { createClient } from "@supabase/supabase-js";
import { prisma, supabase as supabaseAdmin } from "../db";

let anonClient: ReturnType<typeof createClient> | null = null;

/** Anon-key client — required for signInWithPassword(); the service-role client can't mint user sessions. */
export function getSupabaseAnonClient() {
  if (!anonClient) {
    const url = process.env.SUPABASE_URL || "";
    const anonKey = process.env.SUPABASE_ANON_KEY || "";
    if (!url || !anonKey) {
      throw new Error("INTERNAL: SUPABASE_URL/SUPABASE_ANON_KEY are required for Supabase sign-in");
    }
    anonClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
  }
  return anonClient;
}

export interface ProfileForIdentity {
  id: string;
  email: string;
  auth_user_id: string | null;
}

/**
 * Ensure a Supabase auth.users identity exists and is linked for this
 * profile. Idempotent — returns immediately if already linked. On a
 * unique-constraint race (two concurrent requests linking the same
 * profile), re-reads and trusts whichever request won rather than erroring.
 */
export async function ensureSupabaseIdentity(profile: ProfileForIdentity, plaintextPassword: string): Promise<string> {
  if (profile.auth_user_id) return profile.auth_user_id;

  const email = profile.email.toLowerCase();

  // Same Postgres instance as `profiles` (verified during migration
  // planning) — query auth.users directly rather than the unpaginated
  // `supabase.auth.admin.listUsers()` the old reset-password code used,
  // which silently missed users past page 1.
  const existing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT id FROM auth.users WHERE lower(email) = lower(${email}) LIMIT 1
  `;

  let authUserId: string;
  if (existing.length > 0) {
    authUserId = existing[0].id;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(authUserId, {
      password: plaintextPassword,
      email_confirm: true,
    });
    if (error) throw new Error(`INTERNAL: Failed to link Supabase identity: ${error.message}`);
  } else {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password: plaintextPassword,
      email_confirm: true,
      user_metadata: { profile_id: profile.id },
    });
    if (error || !data.user) {
      throw new Error(`INTERNAL: Failed to create Supabase identity: ${error?.message || "unknown error"}`);
    }
    authUserId = data.user.id;
  }

  try {
    await prisma.profile.update({
      where: { id: profile.id },
      data: { auth_user_id: authUserId, auth_linked_at: new Date() },
    });
  } catch (err: any) {
    if (err?.code === "P2002") {
      const refreshed = await prisma.profile.findUnique({ where: { id: profile.id }, select: { auth_user_id: true } });
      if (refreshed?.auth_user_id) return refreshed.auth_user_id;
    }
    throw err;
  }

  return authUserId;
}

export interface SupabaseSessionTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Mint a real Supabase session for an already-verified (or freshly-linked) credential. */
export async function signInWithSupabasePassword(email: string, password: string): Promise<SupabaseSessionTokens> {
  const { data, error } = await getSupabaseAnonClient().auth.signInWithPassword({
    email: email.toLowerCase(),
    password,
  });
  if (error || !data.session) {
    throw new Error(`INTERNAL: Supabase sign-in failed: ${error?.message || "no session returned"}`);
  }
  return {
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
    expires_in: data.session.expires_in,
  };
}
