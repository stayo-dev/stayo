/**
 * Contracts for the two tenant-enquiry WhatsApp templates.
 *
 * Follows `platform-lead-template-contracts.ts` deliberately: same declared
 * parameter shape, same env-var override so a rename during Meta review is
 * config rather than a redeploy, same pure builders pinned by tests.
 *
 * The flow these serve:
 *   tenant enquires on Discovery
 *     → OWNER_ENQUIRY_RECEIVED to the hostel owner
 *     → owner calls/WhatsApps the tenant from their dashboard
 *     → positive: owner sends a tenant invitation (existing pipeline)
 *     → negative: TENANT_ENQUIRY_REJECTED to the tenant
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
   * Utility category — it is a transactional response to the owner's own
   * listing, not marketing.
   */
  OWNER_ENQUIRY_RECEIVED: {
    envVar: "WHATSAPP_OWNER_ENQUIRY_RECEIVED_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_ENQUIRY_RECEIVED_LANGUAGE",
    defaultName: "stayo_owner_enquiry_received",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name", "hostel_name", "tenant_name", "bed_type", "monthly_rent", "move_in_date"],
    buttonParameters: ["lead_id"],
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
  leadId: string;
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
    buttonParameters: [input.leadId],
  };
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
