import { describe, expect, it, beforeAll, afterAll, vi } from "vitest";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import { prisma } from "@/lib/db";
import { authService } from "@/lib/services/auth-service";
import { verifyResetToken, verifyPassword } from "@/lib/auth";
import { PASSWORD_RESET_OTP_PURPOSE } from "@/lib/services/auth/password-reset-purpose";

/**
 * Integration coverage for the half of the phone-reset flow that changes a
 * password. The OTP *send* leg is not exercised here on purpose — it would
 * dispatch a real WhatsApp message to a real number. The code is seeded
 * directly instead, which is the same state a delivered code produces.
 *
 * Honesty note: unlike the pure units in this change (reset-token channel,
 * delivery classification, issuer derivation), these were written against
 * already-written service code rather than test-first. They are verification
 * and regression cover, not TDD.
 *
 * This suite cleans up after itself: `tests/setup.ts`'s `resetDatabase()`
 * truncates `schemaname = 'test'` while this database's tables live in
 * `public`, so it silently no-ops and nothing else will tidy these rows.
 */
/**
 * The provider is stubbed so the last case — which deliberately calls the
 * *send* path for a registered number to prove the response is identical to
 * an unregistered one — cannot dispatch real WhatsApp traffic on every run.
 * The database, the OTP service and the reset logic are all real.
 */
vi.mock("@/lib/services/notification-service", () => ({
  notificationService: {
    sendOtp: vi.fn().mockResolvedValue({ success: true, messageId: "test-message" }),
  },
}));

const PHONE = "919000000042";
const OLD_PASSWORD = "OldPassword123!";
const NEW_PASSWORD = "BrandNewPassword456!";

let profileId: string;

async function seedOtp(code: string, overrides: Record<string, unknown> = {}) {
  return (prisma as any).phoneVerificationOtp.create({
    data: {
      phone: PHONE,
      otp_hash: await bcrypt.hash(code, 10),
      purpose: PASSWORD_RESET_OTP_PURPOSE,
      status: "PENDING",
      max_attempts: 5,
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
      provider_status: "SENT",
      ...overrides,
    },
  });
}

beforeAll(async () => {
  profileId = uuidv4();
  await prisma.profile.create({
    data: {
      id: profileId,
      email: `reset-phone-${profileId}@test.local`,
      name: "Reset By Phone",
      phone: `+${PHONE}`,
      password_hash: await bcrypt.hash(OLD_PASSWORD, 10),
      role: "OWNER",
      owner_id: profileId,
    },
  });
});

afterAll(async () => {
  await (prisma as any).phoneVerificationOtp.deleteMany({ where: { phone: PHONE } });
  await prisma.profile.deleteMany({ where: { id: profileId } });
});

describe("password reset by phone", () => {
  it("rejects a wrong code without issuing a token", async () => {
    await seedOtp("111111");

    await expect(
      authService.verifyPasswordResetOtp({ phone: `+${PHONE}`, otp: "999999" }),
    ).rejects.toThrow();

    await (prisma as any).phoneVerificationOtp.deleteMany({ where: { phone: PHONE } });
  });

  it("issues a phone-channel reset token for a correct code", async () => {
    await seedOtp("222222");

    const { reset_token, expires_in } = await authService.verifyPasswordResetOtp({
      phone: `+${PHONE}`,
      otp: "222222",
    });

    const payload = await verifyResetToken(reset_token);
    expect(payload?.channel).toBe("phone");
    expect(payload?.email).toContain(profileId);
    expect(expires_in).toBe(300);
  });

  it("does not let the same code be spent twice", async () => {
    await seedOtp("333333");

    await authService.verifyPasswordResetOtp({ phone: `+${PHONE}`, otp: "333333" });

    await expect(
      authService.verifyPasswordResetOtp({ phone: `+${PHONE}`, otp: "333333" }),
    ).rejects.toThrow();
  });

  it("actually changes the password when the issued token is redeemed", async () => {
    await (prisma as any).phoneVerificationOtp.deleteMany({ where: { phone: PHONE } });
    await seedOtp("444444");

    const { reset_token } = await authService.verifyPasswordResetOtp({
      phone: `+${PHONE}`,
      otp: "444444",
    });
    await authService.completePasswordReset({
      accessToken: reset_token,
      newPassword: NEW_PASSWORD,
    });

    const profile = await prisma.profile.findUnique({
      where: { id: profileId },
      select: { password_hash: true, password_reset_at: true },
    });

    expect(await verifyPassword(NEW_PASSWORD, profile!.password_hash!)).toBe(true);
    expect(await verifyPassword(OLD_PASSWORD, profile!.password_hash!)).toBe(false);
    expect(profile!.password_reset_at).not.toBeNull();
  });

  // Amended 2026-08-08: this used to assert that a registered and an
  // unregistered number produced identical responses. That anti-enumeration
  // stance was abandoned deliberately — `owner-signup` and `tenant-signup`
  // already reject a duplicate with "Phone number already registered" on
  // public routes, so the same fact was one form away, while the generic
  // reply left anyone who mistyped a digit waiting five minutes for a code
  // that was never coming. Rate limits still throttle bulk probing.
  it("reports that no account exists for an unregistered number", async () => {
    const result = await authService.requestPasswordResetByPhone("+919000000099");

    expect(result.account_exists).toBe(false);
  });

  it("confirms the account and sends a code for a registered number", async () => {
    const result = await authService.requestPasswordResetByPhone(`+${PHONE}`);

    expect(result.account_exists).toBe(true);
  });

  it("treats a deactivated account as absent rather than leaking its status", async () => {
    await prisma.profile.update({ where: { id: profileId }, data: { is_active: false } });

    const result = await authService.requestPasswordResetByPhone(`+${PHONE}`);

    await prisma.profile.update({ where: { id: profileId }, data: { is_active: true } });
    expect(result.account_exists).toBe(false);
  });
});
