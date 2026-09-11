import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { EmailService } from "@/lib/services/email-service";
import { checkFixedWindowLimit, releaseOneTimeLock, setOneTimeLock } from "@/lib/redis/rate-limit";
import { redisKeys } from "@/lib/redis/keys";
import { OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { isPlaceholderEmail } from "@/src/services/tenants/invited-profile-resolver";

/**
 * Proving an email address during tenant onboarding.
 *
 * A tenant invited by phone alone used to finish onboarding with
 * `<phone>@hms.temp` as their account email — a stand-in for the NOT NULL
 * `profiles.email` column, which then became their login and was shown to
 * their owner as though it were an address. Onboarding now asks for a real
 * one and proves it with a code, the way the mobile number is proved.
 *
 * The shape mirrors `AuthOtpService` (phone): a hashed six-digit code, five
 * attempts, a short expiry, Redis rate limits with a database fallback. Two
 * differences, both deliberate:
 *
 * - **Verification is its own step**, separate from submitting the Identity
 *   screen. The tenant sees "confirmed" before moving on, and a retried
 *   submission does not burn a code that was already right.
 * - **A code is bound to one invitation.** It proves an address *for this
 *   onboarding*; the ACCOUNT step accepts only a verification for its own
 *   invitation, and marks it CONSUMED when the address is written.
 */

const logger = getLogger("services.auth.email-otp");

export const EMAIL_OTP_TTL_MINUTES = 10;
const OTP_TTL_MS = EMAIL_OTP_TTL_MINUTES * 60 * 1000;
const MAX_ATTEMPTS = 5;
/** How long a verified address stays usable before the ACCOUNT step must be re-proved. */
const VERIFIED_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Shown by the screen as "Resend in 0:45". */
export const EMAIL_OTP_RESEND_SECONDS = 45;

const EMAIL_SEND_LIMIT = 3;
const EMAIL_SEND_WINDOW_MS = 15 * 60 * 1000;
const INVITATION_SEND_LIMIT = 6;
const INVITATION_SEND_WINDOW_MS = 60 * 60 * 1000;
const IP_SEND_LIMIT = 10;
const IP_SEND_WINDOW_MS = 60 * 60 * 1000;

export const EMAIL_OTP_PURPOSE = "TENANT_ONBOARDING";

/** Lowercased and trimmed, or null when it isn't an address someone can receive mail at. */
export function normalizeOnboardingEmail(raw: unknown): string | null {
  const email = String(raw ?? "").trim().toLowerCase();
  if (!email || email.length > 254) return null;
  // Deliberately plain: one @, something either side, a dot in the domain.
  // The code arriving is the real test of an address.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  if (isPlaceholderEmail(email)) return null;
  return email;
}

function minutesOrSeconds(seconds: number): string {
  return seconds > 60 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
}

export class EmailOtpService {
  /**
   * Emails a fresh code for this invitation and address.
   *
   * Refuses, before sending anything, an address that is already another
   * account's login: the owner decided a taken address is answered with "use a
   * different one", never by quietly attaching this tenancy to that account.
   */
  async sendCode(input: {
    invitationId: string;
    email: unknown;
    /** The profile this onboarding may already be bound to — its own address is not "taken". */
    ownProfileId?: string | null;
    tenantName?: string | null;
    hostelName?: string | null;
    requestIp?: string | null;
  }): Promise<{ email: string; expires_in_seconds: number; resend_after_seconds: number }> {
    const email = normalizeOnboardingEmail(input.email);
    if (!email) {
      throw new OtpServiceError("Enter a valid email address", "EMAIL_INVALID", 400);
    }

    await this.assertAvailable(email, input.ownProfileId ?? null);
    const now = new Date();
    await this.enforceSendLimits({ email, invitationId: input.invitationId, requestIp: input.requestIp ?? null, now });

    // Only the newest code works. An older one still in someone's inbox must
    // not verify an address after a newer one was asked for.
    await (prisma as any).emailVerificationOtp.updateMany({
      where: { invitation_id: input.invitationId, status: "PENDING" },
      data: { status: "EXPIRED", failure_reason: "SUPERSEDED" },
    });

    const code = String(crypto.randomInt(100000, 1000000));
    const record = await (prisma as any).emailVerificationOtp.create({
      data: {
        invitation_id: input.invitationId,
        email,
        otp_hash: await bcrypt.hash(code, 10),
        purpose: EMAIL_OTP_PURPOSE,
        status: "PENDING",
        max_attempts: MAX_ATTEMPTS,
        expires_at: new Date(now.getTime() + OTP_TTL_MS),
        request_ip: input.requestIp ?? null,
      },
    });

    const delivery = await EmailService.sendVerificationCode({
      toEmail: email,
      code,
      tenantName: input.tenantName,
      hostelName: input.hostelName,
      expiresInMinutes: EMAIL_OTP_TTL_MINUTES,
    });

    if (!delivery?.sent) {
      // Not a success with a code nobody will receive — the same mistake the
      // invitation flow made with WhatsApp.
      await (prisma as any).emailVerificationOtp.update({
        where: { id: record.id },
        data: { status: "FAILED", failure_reason: String(delivery?.error || "SEND_FAILED").slice(0, 200) },
      });
      logger.warn("email_otp.send_failed", { otp_id: record.id, error: delivery?.error });
      throw new OtpServiceError(
        "We couldn't send a code to that email. Check the address, or try again in a moment.",
        "EMAIL_SEND_FAILED",
        502
      );
    }

    logger.info("email_otp.sent", { otp_id: record.id, invitation_id: input.invitationId });
    return { email, expires_in_seconds: OTP_TTL_MS / 1000, resend_after_seconds: EMAIL_OTP_RESEND_SECONDS };
  }

  /** Checks a code. Right → VERIFIED; wrong → one attempt fewer, then locked. */
  async verifyCode(input: { invitationId: string; email: unknown; code: unknown }): Promise<{ email: string }> {
    const email = normalizeOnboardingEmail(input.email);
    const code = String(input.code ?? "").replace(/\s+/g, "");
    if (!email) throw new OtpServiceError("Enter a valid email address", "EMAIL_INVALID", 400);
    if (!/^\d{6}$/.test(code)) throw new OtpServiceError("Enter the 6-digit code from the email", "OTP_INVALID", 400);

    // Two taps on Verify must not both count, or race past the attempt limit.
    const lockKey = redisKeys.otpVerifyLock(`email:${input.invitationId}:${email}`, EMAIL_OTP_PURPOSE);
    const locked = await setOneTimeLock(lockKey, 10);
    if (locked === false) {
      throw new OtpServiceError("Already checking that code — one moment", "OTP_VERIFY_IN_PROGRESS", 409);
    }

    try {
      const record = await (prisma as any).emailVerificationOtp.findFirst({
        where: { invitation_id: input.invitationId, email, status: "PENDING" },
        orderBy: { created_at: "desc" },
      });
      if (!record) {
        throw new OtpServiceError("That code isn't active any more — ask for a new one", "OTP_NOT_FOUND", 400);
      }

      const now = new Date();
      if (new Date(record.expires_at) <= now) {
        await (prisma as any).emailVerificationOtp.update({ where: { id: record.id }, data: { status: "EXPIRED" } });
        throw new OtpServiceError("That code has expired — ask for a new one", "OTP_EXPIRED", 400);
      }
      if (record.attempts >= record.max_attempts) {
        await (prisma as any).emailVerificationOtp.update({ where: { id: record.id }, data: { status: "LOCKED" } });
        throw new OtpServiceError("Too many wrong codes — ask for a new one", "OTP_LOCKED", 429);
      }

      const matches = await bcrypt.compare(code, record.otp_hash);
      if (!matches) {
        const attempts = record.attempts + 1;
        const exhausted = attempts >= record.max_attempts;
        await (prisma as any).emailVerificationOtp.update({
          where: { id: record.id },
          data: { attempts, ...(exhausted ? { status: "LOCKED" } : {}) },
        });
        const left = record.max_attempts - attempts;
        throw new OtpServiceError(
          exhausted
            ? "Too many wrong codes — ask for a new one"
            : `That code isn't right. ${left} ${left === 1 ? "try" : "tries"} left.`,
          exhausted ? "OTP_LOCKED" : "OTP_INVALID",
          400
        );
      }

      const claimed = await (prisma as any).emailVerificationOtp.updateMany({
        where: { id: record.id, status: "PENDING" },
        data: { status: "VERIFIED", verified_at: now, attempts: record.attempts + 1 },
      });
      if (claimed.count !== 1) {
        throw new OtpServiceError("That code was already used", "OTP_ALREADY_USED", 409);
      }

      logger.info("email_otp.verified", { otp_id: record.id, invitation_id: input.invitationId });
      return { email };
    } finally {
      await releaseOneTimeLock(lockKey);
    }
  }

  /**
   * The verification the ACCOUNT step may use: verified for this invitation
   * and this address, recently, and not yet written onto an account.
   */
  async findVerified(input: { invitationId: string; email: unknown }): Promise<{ id: string; email: string } | null> {
    const email = normalizeOnboardingEmail(input.email);
    if (!email) return null;
    const record = await (prisma as any).emailVerificationOtp.findFirst({
      where: {
        invitation_id: input.invitationId,
        email,
        status: "VERIFIED",
        verified_at: { gte: new Date(Date.now() - VERIFIED_WINDOW_MS) },
      },
      orderBy: { verified_at: "desc" },
      select: { id: true, email: true },
    });
    return record ?? null;
  }

  /** The address this invitation most recently verified, for the screen after a reload. */
  async latestVerifiedEmail(invitationId: string): Promise<string | null> {
    const record = await (prisma as any).emailVerificationOtp.findFirst({
      where: {
        invitation_id: invitationId,
        status: "VERIFIED",
        verified_at: { gte: new Date(Date.now() - VERIFIED_WINDOW_MS) },
      },
      orderBy: { verified_at: "desc" },
      select: { email: true },
    });
    return record?.email ?? null;
  }

  /** Marks a verification spent, once its address is on the account. Idempotent. */
  async consume(verificationId: string, client: any = prisma): Promise<void> {
    await client.emailVerificationOtp.updateMany({
      where: { id: verificationId, status: "VERIFIED" },
      data: { status: "CONSUMED", consumed_at: new Date() },
    });
  }

  /** Whether another account already signs in with this address. */
  async assertAvailable(email: string, ownProfileId: string | null): Promise<void> {
    const holder = await prisma.profile.findUnique({ where: { email }, select: { id: true } });
    if (holder && holder.id !== ownProfileId) {
      throw new OtpServiceError(
        "That email already has a Stayo account. Use a different email.",
        "EMAIL_TAKEN",
        409
      );
    }
  }

  private async enforceSendLimits(input: {
    email: string;
    invitationId: string;
    requestIp: string | null;
    now: Date;
  }): Promise<void> {
    const limits = [
      { scope: "email-otp:email", identifier: input.email, max: EMAIL_SEND_LIMIT, windowMs: EMAIL_SEND_WINDOW_MS },
      { scope: "email-otp:invitation", identifier: input.invitationId, max: INVITATION_SEND_LIMIT, windowMs: INVITATION_SEND_WINDOW_MS },
      ...(input.requestIp
        ? [{ scope: "email-otp:ip", identifier: input.requestIp, max: IP_SEND_LIMIT, windowMs: IP_SEND_WINDOW_MS }]
        : []),
    ];

    let redisAvailable = true;
    for (const limit of limits) {
      const result = await checkFixedWindowLimit({
        scope: limit.scope,
        identifier: limit.identifier,
        maxAttempts: limit.max,
        windowSeconds: limit.windowMs / 1000,
      });
      if (!result.available) {
        redisAvailable = false;
        break;
      }
      if (!result.allowed) {
        throw new OtpServiceError(
          `Too many codes asked for. Try again in ${minutesOrSeconds(result.retryAfterSeconds)}.`,
          "OTP_RATE_LIMITED",
          429
        );
      }
    }
    if (redisAvailable) return;

    // Redis down: count from the table instead, as the phone flow does.
    logger.warn("redis.rate_limit_unavailable", { flow: "email-otp", fallback: "database" });
    const [byEmail, byInvitation] = await Promise.all([
      (prisma as any).emailVerificationOtp.count({
        where: { email: input.email, created_at: { gte: new Date(input.now.getTime() - EMAIL_SEND_WINDOW_MS) } },
      }),
      (prisma as any).emailVerificationOtp.count({
        where: {
          invitation_id: input.invitationId,
          created_at: { gte: new Date(input.now.getTime() - INVITATION_SEND_WINDOW_MS) },
        },
      }),
    ]);
    if (byEmail >= EMAIL_SEND_LIMIT || byInvitation >= INVITATION_SEND_LIMIT) {
      throw new OtpServiceError("Too many codes asked for. Try again in a few minutes.", "OTP_RATE_LIMITED", 429);
    }
  }
}

export const emailOtpService = new EmailOtpService();
