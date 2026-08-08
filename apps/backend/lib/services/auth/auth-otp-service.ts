import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { incrementOtpMetric } from "@/lib/metrics";
import { maskWhatsAppPhone, normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { notificationService } from "@/lib/services/notification-service";
import { redisKeys } from "@/lib/redis/keys";
import { checkFixedWindowLimit, setOneTimeLock, releaseOneTimeLock } from "@/lib/redis/rate-limit";
import {
  isSkippableOtpPurpose,
  resolvePhoneVerificationMode,
} from "@/lib/services/auth/phone-verification-mode";
import {
  isOtpBreakerOpen,
  recordOtpSendFailure,
  recordOtpSendSuccess,
} from "@/lib/services/auth/otp-provider-breaker";

const logger = getLogger("auth.otp-service");

const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_LENGTH_MIN = 100000;
const OTP_LENGTH_MAX_EXCLUSIVE = 1000000;
const MAX_ATTEMPTS = 5;
const PHONE_SEND_LIMIT = 3;
const PHONE_SEND_WINDOW_MS = 15 * 60 * 1000;
const IP_SEND_LIMIT = 10;
const IP_SEND_WINDOW_MS = 60 * 60 * 1000;
const IP_VERIFY_LIMIT = 30;
const IP_VERIFY_WINDOW_MS = 15 * 60 * 1000;
const SKIPPED_STATUS = "SKIPPED";
const SKIPPED_PROVIDER_STATUS = "UNAVAILABLE";

export type SkipReason = "PROVIDER_NOT_CONFIGURED" | "PROVIDER_UNAVAILABLE" | "PROVIDER_SEND_FAILED";

export class OtpServiceError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "OtpServiceError";
  }
}

type SendOtpInput = {
  phone: string;
  purpose: string;
  requestIp?: string | null;
};

type VerifyOtpInput = {
  phone: string;
  otp: string;
  purpose: string;
  requestIp?: string | null;
};

export class AuthOtpService {
  constructor(private readonly provider = notificationService) {}

  async sendPhoneOtp(input: SendOtpInput): Promise<{
    success: true;
    verification_required: boolean;
    expires_in_seconds?: number;
    reason?: SkipReason;
  }> {
    const phone = normalizeWhatsAppPhone(input.phone);
    const purpose = input.purpose;
    const requestIp = input.requestIp || null;
    const now = new Date();

    // Rate limits first, always — the skip path below must not become an
    // unthrottled way to write rows keyed by an arbitrary phone number.
    await this.enforceSendRateLimits(phone, requestIp, now);
    await (prisma as any).phoneVerificationOtp.updateMany({
      where: { phone, purpose, status: "PENDING" },
      data: { status: "EXPIRED", failure_reason: "superseded by new OTP request" },
    });

    const skipReason = await this.resolveSkipReason(purpose);
    if (skipReason) {
      return this.recordSkippedVerification({ phone, purpose, requestIp, reason: skipReason, now });
    }

    const otp = String(crypto.randomInt(OTP_LENGTH_MIN, OTP_LENGTH_MAX_EXCLUSIVE));
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(now.getTime() + OTP_TTL_MS);

    const record = await (prisma as any).phoneVerificationOtp.create({
      data: {
        phone,
        otp_hash: otpHash,
        purpose,
        status: "PENDING",
        max_attempts: MAX_ATTEMPTS,
        expires_at: expiresAt,
        provider_status: "PENDING",
        request_ip: requestIp,
      },
    });

    incrementOtpMetric("requests_total");

    // The OTP record id is the correlation id for this OTP's whole life:
    // generated → sent → delivered/read (webhook) → verified/expired/failed.
    logger.info("otp.generated", {
      correlation_id: record.id,
      phone: maskWhatsAppPhone(phone),
      purpose,
      expires_at: expiresAt.toISOString(),
      max_attempts: MAX_ATTEMPTS,
    });

    try {
      const sendResult = await this.provider.sendOtp({
        phone,
        otp,
        purpose,
        correlationId: record.id,
      });
      await (prisma as any).phoneVerificationOtp.update({
        where: { id: record.id },
        data: {
          meta_message_id: sendResult.providerMessageId,
          provider_status: "SENT",
          failure_reason: null,
        },
      });
      await recordOtpSendSuccess();

      logger.metrics("otp.request.sent", {
        correlation_id: record.id,
        phone: maskWhatsAppPhone(phone),
        purpose,
        otp_id: record.id,
        meta_message_id: sendResult.providerMessageId,
      });

      return {
        success: true,
        verification_required: true,
        expires_in_seconds: Math.floor(OTP_TTL_MS / 1000),
      };
    } catch (error: any) {
      const message = String(error?.message || error);
      incrementOtpMetric("send_failures");

      if (isSkippableOtpPurpose(purpose)) {
        // The signup flow degrades rather than dead-ends. The user whose
        // request trips the breaker must not be the one who eats the error.
        await recordOtpSendFailure(message);
        const skippedAt = new Date();
        await (prisma as any).phoneVerificationOtp.update({
          where: { id: record.id },
          data: {
            status: SKIPPED_STATUS,
            provider_status: SKIPPED_PROVIDER_STATUS,
            verified_at: skippedAt,
            failure_reason: `whatsapp_unavailable:PROVIDER_SEND_FAILED: ${message}`.slice(0, 500),
          },
        });

        logger.warn("otp.request.skipped", {
          phone: maskWhatsAppPhone(phone),
          purpose,
          otp_id: record.id,
          reason: "PROVIDER_SEND_FAILED",
          error: message,
        });

        return {
          success: true,
          verification_required: false,
          reason: "PROVIDER_SEND_FAILED" as SkipReason,
        };
      }

      await (prisma as any).phoneVerificationOtp.update({
        where: { id: record.id },
        data: {
          status: "FAILED",
          provider_status: "FAILED",
          failure_reason: message.slice(0, 500),
        },
      });

      logger.warn("otp.request.send_failed", {
        phone: maskWhatsAppPhone(phone),
        purpose,
        otp_id: record.id,
        error_code: error?.providerCode || error?.code || "OTP_SEND_FAILED",
        error: message,
      });

      throw new OtpServiceError("Failed to send OTP", "OTP_SEND_FAILED", 502);
    }
  }

  /**
   * Why this request cannot be verified — or null when it can. Only the
   * signup purposes degrade; see phone-verification-mode.ts.
   */
  private async resolveSkipReason(purpose: string): Promise<SkipReason | null> {
    if (!isSkippableOtpPurpose(purpose)) return null;
    if (resolvePhoneVerificationMode() === "off") return "PROVIDER_NOT_CONFIGURED";
    if (await isOtpBreakerOpen()) return "PROVIDER_UNAVAILABLE";
    return null;
  }

  /**
   * Records that signup proceeded without verification. The row is written
   * (rather than omitted) so the downstream signup gates still require the
   * caller to have gone through this endpoint for this exact number, and so
   * the audit trail shows why the number is unverified. `otp_hash` holds a
   * hash of a value that is never sent, and `verifyPhoneOtp` only ever looks
   * at PENDING rows — this row can never be verified.
   */
  private async recordSkippedVerification(params: {
    phone: string;
    purpose: string;
    requestIp: string | null;
    reason: SkipReason;
    now: Date;
  }) {
    const { phone, purpose, requestIp, reason, now } = params;
    const unusableHash = await bcrypt.hash(crypto.randomUUID(), 10);

    const record = await (prisma as any).phoneVerificationOtp.create({
      data: {
        phone,
        otp_hash: unusableHash,
        purpose,
        status: SKIPPED_STATUS,
        max_attempts: MAX_ATTEMPTS,
        expires_at: new Date(now.getTime() + OTP_TTL_MS),
        verified_at: now,
        provider_status: SKIPPED_PROVIDER_STATUS,
        failure_reason: `whatsapp_unavailable:${reason}`,
        request_ip: requestIp,
      },
    });

    incrementOtpMetric("requests_total");
    logger.metrics("otp.request.skipped", {
      phone: maskWhatsAppPhone(phone),
      purpose,
      otp_id: record.id,
      reason,
    });

    return { success: true, verification_required: false, reason };
  }

  async verifyPhoneOtp(input: VerifyOtpInput) {
    const phone = normalizeWhatsAppPhone(input.phone);
    const requestIp = input.requestIp || null;
    const now = new Date();

    await this.enforceVerifyRateLimits(requestIp, now);

    incrementOtpMetric("verifications_total");
    const lockKey = redisKeys.otpVerifyLock(phone, input.purpose);
    const lockAcquired = await setOneTimeLock(lockKey, 30);
    if (!lockAcquired) {
      incrementOtpMetric("verification_failures");
      throw new OtpServiceError("OTP verification already in progress", "OTP_REPLAY_BLOCKED", 409);
    }

    try {
      const record = await (prisma as any).phoneVerificationOtp.findFirst({
        where: {
          phone,
          purpose: input.purpose,
          status: "PENDING",
        },
        orderBy: { created_at: "desc" },
      });

      if (!record) {
        incrementOtpMetric("verification_failures");
        throw new OtpServiceError("Invalid or expired OTP", "OTP_INVALID", 400);
      }

      if (record.expires_at <= now) {
        incrementOtpMetric("expired_total");
        incrementOtpMetric("verification_failures");
        await (prisma as any).phoneVerificationOtp.update({
          where: { id: record.id },
          data: { status: "EXPIRED", failure_reason: "expired before verification" },
        });
        logger.info("otp.expired", {
          correlation_id: record.id,
          phone: maskWhatsAppPhone(phone),
          purpose: input.purpose,
          expired_at: record.expires_at.toISOString(),
          age_ms: now.getTime() - new Date(record.created_at).getTime(),
        });
        throw new OtpServiceError("OTP expired", "OTP_EXPIRED", 400);
      }

      if (record.attempts >= record.max_attempts) {
        incrementOtpMetric("verification_failures");
        await (prisma as any).phoneVerificationOtp.update({
          where: { id: record.id },
          data: { status: "FAILED", failure_reason: "maximum attempts exceeded" },
        });
        logger.warn("otp.invalid_attempt", {
          correlation_id: record.id,
          phone: maskWhatsAppPhone(phone),
          purpose: input.purpose,
          reason: "MAX_ATTEMPTS_EXCEEDED",
          attempts: record.attempts,
          max_attempts: record.max_attempts,
        });
        throw new OtpServiceError("OTP attempts exceeded", "OTP_ATTEMPTS_EXCEEDED", 429);
      }

      const matches = await bcrypt.compare(input.otp, record.otp_hash);
      if (!matches) {
        incrementOtpMetric("verification_failures");
        const nextAttempts = record.attempts + 1;
        await (prisma as any).phoneVerificationOtp.update({
          where: { id: record.id },
          data: {
            attempts: nextAttempts,
            ...(nextAttempts >= record.max_attempts
              ? { status: "FAILED", failure_reason: "maximum attempts exceeded" }
              : {}),
          },
        });
        logger.warn("otp.invalid_attempt", {
          correlation_id: record.id,
          phone: maskWhatsAppPhone(phone),
          purpose: input.purpose,
          reason: "CODE_MISMATCH",
          attempts: nextAttempts,
          max_attempts: record.max_attempts,
          locked: nextAttempts >= record.max_attempts,
        });
        throw new OtpServiceError("Invalid OTP", "OTP_INVALID", 400);
      }

      const profilePhones = profilePhoneCandidates(phone);
      const result = await prisma.$transaction(async (tx: any) => {
        const verified = await (tx as any).phoneVerificationOtp.updateMany({
          where: { id: record.id, status: "PENDING" },
          data: {
            status: "VERIFIED",
            verified_at: now,
            provider_status: "VERIFIED",
          },
        });

        if (verified.count !== 1) {
          throw new OtpServiceError("OTP already used", "OTP_ALREADY_USED", 409);
        }

        const profileUpdate = await (tx.profile as any).updateMany({
          where: { phone: { in: profilePhones } },
          data: {
            phone_verified: true,
            mobile_verified: true,
            updated_at: now,
          },
        });

        return { profileUpdated: profileUpdate.count };
      });

      logger.info("otp.verified", {
        correlation_id: record.id,
        phone: maskWhatsAppPhone(phone),
        purpose: input.purpose,
        attempts: record.attempts + 1,
        time_to_verify_ms: now.getTime() - new Date(record.created_at).getTime(),
      });

      logger.metrics("otp.verification.success", {
        correlation_id: record.id,
        phone: maskWhatsAppPhone(phone),
        purpose: input.purpose,
        otp_id: record.id,
        profile_updated: result.profileUpdated,
      });

      return {
        success: true,
        phone_verified: true,
        profile_updated: result.profileUpdated,
      };
    } finally {
      await releaseOneTimeLock(lockKey);
    }
  }

  private async enforceSendRateLimits(phone: string, requestIp: string | null, now: Date) {
    const redisPhoneLimit = await checkFixedWindowLimit({
      scope: "otp:phone",
      identifier: phone,
      maxAttempts: PHONE_SEND_LIMIT,
      windowSeconds: PHONE_SEND_WINDOW_MS / 1000,
    });

    if (redisPhoneLimit.available) {
      if (!redisPhoneLimit.allowed) {
        incrementOtpMetric("rate_limit_hits");
        logger.warn("otp.rate_limited", {
          scope: "phone",
          phone: maskWhatsAppPhone(phone),
          source: "redis",
        });
        const retryAfter = redisPhoneLimit.retryAfterSeconds;
        const timeMessage = retryAfter > 60
          ? `${Math.ceil(retryAfter / 60)} minutes`
          : `${retryAfter} seconds`;
        throw new OtpServiceError(
          `Too many OTP requests. Please try again after ${timeMessage}.`,
          "OTP_RATE_LIMITED",
          429
        );
      }

      if (requestIp) {
        const redisIpLimit = await checkFixedWindowLimit({
          scope: "otp:ip",
          identifier: requestIp,
          maxAttempts: IP_SEND_LIMIT,
          windowSeconds: IP_SEND_WINDOW_MS / 1000,
        });
        if (redisIpLimit.available && !redisIpLimit.allowed) {
          incrementOtpMetric("rate_limit_hits");
          logger.warn("otp.rate_limited", {
            scope: "ip",
            request_ip: requestIp,
            source: "redis",
          });
          const retryAfter = redisIpLimit.retryAfterSeconds;
          const timeMessage = retryAfter > 60
            ? `${Math.ceil(retryAfter / 60)} minutes`
            : `${retryAfter} seconds`;
          throw new OtpServiceError(
            `Too many OTP requests from this IP. Please try again after ${timeMessage}.`,
            "OTP_RATE_LIMITED",
            429
          );
        }
        if (redisIpLimit.available) return;
      } else {
        return;
      }
    } else {
      logger.warn("redis.rate_limit_unavailable", {
        flow: "otp",
        fallback: "database",
      });
    }

    const phoneWindow = new Date(now.getTime() - PHONE_SEND_WINDOW_MS);
    const phoneCount = await (prisma as any).phoneVerificationOtp.count({
      where: { phone, created_at: { gte: phoneWindow } },
    });

    if (phoneCount >= PHONE_SEND_LIMIT) {
      incrementOtpMetric("rate_limit_hits");
      logger.warn("otp.rate_limited", {
        scope: "phone",
        phone: maskWhatsAppPhone(phone),
      });

      const oldestOtp = await (prisma as any).phoneVerificationOtp.findFirst({
        where: { phone, created_at: { gte: phoneWindow } },
        orderBy: { created_at: "asc" },
      });
      let timeMessage = "15 minutes";
      if (oldestOtp) {
        const msPassed = now.getTime() - oldestOtp.created_at.getTime();
        const msRemaining = PHONE_SEND_WINDOW_MS - msPassed;
        const secondsRemaining = Math.max(1, Math.ceil(msRemaining / 1000));
        timeMessage = secondsRemaining > 60
          ? `${Math.ceil(secondsRemaining / 60)} minutes`
          : `${secondsRemaining} seconds`;
      }

      throw new OtpServiceError(
        `Too many OTP requests. Please try again after ${timeMessage}.`,
        "OTP_RATE_LIMITED",
        429
      );
    }

    if (requestIp) {
      const ipWindow = new Date(now.getTime() - IP_SEND_WINDOW_MS);
      const ipCount = await (prisma as any).phoneVerificationOtp.count({
        where: { request_ip: requestIp, created_at: { gte: ipWindow } },
      });

      if (ipCount >= IP_SEND_LIMIT) {
        incrementOtpMetric("rate_limit_hits");
        logger.warn("otp.rate_limited", {
          scope: "ip",
          request_ip: requestIp,
        });

        const oldestOtp = await (prisma as any).phoneVerificationOtp.findFirst({
          where: { request_ip: requestIp, created_at: { gte: ipWindow } },
          orderBy: { created_at: "asc" },
        });
        let timeMessage = "1 hour";
        if (oldestOtp) {
          const msPassed = now.getTime() - oldestOtp.created_at.getTime();
          const msRemaining = IP_SEND_WINDOW_MS - msPassed;
          const secondsRemaining = Math.max(1, Math.ceil(msRemaining / 1000));
          timeMessage = secondsRemaining > 60
            ? `${Math.ceil(secondsRemaining / 60)} minutes`
            : `${secondsRemaining} seconds`;
        }

        throw new OtpServiceError(
          `Too many OTP requests from this IP. Please try again after ${timeMessage}.`,
          "OTP_RATE_LIMITED",
          429
        );
      }
    }
  }

  private async enforceVerifyRateLimits(requestIp: string | null, now: Date) {
    if (!requestIp) return;

    const redisIpLimit = await checkFixedWindowLimit({
      scope: "otp:verify:ip",
      identifier: requestIp,
      maxAttempts: IP_VERIFY_LIMIT,
      windowSeconds: IP_VERIFY_WINDOW_MS / 1000,
    });

    if (redisIpLimit.available) {
      if (!redisIpLimit.allowed) {
        incrementOtpMetric("rate_limit_hits");
        logger.warn("otp.verify.rate_limited", {
          scope: "ip",
          request_ip: requestIp,
          source: "redis",
        });
        throw new OtpServiceError("Too many verification attempts from this IP", "OTP_RATE_LIMITED", 429);
      }
      return;
    } else {
      logger.warn("redis.rate_limit_unavailable", {
        flow: "otp_verify",
        fallback: "database",
      });
    }

    const ipWindow = new Date(now.getTime() - IP_VERIFY_WINDOW_MS);
    const ipCount = await (prisma as any).phoneVerificationOtp.count({
      where: { request_ip: requestIp, created_at: { gte: ipWindow } },
    });

    if (ipCount >= IP_VERIFY_LIMIT) {
      incrementOtpMetric("rate_limit_hits");
      logger.warn("otp.verify.rate_limited", {
        scope: "ip",
        request_ip: requestIp,
        source: "database",
      });
      throw new OtpServiceError("Too many verification attempts from this IP", "OTP_RATE_LIMITED", 429);
    }
  }
}

/**
 * Every shape the same number may have been stored in on `profiles.phone`
 * (bare, `+`-prefixed, 10-digit local, `+91`-prefixed). Exported so the
 * password-reset lookup matches numbers exactly the way OTP verification
 * does — two different notions of "same phone number" would mean a reset
 * that sends a code but then cannot find the account.
 */
export function profilePhoneCandidates(normalizedPhone: string) {
  const local10 = normalizedPhone.startsWith("91") && normalizedPhone.length === 12
    ? normalizedPhone.slice(2)
    : normalizedPhone;

  return Array.from(new Set([
    normalizedPhone,
    `+${normalizedPhone}`,
    local10,
    `+91${local10}`,
  ]));
}

export const authOtpService = new AuthOtpService();
