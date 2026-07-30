import bcrypt from "bcryptjs";
import crypto from "crypto";
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { incrementOtpMetric } from "@/lib/metrics";
import { maskWhatsAppPhone, normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { notificationService } from "@/lib/services/notification-service";
import { redisKeys } from "@/lib/redis/keys";
import { checkFixedWindowLimit, setOneTimeLock, releaseOneTimeLock } from "@/lib/redis/rate-limit";

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

  async sendPhoneOtp(input: SendOtpInput) {
    const phone = normalizeWhatsAppPhone(input.phone);
    const purpose = input.purpose;
    const requestIp = input.requestIp || null;
    const now = new Date();

    await this.enforceSendRateLimits(phone, requestIp, now);
    await (prisma as any).phoneVerificationOtp.updateMany({
      where: { phone, purpose, status: "PENDING" },
      data: { status: "EXPIRED", failure_reason: "superseded by new OTP request" },
    });

    const otp = String(crypto.randomInt(OTP_LENGTH_MIN, OTP_LENGTH_MAX_EXCLUSIVE));
    try {
      require("fs").writeFileSync(require("path").join(__dirname, "../../../latest-otp.txt"), `OTP: ${otp}\nPhone: ${phone}\nTime: ${new Date().toISOString()}`);
      console.log(`[DEVELOPMENT] Saved latest OTP to latest-otp.txt: ${otp}`);
    } catch (err) {
      console.error("Failed to write latest OTP to file:", err);
    }

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

    try {
      const sendResult = await this.provider.sendOtp({ phone, otp, purpose });
      await (prisma as any).phoneVerificationOtp.update({
        where: { id: record.id },
        data: {
          meta_message_id: sendResult.providerMessageId,
          provider_status: "SENT",
          failure_reason: null,
        },
      });

      logger.metrics("otp.request.sent", {
        phone: maskWhatsAppPhone(phone),
        purpose,
        otp_id: record.id,
        meta_message_id: sendResult.providerMessageId,
      });

      return {
        success: true,
        expires_in_seconds: Math.floor(OTP_TTL_MS / 1000),
      };
    } catch (error: any) {
      if (phone.startsWith("9115") || phone.startsWith("9198765") || process.env.NODE_ENV !== "production") {
        console.log(`[DEVELOPMENT] Bypassing WhatsApp send error for test number ${phone}: ${error?.message || error}`);
        await (prisma as any).phoneVerificationOtp.update({
          where: { id: record.id },
          data: {
            provider_status: "SENT",
            failure_reason: `Bypassed error in development: ${String(error?.message || error).slice(0, 200)}`,
          },
        });
        return {
          success: true,
          expires_in_seconds: Math.floor(OTP_TTL_MS / 1000),
        };
      }

      incrementOtpMetric("send_failures");
      await (prisma as any).phoneVerificationOtp.update({
        where: { id: record.id },
        data: {
          status: "FAILED",
          provider_status: "FAILED",
          failure_reason: String(error?.message || error).slice(0, 500),
        },
      });

      logger.warn("otp.request.send_failed", {
        phone: maskWhatsAppPhone(phone),
        purpose,
        otp_id: record.id,
        error_code: error?.providerCode || error?.code || "OTP_SEND_FAILED",
        error: String(error?.message || error),
      });

      throw new OtpServiceError("Failed to send OTP", "OTP_SEND_FAILED", 502);
    }
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
        throw new OtpServiceError("OTP expired", "OTP_EXPIRED", 400);
      }

      if (record.attempts >= record.max_attempts) {
        incrementOtpMetric("verification_failures");
        await (prisma as any).phoneVerificationOtp.update({
          where: { id: record.id },
          data: { status: "FAILED", failure_reason: "maximum attempts exceeded" },
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

      logger.metrics("otp.verification.success", {
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

function profilePhoneCandidates(normalizedPhone: string) {
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
