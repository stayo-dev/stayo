import { prisma, supabase } from "../db";
import { verifyPassword, hashPassword, generateResetToken, verifyResetToken } from "../auth";
import { EmailService } from "./email-service";
import { createHash } from "crypto";
import { frontendUrl } from "../config/domains";
import { sessionLifecycleService } from "./session-lifecycle-service";
import { eventLog } from "./event-log-service";
import { setOneTimeLock } from "@/lib/redis/rate-limit";
import { redisKeys } from "@/lib/redis/keys";
import { ensureSupabaseIdentity, signInWithSupabasePassword } from "../auth/supabase-identity";

type AuthSessionMeta = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type CompletePasswordResetInput = {
  code?: string;
  accessToken?: string;
  newPassword: string;
  meta?: AuthSessionMeta;
};

const GENERIC_RESET_RESPONSE = {
  success: true,
  message: "If an account exists for this email, Supabase will send password reset instructions.",
};

function tokenFingerprint(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export class AuthService {
  private async verifyOrMigrateLegacyPassword(profile: { id: string; password_hash: string | null }, inputPassword: string) {
    const stored = profile.password_hash;
    if (!stored) return false;

    try {
      return await verifyPassword(inputPassword, stored);
    } catch {
      // Preserve compatibility with legacy bad rows where a plain-text password
      // or malformed hash was stored by older backend code.
      if (stored === inputPassword) {
        const newHash = await hashPassword(inputPassword);
        await prisma.profile.update({
          where: { id: profile.id },
          data: { password_hash: newHash },
        });
        return true;
      }

      return false;
    }
  }

  async login(emailOrPhone: string, password: string, meta: AuthSessionMeta = {}) {
    const cleanIdentifier = emailOrPhone.trim();
    let profile;
    if (cleanIdentifier.includes("@")) {
      profile = await prisma.profile.findUnique({
        where: { email: cleanIdentifier.toLowerCase() },
      });
    } else {
      const cleanPhone = cleanIdentifier.replace(/[^\d+]/g, "");
      const searchPhones = [cleanPhone];
      if (cleanPhone.startsWith("+91")) {
        searchPhones.push(cleanPhone.substring(1), cleanPhone.substring(3));
      } else if (cleanPhone.startsWith("91") && cleanPhone.length === 12) {
        searchPhones.push("+" + cleanPhone, cleanPhone.substring(2));
      } else if (cleanPhone.length === 10) {
        searchPhones.push("+91" + cleanPhone, "91" + cleanPhone);
      }
      profile = await prisma.profile.findFirst({
        where: {
          phone: {
            in: searchPhones
          }
        }
      });
    }

    if (!profile) throw new Error("UNAUTHORIZED: Invalid email, phone, or password");
    if (!profile.is_active) throw new Error("FORBIDDEN: Account is disabled");

    const isValid = await this.verifyOrMigrateLegacyPassword(profile, password);
    if (!isValid) throw new Error("UNAUTHORIZED: Invalid email, phone, or password");

    if (profile.password_reset_required) {
      throw new Error("PASSWORD_RESET_REQUIRED: You must reset your password on first login");
    }

    let tenantId = null;
    let tenantProfileCompleted = null;

    if (profile.role === "TENANT") {
      const tenant = await prisma.tenants.findUnique({
        where: { profile_id: profile.id },
        select: {
          id: true,
          profile_completed: true,
          status: true,
        }
      });
      if (tenant) {
        tenantId = tenant.id;
        tenantProfileCompleted = tenant.profile_completed;
        if (tenant.status === "INVITED") {
          throw new Error("FORBIDDEN: Account not activated. Please check your email.");
        }
      }
    }

    return this.createSessionAndTokens(profile, tenantId, tenantProfileCompleted, meta, password);
  }

  /**
   * The single session-minting chokepoint (ADR-031) — every login path
   * (password, phone, owner-signup, tenant-activation auto-login) funnels
   * through here. `plaintextPassword` is required: it's what lets this
   * function silently provision-or-link the caller's Supabase identity
   * (`ensureSupabaseIdentity`) before minting a real Supabase session via
   * `signInWithPassword` — the plaintext never persists anywhere beyond
   * this call.
   */
  async createSessionAndTokens(
    profile: any,
    tenantId: string | null,
    tenantProfileCompleted: boolean | null,
    meta: AuthSessionMeta = {},
    plaintextPassword?: string
  ) {
    let effectiveOwnerId = profile.owner_id;
    if (profile.role === "OWNER" && (!effectiveOwnerId || effectiveOwnerId.trim() === "")) {
      console.warn("[auth.createSessionAndTokens] repairing missing owner_id for OWNER", { user_id: profile.id });
      const updated = await prisma.profile.update({
        where: { id: profile.id },
        data: { owner_id: profile.id },
        select: { owner_id: true },
      });
      effectiveOwnerId = updated.owner_id;
    }

    if (profile.role === "OWNER" && !effectiveOwnerId) {
      throw new Error("UNAUTHORIZED: Invalid OWNER: missing owner_id");
    }

    if (!plaintextPassword) {
      throw new Error("INTERNAL: createSessionAndTokens requires a plaintext password to provision the Supabase session");
    }

    await ensureSupabaseIdentity(
      { id: profile.id, email: profile.email, auth_user_id: profile.auth_user_id ?? null },
      plaintextPassword
    );
    const session = await signInWithSupabasePassword(profile.email, plaintextPassword);

    return {
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_in: session.expires_in,
      token_type: "bearer",
      role: profile.role,
      name: profile.name,
      user_id: profile.id,
      owner_id: effectiveOwnerId || null,
      tenant_id: tenantId,
      is_profile_completed: tenantId ? tenantProfileCompleted : profile.is_profile_completed,
    };
  }

  async loginWithPhone(phone: string, password: string, meta: AuthSessionMeta = {}) {
    const normalizedPhone = phone.trim();

    const profile = await prisma.profile.findFirst({
      where: {
        phone: normalizedPhone,
        role: "TENANT",
      },
    });

    if (!profile) throw new Error("UNAUTHORIZED: Invalid phone or password");
    if (!profile.is_active) throw new Error("FORBIDDEN: Account is disabled");

    const isValid = await this.verifyOrMigrateLegacyPassword(profile, password);
    if (!isValid) throw new Error("UNAUTHORIZED: Invalid phone or password");

    if (profile.password_reset_required) {
      if (profile.onboarding_expires_at && profile.onboarding_expires_at < new Date()) {
        throw new Error("ONBOARDING_EXPIRED: Your onboarding credentials have expired. Please contact the hostel owner for assistance.");
      }
      throw new Error("PASSWORD_RESET_REQUIRED: You must reset your password on first login");
    }

    const tenant = await prisma.tenants.findUnique({
      where: { profile_id: profile.id },
      select: {
        id: true,
        profile_completed: true,
        status: true,
      },
    });

    if (!tenant) {
      throw new Error("UNAUTHORIZED: Tenant record not found");
    }

    if (tenant.status === "INVITED") {
      throw new Error("FORBIDDEN: Account not activated. Please check your email.");
    }

    if (tenant.status !== "ACTIVE") {
      throw new Error("FORBIDDEN: Account is not active");
    }

    const result = await this.createSessionAndTokens(profile, tenant.id, tenant.profile_completed, meta, password);
    return {
      ...result,
      password_reset_required: profile.password_reset_required,
      is_imported: profile.is_imported,
    };
  }

  async resetOnboardingPassword(
    phone: string,
    currentPassword: string,
    newPassword: string
  ) {
    const normalizedPhone = phone.trim();

    const profile = await prisma.profile.findFirst({
      where: {
        phone: normalizedPhone,
        role: "TENANT",
        password_reset_required: true,
      },
    });

    if (!profile) {
      throw new Error("UNAUTHORIZED: Invalid request or password already reset");
    }

    const isValid = await this.verifyOrMigrateLegacyPassword(profile, currentPassword);
    if (!isValid) {
      throw new Error("UNAUTHORIZED: Current password is incorrect");
    }

    if (newPassword.length < 8) {
      throw new Error("VALIDATION_ERROR: New password must be at least 8 characters");
    }

    const hasLetter = /[a-zA-Z]/.test(newPassword);
    const hasNumber = /[0-9]/.test(newPassword);
    if (!hasLetter || !hasNumber) {
      throw new Error("VALIDATION_ERROR: Password must contain at least one letter and one number");
    }

    const hashedNewPassword = await hashPassword(newPassword);

    await prisma.profile.update({
      where: { id: profile.id },
      data: {
        password_hash: hashedNewPassword,
        password_reset_required: false,
        password_reset_at: new Date(),
        onboarding_expires_at: null,
      },
    });

    return {
      success: true,
      message: "Password reset successfully. You can now log in with your new password.",
    };
  }

  async requestPasswordReset(email: string, meta: AuthSessionMeta = {}) {
    const normalizedEmail = email.trim().toLowerCase();
    const profile = await prisma.profile.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, role: true, owner_id: true, is_active: true, name: true },
    });

    if (!profile || !profile.is_active) {
      return GENERIC_RESET_RESPONSE;
    }

    try {
      const resetToken = await generateResetToken(normalizedEmail);
      const resetLink = frontendUrl(`/reset-password?access_token=${resetToken}`);

      const html = `
        <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;border:1px solid #eadfce;border-radius:16px;overflow:hidden;">
          <div style="background:linear-gradient(135deg,#1B2D5B,#2a427e);padding:28px 24px;color:#ffffff;">
            <h1 style="margin:0;font-size:22px;color:#ffffff;">Reset Your Password</h1>
            <p style="margin:8px 0 0;opacity:0.9;font-size:14px;color:#eadfce;">Sri Adithya Boys Hostel Account Recovery</p>
          </div>
          <div style="padding:24px;color:#1e293b;line-height:1.6;background:#FFFDF5;">
            <p>Hello <strong>${profile.name || "User"}</strong>,</p>
            <p>We received a request to reset the password for your account. Click the button below to choose a new password. This link is valid for 1 hour.</p>
            <div style="text-align:center;margin:28px 0;">
              <a href="${resetLink}" target="_blank" style="display:inline-block;background:#F07B1D;color:#ffffff;padding:14px 32px;text-decoration:none;border-radius:10px;font-weight:700;font-size:16px;">
                Reset Password
              </a>
            </div>
            <p style="font-size:12px;color:#94a3b8;text-align:center;">If you did not request this, you can safely ignore this email.</p>
          </div>
        </div>
      `;

      await EmailService.sendEmail(normalizedEmail, "Reset your Sri Adithya Boys Hostel password", html);

      await eventLog.log("PASSWORD_RESET_REQUESTED", profile.owner_id || profile.id, {
        profile_id: profile.id,
        role: profile.role,
        email: normalizedEmail,
        ip_address: meta.ipAddress || null,
        user_agent: meta.userAgent || null,
      });
    } catch (error) {
      console.error("[auth.requestPasswordReset] Custom reset email failed", {
        email: normalizedEmail,
        profile_id: profile.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return GENERIC_RESET_RESPONSE;
  }

  async completePasswordReset(input: CompletePasswordResetInput) {
    if (input.newPassword.length < 8) {
      throw new Error("VALIDATION_ERROR: Password must be at least 8 characters");
    }

    const token = input.code || input.accessToken;
    if (!token) {
      throw new Error("VALIDATION_ERROR: Reset token is required");
    }

    const resetPayload = await verifyResetToken(token);
    if (!resetPayload || !resetPayload.email) {
      throw new Error("VALIDATION_ERROR: Reset link is invalid or expired");
    }

    const fingerprint = tokenFingerprint(token);
    const firstUse = await setOneTimeLock(redisKeys.passwordReset.usedToken(fingerprint), 60 * 60);
    if (!firstUse) {
      throw new Error("VALIDATION_ERROR: Reset link has already been used");
    }

    const normalizedEmail = resetPayload.email.trim().toLowerCase();
    const profile = await prisma.profile.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, email: true, role: true, owner_id: true, is_active: true, auth_user_id: true },
    });

    if (!profile || !profile.is_active) {
      throw new Error("VALIDATION_ERROR: Reset link is invalid or expired");
    }

    const newHash = await hashPassword(input.newPassword);

    await prisma.profile.update({
      where: { id: profile.id },
      data: {
        password_hash: newHash,
        password_reset_required: false,
        password_reset_at: new Date(),
      },
    });

    await sessionLifecycleService.revokeSession(undefined, profile.id);

    // Bug fixed here (ADR-031): this used to scan `auth.admin.listUsers()`
    // unpaginated, silently missing any user past page 1. Also now links
    // an unlinked profile rather than only best-effort-syncing an already-
    // linked one — a password reset is a real opportunity to migrate.
    try {
      await ensureSupabaseIdentity(
        { id: profile.id, email: profile.email, auth_user_id: profile.auth_user_id },
        input.newPassword
      );
    } catch (e) {
      console.warn("[auth.completePasswordReset] Supabase sync skipped/failed", e);
    }

    await eventLog.log("PASSWORD_RESET_COMPLETED", profile.owner_id || profile.id, {
      profile_id: profile.id,
      role: profile.role,
      email: normalizedEmail,
      ip_address: input.meta?.ipAddress || null,
      user_agent: input.meta?.userAgent || null,
    });

    return {
      success: true,
      message: "Password reset successfully. Please sign in with your new password.",
    };
  }

  /**
   * 🔒 BOOTSTRAP-ONLY: Create a new owner account.
   *
   * This method is restricted to initial system setup. In production,
   * it requires the ALLOW_OWNER_BOOTSTRAP environment variable to be set.
   * This prevents accidental invocation from any future route or service.
   *
   * HMS is a single-owner system. After initial setup, no new owners
   * should be created through any code path.
   */
  async registerOwner(data: {
    email:    string;
    password: string;
    name:     string;
    phone?:   string;

    role?:    string;
  }) {
    // Defence-in-depth: block owner creation unless explicitly allowed.
    if (!process.env.ALLOW_OWNER_BOOTSTRAP) {
      console.error("[auth.registerOwner] BLOCKED: Owner creation attempted without ALLOW_OWNER_BOOTSTRAP flag");
      await eventLog.log("OWNER_CREATION_BLOCKED", null, {
        email: data.email,
        reason: "BOOTSTRAP_FLAG_NOT_SET",
      });
      throw new Error("FORBIDDEN: Owner registration is disabled. HMS is a single-owner system.");
    }
    const normalizedEmail = data.email.trim().toLowerCase();

    // 1. Check for existing profile
    const existing = await prisma.profile.findUnique({ where: { email: normalizedEmail } });
    if (existing) throw new Error("ALREADY_EXISTS: Email already registered");

    // 2. Create the Supabase Auth identity first — profile.id and
    //    auth_user_id are both set from it, so this account is born
    //    linked. Fails loudly rather than silently falling back to a
    //    local UUID (ADR-031): that old fallback is the root cause of
    //    today's unreliable Supabase linkage across existing accounts.
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password: data.password,
      email_confirm: true,
    });
    if (authError || !authData.user?.id) {
      throw new Error(`INTERNAL: Failed to create Supabase identity: ${authError?.message || "unknown error"}`);
    }
    const userId = authData.user.id;

    // 3. Hash password and create profile (no hostel — captured in onboarding step 2)
    const hashedPassword = await hashPassword(data.password);

    try {
      const profile = await prisma.profile.create({
        data: {
          id:       userId,
          email:    normalizedEmail,
          password_hash: hashedPassword,
          name:     data.name,
          phone:    data.phone || null,

          role:     "OWNER",
          is_active: true,
          owner_id:  userId,
          auth_user_id: userId,
          auth_linked_at: new Date(),
        },
      });

      return profile;
    } catch (dbError) {
      // Rollback Supabase user creation if Prisma transaction fails
      await supabase.auth.admin.deleteUser(userId);
      throw dbError;
    }
  }

  /**
   * Returns the `auth.users` id to bind a brand-new profile to, creating the
   * Supabase identity or **adopting an existing orphaned one**.
   *
   * The adoption case is real, not defensive: signing in with Google on the
   * landing page's lead flow creates an `auth.users` row with no `profiles`
   * row behind it. When that person later signs up properly, a blind
   * `admin.createUser` is rejected ("email already registered") and the route
   * surfaced an opaque 500. Callers have already checked `profiles` for a
   * duplicate email, so an `auth.users` hit here means an orphan — claim it
   * and set the password the user just chose.
   */
  private async provisionSupabaseIdentity(
    normalizedEmail: string,
    password: string,
  ): Promise<{ userId: string; adopted: boolean }> {
    const existing = await prisma.$queryRaw<{ id: string }[]>`
      SELECT id FROM auth.users WHERE lower(email) = lower(${normalizedEmail}) LIMIT 1
    `;

    if (existing.length > 0) {
      const authUserId = existing[0].id;
      const { error } = await supabase.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
      });
      if (error) {
        throw new Error(`INTERNAL: Failed to adopt Supabase identity: ${error.message}`);
      }
      return { userId: authUserId, adopted: true };
    }

    const { data, error } = await supabase.auth.admin.createUser({
      email: normalizedEmail,
      password,
      email_confirm: true,
    });
    if (error || !data.user?.id) {
      throw new Error(`INTERNAL: Failed to create Supabase identity: ${error?.message || "unknown error"}`);
    }
    return { userId: data.user.id, adopted: false };
  }

  /**
   * Real self-serve StayO owner signup. Deliberately separate from
   * `registerOwner` above — that method's `ALLOW_OWNER_BOOTSTRAP` gate exists
   * to keep the legacy single-owner HMS from ever growing a second owner;
   * StayO is a real multi-tenant product where new owners signing up is the
   * expected, ungated path. Requires a fresh `phone_verification_otps` row for
   * the phone — VERIFIED when a code was really entered, SKIPPED when WhatsApp
   * could not deliver (checked by the route via resolveSignupPhoneVerification).
   * `phoneVerified` carries which of the two happened onto the profile.
   */
  async selfSignUpOwner(data: {
    email: string;
    password: string;
    name: string;
    phone: string;
    phoneVerified: boolean;
  }) {
    const normalizedEmail = data.email.trim().toLowerCase();

    const existingEmail = await prisma.profile.findUnique({ where: { email: normalizedEmail } });
    if (existingEmail) throw new Error("ALREADY_EXISTS: Email already registered");

    const existingPhone = await prisma.profile.findFirst({ where: { phone: data.phone } });
    if (existingPhone) throw new Error("ALREADY_EXISTS: Phone number already registered");

    // Born linked — same reasoning as registerOwner() above (ADR-031): no
    // silent local-UUID fallback.
    const { userId, adopted } = await this.provisionSupabaseIdentity(normalizedEmail, data.password);

    const hashedPassword = await hashPassword(data.password);

    try {
      const profile = await prisma.profile.create({
        data: {
          id: userId,
          email: normalizedEmail,
          password_hash: hashedPassword,
          name: data.name,
          phone: data.phone,
          role: "OWNER",
          is_active: true,
          owner_id: userId,
          phone_verified: data.phoneVerified,
          mobile_verified: data.phoneVerified,
          auth_user_id: userId,
          auth_linked_at: new Date(),
        },
      });

      return profile;
    } catch (dbError) {
      // Only clean up an identity we created — deleting an adopted one would
      // destroy a Supabase user that existed before this signup attempt.
      if (!adopted) await supabase.auth.admin.deleteUser(userId);
      throw dbError;
    }
  }

  /**
   * Self-serve tenant signup (ADR-035). Creates a **marketplace account**: a
   * `profiles` row with `role: TENANT` and deliberately **no `tenants` row`.
   *
   * That distinction is the whole design. A `tenants` record binds a person to
   * a hostel, a room and an agreement — none of which exist for someone who
   * just signed up to browse. They become a tenant *of a hostel* only when an
   * owner invites them and they activate, which reuses this same profile:
   * `tenant-invitation-lifecycle-service` only rejects an existing profile
   * that already has an active `tenants` row, and otherwise updates the
   * profile in place rather than creating a second one.
   *
   * `is_profile_completed` is set true because that flag gates the *invited*
   * tenant's onboarding wizard (guardian details, documents) — a marketplace
   * account has no hostel to complete a profile for, and would otherwise be
   * trapped in a redirect loop by `ProtectedTenantRoute`.
   *
   * Callers must verify the phone first (`resolveSignupPhoneVerification`),
   * exactly as `/api/auth/owner-signup` does.
   */
  async selfSignUpTenant(data: {
    email: string;
    password: string;
    name: string;
    phone: string;
    phoneVerified: boolean;
  }) {
    const normalizedEmail = data.email.trim().toLowerCase();

    const existingEmail = await prisma.profile.findUnique({ where: { email: normalizedEmail } });
    if (existingEmail) throw new Error("ALREADY_EXISTS: Email already registered");

    const existingPhone = await prisma.profile.findFirst({ where: { phone: data.phone } });
    if (existingPhone) throw new Error("ALREADY_EXISTS: Phone number already registered");

    // Born linked — same reasoning as selfSignUpOwner above (ADR-031).
    const { userId, adopted } = await this.provisionSupabaseIdentity(normalizedEmail, data.password);

    const hashedPassword = await hashPassword(data.password);

    try {
      const profile = await prisma.profile.create({
        data: {
          id: userId,
          email: normalizedEmail,
          password_hash: hashedPassword,
          name: data.name,
          phone: data.phone,
          role: "TENANT",
          is_active: true,
          // No owner_id: this account belongs to no hostel until an owner
          // invites them. The column is nullable precisely for this.
          phone_verified: data.phoneVerified,
          mobile_verified: data.phoneVerified,
          is_profile_completed: true,
          auth_user_id: userId,
          auth_linked_at: new Date(),
        },
      });

      return profile;
    } catch (dbError) {
      // Only clean up an identity we created — deleting an adopted one would
      // destroy a Supabase user that existed before this signup attempt.
      if (!adopted) await supabase.auth.admin.deleteUser(userId);
      throw dbError;
    }
  }

  async changePassword(userId: string, oldPassword: string, newPassword: string) {
    const profile = await prisma.profile.findUnique({ where: { id: userId } });
    if (!profile) throw new Error("NOT_FOUND: User not found");

    const isValid = await verifyPassword(oldPassword, profile.password_hash || "");
    if (!isValid) throw new Error("UNAUTHORIZED: Current password is incorrect");

    // Sync new password with Supabase Auth. Bug fixed here (ADR-031): this
    // used to pass the local `profiles.id` straight to `updateUserById`,
    // which only worked for profiles that happened to be born with
    // profiles.id === auth.users.id — every unlinked profile 500'd the
    // whole password change. If unlinked, provisioning IS the update (the
    // new password becomes the initial Supabase password).
    if (profile.auth_user_id) {
      const { error: supabaseError } = await supabase.auth.admin.updateUserById(profile.auth_user_id, {
        password: newPassword,
      });
      if (supabaseError) {
        throw new Error(`INTERNAL: Failed to update auth provider password: ${supabaseError.message}`);
      }
    } else {
      await ensureSupabaseIdentity({ id: profile.id, email: profile.email, auth_user_id: null }, newPassword);
    }

    const newHash = await hashPassword(newPassword);
    await prisma.profile.update({
      where: { id: userId },
      data: { password_hash: newHash },
    });

    return { success: true, message: "Password updated successfully" };
  }

  async verifyUserPassword(userId: string, password: string): Promise<boolean> {
    const profile = await prisma.profile.findUnique({
      where: { id: userId },
      select: { id: true, password_hash: true },
    });
    if (!profile) return false;
    return this.verifyOrMigrateLegacyPassword(profile, password);
  }

  /**
   * Kept for the few payment/tenant routes that call this instead of
   * `getSession()` directly — same underlying resolution now (ADR-031), just
   * reshaped into this method's older return shape.
   */
  async getCurrentUser(req: Request) {
    const { getSession } = await import("../auth");
    const session = await getSession(req as any);
    if (!session) return null;

    return {
      id: session.sub,
      email: session.email,
      role: session.role,
      owner_id: session.owner_id
    };
  }
}

export const authService = new AuthService();
