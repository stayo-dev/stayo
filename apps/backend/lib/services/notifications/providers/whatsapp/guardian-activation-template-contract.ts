/**
 * Contract for `stayo_guardian_whatsapp_activated`.
 *
 * The one message a guardian receives *before* they have ever messaged us. It
 * fires the moment a tenant enters their guardian's number and verifies it
 * during onboarding, and its whole job is to convert a number sitting in a
 * database field into someone who knows this channel exists.
 *
 * The approved template:
 *
 *   Header: Guardian Access Activated
 *   Body:   Hello {{1}}, you have been added as the guardian for {{2}} at {{3}}
 *           on Stayo. You can now receive rent reminders, check payment status,
 *           and pay rent on behalf of your ward directly from WhatsApp.
 *           Type *HELP* anytime to see available commands.
 *   Footer: Stayo Property Management
 *   Button: [Help]  — quick reply, payload "Help"
 *   Validity: 12 hours
 *
 * ── Two things this contract exists to protect ──
 *
 * 1. **{{2}} is a name, never a possessive.** Guardian-facing copy elsewhere is
 *    third-person and builds possessives itself (`voice.ts::possessive` turns
 *    "Aarav" into "Aarav's"). This body already carries its own framing — "the
 *    guardian for {{2}}", "on behalf of your ward" — so a possessive arriving
 *    here reads "the guardian for Aarav's at Sunrise". `tenantDisplayName()`
 *    strips one if a caller passes it, rather than trusting every future call
 *    site to remember.
 *
 * 2. **The Help button must actually work.** It is a quick reply, so tapping it
 *    delivers an inbound webhook of type `button` — a type
 *    `extractMessageEvents` explicitly did *not* handle until this template
 *    existed, meaning the tap would have been silently dropped. The payload is
 *    a plain word (`Help`) rather than a `CC:` id, because a template quick
 *    reply is semantically the reader *saying* that word; it resolves through
 *    the ordinary command vocabulary.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export const GUARDIAN_ACTIVATION_TEMPLATE = {
  envVar: "WHATSAPP_GUARDIAN_ACTIVATION_TEMPLATE",
  languageEnvVar: "WHATSAPP_GUARDIAN_ACTIVATION_LANGUAGE",
  defaultName: "stayo_guardian_whatsapp_activated",
  defaultLanguage: "en",
  /** BODY {{1}}, {{2}}, {{3}} in order. */
  bodyParameters: ["guardian_name", "tenant_name", "hostel_name"] as const,
  /** One quick-reply button. Its payload is the keyword, not an id. */
  quickReply: { text: "Help", payload: "Help" },
} as const;

export function guardianActivationTemplateName(): string {
  return process.env[GUARDIAN_ACTIVATION_TEMPLATE.envVar] || GUARDIAN_ACTIVATION_TEMPLATE.defaultName;
}

export function guardianActivationTemplateLanguage(): string {
  return (
    process.env[GUARDIAN_ACTIVATION_TEMPLATE.languageEnvVar] ||
    GUARDIAN_ACTIVATION_TEMPLATE.defaultLanguage
  );
}

/**
 * The tenant's name as {{2}} needs it: bare, never possessive.
 *
 * Handles both the straight and curly apostrophe, and both the `Aarav's` and
 * `Anders'` forms `voice.ts::possessive` can produce.
 */
export function tenantDisplayName(name: string): string {
  const trimmed = String(name || "").trim();
  if (!trimmed) return "your ward";
  return trimmed.replace(/['’]s$/i, "").replace(/['’]$/, "").trim() || "your ward";
}

export type GuardianActivationInput = {
  guardianName: string | null | undefined;
  tenantName: string | null | undefined;
  hostelName: string | null | undefined;
};

/**
 * Pure mapper. Every parameter is non-empty — Meta rejects a blank one, and a
 * rejected send here means a guardian never learns the channel exists.
 */
export function buildGuardianActivationPayload(input: GuardianActivationInput): string[] {
  return [
    String(input.guardianName || "").trim() || "there",
    tenantDisplayName(String(input.tenantName || "")),
    String(input.hostelName || "").trim() || "your hostel",
  ];
}
