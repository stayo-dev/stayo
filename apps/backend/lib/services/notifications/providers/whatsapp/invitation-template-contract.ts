import { WhatsAppConfigError } from "./errors";
import {
  countPlaceholders,
  describeTemplateShape,
  fetchTemplate,
  type MetaTemplateDefinition,
  type TemplateShape,
} from "./otp-template-contract";

/**
 * Tenant invitation template contract.
 *
 * The payload builder used to send **four** body parameters (tenant, owner,
 * room, rent) while the approved template declares **two**, and defaulted to
 * language `en_IN` against a template published as `en`. Every invitation
 * therefore failed at Meta with #132000 / #132001. That was invisible until
 * the invite wizard stopped claiming success on a failed send.
 *
 * The shape below was read from the live Graph API, not from the WhatsApp
 * Manager UI:
 *
 *   stayo_tenant_invitation | en | APPROVED | body=2 button=1
 *   BODY: "Hello {{1}}, you have been invited to join {{2}} on Stayo. …"
 *   BUTTON (URL): https://yourstayo.com/activate/{{1}}
 *
 * Parameter *meanings* are declared once here; the *counts* are checked
 * against the live template by `checkInvitationTemplateContract()`, so editing
 * the template in WhatsApp Manager fails a deploy rather than silently
 * breaking every invitation. Same approach as `otp-template-contract.ts`,
 * whose generic helpers this reuses rather than re-deriving.
 */
export const INVITATION_TEMPLATE_CONTRACT = {
  /** BODY {{1}} = tenant's name, {{2}} = the hostel they were invited to. */
  bodyParameters: ["tenant_name", "hostel_name"] as const,
  /** The "Activate Account" URL button takes the activation token. */
  buttonParameters: ["activation_token"] as const,
} as const;

export const EXPECTED_INVITATION_BODY_PARAMETERS = INVITATION_TEMPLATE_CONTRACT.bodyParameters.length;
export const EXPECTED_INVITATION_BUTTON_PARAMETERS = INVITATION_TEMPLATE_CONTRACT.buttonParameters.length;

/** The approved template. Was `tenant_account_activation_v2`, which never existed in this WABA. */
const DEFAULT_INVITATION_TEMPLATE = "stayo_tenant_invitation";

/**
 * Retired names that must not be honoured even if still set in a deployed
 * environment — pointing at a template that doesn't exist fails every send.
 */
const RETIRED_INVITATION_TEMPLATES = new Set([
  "hms_tenant_invite_v2",
  "tenant_account_activation_v1",
  "tenant_account_activation_v2",
]);

/** The language the template is published in. `en` and `en_IN` are different templates to Meta. */
const DEFAULT_INVITATION_LANGUAGE = "en";

export function invitationTemplateName(): string {
  const configured = String(process.env.WHATSAPP_INVITATION_TEMPLATE || "").trim();
  if (!configured || RETIRED_INVITATION_TEMPLATES.has(configured)) {
    return DEFAULT_INVITATION_TEMPLATE;
  }
  return configured;
}

export function invitationTemplateLanguage(): string {
  const configured = String(process.env.WHATSAPP_INVITATION_LANGUAGE || "").trim();
  return configured || DEFAULT_INVITATION_LANGUAGE;
}

/** `https://host/activate/<token>` → `<token>`. */
export function extractActivationToken(activationLink: string): string {
  try {
    const url = new URL(activationLink);
    const token = url.pathname.split("/").filter(Boolean).pop();
    return token ? decodeURIComponent(token) : activationLink;
  } catch {
    const token = String(activationLink || "").split("/").filter(Boolean).pop();
    return token || activationLink;
  }
}

export interface InvitationTemplateInput {
  tenantName: string;
  hostelName: string;
  activationLink: string;
}

/**
 * Builds the `components` array for the invitation template send.
 *
 * Exactly the contract above — nothing more. Meta rejects both a wrong
 * parameter count and an empty parameter, so each value is coerced to
 * something non-empty.
 */
export function buildInvitationTemplatePayload(input: InvitationTemplateInput) {
  const tenantName = String(input.tenantName || "").trim() || "there";
  const hostelName = String(input.hostelName || "").trim() || "your hostel";

  return {
    components: [
      {
        type: "body",
        parameters: [
          { type: "text", text: tenantName },
          { type: "text", text: hostelName },
        ],
      },
      {
        type: "button",
        sub_type: "url",
        index: "0",
        parameters: [{ type: "text", text: extractActivationToken(input.activationLink) }],
      },
    ],
  };
}

/**
 * Throws a descriptive `WhatsAppConfigError` when the approved template no
 * longer matches what `buildInvitationTemplatePayload` fills in. The message
 * names the template, both counts, the Meta error this would cause, and what
 * to change — read by whoever edited the template, possibly weeks later.
 */
export function assertInvitationTemplateMatchesContract(template: MetaTemplateDefinition): TemplateShape {
  const shape = describeTemplateShape(template);
  const problems: string[] = [];

  if (String(template.status).toUpperCase() !== "APPROVED") {
    problems.push(`status is ${template.status}, expected APPROVED`);
  }

  if (shape.bodyParameterCount !== EXPECTED_INVITATION_BODY_PARAMETERS) {
    problems.push(
      `body takes ${shape.bodyParameterCount} parameter(s), but the payload builder fills ` +
        `${EXPECTED_INVITATION_BODY_PARAMETERS} (${INVITATION_TEMPLATE_CONTRACT.bodyParameters.join(", ")})`
    );
  }

  if (!shape.hasButtons) {
    problems.push(
      "template has no button, but the payload builder sends the activation link as a URL button " +
        "parameter — without it the tenant receives no way to activate"
    );
  } else if (shape.buttonParameterCount !== EXPECTED_INVITATION_BUTTON_PARAMETERS) {
    problems.push(
      `button takes ${shape.buttonParameterCount} parameter(s), but the payload builder fills ` +
        `${EXPECTED_INVITATION_BUTTON_PARAMETERS} (${INVITATION_TEMPLATE_CONTRACT.buttonParameters.join(", ")})`
    );
  }

  if (problems.length > 0) {
    throw new WhatsAppConfigError(
      `WhatsApp invitation template "${template.name}" (${template.language}) no longer matches the payload ` +
        `this code builds: ${problems.join("; ")}. Sending would fail with Meta #132000. ` +
        "Update buildInvitationTemplatePayload() and INVITATION_TEMPLATE_CONTRACT in " +
        "lib/services/notifications/providers/whatsapp/invitation-template-contract.ts to match the template, " +
        "or revert the template edit in WhatsApp Manager."
    );
  }

  return shape;
}

export { countPlaceholders };

export type InvitationContractCheckResult =
  | { status: "OK"; templateName: string; shape: TemplateShape }
  | { status: "SKIPPED"; reason: string }
  | { status: "UNVERIFIED"; reason: string };

/**
 * Deploy-time gate: does the approved invitation template still match the
 * payload this code builds?
 *
 * Mirrors `checkOtpTemplateContract` and reuses its `fetchTemplate` rather
 * than repeating the Graph call. Same deliberate asymmetry: real drift throws,
 * but an unreachable Graph API resolves UNVERIFIED — a Meta outage must not
 * fail a deploy on top of itself.
 */
export async function checkInvitationTemplateContract(options: {
  templateName?: string;
  wabaId?: string;
  accessToken?: string;
  baseUrl?: string;
  timeoutMs?: number;
} = {}): Promise<InvitationContractCheckResult> {
  const templateName = options.templateName ?? invitationTemplateName();
  const wabaId = options.wabaId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const accessToken =
    options.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.WHATSAPP_TOKEN;
  const baseUrl = (options.baseUrl ?? process.env.WHATSAPP_API ?? "https://graph.facebook.com/v19.0").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? Number(process.env.WHATSAPP_TIMEOUT_MS || 10_000);

  if (templateName.toLowerCase() === "text") {
    return { status: "SKIPPED", reason: "Invitation delivery is in plain-text mode, not template mode" };
  }
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
    // Meta answered and the template is absent — drift, not an outage.
    throw new WhatsAppConfigError(
      `WhatsApp invitation template "${templateName}" was not found on WABA ${wabaId}. ` +
        "Check WHATSAPP_INVITATION_TEMPLATE, or that the template still exists and is approved in WhatsApp Manager."
    );
  }

  const shape = assertInvitationTemplateMatchesContract(template);
  return { status: "OK", templateName: template.name, shape };
}
