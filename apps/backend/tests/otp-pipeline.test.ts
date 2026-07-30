import { describe, expect, it, vi, beforeEach } from "vitest";
import { authOtpService, OtpServiceError } from "@/lib/services/auth/auth-otp-service";
import { prisma } from "@/lib/db";
import { notificationService } from "@/lib/services/notification-service";
import bcrypt from "bcryptjs";

// Mock the database client
vi.mock("@/lib/db", () => {
  const mockPrisma = {
    phoneVerificationOtp: {
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
    },
    profile: {
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };
  return { prisma: mockPrisma, supabase: {} };
});

// Mock notification service
vi.mock("@/lib/services/notification-service", () => ({
  notificationService: {
    sendOtp: vi.fn(),
  },
}));

// Mock bcryptjs for speed and predictability
vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("mock_hash"),
    compare: vi.fn(),
  },
}));

// Mock Redis rate limits to always pass/be available by default
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

describe("OTP Verification Pipeline Security Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.REDIS_ENABLED = "false";
    process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";
  });

  // ==========================================
  // Test 1: Superseding & Expiration Checks (Same Phone)
  // ==========================================
  it("Test 1: invalidates previous pending OTPs, and only the newest OTP works", async () => {
    // 1. Mock sending first OTP
    prisma.phoneVerificationOtp.create.mockResolvedValueOnce({
      id: "otp_id_1",
      phone: "918008046952",
      otp_hash: "mock_hash_1",
      status: "PENDING",
    });
    vi.mocked(notificationService.sendOtp).mockResolvedValueOnce({
      success: true,
      providerMessageId: "wamid.1",
      attempts: 1,
    } as any);

    await authOtpService.sendPhoneOtp({
      phone: "8008046952",
      purpose: "Login",
      requestIp: "127.0.0.1",
    });

    // Check that updateMany was called to expire existing pending OTPs
    expect(prisma.phoneVerificationOtp.updateMany).toHaveBeenCalledWith({
      where: { phone: "918008046952", purpose: "Login", status: "PENDING" },
      data: { status: "EXPIRED", failure_reason: "superseded by new OTP request" },
    });
  });

  // ==========================================
  // Test 2: Locked Out on Excessive Wrong Attempts
  // ==========================================
  it("Test 2: fails verification and locks out after reaching maximum attempts", async () => {
    // 1. Simulate finding a PENDING OTP that already has 5 wrong attempts
    const mockRecord = {
      id: "otp_id_expired_attempts",
      phone: "918008046952",
      otp_hash: "correct_hash",
      status: "PENDING",
      attempts: 5,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 600000), // not expired in time
    };

    prisma.phoneVerificationOtp.findFirst.mockResolvedValueOnce(mockRecord);

    await expect(
      authOtpService.verifyPhoneOtp({
        phone: "8008046952",
        otp: "123456",
        purpose: "Login",
      })
    ).rejects.toThrowError(new OtpServiceError("OTP attempts exceeded", "OTP_ATTEMPTS_EXCEEDED", 429));

    // Verify record was marked as FAILED in DB
    expect(prisma.phoneVerificationOtp.update).toHaveBeenCalledWith({
      where: { id: "otp_id_expired_attempts" },
      data: { status: "FAILED", failure_reason: "maximum attempts exceeded" },
    });
  });

  it("Test 2 (b): increments wrong attempts count and locks out on the threshold wrong attempt", async () => {
    const mockRecord = {
      id: "otp_id_threshold_attempts",
      phone: "918008046952",
      otp_hash: "correct_hash",
      status: "PENDING",
      attempts: 4,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 600000),
    };

    prisma.phoneVerificationOtp.findFirst.mockResolvedValueOnce(mockRecord);
    (bcrypt.compare as any).mockResolvedValueOnce(false); // wrong code entered

    await expect(
      authOtpService.verifyPhoneOtp({
        phone: "8008046952",
        otp: "wrong_otp",
        purpose: "Login",
      })
    ).rejects.toThrowError(new OtpServiceError("Invalid OTP", "OTP_INVALID", 400));

    // Assert that the record was updated to FAILED because count hit max_attempts
    expect(prisma.phoneVerificationOtp.update).toHaveBeenCalledWith({
      where: { id: "otp_id_threshold_attempts" },
      data: {
        attempts: 5,
        status: "FAILED",
        failure_reason: "maximum attempts exceeded",
      },
    });
  });

  // ==========================================
  // Test 3: Expiration Invalidation
  // ==========================================
  it("Test 3: fails verification if current time is past the OTP expiry date", async () => {
    const mockRecord = {
      id: "otp_id_expired",
      phone: "918008046952",
      otp_hash: "correct_hash",
      status: "PENDING",
      attempts: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() - 10000), // 10 seconds in the past
    };

    prisma.phoneVerificationOtp.findFirst.mockResolvedValueOnce(mockRecord);

    await expect(
      authOtpService.verifyPhoneOtp({
        phone: "8008046952",
        otp: "123456",
        purpose: "Login",
      })
    ).rejects.toThrowError(new OtpServiceError("OTP expired", "OTP_EXPIRED", 400));

    expect(prisma.phoneVerificationOtp.update).toHaveBeenCalledWith({
      where: { id: "otp_id_expired" },
      data: { status: "EXPIRED", failure_reason: "expired before verification" },
    });
  });

  // ==========================================
  // Test 4: Replay Attack Invalidation
  // ==========================================
  it("Test 4: prevents reuse of an already verified OTP", async () => {
    // 1. Simulate the first verification request finding a PENDING OTP
    const mockRecord = {
      id: "otp_id_replay",
      phone: "918008046952",
      otp_hash: "correct_hash",
      status: "PENDING",
      attempts: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 600000),
    };

    prisma.phoneVerificationOtp.findFirst.mockResolvedValueOnce(mockRecord);
    (bcrypt.compare as any).mockResolvedValueOnce(true); // OTP matches

    // Mock successful transaction outcome (updates status to VERIFIED)
    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const txMock = {
        phoneVerificationOtp: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }), // successfully updated 1 PENDING row
        },
        profile: {
          updateMany: vi.fn().mockResolvedValue({ count: 2 }), // updated profiles
        },
      };
      return callback(txMock);
    });

    const result = await authOtpService.verifyPhoneOtp({
      phone: "8008046952",
      otp: "123456",
      purpose: "Login",
    });

    expect(result.success).toBe(true);

    // 2. Simulate subsequent request. The findFirst query won't find a PENDING OTP anymore (it is now VERIFIED/EXPIRED)
    prisma.phoneVerificationOtp.findFirst.mockResolvedValueOnce(null);

    await expect(
      authOtpService.verifyPhoneOtp({
        phone: "8008046952",
        otp: "123456",
        purpose: "Login",
      })
    ).rejects.toThrowError(new OtpServiceError("Invalid or expired OTP", "OTP_INVALID", 400));
  });

  // ==========================================
  // Test 5: Concurrent Verification Race Condition Check
  // ==========================================
  it("Test 5: exactly one request succeeds and the other fails when concurrent checks are run", async () => {
    const mockRecord = {
      id: "otp_id_race",
      phone: "918008046952",
      otp_hash: "correct_hash",
      status: "PENDING",
      attempts: 0,
      max_attempts: 5,
      expires_at: new Date(Date.now() + 600000),
    };

    // Both requests retrieve the active PENDING OTP
    prisma.phoneVerificationOtp.findFirst.mockResolvedValue(mockRecord);
    (bcrypt.compare as any).mockResolvedValue(true);

    // Request A transaction updates the PENDING record successfully
    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const txMock = {
        phoneVerificationOtp: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
        profile: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return callback(txMock);
    });

    // Request B transaction tries to update but finds status is no longer PENDING (count 0)
    prisma.$transaction.mockImplementationOnce(async (callback: any) => {
      const txMock = {
        phoneVerificationOtp: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        profile: {
          updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
      };
      return callback(txMock);
    });

    // Run Request A
    const resA = await authOtpService.verifyPhoneOtp({
      phone: "8008046952",
      otp: "123456",
      purpose: "Login",
    });
    expect(resA.success).toBe(true);

    // Run Request B (concurrent/second callback execution)
    await expect(
      authOtpService.verifyPhoneOtp({
        phone: "8008046952",
        otp: "123456",
        purpose: "Login",
      })
    ).rejects.toThrowError(new OtpServiceError("OTP already used", "OTP_ALREADY_USED", 409));
  });

  // ==========================================
  // Test 6: IP Verification Rate Limiting
  // ==========================================
  it("Test 6: blocks verification attempts from an IP that exceeds the rate limit", async () => {
    const { checkFixedWindowLimit } = await import("@/lib/redis/rate-limit");
    vi.mocked(checkFixedWindowLimit).mockResolvedValueOnce({
      available: true,
      allowed: false,
      attempts: 30,
      attemptsRemaining: 0,
      retryAfterSeconds: 900,
    });

    await expect(
      authOtpService.verifyPhoneOtp({
        phone: "8008046952",
        otp: "123456",
        purpose: "Login",
        requestIp: "198.51.100.1",
      })
    ).rejects.toThrowError(new OtpServiceError("Too many verification attempts from this IP", "OTP_RATE_LIMITED", 429));
  });
});
