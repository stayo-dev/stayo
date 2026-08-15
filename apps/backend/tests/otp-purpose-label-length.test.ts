import { describe, it, expect } from "vitest";
import {
  otpPurposeLabel,
  buildOtpTemplatePayload,
  OTP_AUTH_PARAMETER_MAX_LENGTH,
} from "@/lib/services/notifications/providers/whatsapp/meta-provider";

/**
 * Regression coverage for Meta error #132018.
 *
 * The approved `otp` template is category **AUTHENTICATION**, and Meta caps
 * every body parameter on an authentication template at 15 characters.
 * `{{2}}` carries a human-readable purpose label, and two of the shipped
 * labels were over that limit:
 *
 *   "phone verification"   18 chars  (owner signup)
 *   "parent verification"  19 chars  (tenant guardian verification)
 *
 * Meta rejected both with:
 *   (#132018) body: Parameter at index 1 exceeds the parameter length limit 15
 *
 * The two failures looked completely different to users, which is why this
 * went unnoticed for so long: `PHONE_VERIFICATION` is a *skippable* purpose,
 * so owner signup swallowed the rejection and silently proceeded **without
 * verifying anybody's phone**. `ParentVerify` is not skippable, so tenant
 * onboarding surfaced it as a hard OTP_SEND_FAILED. One bug, two faces.
 */
describe("otpPurposeLabel — Meta authentication-template parameter limit", () => {
  const PURPOSES = [
    "LEAD_CAPTURE",
    "PHONE_VERIFICATION",
    "ParentVerify",
    "Registration",
    "LOGIN",
    "SIGNUP",
    "PASSWORD_RESET",
    "ProfileUpdate",
  ];

  it("exposes the limit Meta actually enforces", () => {
    expect(OTP_AUTH_PARAMETER_MAX_LENGTH).toBe(15);
  });

  it.each(PURPOSES)("keeps %s within the limit", (purpose) => {
    expect(otpPurposeLabel(purpose).length).toBeLessThanOrEqual(OTP_AUTH_PARAMETER_MAX_LENGTH);
  });

  it("keeps the two labels that Meta actually rejected within the limit", () => {
    // The exact pair that produced #132018 in production.
    expect(otpPurposeLabel("PHONE_VERIFICATION").length).toBeLessThanOrEqual(15);
    expect(otpPurposeLabel("ParentVerify").length).toBeLessThanOrEqual(15);
  });

  it("still says something meaningful rather than truncating to noise", () => {
    // The label is rendered to a person: "This is your OTP code for {{2}}."
    expect(otpPurposeLabel("ParentVerify")).toBe("parent verify");
    expect(otpPurposeLabel("PHONE_VERIFICATION")).toBe("verification");
    expect(otpPurposeLabel("LEAD_CAPTURE")).toBe("sign up");
  });

  it("caps an unmapped purpose too — a new purpose must not break delivery", () => {
    // The fallback humanises anything unknown, so without a cap the next
    // purpose someone adds silently reintroduces #132018.
    const label = otpPurposeLabel("SOME_VERY_LONG_NEW_PURPOSE_NOBODY_ANTICIPATED");
    expect(label.length).toBeLessThanOrEqual(OTP_AUTH_PARAMETER_MAX_LENGTH);
    expect(label.length).toBeGreaterThan(0);
  });

  it("never emits a label ending in a dangling space after capping", () => {
    const label = otpPurposeLabel("ACCOUNT_RECOVERY_REQUEST");
    expect(label).toBe(label.trim());
  });

  it("falls back to a safe label for an empty purpose", () => {
    expect(otpPurposeLabel("")).toBe("verification");
    expect(otpPurposeLabel("   ").length).toBeLessThanOrEqual(15);
  });
});

describe("buildOtpTemplatePayload — every body parameter is sendable", () => {
  const build = (purpose: string) =>
    buildOtpTemplatePayload({ phone: "918008046952", otp: "123456", purpose, templateName: "otp" });

  it("sends nothing over the limit for the guardian purpose", () => {
    const payload = build("ParentVerify") as any;
    const body = payload.template.components.find((c: any) => c.type === "body");
    for (const parameter of body.parameters) {
      expect(String(parameter.text).length).toBeLessThanOrEqual(OTP_AUTH_PARAMETER_MAX_LENGTH);
    }
  });

  it("keeps the code itself intact — capping must never touch the OTP", () => {
    const payload = build("ParentVerify") as any;
    const body = payload.template.components.find((c: any) => c.type === "body");
    const button = payload.template.components.find((c: any) => c.type === "button");
    expect(body.parameters[0].text).toBe("123456");
    expect(button.parameters[0].text).toBe("123456");
  });

  it("still matches the approved template's shape", () => {
    const payload = build("ParentVerify") as any;
    const body = payload.template.components.find((c: any) => c.type === "body");
    const button = payload.template.components.find((c: any) => c.type === "button");
    expect(body.parameters).toHaveLength(2);
    expect(button).toMatchObject({ sub_type: "url", index: "0" });
    expect(button.parameters).toHaveLength(1);
  });
});
