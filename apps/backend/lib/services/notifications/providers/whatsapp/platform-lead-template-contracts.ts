/**
 * Contracts for the five owner-acquisition funnel WhatsApp templates.
 *
 * Deliberately ONE registry module rather than the five separate
 * `*-template-contract.ts` files the older templates each have: these five
 * ship together, share an identical shape, and copying the per-file
 * assert/check machinery five times would be ~500 lines of duplication.
 * The guarantees are the same — declared parameter shape, env-var name
 * override, and a pure builder that a test pins against the declaration.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export type PlatformLeadTemplateKey =
  | "LEAD_RECEIVED"
  | "INVITATION"
  | "ACCOUNT_ACTIVATED"
  | "ONBOARDING_COMPLETE"
  | "LEAD_REJECTED";

export type PlatformLeadTemplateDefinition = {
  /** Env var that overrides the Meta template name, so a rename during Meta review is config, not a redeploy. */
  envVar: string;
  languageEnvVar: string;
  defaultName: string;
  defaultLanguage: string;
  /** Documentation of BODY {{1}}, {{2}}... in order. Length is asserted against the builder in tests. */
  bodyParameters: readonly string[];
  /** Dynamic URL-button suffixes, in button order. Empty for a static button. */
  buttonParameters: readonly string[];
};

export type TemplatePayload = {
  bodyParameters: string[];
  buttonParameters: string[];
};

export const PLATFORM_LEAD_TEMPLATES: Record<PlatformLeadTemplateKey, PlatformLeadTemplateDefinition> = {
  LEAD_RECEIVED: {
    envVar: "WHATSAPP_OWNER_LEAD_RECEIVED_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_LEAD_RECEIVED_LANGUAGE",
    defaultName: "stayo_owner_lead_received",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name"],
    buttonParameters: ["tracking_token"],
  },
  INVITATION: {
    envVar: "WHATSAPP_OWNER_INVITATION_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_INVITATION_LANGUAGE",
    defaultName: "stayo_owner_invitation",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name", "expiry_days"],
    buttonParameters: ["activation_token"],
  },
  ACCOUNT_ACTIVATED: {
    envVar: "WHATSAPP_OWNER_ACCOUNT_ACTIVATED_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_ACCOUNT_ACTIVATED_LANGUAGE",
    defaultName: "stayo_owner_account_activated",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name"],
    buttonParameters: [],
  },
  ONBOARDING_COMPLETE: {
    envVar: "WHATSAPP_OWNER_ONBOARDING_COMPLETE_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_ONBOARDING_COMPLETE_LANGUAGE",
    defaultName: "stayo_owner_onboarding_complete",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name", "hostel_name"],
    buttonParameters: [],
  },
  LEAD_REJECTED: {
    envVar: "WHATSAPP_OWNER_LEAD_REJECTED_TEMPLATE",
    languageEnvVar: "WHATSAPP_OWNER_LEAD_REJECTED_LANGUAGE",
    defaultName: "stayo_owner_lead_rejected",
    defaultLanguage: "en_IN",
    bodyParameters: ["owner_name", "reason"],
    buttonParameters: [],
  },
};

export function platformLeadTemplateName(key: PlatformLeadTemplateKey): string {
  const definition = PLATFORM_LEAD_TEMPLATES[key];
  const configured = String(process.env[definition.envVar] || "").trim();
  return configured || definition.defaultName;
}

export function platformLeadTemplateLanguage(key: PlatformLeadTemplateKey): string {
  const definition = PLATFORM_LEAD_TEMPLATES[key];
  const configured = String(process.env[definition.languageEnvVar] || "").trim();
  return configured || definition.defaultLanguage;
}

/**
 * Meta rejects template parameters containing newlines, tabs, or 4+
 * consecutive spaces (error 132000). Admin-authored free text — rejection
 * reasons above all — routinely contains all three.
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

export function buildLeadReceivedPayload(input: { ownerName: string; trackingToken: string }): TemplatePayload {
  return {
    bodyParameters: [safeName(input.ownerName)],
    buttonParameters: [requireToken(input.trackingToken, "tracking token")],
  };
}

export function buildInvitationPayload(input: {
  ownerName: string;
  expiryDays: number;
  activationToken: string;
}): TemplatePayload {
  return {
    bodyParameters: [safeName(input.ownerName), String(Math.max(1, Math.round(input.expiryDays)))],
    buttonParameters: [requireToken(input.activationToken, "activation token")],
  };
}

export function buildAccountActivatedPayload(input: { ownerName: string }): TemplatePayload {
  return { bodyParameters: [safeName(input.ownerName)], buttonParameters: [] };
}

export function buildOnboardingCompletePayload(input: {
  ownerName: string;
  hostelName: string;
}): TemplatePayload {
  return {
    bodyParameters: [safeName(input.ownerName), sanitizeParameter(input.hostelName) || "your hostel"],
    buttonParameters: [],
  };
}

export function buildLeadRejectedPayload(input: { ownerName: string; reason: string }): TemplatePayload {
  return {
    bodyParameters: [safeName(input.ownerName), sanitizeParameter(input.reason) || "Not specified"],
    buttonParameters: [],
  };
}
