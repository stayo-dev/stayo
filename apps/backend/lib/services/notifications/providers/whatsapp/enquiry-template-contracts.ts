/**
 * Contracts for the tenant-enquiry WhatsApp templates.
 *
 * Follows `platform-lead-template-contracts.ts` deliberately: same declared
 * parameter shape, same env-var override so a rename during Meta review is
 * config rather than a redeploy, same pure builders pinned by tests.
 *
 * The flow these serve — the owner Leads tab's Accept / Hold / Reject
 * actions, which apply to every `visitor_leads` row regardless of source
 * (Discover, QR, walk-in):
 *   tenant enquires
 *     → OWNER_ENQUIRY_RECEIVED to the hostel owner (Discover-sourced only)
 *     → owner opens the lead and Accepts / Holds / Rejects
 *     → Accept: owner sends a tenant invitation (existing pipeline)
 *     → Hold: no tenant notification — the owner's message is saved to
 *       `lead_notes` only (deliberate product decision)
 *     → Reject: TENANT_ENQUIRY_REJECTED to the tenant
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export type EnquiryTemplateKey = "OWNER_ENQUIRY_RECEIVED" | "TENANT_ENQUIRY_REJECTED";

export type EnquiryTemplateDefinition = {
  envVar: string;
  languageEnvVar: string;
  defaultName: string;
  defaultLanguage: string;
  /** BODY {{1}}, {{2}}… in order. Length is asserted against the builder in tests. */
  bodyParameters: readonly string[];
  /** Dynamic URL-button suffixes, in button order. Empty for a static button. */
  buttonParameters: readonly string[];
};

export type TemplatePayload = {
  bodyParameters: string[];
  buttonParameters: string[];
};

export const ENQUIRY_TEMPLATES: Record<EnquiryTemplateKey, EnquiryTemplateDefinition> = {
  /**
   * "Hello {{1}}, a new enquiry has been received for {{2}}.
   *  Tenant: {{3}}.
   *  Requested bed: {{4}} at {{5}} per month.
   *  Move-in date: {{6}}.
   *  Review and respond from your dashboard."   [Review Enquiry →]
   *
   * Utility category, 12-hour validity period, and a STATIC "Review Enquiry"
   * button pointing at the owner's dashboard — verified against the approved
   * template in WhatsApp Manager. Static means no button parameter: sending
   * one to a static-URL button is rejected by Meta.
   */
  OWNER_ENQUIRY_RECEIVED: {
    envVar: "WHATSAPP_OWNER_ENQUIRY_RECEIVED_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_ENQUIRY_RECEIVED_LANGUAGE",
    defaultName: "stayo_owner_enquiry_received",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name", "hostel_name", "tenant_name", "bed_type", "monthly_rent", "move_in_date"],
    // Static button — every owner goes to their own dashboard.
    buttonParameters: [],
  },

  /**
   * "Hello {{1}}, your enquiry for {{2}} could not be confirmed at this time.
   *  Reason: {{3}}.
   *  You can explore other available hostels on Stayo and submit a new request."
   *                                                      [Explore Hostels →]
   *
   * Marketing category, per Meta's classification of the template as shown in
   * WhatsApp Manager — it points the tenant back to Discovery.
   */
  TENANT_ENQUIRY_REJECTED: {
    envVar: "WHATSAPP_TENANT_ENQUIRY_REJECTED_TEMPLATE",
    languageEnvVar: "WHATSAPP_TENANT_ENQUIRY_REJECTED_LANGUAGE",
    defaultName: "stayo_tenant_enquiry_rejected",
    defaultLanguage: "en",
    bodyParameters: ["tenant_name", "hostel_name", "reason"],
    // Static "Explore Hostels" button — every tenant goes to the same page.
    buttonParameters: [],
  },
};

export function resolveEnquiryTemplateName(key: EnquiryTemplateKey, env: NodeJS.ProcessEnv = process.env) {
  const def = ENQUIRY_TEMPLATES[key];
  return {
    name: env[def.envVar]?.trim() || def.defaultName,
    language: env[def.languageEnvVar]?.trim() || def.defaultLanguage,
  };
}

/** WhatsApp rejects an empty body parameter, so every value must degrade to something. */
function safe(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim();
  return text || fallback;
}

/**
 * Money as the owner reads it on their own listing. The template already
 * supplies "per month", so this must not repeat it.
 */
export function formatRent(amount: unknown): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `₹${Math.round(n).toLocaleString("en-IN")}`;
}

export function buildOwnerEnquiryReceived(input: {
  ownerName?: string | null;
  hostelName?: string | null;
  tenantName?: string | null;
  bedType?: string | null;
  monthlyRent?: number | null;
  moveInDate?: string | null;
}): TemplatePayload {
  return {
    bodyParameters: [
      safe(input.ownerName, "there"),
      safe(input.hostelName, "your hostel"),
      safe(input.tenantName, "A tenant"),
      // "Not specified" rather than a blank: an enquiry with no bed preference
      // is a real case, and the owner should see that it was left open.
      safe(input.bedType, "Not specified"),
      input.monthlyRent == null ? "—" : formatRent(input.monthlyRent),
      safe(input.moveInDate, "Not specified"),
    ],
    buttonParameters: [],
  };
}

/**
 * The owner's internal lost-reason, in words the applicant can be told.
 *
 * `JOINED_COMPETITOR` and `NO_RESPONSE` are deliberately unmapped: the first
 * is the owner's read of someone else's decision, the second is an accusation,
 * and neither belongs in a message to the person it is about. Unmapped reasons
 * fall through to the template's own neutral floor rather than being repeated
 * verbatim — an internal CRM value is not a sentence.
 */
const REJECTION_REASON_TEXT: Record<string, string> = {
  PRICE_HIGH: "the budget did not match",
  LOCATION_UNSUITABLE: "the location did not suit",
  FOOD_QUALITY: "the food arrangement did not suit",
  PARENT_REJECTED: "it could not be confirmed with your family",
  OTHER: "no rooms available right now",
};

export function rejectionReasonText(reason: string | null | undefined): string | null {
  return REJECTION_REASON_TEXT[String(reason)] ?? null;
}

export function buildTenantEnquiryRejected(input: {
  tenantName?: string | null;
  hostelName?: string | null;
  reason?: string | null;
}): TemplatePayload {
  return {
    bodyParameters: [
      safe(input.tenantName, "there"),
      safe(input.hostelName, "the hostel"),
      // A rejection with no reason reads as arbitrary. The owner is asked for
      // one in the UI; this is the floor, not the expected value.
      safe(input.reason, "no rooms available right now"),
    ],
    buttonParameters: [],
  };
}
