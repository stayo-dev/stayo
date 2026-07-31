import { describe, expect, it, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { resolveSignupPhoneVerification } from "@/lib/services/auth/signup-phone-verification-gate";

vi.mock("@/lib/db", () => ({
  prisma: { phoneVerificationOtp: { findFirst: vi.fn() } },
  supabase: {},
}));

const NOW = Date.now();
const findFirst = () => (prisma as any).phoneVerificationOtp.findFirst;

describe("signup phone verification gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when no row exists for the phone", async () => {
    findFirst().mockResolvedValueOnce(null);
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({
      ok: false,
    });
  });

  it("accepts a fresh VERIFIED row as verified", async () => {
    findFirst().mockResolvedValueOnce({ status: "VERIFIED", verified_at: new Date(NOW - 60_000) });
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({
      ok: true,
      phoneVerified: true,
    });
  });

  it("accepts a fresh SKIPPED row as unverified", async () => {
    findFirst().mockResolvedValueOnce({ status: "SKIPPED", verified_at: new Date(NOW - 60_000) });
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({
      ok: true,
      phoneVerified: false,
    });
  });

  it("rejects a row older than the 30 minute freshness window", async () => {
    findFirst().mockResolvedValueOnce({ status: "VERIFIED", verified_at: new Date(NOW - 31 * 60_000) });
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({
      ok: false,
    });
  });

  it("rejects a row with no verified_at", async () => {
    findFirst().mockResolvedValueOnce({ status: "SKIPPED", verified_at: null });
    await expect(resolveSignupPhoneVerification("918008046952", "LEAD_CAPTURE", NOW)).resolves.toEqual({
      ok: false,
    });
  });

  it("queries only VERIFIED and SKIPPED rows for that phone and purpose, newest first", async () => {
    findFirst().mockResolvedValueOnce(null);
    await resolveSignupPhoneVerification("918008046952", "PHONE_VERIFICATION", NOW);
    expect(findFirst()).toHaveBeenCalledWith({
      where: {
        phone: "918008046952",
        purpose: "PHONE_VERIFICATION",
        status: { in: ["VERIFIED", "SKIPPED"] },
      },
      orderBy: { created_at: "desc" },
    });
  });
});
