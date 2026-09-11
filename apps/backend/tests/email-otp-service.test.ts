import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";

/**
 * Onboarding now requires a real email, proved with a code. Before this, a
 * tenant invited by phone alone finished with `<phone>@hms.temp` as their
 * login — the address their owner then saw.
 */

const mocks = vi.hoisted(() => ({
  otpCreate: vi.fn(),
  otpUpdate: vi.fn(),
  otpUpdateMany: vi.fn(),
  otpFindFirst: vi.fn(),
  otpCount: vi.fn(),
  profileFindUnique: vi.fn(),
  sendVerificationCode: vi.fn(),
  checkFixedWindowLimit: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    emailVerificationOtp: {
      create: mocks.otpCreate,
      update: mocks.otpUpdate,
      updateMany: mocks.otpUpdateMany,
      findFirst: mocks.otpFindFirst,
      count: mocks.otpCount,
    },
    profile: { findUnique: mocks.profileFindUnique },
  },
}));
vi.mock("@/lib/services/email-service", () => ({
  EmailService: { sendVerificationCode: mocks.sendVerificationCode },
}));
vi.mock("@/lib/redis/rate-limit", () => ({
  checkFixedWindowLimit: mocks.checkFixedWindowLimit,
  setOneTimeLock: vi.fn().mockResolvedValue(true),
  releaseOneTimeLock: vi.fn().mockResolvedValue(true),
}));

import { EmailOtpService, normalizeOnboardingEmail } from "@/lib/services/auth/email-otp-service";

let service: EmailOtpService;
let sentCode = "";

beforeEach(() => {
  vi.clearAllMocks();
  service = new EmailOtpService();
  mocks.checkFixedWindowLimit.mockResolvedValue({ available: true, allowed: true, retryAfterSeconds: 0 });
  mocks.profileFindUnique.mockResolvedValue(null);
  mocks.otpCreate.mockImplementation(async ({ data }: any) => ({ id: "otp-1", ...data }));
  mocks.otpUpdateMany.mockResolvedValue({ count: 1 });
  mocks.sendVerificationCode.mockImplementation(async ({ code }: any) => {
    sentCode = code;
    return { sent: true };
  });
});

describe("an onboarding email", () => {
  it.each([
    ["Ravi@Gmail.com ", "ravi@gmail.com"],
    ["a.b@college.ac.in", "a.b@college.ac.in"],
  ])("accepts %s", (raw, expected) => {
    expect(normalizeOnboardingEmail(raw)).toBe(expected);
  });

  /** The stand-in this whole step exists to replace. */
  it.each(["+918008046952@hms.temp", "not an email", "", "a@b"])("refuses %s", (raw) => {
    expect(normalizeOnboardingEmail(raw)).toBeNull();
  });
});

describe("sending a code", () => {
  const send = (over: any = {}) =>
    service.sendCode({ invitationId: "inv-1", email: "ravi@gmail.com", tenantName: "Ravi", ...over });

  it("emails a six-digit code and stores only its hash", async () => {
    const result = await send();

    expect(sentCode).toMatch(/^\d{6}$/);
    const stored = mocks.otpCreate.mock.calls[0][0].data;
    expect(stored.otp_hash).not.toContain(sentCode);
    expect(await bcrypt.compare(sentCode, stored.otp_hash)).toBe(true);
    expect(stored).toMatchObject({ invitation_id: "inv-1", email: "ravi@gmail.com", status: "PENDING" });
    expect(result.email).toBe("ravi@gmail.com");
  });

  /** The owner's decision: a taken address is answered with "use another", never adopted. */
  it("refuses an address another account signs in with, before sending anything", async () => {
    mocks.profileFindUnique.mockResolvedValue({ id: "someone-else" });

    await expect(send()).rejects.toMatchObject({ code: "EMAIL_TAKEN", status: 409 });
    expect(mocks.sendVerificationCode).not.toHaveBeenCalled();
  });

  it("does not call the tenant's own address taken", async () => {
    mocks.profileFindUnique.mockResolvedValue({ id: "own-profile" });

    await expect(send({ ownProfileId: "own-profile" })).resolves.toBeTruthy();
  });

  it("retires older codes, so only the newest works", async () => {
    await send();

    expect(mocks.otpUpdateMany).toHaveBeenCalledWith({
      where: { invitation_id: "inv-1", status: "PENDING" },
      data: { status: "EXPIRED", failure_reason: "SUPERSEDED" },
    });
  });

  /** Not a success with a code nobody will receive — the WhatsApp mistake, again. */
  it("fails loudly when the email did not go out", async () => {
    mocks.sendVerificationCode.mockResolvedValue({ sent: false, error: "RESEND_API_KEY missing" });

    await expect(send()).rejects.toMatchObject({ code: "EMAIL_SEND_FAILED" });
    expect(mocks.otpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "FAILED" }) })
    );
  });

  it("rate-limits repeated requests", async () => {
    mocks.checkFixedWindowLimit.mockResolvedValue({ available: true, allowed: false, retryAfterSeconds: 300 });

    await expect(send()).rejects.toMatchObject({ code: "OTP_RATE_LIMITED", status: 429 });
    expect(mocks.sendVerificationCode).not.toHaveBeenCalled();
  });

  it("falls back to counting rows when Redis is down", async () => {
    mocks.checkFixedWindowLimit.mockResolvedValue({ available: false, allowed: true, retryAfterSeconds: 0 });
    mocks.otpCount.mockResolvedValue(3);

    await expect(send()).rejects.toMatchObject({ code: "OTP_RATE_LIMITED" });
  });
});

describe("checking a code", () => {
  const pending = async (over: any = {}) => ({
    id: "otp-1",
    invitation_id: "inv-1",
    email: "ravi@gmail.com",
    otp_hash: await bcrypt.hash("123456", 4),
    status: "PENDING",
    attempts: 0,
    max_attempts: 5,
    expires_at: new Date(Date.now() + 60_000),
    ...over,
  });
  const verify = (code: string) => service.verifyCode({ invitationId: "inv-1", email: "ravi@gmail.com", code });

  it("verifies the right code", async () => {
    mocks.otpFindFirst.mockResolvedValue(await pending());

    await expect(verify("123456")).resolves.toEqual({ email: "ravi@gmail.com" });
    expect(mocks.otpUpdateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "VERIFIED" }) })
    );
  });

  it("says how many tries are left after a wrong one", async () => {
    mocks.otpFindFirst.mockResolvedValue(await pending({ attempts: 2 }));

    await expect(verify("000000")).rejects.toThrow("2 tries left");
  });

  it("locks after the last wrong try", async () => {
    mocks.otpFindFirst.mockResolvedValue(await pending({ attempts: 4 }));

    await expect(verify("000000")).rejects.toMatchObject({ code: "OTP_LOCKED" });
    expect(mocks.otpUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "LOCKED" }) })
    );
  });

  it("refuses an expired code", async () => {
    mocks.otpFindFirst.mockResolvedValue(await pending({ expires_at: new Date(Date.now() - 1) }));

    await expect(verify("123456")).rejects.toMatchObject({ code: "OTP_EXPIRED" });
  });

  /** A code proves an address for one onboarding only. */
  it("only looks for codes sent for this invitation and address", async () => {
    mocks.otpFindFirst.mockResolvedValue(null);

    await expect(verify("123456")).rejects.toMatchObject({ code: "OTP_NOT_FOUND" });
    expect(mocks.otpFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { invitation_id: "inv-1", email: "ravi@gmail.com", status: "PENDING" } })
    );
  });

  it("refuses anything but six digits without touching the database", async () => {
    await expect(verify("12ab")).rejects.toMatchObject({ code: "OTP_INVALID" });
    expect(mocks.otpFindFirst).not.toHaveBeenCalled();
  });
});
