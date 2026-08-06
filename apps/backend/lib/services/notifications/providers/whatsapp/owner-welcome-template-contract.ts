import { WhatsAppConfigError } from "./errors";
import {
  countPlaceholders,
  describeTemplateShape,
  fetchTemplate,
  type MetaTemplateDefinition,
  type TemplateShape,
} from "./otp-template-contract";

/**
 * Owner post-activation welcome template contract.
 *
 * Fires once an owner who came through the platform-leads approval funnel
 * finishes real signup (see whatsapp-owner-welcome-handler.ts) — this is a
 * "you're all set" confirmation, not the activation invite itself (that's
 * sendOwnerActivation, a separate template with its own contract TODO).
 *
 * The shape below was read from the live Graph API, not the WhatsApp
 * Manager preview:
 *
 *   stayo_owner_welcome | en_IN | APPROVED | body=1 button=0
 *   BODY: "Hello {{1}}, your Stayo owner account has been created
 *          successfully. You can now add your hostel and start managing
 *          your properties from your dashboard."
 *   BUTTON (URL, static): https://app.stayo.in/dashboard — no placeholder,
 *          so the send never attaches a button component (see
 *          MetaWhatsAppProvider.sendTemplate: an empty buttonParameters
 *          array omits the button entirely, which is correct for a static
 *          button already baked into the approved template).
 */
export const OWNER_WELCOME_TEMPLATE_CONTRACT = {
  /** BODY {{1}} = the owner's name. */
  bodyParameters: ["owner_name"] as const,
  /** The button is static in the approved template — no parameters to fill. */
  buttonParameters: [] as const,
} as const;

export const EXPECTED_OWNER_WELCOME_BODY_PARAMETERS = OWNER_WELCOME_TEMPLATE_CONTRACT.bodyParameters.length;
export const EXPECTED_OWNER_WELCOME_BUTTON_PARAMETERS = OWNER_WELCOME_TEMPLATE_CONTRACT.buttonParameters.length;

const DEFAULT_OWNER_WELCOME_TEMPLATE = "stayo_owner_welcome";
const DEFAULT_OWNER_WELCOME_LANGUAGE = "en_IN";

export function ownerWelcomeTemplateName(): string {
  const configured = String(process.env.WHATSAPP_OWNER_WELCOME_TEMPLATE || "").trim();
  return configured || DEFAULT_OWNER_WELCOME_TEMPLATE;
}

export function ownerWelcomeTemplateLanguage(): string {
  const configured = String(process.env.WHATSAPP_OWNER_WELCOME_LANGUAGE || "").trim();
  return configured || DEFAULT_OWNER_WELCOME_LANGUAGE;
}

export interface OwnerWelcomeTemplateInput {
  ownerName: string;
}

/** Pure mapper — body parameters only; the button is static, nothing to fill. */
export function buildOwnerWelcomeTemplatePayload(input: OwnerWelcomeTemplateInput): string[] {
  return [String(input.ownerName || "").trim() || "there"];
}

/**
 * Throws a descriptive `WhatsAppConfigError` when the approved template no
 * longer matches what buildOwnerWelcomeTemplatePayload fills in. Same
 * approach as invitation-template-contract.ts / otp-template-contract.ts.
 */
export function assertOwnerWelcomeTemplateMatchesContract(template: MetaTemplateDefinition): TemplateShape {
  const shape = describeTemplateShape(template);
  const problems: string[] = [];

  if (String(template.status).toUpperCase() !== "APPROVED") {
    problems.push(`status is ${template.status}, expected APPROVED`);
  }

  if (shape.bodyParameterCount !== EXPECTED_OWNER_WELCOME_BODY_PARAMETERS) {
    problems.push(
      `body takes ${shape.bodyParameterCount} parameter(s), but the payload builder fills ` +
        `${EXPECTED_OWNER_WELCOME_BODY_PARAMETERS} (${OWNER_WELCOME_TEMPLATE_CONTRACT.bodyParameters.join(", ") || "none"})`
    );
  }

  if (shape.buttonParameterCount !== EXPECTED_OWNER_WELCOME_BUTTON_PARAMETERS) {
    problems.push(
      `button takes ${shape.buttonParameterCount} parameter(s), but the send never attaches button ` +
        `parameters (contract expects ${EXPECTED_OWNER_WELCOME_BUTTON_PARAMETERS}) — if the template's button ` +
        "became dynamic, sendTemplate() needs a buttonParameters argument added for this flow"
    );
  }

  if (problems.length > 0) {
    throw new WhatsAppConfigError(
      `WhatsApp owner-welcome template "${template.name}" (${template.language}) no longer matches the payload ` +
        `this code builds: ${problems.join("; ")}. Update buildOwnerWelcomeTemplatePayload() and ` +
        "OWNER_WELCOME_TEMPLATE_CONTRACT in lib/services/notifications/providers/whatsapp/owner-welcome-template-contract.ts " +
        "to match the template, or revert the template edit in WhatsApp Manager."
    );
  }

  return shape;
}

export { countPlaceholders };

export type OwnerWelcomeContractCheckResult =
  | { status: "OK"; templateName: string; shape: TemplateShape }
  | { status: "SKIPPED"; reason: string }
  | { status: "UNVERIFIED"; reason: string };

/**
 * Deploy-time gate: does the approved owner-welcome template still match the
 * payload this code builds? Mirrors checkInvitationTemplateContract.
 */
export async function checkOwnerWelcomeTemplateContract(options: {
  templateName?: string;
  wabaId?: string;
  accessToken?: string;
  baseUrl?: string;
  timeoutMs?: number;
} = {}): Promise<OwnerWelcomeContractCheckResult> {
  const templateName = options.templateName ?? ownerWelcomeTemplateName();
  const wabaId = options.wabaId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const accessToken =
    options.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.WHATSAPP_TOKEN;
  const baseUrl = (options.baseUrl ?? process.env.WHATSAPP_API ?? "https://graph.facebook.com/v19.0").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? Number(process.env.WHATSAPP_TIMEOUT_MS || 10_000);

  if (!accessToken) return { status: "SKIPPED", reason: "WhatsApp access token is not configured" };
  if (!wabaId) {
    return { status: "SKIPPED", reason: "WHATSAPP_BUSINESS_ACCOUNT_ID is not configured — cannot read templates" };
  }

  let template: MetaTemplateDefinition | null;
  try {
    template = await fetchTemplate({ templateName, wabaId, accessToken, baseUrl, timeoutMs });
  } catch (error: any) {
    return { status: "UNVERIFIED", reason: error?.message || "Graph API unreachable" };
  }

  if (!template) {
    throw new WhatsAppConfigError(
      `WhatsApp owner-welcome template "${templateName}" was not found on WABA ${wabaId}. ` +
        "Check WHATSAPP_OWNER_WELCOME_TEMPLATE, or that the template still exists and is approved in WhatsApp Manager."
    );
  }

  const shape = assertOwnerWelcomeTemplateMatchesContract(template);
  return { status: "OK", templateName: template.name, shape };
}
