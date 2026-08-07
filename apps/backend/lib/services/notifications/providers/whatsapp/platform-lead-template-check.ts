import { WhatsAppConfigError } from "./errors";
import {
  describeTemplateShape,
  fetchTemplate,
  type MetaTemplateDefinition,
  type TemplateShape,
} from "./otp-template-contract";
import {
  PLATFORM_LEAD_TEMPLATES,
  platformLeadTemplateLanguage,
  platformLeadTemplateName,
  type PlatformLeadTemplateKey,
} from "./platform-lead-template-contracts";

/**
 * Deploy-time gate for the five owner-acquisition funnel templates.
 *
 * These five are the ones most likely to drift, because they were authored by
 * hand in WhatsApp Manager rather than generated from this code, and a
 * mismatch is invisible until a real lead hits it. Two failure modes this
 * catches, both of which have already happened once:
 *
 *  - **Wrong language.** A template is addressed by (name, language). Sending
 *    `en_IN` to a template approved as `en` fails with error 132001 even
 *    though the template is perfectly healthy. Four of these five were
 *    defaulted to the wrong code until 2026-08-07.
 *  - **Shape drift.** An edit that adds or removes a `{{n}}` in the body, or
 *    makes a static button dynamic, silently breaks every send.
 *
 * Deliberately does NOT fail on a template still in review — that is a normal
 * pre-launch state, not drift, and blocking a deploy on Meta's review queue
 * would be worse than the thing it prevents.
 */
export type PlatformLeadTemplateCheck =
  | { status: "OK"; key: PlatformLeadTemplateKey; templateName: string; language: string; shape: TemplateShape }
  | { status: "PENDING_REVIEW"; key: PlatformLeadTemplateKey; templateName: string; reason: string }
  | { status: "SKIPPED"; key: PlatformLeadTemplateKey; reason: string }
  | { status: "UNVERIFIED"; key: PlatformLeadTemplateKey; reason: string };

function assertShape(
  key: PlatformLeadTemplateKey,
  template: MetaTemplateDefinition,
  expectedLanguage: string
): TemplateShape {
  const definition = PLATFORM_LEAD_TEMPLATES[key];
  const shape = describeTemplateShape(template);
  const problems: string[] = [];

  if (String(template.language) !== expectedLanguage) {
    problems.push(
      `approved language is "${template.language}" but this code sends "${expectedLanguage}" — ` +
        "a template is addressed by (name, language), so this send fails with error 132001"
    );
  }

  if (shape.bodyParameterCount !== definition.bodyParameters.length) {
    problems.push(
      `body takes ${shape.bodyParameterCount} parameter(s), but the payload builder fills ` +
        `${definition.bodyParameters.length} (${definition.bodyParameters.join(", ") || "none"})`
    );
  }

  if (shape.buttonParameterCount !== definition.buttonParameters.length) {
    problems.push(
      `the first button takes ${shape.buttonParameterCount} parameter(s), but the builder fills ` +
        `${definition.buttonParameters.length} (${definition.buttonParameters.join(", ") || "none"})`
    );
  }

  if (problems.length > 0) {
    throw new WhatsAppConfigError(
      `WhatsApp template "${template.name}" (${template.language}) no longer matches what this code sends: ` +
        `${problems.join("; ")}. Update PLATFORM_LEAD_TEMPLATES.${key} in ` +
        "lib/services/notifications/providers/whatsapp/platform-lead-template-contracts.ts to match the " +
        "template, or revert the edit in WhatsApp Manager."
    );
  }

  return shape;
}

export async function checkPlatformLeadTemplate(
  key: PlatformLeadTemplateKey,
  options: { wabaId?: string; accessToken?: string; baseUrl?: string; timeoutMs?: number } = {}
): Promise<PlatformLeadTemplateCheck> {
  const templateName = platformLeadTemplateName(key);
  const expectedLanguage = platformLeadTemplateLanguage(key);
  const wabaId = options.wabaId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const accessToken =
    options.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.WHATSAPP_TOKEN;
  const baseUrl = (options.baseUrl ?? process.env.WHATSAPP_API ?? "https://graph.facebook.com/v19.0").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? Number(process.env.WHATSAPP_TIMEOUT_MS || 10_000);

  if (!accessToken) return { status: "SKIPPED", key, reason: "WhatsApp access token is not configured" };
  if (!wabaId) {
    return { status: "SKIPPED", key, reason: "WHATSAPP_BUSINESS_ACCOUNT_ID is not configured" };
  }

  let template: MetaTemplateDefinition | null;
  try {
    template = await fetchTemplate({ templateName, wabaId, accessToken, baseUrl, timeoutMs });
  } catch (error: any) {
    return { status: "UNVERIFIED", key, reason: error?.message || "Graph API unreachable" };
  }

  if (!template) {
    throw new WhatsAppConfigError(
      `WhatsApp template "${templateName}" was not found on WABA ${wabaId}. Create it in WhatsApp Manager, ` +
        `or point ${PLATFORM_LEAD_TEMPLATES[key].envVar} at the template that replaces it.`
    );
  }

  const status = String(template.status).toUpperCase();
  if (status !== "APPROVED") {
    // Still in review is a normal pre-launch state, not drift. Report it
    // loudly, but never fail a deploy on Meta's review queue.
    return {
      status: "PENDING_REVIEW",
      key,
      templateName: template.name,
      reason: `status is ${template.status} — sends using this template will fail until Meta approves it`,
    };
  }

  const shape = assertShape(key, template, expectedLanguage);
  return { status: "OK", key, templateName: template.name, language: String(template.language), shape };
}

export const PLATFORM_LEAD_TEMPLATE_KEYS = Object.keys(PLATFORM_LEAD_TEMPLATES) as PlatformLeadTemplateKey[];
