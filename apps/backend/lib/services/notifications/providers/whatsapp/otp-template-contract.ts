import { getLogger } from "@/lib/logger";
import { WhatsAppConfigError } from "./errors";

const logger = getLogger("whatsapp.otp-template");

/**
 * The OTP template contract, and its enforcement.
 *
 * `buildOtpTemplatePayload()` has to know what each positional variable means —
 * that knowledge cannot be derived from Meta, because Meta only tells us *how
 * many* parameters a template takes, never what they signify. What we can do is
 * refuse to guess when the shape changes: this module fetches the approved
 * template and fails loudly if the counts no longer match what the builder
 * fills in, so editing the template in WhatsApp Manager surfaces here rather
 * than as a run of #132000 errors against real users' logins.
 */

/** What the builder produces, in order. Positional — Meta has no names. */
export const OTP_TEMPLATE_CONTRACT = {
  /** BODY {{1}} = the one-time code, {{2}} = a human-readable purpose label. */
  bodyParameters: ["otp_code", "purpose_label"] as const,
  /** The Copy code URL button repeats the code as its single parameter. */
  buttonParameters: ["otp_code"] as const,
} as const;

export const EXPECTED_BODY_PARAMETER_COUNT = OTP_TEMPLATE_CONTRACT.bodyParameters.length;
export const EXPECTED_BUTTON_PARAMETER_COUNT = OTP_TEMPLATE_CONTRACT.buttonParameters.length;

export type MetaTemplateComponent = {
  type: string;
  text?: string;
  buttons?: Array<{ type: string; text?: string; url?: string }>;
};

export type MetaTemplateDefinition = {
  name: string;
  status: string;
  category?: string;
  language: string;
  components: MetaTemplateComponent[];
};

/** `{{1}} … {{2}}` → 2. Repeated indices count once, as Meta counts them. */
export function countPlaceholders(text: string): number {
  const matches = String(text || "").match(/\{\{\s*(\d+)\s*\}\}/g) || [];
  const indices = new Set(matches.map((token) => token.replace(/\D/g, "")));
  return indices.size;
}

export type TemplateShape = {
  bodyParameterCount: number;
  buttonParameterCount: number;
  hasButtons: boolean;
  buttonType: string | null;
};

export function describeTemplateShape(template: MetaTemplateDefinition): TemplateShape {
  const body = template.components.find((component) => component.type?.toUpperCase() === "BODY");
  const buttons = template.components.find((component) => component.type?.toUpperCase() === "BUTTONS");
  const firstButton = buttons?.buttons?.[0];

  return {
    bodyParameterCount: countPlaceholders(body?.text || ""),
    // A URL button's parameter lives in its url, e.g. "...&code=otp{{1}}".
    buttonParameterCount: firstButton ? countPlaceholders(firstButton.url || "") : 0,
    hasButtons: Boolean(firstButton),
    buttonType: firstButton?.type || null,
  };
}

/**
 * Throw a descriptive `WhatsAppConfigError` when the approved template no
 * longer matches what the payload builder fills in. The message names the
 * template, both counts, and what to do — this is read by whoever just edited
 * the template, possibly weeks later.
 */
export function assertTemplateMatchesContract(template: MetaTemplateDefinition): TemplateShape {
  const shape = describeTemplateShape(template);
  const problems: string[] = [];

  if (String(template.status).toUpperCase() !== "APPROVED") {
    problems.push(`status is ${template.status}, expected APPROVED`);
  }

  if (shape.bodyParameterCount !== EXPECTED_BODY_PARAMETER_COUNT) {
    problems.push(
      `body takes ${shape.bodyParameterCount} parameter(s), but the payload builder fills ` +
        `${EXPECTED_BODY_PARAMETER_COUNT} (${OTP_TEMPLATE_CONTRACT.bodyParameters.join(", ")})`
    );
  }

  const includeButton = process.env.WHATSAPP_OTP_TEMPLATE_HAS_BUTTON !== "false";
  if (includeButton && !shape.hasButtons) {
    problems.push(
      "template has no button, but the payload builder sends a button component " +
        "(set WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=false)"
    );
  }
  if (!includeButton && shape.hasButtons) {
    problems.push(
      `template has a ${shape.buttonType} button, but WHATSAPP_OTP_TEMPLATE_HAS_BUTTON=false ` +
        "suppresses the button component Meta requires"
    );
  }
  if (includeButton && shape.hasButtons && shape.buttonParameterCount !== EXPECTED_BUTTON_PARAMETER_COUNT) {
    problems.push(
      `button takes ${shape.buttonParameterCount} parameter(s), but the payload builder fills ` +
        `${EXPECTED_BUTTON_PARAMETER_COUNT}`
    );
  }

  if (problems.length > 0) {
    throw new WhatsAppConfigError(
      `WhatsApp OTP template "${template.name}" (${template.language}) no longer matches the payload this code builds: ` +
        `${problems.join("; ")}. Sending would fail with Meta #132000. ` +
        "Update buildOtpTemplatePayload() and OTP_TEMPLATE_CONTRACT in lib/services/notifications/providers/whatsapp/ " +
        "to match the template, or revert the template edit in WhatsApp Manager."
    );
  }

  return shape;
}

async function fetchTemplate(input: {
  templateName: string;
  wabaId: string;
  accessToken: string;
  baseUrl: string;
  timeoutMs: number;
}): Promise<MetaTemplateDefinition | null> {
  const url =
    `${input.baseUrl}/${input.wabaId}/message_templates` +
    `?name=${encodeURIComponent(input.templateName)}&fields=name,status,category,language,components`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: controller.signal,
    });
    const parsed: any = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error: any = new Error(parsed?.error?.message || `Graph API returned ${response.status}`);
      error.isFetchFailure = true;
      throw error;
    }
    const templates: MetaTemplateDefinition[] = parsed?.data || [];
    return templates.find((template) => template.name === input.templateName) || null;
  } finally {
    clearTimeout(timeout);
  }
}

export type ContractCheckResult =
  | { status: "OK"; shape: TemplateShape; templateName: string }
  | { status: "SKIPPED"; reason: string }
  | { status: "UNVERIFIED"; reason: string };

/**
 * Fetch the approved template and check it against the contract.
 *
 * Deliberate asymmetry in how the two failure modes are treated:
 *
 * - **Drift** (Meta answered, and the shape is wrong) throws. That is a real
 *   misconfiguration; every send would fail anyway, and failing here says why.
 * - **An unreachable Graph API** returns `UNVERIFIED` and does *not* throw.
 *   A Meta outage or an expired token must not take OTP delivery down on top
 *   of it — the send path has its own error handling for that.
 */
export async function checkOtpTemplateContract(options: {
  templateName?: string;
  wabaId?: string;
  accessToken?: string;
  baseUrl?: string;
  timeoutMs?: number;
} = {}): Promise<ContractCheckResult> {
  const templateName = options.templateName ?? process.env.WHATSAPP_OTP_TEMPLATE;
  const wabaId = options.wabaId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const accessToken =
    options.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.WHATSAPP_TOKEN;
  const baseUrl = (options.baseUrl ?? process.env.WHATSAPP_API ?? "https://graph.facebook.com/v19.0").replace(/\/$/, "");
  const timeoutMs = options.timeoutMs ?? Number(process.env.WHATSAPP_TIMEOUT_MS || 10_000);

  if (!templateName) return { status: "SKIPPED", reason: "WHATSAPP_OTP_TEMPLATE is not configured" };
  if (templateName.toLowerCase() === "text") {
    return { status: "SKIPPED", reason: "OTP delivery is in plain-text mode, not template mode" };
  }
  if (!accessToken) return { status: "SKIPPED", reason: "WhatsApp access token is not configured" };
  if (!wabaId) {
    return { status: "SKIPPED", reason: "WHATSAPP_BUSINESS_ACCOUNT_ID is not configured — cannot read templates" };
  }

  let template: MetaTemplateDefinition | null;
  try {
    template = await fetchTemplate({ templateName, wabaId, accessToken, baseUrl, timeoutMs });
  } catch (error: any) {
    logger.warn("otp.template.check_unavailable", {
      template: templateName,
      error: error?.message || String(error),
    });
    return { status: "UNVERIFIED", reason: error?.message || "Graph API unreachable" };
  }

  if (!template) {
    // Meta answered and the template is absent — that is drift, not an outage.
    throw new WhatsAppConfigError(
      `WhatsApp OTP template "${templateName}" was not found on WABA ${wabaId}. ` +
        "Check WHATSAPP_OTP_TEMPLATE, or that the template still exists and is approved in WhatsApp Manager."
    );
  }

  const shape = assertTemplateMatchesContract(template);
  logger.info("otp.template.verified", {
    template: template.name,
    language: template.language,
    category: template.category,
    body_parameters: shape.bodyParameterCount,
    button_parameters: shape.buttonParameterCount,
  });

  return { status: "OK", shape, templateName: template.name };
}

/**
 * Process-wide memo: the contract is checked once, not per send. Rejections are
 * not cached, so a transient failure can be retried on the next send.
 */
let inFlight: Promise<ContractCheckResult> | null = null;

export function verifyOtpTemplateContractOnce(): Promise<ContractCheckResult> {
  if (!inFlight) {
    inFlight = checkOtpTemplateContract().catch((error) => {
      inFlight = null;
      throw error;
    });
  }
  return inFlight;
}

/** Test seam. */
export function resetOtpTemplateContractCache() {
  inFlight = null;
}
