/**
 * Manager invitation/activation lifecycle:
 *   PENDING_INVITATION -> (phone verified via authOtpService) -> (password
 *   set) -> ACTIVE.
 *
 * Reuses, rather than reimplements:
 *  - `profile.invitation_token`/`invitation_expires_at` (already on
 *    `profile`, used by the tenant-invite flow) for the activation link.
 *  - `authOtpService` (`lib/services/auth/auth-otp-service.ts`) for phone
 *    OTP send/verify, with a new purpose string "MANAGER_INVITE".
 *  - `hashPassword` (`lib/auth.ts`) for the password itself.
 *  - The existing `/api/auth/login` -> `ensureSupabaseIdentity()` JIT-link
 *    path for actually creating the Supabase Auth account — activation
 *    here only sets `password_hash`; the manager's first login does the
 *    rest, exactly like it does for owners today.
 */
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { authOtpService } from "@/lib/services/auth/auth-otp-service";
import { EmailService } from "@/lib/services/email-service";
import { frontendUrl } from "@/lib/config/domains";
import { ManagerServiceError } from "./manager-service";

export const MANAGER_OTP_PURPOSE = "MANAGER_INVITE";
const INVITE_TTL_HOURS = 72;

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

export class ManagerInvitationService {
  /** Mints a fresh activation token and emails the link. Safe to call again (resend). */
  async sendInvitation(managerProfileId: string) {
    const manager = await prisma.manager_profiles.findUnique({
      where: { id: managerProfileId },
      include: { profile: true },
    });
    if (!manager) throw new ManagerServiceError("Manager not found", "NOT_FOUND", 404);
    if (manager.status === "ACTIVE") {
      throw new ManagerServiceError("Manager has already activated their account", "ALREADY_ACTIVE", 409);
    }

    const token = generateToken();
    const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000);
    await prisma.profile.update({
      where: { id: manager.profile_id },
      data: { invitation_token: token, invitation_expires_at: expiresAt },
    });

    const activationLink = frontendUrl(`/admin/manager-invitation/${token}`);
    const html = `
      <p>Hello ${manager.profile.name},</p>
      <p>You've been added as a Manager on Stayo. Activate your account to get started:</p>
      <p><a href="${activationLink}">${activationLink}</a></p>
      <p>This link expires in ${INVITE_TTL_HOURS} hours.</p>
    `;
    await EmailService.sendEmail(manager.profile.email, "You've been invited to Stayo as a Manager", html);

    return { activationLink, expiresAt };
  }

  /** Public, token-gated: minimal context for the activation landing page. */
  async getInvitationContext(token: string) {
    const profile = await this.findByToken(token);
    return {
      name: profile.name,
      phone: profile.phone,
      email: profile.email,
      phoneVerified: !!(await prisma.manager_profiles.findUnique({ where: { profile_id: profile.id } }))
        ?.phone_verified_at,
    };
  }

  async sendPhoneOtp(token: string) {
    const profile = await this.findByToken(token);
    return authOtpService.sendPhoneOtp({ phone: profile.phone!, purpose: MANAGER_OTP_PURPOSE });
  }

  async verifyPhoneOtp(token: string, otp: string) {
    const profile = await this.findByToken(token);
    await authOtpService.verifyPhoneOtp({ phone: profile.phone!, otp, purpose: MANAGER_OTP_PURPOSE });
    await prisma.manager_profiles.update({
      where: { profile_id: profile.id },
      data: { phone_verified_at: new Date() },
    });
    return { verified: true };
  }

  async completeActivation(token: string, password: string) {
    if (!password || password.length < 8) {
      throw new ManagerServiceError("Password must be at least 8 characters", "INVALID_PASSWORD", 422);
    }
    const profile = await this.findByToken(token);
    const manager = await prisma.manager_profiles.findUnique({ where: { profile_id: profile.id } });
    if (!manager) throw new ManagerServiceError("Manager not found", "NOT_FOUND", 404);
    if (!manager.phone_verified_at) {
      throw new ManagerServiceError("Phone must be verified before activation", "PHONE_NOT_VERIFIED", 400);
    }
    if (manager.status === "ACTIVE") {
      throw new ManagerServiceError("This invitation has already been used", "ALREADY_ACTIVE", 409);
    }

    const passwordHash = await hashPassword(password);
    await prisma.$transaction([
      prisma.profile.update({
        where: { id: profile.id },
        data: { password_hash: passwordHash, invitation_token: null, invitation_expires_at: null },
      }),
      prisma.manager_profiles.update({
        where: { profile_id: profile.id },
        data: { status: "ACTIVE", activated_at: new Date() },
      }),
    ]);

    return { activated: true, email: profile.email };
  }

  private async findByToken(token: string) {
    const profile = await prisma.profile.findFirst({
      where: { invitation_token: token, role: "MANAGER" },
    });
    if (!profile) throw new ManagerServiceError("Invalid activation link", "INVALID", 410);
    if (!profile.invitation_expires_at || profile.invitation_expires_at < new Date()) {
      throw new ManagerServiceError("This activation link has expired", "EXPIRED", 410);
    }
    return profile;
  }
}

export const managerInvitationService = new ManagerInvitationService();
