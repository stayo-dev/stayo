import { describe, expect, it, vi, beforeEach } from "vitest";
import { authOtpService, OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { prisma } from "@/lib/db";
import { notificationService } from "@/lib/services/notification-service";
import { __resetOtpBreakerForTests } from "@/lib/services/auth/otp-provider-breaker";

vi.mock("@/lib/db", () => {
  const mockPrisma = {
    phoneVerificationOtp: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    profile: { updateMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { prisma: mockPrisma, supabase: {} };
});

vi.mock("@/lib/services/notification-service", () => ({
  notificationService: { sendOtp: vi.fn() },
}));

vi.mock("bcryptjs", () => ({
  default: { hash: vi.fn().mockResolvedValue("mock_hash"), compare: vi.fn() },
}));

vi.mock("@/lib/redis/rate-limit", () => ({
  checkFixedWindowLimit: vi.fn().mockResolvedValue({
    available: true,
    allowed: true,
    attempts: 0,
    attemptsRemaining: 3,
    retryAfterSeconds: 60,
  }),
  setOneTimeLock: vi.fn().mockResolvedValue(true),
  releaseOneTimeLock: vi.fn().mockResolvedValue(true),
}));

vi.mock("@/lib/redis/client", () => ({
  safeRedis: vi.fn(async (_op: string, _fn: unknown, fallback: unknown) => fallback),
  getRedisClient: () => null,
  isRedisConfigured: () => false,
}));

const CREDENTIAL_VARS = [
  "OTP_PROVIDER",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "PHONE_NUMBER_ID",
  "WHATSAPP_OTP_TEMPLATE",
  "PHONE_VERIFICATION_MODE",
];

function configureWhatsApp() {
  process.env.OTP_PROVIDER = "whatsapp";
  process.env.WHATSAPP_ACCESS_TOKEN = "token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";
}

describe("signup OTP degradation when WhatsApp is unavailable", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetOtpBreakerForTests();
    for (const v of CREDENTIAL_VARS) delete process.env[v];
    (prisma as any).phoneVerificationOtp.create.mockResolvedValue({ id: "otp_1" });
    (prisma as any).phoneVerificationOtp.update.mockResolvedValue({ id: "otp_1" });
    (prisma as any).phoneVerificationOtp.updateMany.mockResolvedValue({ count: 0 });
    (prisma as any).phoneVerificationOtp.count.mockResolvedValue(0);
  });

  it("skips verification for LEAD_CAPTURE when WhatsApp is not configured", async () => {
    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "LEAD_CAPTURE",
      requestIp: "127.0.0.1",
    });

    expect(result).toMatchObject({
      success: true,
      verification_required: false,
      reason: "PROVIDER_NOT_CONFIGURED",
    });
    expect(notificationService.sendOtp).not.toHaveBeenCalled();

    const created = (prisma as any).phoneVerificationOtp.create.mock.calls[0][0].data;
    expect(created.status).toBe("SKIPPED");
    expect(created.provider_status).toBe("UNAVAILABLE");
    expect(created.verified_at).toBeInstanceOf(Date);
  });

  it("skips verification for PHONE_VERIFICATION when WhatsApp is not configured", async () => {
    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "PHONE_VERIFICATION",
      requestIp: "127.0.0.1",
    });
    expect(result.verification_required).toBe(false);
    expect(notificationService.sendOtp).not.toHaveBeenCalled();
  });

  it("still enforces rate limits on the skip path", async () => {
    const { checkFixedWindowLimit } = await import("@/lib/redis/rate-limit");
    vi.mocked(checkFixedWindowLimit).mockResolvedValueOnce({
      available: true,
      allowed: false,
      attempts: 3,
      attemptsRemaining: 0,
      retryAfterSeconds: 120,
    } as any);

    await expect(
      authOtpService.sendPhoneOtp({
        phone: "8008046952",
        purpose: "LEAD_CAPTURE",
        requestIp: "127.0.0.1",
      }),
    ).rejects.toBeInstanceOf(OtpServiceError);
    expect((prisma as any).phoneVerificationOtp.create).not.toHaveBeenCalled();
  });

  it("degrades the same request whose send fails, rather than throwing", async () => {
    configureWhatsApp();
    vi.mocked(notificationService.sendOtp).mockRejectedValueOnce(new Error("token expired"));

    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "LEAD_CAPTURE",
      requestIp: "127.0.0.1",
    });

    expect(result).toMatchObject({
      success: true,
      verification_required: false,
      reason: "PROVIDER_SEND_FAILED",
    });
    const update = (prisma as any).phoneVerificationOtp.update.mock.calls.at(-1)[0];
    expect(update.data.status).toBe("SKIPPED");
    expect(update.data.provider_status).toBe("UNAVAILABLE");
    expect(update.data.verified_at).toBeInstanceOf(Date);
  });

  it("stops calling the provider once the breaker opens", async () => {
    configureWhatsApp();
    vi.mocked(notificationService.sendOtp).mockRejectedValue(new Error("token expired"));

    for (let i = 0; i < 3; i++) {
      await authOtpService.sendPhoneOtp({
        phone: "8008046952",
        purpose: "LEAD_CAPTURE",
        requestIp: "127.0.0.1",
      });
    }
    expect(notificationService.sendOtp).toHaveBeenCalledTimes(3);

    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "LEAD_CAPTURE",
      requestIp: "127.0.0.1",
    });
    expect(result).toMatchObject({ verification_required: false, reason: "PROVIDER_UNAVAILABLE" });
    expect(notificationService.sendOtp).toHaveBeenCalledTimes(3);
  });

  it("sends normally and requires verification when WhatsApp works", async () => {
    configureWhatsApp();
    vi.mocked(notificationService.sendOtp).mockResolvedValueOnce({
      success: true,
      providerMessageId: "wamid.1",
      attempts: 1,
    } as any);

    const result = await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "LEAD_CAPTURE",
      requestIp: "127.0.0.1",
    });

    expect(result).toMatchObject({
      success: true,
      verification_required: true,
      expires_in_seconds: 300,
    });
    const created = (prisma as any).phoneVerificationOtp.create.mock.calls[0][0].data;
    expect(created.status).toBe("PENDING");
  });

  it("still throws for non-signup purposes when the send fails", async () => {
    configureWhatsApp();
    vi.mocked(notificationService.sendOtp).mockRejectedValueOnce(new Error("token expired"));

    await expect(
      authOtpService.sendPhoneOtp({
        phone: "8008046952",
        purpose: "Login",
        requestIp: "127.0.0.1",
      }),
    ).rejects.toThrowError(new OtpServiceError("Failed to send OTP", "OTP_SEND_FAILED", 502));
  });

  it("still throws for non-signup purposes when WhatsApp is not configured", async () => {
    vi.mocked(notificationService.sendOtp).mockRejectedValueOnce(new Error("not configured"));

    await expect(
      authOtpService.sendPhoneOtp({
        phone: "8008046952",
        purpose: "Login",
        requestIp: "127.0.0.1",
      }),
    ).rejects.toThrowError(new OtpServiceError("Failed to send OTP", "OTP_SEND_FAILED", 502));
  });
});
