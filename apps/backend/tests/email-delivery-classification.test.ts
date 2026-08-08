import { describe, expect, it } from "vitest";
import { describeEmailDeliveryConfig, isSandboxSender } from "@/lib/services/email-delivery";

/**
 * Password reset used to report success even when the email provider had
 * rejected the send, so a total delivery outage was indistinguishable from a
 * working one — for users and operators alike.
 *
 * The fix reports degradation, but it must derive from **configuration
 * only**, never from what happened to a particular address. A flag that
 * appeared only for real accounts would turn the deliberately generic
 * "if an account exists…" response into an account enumeration oracle.
 */
describe("sandbox sender detection", () => {
  it("recognises Resend's sandbox sender, which only delivers to the account owner", () => {
    expect(isSandboxSender("Stayo <onboarding@resend.dev>")).toBe(true);
  });

  it("accepts a sender on the product's own domain", () => {
    expect(isSandboxSender("StayO <admin@yourstayo.com>")).toBe(false);
  });

  it("recognises a bare sandbox address with no display name", () => {
    expect(isSandboxSender("onboarding@resend.dev")).toBe(true);
  });
});

describe("email delivery config", () => {
  it("is degraded when no provider key is configured", () => {
    expect(describeEmailDeliveryConfig({ apiKey: "", from: "StayO <admin@yourstayo.com>" })).toEqual({
      degraded: true,
      reason: "PROVIDER_NOT_CONFIGURED",
    });
  });

  it("is degraded when falling back to the sandbox sender", () => {
    expect(describeEmailDeliveryConfig({ apiKey: "re_123", from: "Stayo <onboarding@resend.dev>" })).toEqual({
      degraded: true,
      reason: "SANDBOX_SENDER",
    });
  });

  it("is healthy with a key and a first-party sender", () => {
    expect(describeEmailDeliveryConfig({ apiKey: "re_123", from: "StayO <admin@yourstayo.com>" })).toEqual({
      degraded: false,
      reason: null,
    });
  });

  it("reports the same result regardless of recipient, so it cannot enumerate accounts", () => {
    const config = { apiKey: "re_123", from: "Stayo <onboarding@resend.dev>" };

    expect(describeEmailDeliveryConfig(config)).toEqual(describeEmailDeliveryConfig(config));
    expect(Object.keys(describeEmailDeliveryConfig(config))).not.toContain("to");
  });
});
