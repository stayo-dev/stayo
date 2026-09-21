/**
 * Contracts for the marketplace-partner WhatsApp templates — the messages an
 * off-platform hostel owner receives about their Stayo-authored listing.
 *
 * One registry module rather than a file per template, following
 * `platform-lead-template-contracts.ts`: these ship together, share a shape,
 * and copying the assert/check machinery four times would be pure duplication.
 * The guarantees are the same — declared parameter shape, env-var name
 * override so a rename during Meta review is config rather than a redeploy,
 * and pure builders a test pins against the declaration.
 *
 * All four were approved in the Stayo WABA on 2026-09-21. Two came back
 * MARKETING rather than the UTILITY they were submitted as (see
 * `category` below) — recorded here because it changes their cost, their
 * rate limits and their block risk, none of which are visible from the code.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export type PartnerTemplateKey =
  | "LISTING_LIVE"
  | "NEW_ENQUIRY"
  | "ENQUIRY_LOCKED"
  | "ACTIVATED";

/**
 * Meta's own categorisation, not our intent. `NEW_ENQUIRY` clearing as
 * UTILITY is what makes the funnel affordable — it is the only template sent
 * on every single enquiry. Adding promotional language to it would earn a
 * recategorisation to MARKETING and a frequency cap on the one message that
 * must never be capped.
 */
export type TemplateCategory = "UTILITY" | "MARKETING";

export type PartnerTemplateDefinition = {
  envVar: string;
  languageEnvVar: string;
  defaultName: string;
  defaultLanguage: string;
  category: TemplateCategory;
  /** Documentation of BODY {{1}}, {{2}}... in order. Length is asserted against the builder in tests. */
  bodyParameters: readonly string[];
  /** Dynamic URL-button suffixes, in button order. Empty for a static button. Quick replies take no parameter. */
  buttonParameters: readonly string[];
  /** Approved in Meta as of 2026-09-21. `false` means every send will fail, loudly. */
  approved: boolean;
};

export type TemplatePayload = {
  bodyParameters: string[];
  buttonParameters: string[];
};

export const PARTNER_TEMPLATES: Record<PartnerTemplateKey, PartnerTemplateDefinition> = {
  /**
   * First contact. Submitted as UTILITY, returned as MARKETING — so this is a
   * marketing-category message, sent on offline consent, as the first thing a
   * cold owner ever receives from us. The highest block-risk message we send;
   * see the design doc's note on using a separate sender number.
   */
  LISTING_LIVE: {
    envVar: "WHATSAPP_PARTNER_LISTING_LIVE_TEMPLATE",
    languageEnvVar: "WHATSAPP_PARTNER_LISTING_LIVE_LANGUAGE",
    defaultName: "stayo_partner_listing_live",
    defaultLanguage: "en",
    category: "MARKETING",
    bodyParameters: ["owner_name", "hostel_name", "city"],
    buttonParameters: ["portal_token"],
    approved: true,
  },

  /** The workhorse. UTILITY. Sent on every delivered enquiry inside the free quota. */
  NEW_ENQUIRY: {
    envVar: "WHATSAPP_PARTNER_NEW_ENQUIRY_TEMPLATE",
    languageEnvVar: "WHATSAPP_PARTNER_NEW_ENQUIRY_LANGUAGE",
    defaultName: "stayo_partner_new_enquiry",
    defaultLanguage: "en",
    category: "UTILITY",
    bodyParameters: [
      "owner_name",
      "hostel_name",
      "student_name",
      "move_in",
      "delivered_count",
      "free_quota",
    ],
    buttonParameters: ["delivery_token"],
    approved: true,
  },

  /** The conversion moment. MARKETING, with a `Stop promotions` quick reply. */
  ENQUIRY_LOCKED: {
    envVar: "WHATSAPP_PARTNER_ENQUIRY_LOCKED_TEMPLATE",
    languageEnvVar: "WHATSAPP_PARTNER_ENQUIRY_LOCKED_LANGUAGE",
    defaultName: "stayo_partner_enquiry_locked",
    defaultLanguage: "en",
    category: "MARKETING",
    /**
     * `enquiries_this_month`, not a lifetime total: the approved copy reads
     * "That is {{3}} students this month." A lifetime count here would make
     * the message say something untrue.
     */
    bodyParameters: ["owner_name", "hostel_name", "enquiries_this_month", "free_quota"],
    buttonParameters: ["activation_token"],
    approved: true,
  },

  /**
   * The post-claim payoff. NOT YET SUBMITTED to Meta — every send will fail
   * until it is approved, which is correct: the alternative is pretending a
   * message went out.
   */
  ACTIVATED: {
    envVar: "WHATSAPP_PARTNER_ACTIVATED_TEMPLATE",
    languageEnvVar: "WHATSAPP_PARTNER_ACTIVATED_LANGUAGE",
    defaultName: "stayo_partner_activated",
    defaultLanguage: "en",
    category: "UTILITY",
    bodyParameters: ["owner_name", "hostel_name", "released_count"],
    buttonParameters: [],
    approved: false,
  },
};

export function partnerTemplateName(key: PartnerTemplateKey): string {
  const definition = PARTNER_TEMPLATES[key];
  const configured = String(process.env[definition.envVar] || "").trim();
  return configured || definition.defaultName;
}

export function partnerTemplateLanguage(key: PartnerTemplateKey): string {
  const definition = PARTNER_TEMPLATES[key];
  const configured = String(process.env[definition.languageEnvVar] || "").trim();
  return configured || definition.defaultLanguage;
}

export function isPartnerTemplateApproved(key: PartnerTemplateKey): boolean {
  return PARTNER_TEMPLATES[key].approved;
}

/**
 * Meta rejects template parameters containing newlines, tabs, or 4+
 * consecutive spaces (error 132000). Hostel names and student names are
 * user-authored and routinely contain all three.
 */
function sanitizeParameter(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function safeName(value: unknown): string {
  return sanitizeParameter(value) || "there";
}

function requireToken(value: unknown, label: string): string {
  const token = sanitizeParameter(value);
  if (!token) {
    throw new Error(
      `Cannot build WhatsApp payload: ${label} is empty. Meta rejects a send with a blank URL-button parameter.`
    );
  }
  return token;
}

/**
 * A count rendered into a sentence the owner will check against their own
 * memory. Never negative, never a decimal, never "NaN".
 */
function safeCount(value: unknown): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return "0";
  return String(Math.max(0, Math.floor(n)));
}

export function buildListingLivePayload(input: {
  ownerName: string;
  hostelName: string;
  city: string;
  portalToken: string;
}): TemplatePayload {
  return {
    bodyParameters: [
      safeName(input.ownerName),
      sanitizeParameter(input.hostelName) || "your hostel",
      sanitizeParameter(input.city) || "your city",
    ],
    buttonParameters: [requireToken(input.portalToken, "portal token")],
  };
}

export function buildNewEnquiryPayload(input: {
  ownerName: string;
  hostelName: string;
  studentName: string;
  moveIn?: string | null;
  deliveredCount: number;
  freeQuota: number;
  deliveryToken: string;
}): TemplatePayload {
  return {
    bodyParameters: [
      safeName(input.ownerName),
      sanitizeParameter(input.hostelName) || "your hostel",
      safeName(input.studentName),
      // An enquiry with no stated move-in date is normal, not an error. Meta
      // rejects an empty parameter, so the absence has to be said out loud.
      sanitizeParameter(input.moveIn) || "Not specified",
      safeCount(input.deliveredCount),
      safeCount(input.freeQuota),
    ],
    buttonParameters: [requireToken(input.deliveryToken, "delivery token")],
  };
}

export function buildEnquiryLockedPayload(input: {
  ownerName: string;
  hostelName: string;
  enquiriesThisMonth: number;
  freeQuota: number;
  activationToken: string;
}): TemplatePayload {
  return {
    bodyParameters: [
      safeName(input.ownerName),
      sanitizeParameter(input.hostelName) || "your hostel",
      safeCount(input.enquiriesThisMonth),
      safeCount(input.freeQuota),
    ],
    buttonParameters: [requireToken(input.activationToken, "activation token")],
  };
}

export function buildActivatedPayload(input: {
  ownerName: string;
  hostelName: string;
  releasedCount: number;
}): TemplatePayload {
  return {
    bodyParameters: [
      safeName(input.ownerName),
      sanitizeParameter(input.hostelName) || "your hostel",
      safeCount(input.releasedCount),
    ],
    buttonParameters: [],
  };
}
