import { randomUUID } from "crypto";
import { prisma } from "../db";
import { getLogger } from "../logger";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";

const logger = getLogger("rate-limit-service");

export interface RateLimitConfig {
  maxAttempts: number;
  windowMinutes: number;
  lockoutMinutes?: number;
}

export interface RateLimitResult {
  allowed: boolean;
  attemptsRemaining?: number;
  retryAfterSeconds?: number;
  lockoutUntil?: Date;
}

const DEFAULT_CONFIGS: Record<string, RateLimitConfig> = {
  ONBOARDING_LOGIN: {
    maxAttempts: 5,
    windowMinutes: 15,
    lockoutMinutes: 30,
  },
  REGULAR_LOGIN: {
    maxAttempts: 10,
    windowMinutes: 15,
    lockoutMinutes: 60,
  },
  PHONE_IDENTIFIER: {
    maxAttempts: 8,
    windowMinutes: 30,
  },
  IP_ADDRESS: {
    maxAttempts: 20,
    windowMinutes: 15,
  },
};

export class RateLimitService {
  async checkRateLimit(
    identifier: string,
    attemptType: "ONBOARDING" | "REGULAR",
    ipAddress?: string
  ): Promise<RateLimitResult> {
    const config = DEFAULT_CONFIGS[`${attemptType}_LOGIN`];
    const redisResult = await this.checkRedisLoginLimit(identifier, attemptType, ipAddress, config);
    if (redisResult) return redisResult;

    return this.checkDatabaseRateLimit(identifier, attemptType, ipAddress, config);
  }

  private async checkRedisLoginLimit(
    identifier: string,
    attemptType: "ONBOARDING" | "REGULAR",
    ipAddress: string | undefined,
    config: RateLimitConfig,
  ): Promise<RateLimitResult | null> {
    const identifierLimit = await checkFixedWindowLimit({
      scope: `login:${attemptType.toLowerCase()}:identifier`,
      identifier,
      maxAttempts: config.maxAttempts,
      windowSeconds: config.windowMinutes * 60,
    });

    if (!identifierLimit.available) {
      logger.warn("redis.rate_limit_unavailable", {
        flow: "login",
        attemptType,
        fallback: "database",
      });
      return null;
    }

    if (!identifierLimit.allowed) {
      const lockoutMinutes = config.lockoutMinutes || config.windowMinutes;
      logger.warn(`Rate limit exceeded for identifier: ${identifier}`, {
        identifier,
        attemptType,
        attempts: identifierLimit.attempts,
        maxAttempts: config.maxAttempts,
        source: "redis",
      });

      return {
        allowed: false,
        attemptsRemaining: 0,
        retryAfterSeconds: identifierLimit.retryAfterSeconds || lockoutMinutes * 60,
        lockoutUntil: new Date(Date.now() + (identifierLimit.retryAfterSeconds || lockoutMinutes * 60) * 1000),
      };
    }

    if (ipAddress) {
      const ipConfig = DEFAULT_CONFIGS.IP_ADDRESS;
      const ipLimit = await checkFixedWindowLimit({
        scope: "login:ip",
        identifier: ipAddress,
        maxAttempts: ipConfig.maxAttempts,
        windowSeconds: ipConfig.windowMinutes * 60,
      });

      if (!ipLimit.available) return null;
      if (!ipLimit.allowed) {
        logger.warn(`IP rate limit exceeded: ${ipAddress}`, {
          ipAddress,
          attempts: ipLimit.attempts,
          maxAttempts: ipConfig.maxAttempts,
          source: "redis",
        });
        return {
          allowed: false,
          attemptsRemaining: 0,
          retryAfterSeconds: ipLimit.retryAfterSeconds,
        };
      }
    }

    return {
      allowed: true,
      attemptsRemaining: identifierLimit.attemptsRemaining,
    };
  }

  private async checkDatabaseRateLimit(
    identifier: string,
    attemptType: "ONBOARDING" | "REGULAR",
    ipAddress: string | undefined,
    config: RateLimitConfig,
  ): Promise<RateLimitResult> {
    const windowStart = new Date(Date.now() - config.windowMinutes * 60 * 1000);

    const identifierAttempts = await prisma.login_attempts.count({
      where: {
        identifier,
        attempt_type: attemptType,
        created_at: { gte: windowStart },
      },
    });

    if (identifierAttempts >= config.maxAttempts) {
      const lockoutMinutes = config.lockoutMinutes || 30;
      const lockoutUntil = new Date(Date.now() + lockoutMinutes * 60 * 1000);
      
      logger.warn(`Rate limit exceeded for identifier: ${identifier}`, {
        identifier,
        attemptType,
        attempts: identifierAttempts,
        maxAttempts: config.maxAttempts,
      });

      return {
        allowed: false,
        attemptsRemaining: 0,
        retryAfterSeconds: lockoutMinutes * 60,
        lockoutUntil,
      };
    }

    if (ipAddress) {
      const ipConfig = DEFAULT_CONFIGS.IP_ADDRESS;
      const ipWindowStart = new Date(Date.now() - ipConfig.windowMinutes * 60 * 1000);
      
      const ipAttempts = await prisma.login_attempts.count({
        where: {
          ip_address: ipAddress,
          created_at: { gte: ipWindowStart },
        },
      });

      if (ipAttempts >= ipConfig.maxAttempts) {
        logger.warn(`IP rate limit exceeded: ${ipAddress}`, {
          ipAddress,
          attempts: ipAttempts,
          maxAttempts: ipConfig.maxAttempts,
        });

        return {
          allowed: false,
          attemptsRemaining: 0,
          retryAfterSeconds: ipConfig.windowMinutes * 60,
        };
      }
    }

    const remaining = config.maxAttempts - identifierAttempts;
    return {
      allowed: true,
      attemptsRemaining: remaining,
    };
  }

  async checkStatelessLimit(params: {
    scope: string;
    identifier: string;
    maxAttempts: number;
    windowSeconds: number;
    failOpen?: boolean;
  }): Promise<RateLimitResult> {
    const result = await checkFixedWindowLimit(params);
    if (!result.available) {
      logger.warn("redis.rate_limit_unavailable", {
        flow: params.scope,
        fallback: params.failOpen === false ? "closed" : "open",
      });
      return {
        allowed: params.failOpen === false ? false : true,
        attemptsRemaining: params.maxAttempts,
        retryAfterSeconds: params.windowSeconds,
      };
    }
    return {
      allowed: result.allowed,
      attemptsRemaining: result.attemptsRemaining,
      retryAfterSeconds: result.retryAfterSeconds,
    };
  }

  async recordAttempt(
    identifier: string,
    attemptType: "ONBOARDING" | "REGULAR",
    success: boolean,
    ipAddress?: string,
    userAgent?: string,
    failureReason?: string
  ): Promise<void> {
    try {
      await prisma.login_attempts.create({
        data: {
          id: randomUUID(),
          identifier,
          attempt_type: attemptType,
          success,
          ip_address: ipAddress,
          user_agent: userAgent,
          failure_reason: failureReason,
        },
      });

      if (success) {
        logger.info(`Successful ${attemptType} login`, { identifier });
      } else {
        logger.warn(`Failed ${attemptType} login attempt`, {
          identifier,
          failureReason,
          ipAddress,
        });
      }
    } catch (error) {
      logger.error("Failed to record login attempt", {
        error: String(error),
        identifier,
        attemptType,
      });
    }
  }

  async cleanupOldAttempts(daysToKeep: number = 30): Promise<number> {
    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);
    
    try {
      const result = await prisma.login_attempts.deleteMany({
        where: {
          created_at: { lt: cutoffDate },
        },
      });

      logger.info(`Cleaned up ${result.count} old login attempts older than ${daysToKeep} days`);
      return result.count;
    } catch (error) {
      logger.error("Failed to cleanup old login attempts", { error: String(error) });
      return 0;
    }
  }

  async getRecentFailedAttempts(
    identifier: string,
    hoursBack: number = 24
  ): Promise<number> {
    const windowStart = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
    
    return await prisma.login_attempts.count({
      where: {
        identifier,
        success: false,
        created_at: { gte: windowStart },
      },
    });
  }
}

export const rateLimitService = new RateLimitService();
