import { describe, expect, it } from "vitest";
import { isSkippableOtpPurpose, SKIPPABLE_OTP_PURPOSES } from "@/lib/services/auth/phone-verification-mode";
import { PASSWORD_RESET_OTP_PURPOSE } from "@/lib/services/auth/password-reset-purpose";

/**
 * The phone leg of password reset reuses the signup OTP service, which can
 * *skip* verification entirely when WhatsApp is unconfigured — a deliberate
 * degradation for signup (docs/superpowers/specs/2026-07-31-whatsapp-
 * unavailable-signup-fallback-design.md).
 *
 * Applied to password reset that degradation would mean: WhatsApp goes down,
 * and anyone who knows a registered phone number can reset that account's
 * password without ever receiving a code. This test is the guard. If someone
 * adds PASSWORD_RESET to the skippable list, this fails.
 */
describe("password reset OTP fails closed", () => {
  it("is not a skippable OTP purpose", () => {
    expect(isSkippableOtpPurpose(PASSWORD_RESET_OTP_PURPOSE)).toBe(false);
  });

  it("is absent from the skippable list itself", () => {
    expect(SKIPPABLE_OTP_PURPOSES as readonly string[]).not.toContain(PASSWORD_RESET_OTP_PURPOSE);
  });

  it("only signup-flow purposes are allowed to degrade", () => {
    expect([...SKIPPABLE_OTP_PURPOSES]).toEqual(["PHONE_VERIFICATION", "LEAD_CAPTURE"]);
  });
});
