import { WhatsAppConfigError } from "./errors";
import {
  describeTemplateShape,
  fetchTemplate,
  type MetaTemplateDefinition,
  type TemplateShape,
} from "./otp-template-contract";

/**
 * Tenant onboarding-complete template contract.
 *
 * `ONBOARDING_COMPLETED_TEMPLATE_NAME` was `tenant_onboarding_completed_v1` — a
 * template that does not exist in this WABA — and the handler hardcoded
 * language `en_IN` while the approved template is published as `en`. Every
 * post-activation "Admission Confirmed" message therefore failed at Meta. Same
 * bug class as the invitation template, one flow over.
 *
 * Read from the live Graph API, not the WhatsApp Manager UI:
 *
 *   stayo_tenant_onboarding_complete | en | APPROVED | body=6
 *   BODY: "Hello {{1}}, your admission at {{2}} is complete. Room: {{3}}.
 *          Joining Date: {{4}}. Monthly Rent: {{5}}.
 *          Rent is due on the {{6}} of every month. …"
 *   BUTTON (URL): https://yourstayo.com/  ← **static, no placeholder**
 *
 * The static button is the one meaningful difference from the invitation
 * template: Meta rejects a button component supplied for a URL that has no
 * variable, so this contract declares zero button parameters and the sender
 * must not add one.
 *
 * The body mapper itself (`buildTenantOnboardingTemplatePayload` in
 * `templates.ts`) was already correct — six parameters in exactly this order —
 * so it is reused unchanged rather than reimplemented here.
 */
export const ONBOARDING_TEMPLATE_CONTRACT = {
  bodyParameters: [
    "tenant_name",
    "hostel_name",
    "room_number",
    "joining_date",
    "monthly_rent",
    "rent_due_day",
  ] as const,
  /** The "Open Dashboard" button points at a fixed URL — nothing to fill in. */
  buttonParameters: [] as const,
} as const;

export const EXPECTED_ONBOARDING_BODY_PARAMETERS = ONBOARDING_TEMPLATE_CONTRACT.bodyParameters.length;

const DEFAULT_ONBOARDING_TEMPLATE = "stayo_tenant_onboarding_complete";

/** Never honour these even if still set in a deployed environment — they don't exist. */
const RETIRED_ONBOARDING_TEMPLATES = new Set(["tenant_onboarding_completed_v1"]);

const DEFAULT_ONBOARDING_LANGUAGE = "en";

export function onboardingTemplateName(): string {
  const configured = String(process.env.WHATSAPP_ONBOARDING_TEMPLATE || "").trim();
  if (!configured || RETIRED_ONBOARDING_TEMPLATES.has(configured)) {
    return DEFAULT_ONBOARDING_TEMPLATE;
  }
  return configured;
}

export function onboardingTemplateLanguage(): string {
  const configured = String(process.env.WHATSAPP_ONBOARDING_LANGUAGE || "").trim();
  return configured || DEFAULT_ONBOARDING_LANGUAGE;
}

export function assertOnboardingTemplateMatchesContract(template: MetaTemplateDefinition): TemplateShape {
  const shape = describeTemplateShape(template);
  const problems: string[] = [];

  if (String(template.status).toUpperCase() !== "APPROVED") {
    problems.push(`status is ${template.status}, expected APPROVED`);
  }

  if (shape.bodyParameterCount !== EXPECTED_ONBOARDING_BODY_PARAMETERS) {
    problems.push(
      `body takes ${shape.bodyParameterCount} parameter(s), but the payload builder fills ` +
        `${EXPECTED_ONBOARDING_BODY_PARAMETERS} (${ONBOARDING_TEMPLATE_CONTRACT.bodyParameters.join(", ")})`
    );
  }

  // A static-URL button is expected and needs no parameter. Only a button that
  // gained a placeholder is drift, because the sender fills none.
  if (shape.buttonParameterCount > 0) {
    problems.push(
      `button URL now takes ${shape.buttonParameterCount} parameter(s), but this template's button is ` +
        "expected to be a static link and the sender fills none"
    );
  }

  if (problems.length > 0) {
    throw new WhatsAppConfigError(
      `WhatsApp onboarding template "${template.name}" (${template.language}) no longer matches the payload ` +
        `this code builds: ${problems.join("; ")}. Sending would fail with Meta #132000. ` +
        "Update buildTenantOnboardingTemplatePayload() and ONBOARDING_TEMPLATE_CONTRACT to match the template, " +
        "or revert the template edit in WhatsApp Manager."
    );
  }

  return shape;
}

export type OnboardingContractCheckResult =
  | { status: "OK"; templateName: string; shape: TemplateShape }
  | { status: "SKIPPED"; reason: string }
  | { status: "UNVERIFIED"; reason: string };

/** Deploy-time gate. Mirrors the OTP and invitation checks; drift throws, an outage does not. */
export async function checkOnboardingTemplateContract(options: {
  templateName?: string;
  wabaId?: string;
  accessToken?: string;
  baseUrl?: string;
  timeoutMs?: number;
} = {}): Promise<OnboardingContractCheckResult> {
  const templateName = options.templateName ?? onboardingTemplateName();
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
      `WhatsApp onboarding template "${templateName}" was not found on WABA ${wabaId}. ` +
        "Check WHATSAPP_ONBOARDING_TEMPLATE, or that the template still exists and is approved in WhatsApp Manager."
    );
  }

  const shape = assertOnboardingTemplateMatchesContract(template);
  return { status: "OK", templateName: template.name, shape };
}
