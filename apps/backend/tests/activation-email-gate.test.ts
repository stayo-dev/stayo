import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The ACCOUNT step will not complete without a proved email.
 *
 * It used to write `resolveActivationEmail`'s output — `<phone>@hms.temp` for
 * anyone invited by phone alone — onto the profile, the tenancy and the
 * invitation, and that stand-in became the tenant's login and the address
 * their owner saw. (tests/activation-workflow.test.ts would be the natural
 * home, but all six of its tests fail on a clean checkout.)
 */

const mocks = vi.hoisted(() => ({
  findVerified: vi.fn(),
  assertAvailable: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/services/auth/email-otp-service", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  emailOtpService: { findVerified: mocks.findVerified, assertAvailable: mocks.assertAvailable, consume: vi.fn() },
}));

import { ActivationWorkflowService, hasOwnLogin } from "@/src/services/tenants/activation-workflow-service";

const service = new ActivationWorkflowService() as any;
const invitation = { id: "inv-1" };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findVerified.mockResolvedValue({ id: "otp-1", email: "ravi@gmail.com" });
  mocks.assertAvailable.mockResolvedValue(undefined);
});

describe("who is asked for an email", () => {
  it("asks someone invited by phone alone — their profile holds only the stand-in", () => {
    expect(hasOwnLogin({ email: "+918008046952@hms.temp", auth_user_id: null, password_hash: null })).toBe(false);
  });

  /** They were never asked before; a login does not make the stand-in real. */
  it("asks someone who activated earlier with the stand-in as their login", () => {
    expect(hasOwnLogin({ email: "+918008046952@hms.temp", auth_user_id: "auth-1" })).toBe(false);
  });

  /** Typed by the owner, proved by nobody. */
  it("asks when the only address is one the owner typed", () => {
    expect(hasOwnLogin({ email: "ravi@gmail.com", auth_user_id: null, password_hash: null })).toBe(false);
  });

  /** ADR-110: onboarding never rewrites an existing login. */
  it("does not ask someone who already signs in with a real address", () => {
    expect(hasOwnLogin({ email: "ravi@gmail.com", auth_user_id: "auth-1" })).toBe(true);
    expect(hasOwnLogin({ email: "ravi@gmail.com", password_hash: "x" })).toBe(true);
  });
});

describe("completing the ACCOUNT step", () => {
  const profileWithoutLogin = { id: "p1", email: "+918008046952@hms.temp" };

  it("refuses without an email", async () => {
    await expect(service.resolveAccountEmail(profileWithoutLogin, invitation, {})).rejects.toThrow(
      "VALIDATION_ERROR: Add your email address"
    );
  });

  it("refuses an email that was never confirmed with the code", async () => {
    mocks.findVerified.mockResolvedValue(null);

    await expect(
      service.resolveAccountEmail(profileWithoutLogin, invitation, { email: "ravi@gmail.com" })
    ).rejects.toThrow("VALIDATION_ERROR: Confirm your email with the code");
  });

  it("looks for a verification made for this invitation and this address", async () => {
    await service.resolveAccountEmail(profileWithoutLogin, invitation, { email: " Ravi@Gmail.com " });

    expect(mocks.findVerified).toHaveBeenCalledWith({ invitationId: "inv-1", email: "ravi@gmail.com" });
  });

  it("uses the proved address, and hands back the verification to spend", async () => {
    await expect(
      service.resolveAccountEmail(profileWithoutLogin, invitation, { email: "ravi@gmail.com" })
    ).resolves.toEqual({ email: "ravi@gmail.com", verificationId: "otp-1" });
  });

  it("never accepts the stand-in as the email", async () => {
    await expect(
      service.resolveAccountEmail(profileWithoutLogin, invitation, { email: "+918008046952@hms.temp" })
    ).rejects.toThrow("VALIDATION_ERROR: Add your email address");
  });

  it("says so if the address was taken since the code went out", async () => {
    mocks.assertAvailable.mockRejectedValue(new Error("That email already has a Stayo account. Use a different email."));

    await expect(
      service.resolveAccountEmail(profileWithoutLogin, invitation, { email: "ravi@gmail.com" })
    ).rejects.toThrow("VALIDATION_ERROR: That email already has a Stayo account");
  });

  it("keeps an existing login's own address, unasked", async () => {
    const result = await service.resolveAccountEmail(
      { id: "p1", email: "Ravi@Gmail.com", auth_user_id: "auth-1" },
      invitation,
      { email: "someone-else@gmail.com" }
    );

    expect(result).toEqual({ email: "ravi@gmail.com", verificationId: null });
    expect(mocks.findVerified).not.toHaveBeenCalled();
  });
});
