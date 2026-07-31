import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  resolvePhoneVerificationMode,
  hasWhatsAppOtpCredentials,
  isSkippableOtpPurpose,
} from "@/lib/services/auth/phone-verification-mode";

const VARS = [
  "PHONE_VERIFICATION_MODE",
  "OTP_PROVIDER",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "PHONE_NUMBER_ID",
  "WHATSAPP_OTP_TEMPLATE",
];

let saved: Record<string, string | undefined> = {};

function fullyConfigured() {
  process.env.OTP_PROVIDER = "whatsapp";
  process.env.WHATSAPP_ACCESS_TOKEN = "token";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "123";
  process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";
}

describe("phone verification mode resolver", () => {
  beforeEach(() => {
    saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));
    for (const v of VARS) delete process.env[v];
  });

  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("is off when nothing is configured", () => {
    expect(hasWhatsAppOtpCredentials()).toBe(false);
    expect(resolvePhoneVerificationMode()).toBe("off");
  });

  it("is on when the provider and all send-critical credentials are present", () => {
    fullyConfigured();
    expect(resolvePhoneVerificationMode()).toBe("on");
  });

  it("accepts the legacy WHATSAPP_TOKEN and PHONE_NUMBER_ID aliases", () => {
    process.env.OTP_PROVIDER = "whatsapp";
    process.env.WHATSAPP_TOKEN = "token";
    process.env.PHONE_NUMBER_ID = "123";
    process.env.WHATSAPP_OTP_TEMPLATE = "otp_phone";
    expect(resolvePhoneVerificationMode()).toBe("on");
  });

  it.each([
    ["OTP_PROVIDER"],
    ["WHATSAPP_ACCESS_TOKEN"],
    ["WHATSAPP_PHONE_NUMBER_ID"],
    ["WHATSAPP_OTP_TEMPLATE"],
  ])("is off when %s is missing", (missing) => {
    fullyConfigured();
    delete process.env[missing];
    expect(resolvePhoneVerificationMode()).toBe("off");
  });

  it("lets PHONE_VERIFICATION_MODE force verification off despite full credentials", () => {
    fullyConfigured();
    process.env.PHONE_VERIFICATION_MODE = "off";
    expect(resolvePhoneVerificationMode()).toBe("off");
  });

  it("lets PHONE_VERIFICATION_MODE force verification on despite no credentials", () => {
    process.env.PHONE_VERIFICATION_MODE = "ON";
    expect(resolvePhoneVerificationMode()).toBe("on");
  });

  it("ignores an unrecognised override and falls back to derivation", () => {
    process.env.PHONE_VERIFICATION_MODE = "maybe";
    expect(resolvePhoneVerificationMode()).toBe("off");
    fullyConfigured();
    expect(resolvePhoneVerificationMode()).toBe("on");
  });

  it("treats only the two signup purposes as skippable", () => {
    expect(isSkippableOtpPurpose("PHONE_VERIFICATION")).toBe(true);
    expect(isSkippableOtpPurpose("LEAD_CAPTURE")).toBe(true);
    expect(isSkippableOtpPurpose("Login")).toBe(false);
    expect(isSkippableOtpPurpose("")).toBe(false);
  });
});
