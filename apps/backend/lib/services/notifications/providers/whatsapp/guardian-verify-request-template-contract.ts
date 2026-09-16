/**
 * Contract for `stayo_guardian_verify_request` — the message that replaces the
 * code relay.
 *
 * ## The friction this removes
 *
 * Verification has always been an OTP: a six-digit code goes to the guardian's
 * handset, and the *tenant* has to obtain it and type it in. That works
 * perfectly when the two are sitting together and not at all otherwise, which
 * is most of the time — a parent at work, asleep, abroad, or simply not
 * picking up leaves a tenant stuck at a form they cannot complete. The OTP was
 * never the problem. Making a present tenant relay a secret from an absent
 * third party was.
 *
 * So the guardian answers directly: one message, one button, nothing to read
 * out, nothing to type. The tenant's only job is to ask.
 *
 * The approved template:
 *
 *   Header: Confirm your ward
 *   Body:   Hello {{1}}, {{2}} has listed you as their parent/guardian for
 *           their stay at {{3}} on Stayo. Please confirm so we can keep you
 *           updated about their stay, rent and safety.
 *           If you do not know this person, ignore this message.
 *   Footer: Stayo Property Management
 *   Button: [Yes, I confirm] — quick reply, payload "ConfirmWard"
 *   Validity: 24 hours
 *
 * ── Three things this contract exists to protect ──
 *
 * 1. **{{2}} is a bare name.** Same trap as
 *    `guardian-activation-template-contract`: the body supplies its own framing
 *    ("has listed you as their parent/guardian"), so a possessive arriving here
 *    reads "Aarav's has listed you". `tenantDisplayName()` is reused rather
 *    than reimplemented.
 *
 * 2. **The opt-out line is not decoration.** This is the one message Stayo
 *    sends to someone who has never heard of Stayo, about a claim somebody else
 *    made about them. A person who was named by mistake — or by a stranger who
 *    mistyped a digit — must be able to do nothing and have that be the right
 *    answer. Nothing escalates on silence.
 *
 * 3. **The payload is a keyword, not an id.** A template quick reply arrives as
 *    an inbound `type: "button"` webhook, which `extractMessageEvents` converts
 *    to a *text* event on the grounds that tapping it is the reader saying that
 *    word. It therefore resolves through the ordinary command vocabulary, not
 *    through `decodePayload`. A `CC:`-style id here would be silently dropped.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

import { tenantDisplayName } from "./guardian-activation-template-contract";

export const GUARDIAN_VERIFY_REQUEST_TEMPLATE = {
  envVar: "WHATSAPP_GUARDIAN_VERIFY_TEMPLATE",
  languageEnvVar: "WHATSAPP_GUARDIAN_VERIFY_LANGUAGE",
  defaultName: "stayo_guardian_verify_request",
  defaultLanguage: "en",
  /** BODY {{1}}, {{2}}, {{3}} in order. */
  bodyParameters: ["guardian_name", "tenant_name", "hostel_name"] as const,
  /** One quick-reply button. Its payload is a keyword, not an id. */
  quickReply: { text: "Yes, I confirm", payload: "ConfirmWard" },
  /** How long a request stands before the guardian has to be asked again. */
  validityHours: 24,
} as const;

export function guardianVerifyRequestTemplateName(): string {
  return process.env[GUARDIAN_VERIFY_REQUEST_TEMPLATE.envVar] || GUARDIAN_VERIFY_REQUEST_TEMPLATE.defaultName;
}

export function guardianVerifyRequestTemplateLanguage(): string {
  return (
    process.env[GUARDIAN_VERIFY_REQUEST_TEMPLATE.languageEnvVar] ||
    GUARDIAN_VERIFY_REQUEST_TEMPLATE.defaultLanguage
  );
}

/**
 * Whether this template has been configured for this environment at all.
 *
 * Meta must approve a template before it can be sent to a handset that has not
 * messaged us first, and that approval has a lead time measured in days. Rather
 * than hold the whole feature behind it, the caller checks this and falls back
 * to the OTP relay — which is exactly what tenants do today, so the fallback is
 * a known-working path, not a degraded guess.
 */
export function isGuardianVerifyRequestConfigured(): boolean {
  return Boolean(process.env[GUARDIAN_VERIFY_REQUEST_TEMPLATE.envVar]);
}

export type GuardianVerifyRequestInput = {
  guardianName: string | null | undefined;
  tenantName: string | null | undefined;
  hostelName: string | null | undefined;
};

/**
 * Pure mapper. Every parameter is non-empty — Meta rejects a blank one, and a
 * rejected send here means the tenant is back to relaying a code.
 */
export function buildGuardianVerifyRequestPayload(input: GuardianVerifyRequestInput): string[] {
  return [
    String(input.guardianName || "").trim() || "there",
    tenantDisplayName(String(input.tenantName || "")),
    String(input.hostelName || "").trim() || "their hostel",
  ];
}

/** Does this inbound body look like the confirm button being tapped? */
export function isGuardianConfirmReply(body: string): boolean {
  const normalized = String(body || "").trim().toLowerCase().replace(/[^a-z]/g, "");
  return (
    normalized === GUARDIAN_VERIFY_REQUEST_TEMPLATE.quickReply.payload.toLowerCase() ||
    normalized === "yesiconfirm"
  );
}
