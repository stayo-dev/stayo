import { getLogger } from "@/lib/logger";

const logger = getLogger("auth.phone-verification-mode");

/**
 * Whether phone verification can actually happen right now.
 *
 * StayO's WhatsApp Business setup is an external dependency (Meta template
 * approval) that can be absent, half-configured, or temporarily broken. Rather
 * than blocking owner signup behind a code nobody can receive, the signup path
 * degrades: see `AuthOtpService.sendPhoneOtp` and the design spec at
 * docs/superpowers/specs/2026-07-31-whatsapp-unavailable-signup-fallback-design.md
 */
export type PhoneVerificationMode = "on" | "off";

/**
 * Only the owner-signup purposes degrade. Every other OTP purpose keeps its
 * hard failure — silently skipping verification elsewhere would weaken a
 * security control nobody asked to relax.
 */
export const SKIPPABLE_OTP_PURPOSES = ["PHONE_VERIFICATION", "LEAD_CAPTURE"] as const;

export function isSkippableOtpPurpose(purpose: string): boolean {
  return (SKIPPABLE_OTP_PURPOSES as readonly string[]).includes(purpose);
}

/**
 * The four variables genuinely required to *send* an OTP template.
 * WHATSAPP_BUSINESS_ACCOUNT_ID is intentionally excluded — validateWhatsApp-
 * Configuration() checks it, but configFromEnv() never uses it to send.
 */
export function hasWhatsAppOtpCredentials(): boolean {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;
  const otpTemplate = process.env.WHATSAPP_OTP_TEMPLATE;

  return Boolean(
    process.env.OTP_PROVIDER === "whatsapp" && accessToken && phoneNumberId && otpTemplate,
  );
}

export function resolvePhoneVerificationMode(): PhoneVerificationMode {
  const override = String(process.env.PHONE_VERIFICATION_MODE || "").trim().toLowerCase();
  if (override === "on" || override === "off") return override;
  if (override) {
    logger.warn("phone_verification.invalid_mode_override", { value: override });
  }

  return hasWhatsAppOtpCredentials() ? "on" : "off";
}
