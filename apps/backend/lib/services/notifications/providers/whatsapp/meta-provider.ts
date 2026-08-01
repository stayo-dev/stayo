import { getLogger } from "@/lib/logger";
import {
  WhatsAppConfigError,
  WhatsAppProviderError,
  WhatsAppValidationError,
} from "./errors";
import {
  OTP_TEMPLATE_CONTRACT,
  verifyOtpTemplateContractOnce,
} from "./otp-template-contract";
import type {
  MetaWhatsAppErrorBody,
  WhatsAppProviderConfig,
  WhatsAppSendResult,
  WhatsAppTemplateMessage,
  WhatsAppButton,
  WhatsAppListSection,
} from "./types";

const logger = getLogger("whatsapp.meta-provider");

const DEFAULT_BASE_URL = "https://graph.facebook.com/v19.0";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_INVITATION_TEMPLATE = "tenant_account_activation_v2";
const LEGACY_MISSING_INVITATION_TEMPLATE = "hms_tenant_invite_v2";
const DEFAULT_OWNER_ACTIVATION_TEMPLATE = "owner_lead_activation_v1";

function configFromEnv(): WhatsAppProviderConfig {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  if (!accessToken) throw new WhatsAppConfigError("WHATSAPP_ACCESS_TOKEN or WHATSAPP_TOKEN is not configured");
  if (!phoneNumberId) throw new WhatsAppConfigError("WHATSAPP_PHONE_NUMBER_ID or PHONE_NUMBER_ID is not configured");

  return {
    accessToken,
    phoneNumberId,
    businessAccountId,
    baseUrl: (process.env.WHATSAPP_API || DEFAULT_BASE_URL).replace(/\/$/, ""),
    timeoutMs: Number(process.env.WHATSAPP_TIMEOUT_MS || DEFAULT_TIMEOUT_MS),
    maxRetries: Number(process.env.WHATSAPP_MAX_RETRIES || DEFAULT_MAX_RETRIES),
  };
}

export function validateWhatsAppConfiguration() {
  if (process.env.OTP_PROVIDER !== "whatsapp") {
    return;
  }

  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || process.env.PHONE_NUMBER_ID;
  const businessAccountId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const otpTemplate = process.env.WHATSAPP_OTP_TEMPLATE;

  const missing = [];
  if (!accessToken) missing.push("WHATSAPP_ACCESS_TOKEN/WHATSAPP_TOKEN");
  if (!phoneNumberId) missing.push("WHATSAPP_PHONE_NUMBER_ID/PHONE_NUMBER_ID");
  if (!businessAccountId) missing.push("WHATSAPP_BUSINESS_ACCOUNT_ID");
  if (!otpTemplate) missing.push("WHATSAPP_OTP_TEMPLATE");

  if (missing.length > 0) {
    throw new Error(
      `CRITICAL CONFIGURATION ERROR: OTP_PROVIDER is set to 'whatsapp' but the following required environment variable(s) are missing: ${missing.join(", ")}`
    );
  }
}

export function normalizeWhatsAppPhone(raw: string): string {
  let digits = String(raw || "").replace(/\D/g, "");
  if (!digits) throw new WhatsAppValidationError("Recipient phone number is empty");

  if (digits.startsWith("0")) {
    digits = digits.slice(1);
  }

  if (digits.startsWith("91") && digits.length === 12) return digits;
  if (digits.length === 10) return `91${digits}`;
  if (digits.length < 8 || digits.length > 15) {
    throw new WhatsAppValidationError("Recipient phone number is not a valid international number");
  }
  return digits;
}

export function maskWhatsAppPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(0, digits.length - 4))}${digits.slice(-4)}`;
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

function providerCode(body: MetaWhatsAppErrorBody): string | undefined {
  const code = body.error?.code;
  const subcode = body.error?.error_subcode;
  if (code && subcode) return `${code}:${subcode}`;
  if (code) return String(code);
  return undefined;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractActivationToken(activationLink: string): string {
  try {
    const url = new URL(activationLink);
    const token = url.pathname.split("/").filter(Boolean).pop();
    return token ? decodeURIComponent(token) : activationLink;
  } catch {
    const token = String(activationLink || "").split("/").filter(Boolean).pop();
    return token || activationLink;
  }
}

function invitationTemplateName(): string {
  const configured = String(process.env.WHATSAPP_INVITATION_TEMPLATE || "").trim();
  if (!configured || configured === LEGACY_MISSING_INVITATION_TEMPLATE) {
    return DEFAULT_INVITATION_TEMPLATE;
  }
  return configured;
}

function invitationTemplateLanguage(templateName: string): string {
  const configured = String(process.env.WHATSAPP_INVITATION_LANGUAGE || "").trim();
  if (configured) return configured;
  return "en_IN";
}

function ownerActivationTemplateName(): string {
  const configured = String(process.env.WHATSAPP_OWNER_ACTIVATION_TEMPLATE || "").trim();
  return configured || DEFAULT_OWNER_ACTIVATION_TEMPLATE;
}

function ownerActivationTemplateLanguage(): string {
  const configured = String(process.env.WHATSAPP_OWNER_ACTIVATION_LANGUAGE || "").trim();
  return configured || "en_IN";
}

/** Meta requires the locale of the approved template; ours is English (US). */
export const OTP_TEMPLATE_LANGUAGE = "en_US";

/**
 * `{{2}}` is rendered to the user: "This is your OTP code for {{2}}."
 * Callers pass internal purpose codes (LEAD_CAPTURE, ParentVerify, …), so map
 * them to something a person should read. Unknown values are humanised rather
 * than rejected — a new purpose must never break OTP delivery.
 */
export function otpPurposeLabel(purpose: string): string {
  const raw = String(purpose || "").trim();
  if (!raw) return "verification";

  const known: Record<string, string> = {
    LEAD_CAPTURE: "sign up",
    PHONE_VERIFICATION: "phone verification",
    PARENTVERIFY: "parent verification",
    LOGIN: "login",
    SIGNUP: "sign up",
    PASSWORD_RESET: "password reset",
  };

  const mapped = known[raw.toUpperCase().replace(/[\s-]+/g, "_")];
  if (mapped) return mapped;

  return raw.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
}

/**
 * Build the Cloud API payload for the approved `otp` Authentication template.
 *
 * The shape is dictated by the template as approved — verified against the
 * Graph API (`GET /{WABA_ID}/message_templates?name=otp`), not assumed:
 *
 *   BODY    {{1}} = otp_code, {{2}} = purpose_label   (OTP_TEMPLATE_CONTRACT)
 *   BUTTON  Copy code URL, ...&code=otp{{1}} = otp_code
 *
 * Meta can tell us how many parameters a template takes but never what they
 * mean, so the *meaning* is declared once in `OTP_TEMPLATE_CONTRACT` and the
 * *counts* are checked against the live template by
 * `checkOtpTemplateContract()` — run at deploy time via
 * `npm run check:whatsapp-template`, once per process before the first send,
 * and on demand from /api/debug/whatsapp-health. Editing the template in
 * WhatsApp Manager therefore fails loudly here instead of as a run of Meta
 * #132000 errors against real logins.
 */
export function buildOtpTemplatePayload(input: {
  phone: string;
  otp: string;
  purpose: string;
  templateName: string;
}) {
  const code = String(input.otp);
  const includeButton = process.env.WHATSAPP_OTP_TEMPLATE_HAS_BUTTON !== "false";

  const byRole: Record<(typeof OTP_TEMPLATE_CONTRACT.bodyParameters)[number], string> = {
    otp_code: code,
    purpose_label: otpPurposeLabel(input.purpose),
  };

  const components: Array<Record<string, unknown>> = [
    {
      type: "body",
      parameters: OTP_TEMPLATE_CONTRACT.bodyParameters.map((role) => ({
        type: "text",
        text: byRole[role],
      })),
    },
  ];

  if (includeButton) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: OTP_TEMPLATE_CONTRACT.buttonParameters.map((role) => ({
        type: "text",
        text: byRole[role],
      })),
    });
  }

  return {
    messaging_product: "whatsapp",
    to: input.phone,
    type: "template",
    template: {
      name: input.templateName,
      language: { code: OTP_TEMPLATE_LANGUAGE },
      components,
    },
  };
}

export class MetaWhatsAppProvider {
  private readonly config: WhatsAppProviderConfig;

  constructor(config: WhatsAppProviderConfig = configFromEnv()) {
    this.config = config;
  }

  async sendTemplate(message: WhatsAppTemplateMessage): Promise<WhatsAppSendResult> {
    const phone = normalizeWhatsAppPhone(message.to);
    const url = `${this.config.baseUrl}/${this.config.phoneNumberId}/messages`;
    const components: any[] = [];
    if (message.bodyParameters?.length) {
      components.push({
        type: "body",
        parameters: message.bodyParameters.map((text) => ({ type: "text", text: String(text) })),
      });
    }
    if (message.buttonParameters?.length) {
      message.buttonParameters.forEach((suffix, index) => {
        components.push({
          type: "button",
          sub_type: "url",
          index,
          parameters: [{ type: "text", text: String(suffix) }],
        });
      });
    }

    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: message.templateName,
        language: message.language || { code: "en" },
        ...(components.length > 0 ? { components } : {}),
      },
    };

    let lastError: WhatsAppProviderError | null = null;
    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      try {
        const result = await this.post(url, body, attempt);
        const providerMessageId = Array.isArray((result as any)?.messages)
          ? String((result as any).messages[0]?.id || "")
          : "";
        return {
          providerMessageId: providerMessageId || null,
          raw: result,
          attempts: attempt,
        };
      } catch (error: any) {
        if (error instanceof WhatsAppProviderError) {
          lastError = error;
          if (!error.retryable || attempt > this.config.maxRetries) throw error;
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
          continue;
        }
        throw error;
      }
    }

    throw lastError || new WhatsAppProviderError({
      message: "WhatsApp send failed",
      code: "WHATSAPP_SEND_FAILED",
      retryable: false,
      attempts: this.config.maxRetries + 1,
    });
  }

  async sendTextMessage(to: string, bodyText: string): Promise<WhatsAppSendResult> {
    const phone = normalizeWhatsAppPhone(to);
    const url = `${this.config.baseUrl}/${this.config.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "text",
      text: {
        body: bodyText,
      },
    };

    let lastError: WhatsAppProviderError | null = null;
    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      try {
        const result = await this.post(url, body, attempt);
        const providerMessageId = Array.isArray((result as any)?.messages)
          ? String((result as any).messages[0]?.id || "")
          : "";
        return {
          providerMessageId: providerMessageId || null,
          raw: result,
          attempts: attempt,
        };
      } catch (error: any) {
        if (error instanceof WhatsAppProviderError) {
          lastError = error;
          if (!error.retryable || attempt > this.config.maxRetries) throw error;
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
          continue;
        }
        throw error;
      }
    }

    throw lastError || new WhatsAppProviderError({
      message: "WhatsApp send failed",
      code: "WHATSAPP_SEND_FAILED",
      retryable: false,
      attempts: this.config.maxRetries + 1,
    });
  }

  async sendButtonMessage(
    to: string,
    bodyText: string,
    buttons: WhatsAppButton[]
  ): Promise<WhatsAppSendResult> {
    const phone = normalizeWhatsAppPhone(to);
    const cleanButtons = buttons
      .filter((button) => button.id && button.title)
      .slice(0, 3)
      .map((button) => ({
        type: "reply",
        reply: {
          id: String(button.id).slice(0, 256),
          title: String(button.title).slice(0, 20),
        },
      }));

    if (cleanButtons.length === 0) {
      logger.warn("whatsapp.interactive.button.no_buttons_fallback", {
        phone: maskWhatsAppPhone(phone),
        body_chars: bodyText.length,
      });
      return this.sendTextMessage(to, bodyText);
    }

    const url = `${this.config.baseUrl}/${this.config.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "interactive",
      interactive: {
        type: "button",
        body: {
          text: bodyText,
        },
        action: {
          buttons: cleanButtons,
        },
      },
    };

    logger.info("whatsapp.interactive.button.send_started", {
      phone: maskWhatsAppPhone(phone),
      button_count: cleanButtons.length,
      button_ids: cleanButtons.map((button) => button.reply.id),
      body_chars: bodyText.length,
    });

    try {
      const result = await this.sendBody(url, body, "WhatsApp button send failed");
      logger.info("whatsapp.interactive.button.send_success", {
        phone: maskWhatsAppPhone(phone),
        providerMessageId: result.providerMessageId,
        attempts: result.attempts,
        raw: result.raw,
      });
      return result;
    } catch (error: any) {
      logger.error("whatsapp.interactive.button.send_failed", {
        phone: maskWhatsAppPhone(phone),
        status: error?.status || null,
        provider_code: error?.providerCode || null,
        error_code: error?.code || null,
        error: error?.message || String(error),
        raw: error?.raw || null,
        stack: error?.stack || null,
      });
      throw error;
    }
  }

  async sendListMessage(
    to: string,
    bodyText: string,
    sections: WhatsAppListSection[],
    buttonText = "View options"
  ): Promise<WhatsAppSendResult> {
    const phone = normalizeWhatsAppPhone(to);
    const cleanSections = sections
      .map((section) => ({
        title: String(section.title || "Options").slice(0, 24),
        rows: section.rows
          .filter((row) => row.id && row.title)
          .slice(0, 10)
          .map((row) => ({
            id: String(row.id).slice(0, 200),
            title: String(row.title).slice(0, 24),
            ...(row.description ? { description: String(row.description).slice(0, 72) } : {}),
          })),
      }))
      .filter((section) => section.rows.length > 0)
      .slice(0, 10);

    if (cleanSections.length === 0) {
      logger.warn("whatsapp.interactive.list.no_rows_fallback", {
        phone: maskWhatsAppPhone(phone),
        body_chars: bodyText.length,
      });
      return this.sendTextMessage(to, bodyText);
    }

    const url = `${this.config.baseUrl}/${this.config.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "interactive",
      interactive: {
        type: "list",
        body: {
          text: bodyText,
        },
        action: {
          button: String(buttonText || "View options").slice(0, 20),
          sections: cleanSections,
        },
      },
    };

    logger.info("whatsapp.interactive.list.send_started", {
      phone: maskWhatsAppPhone(phone),
      section_count: cleanSections.length,
      row_count: cleanSections.reduce((sum, section) => sum + section.rows.length, 0),
      row_ids: cleanSections.flatMap((section) => section.rows.map((row) => row.id)),
      body_chars: bodyText.length,
      button_text: String(buttonText || "View options").slice(0, 20),
    });

    try {
      const result = await this.sendBody(url, body, "WhatsApp list send failed");
      logger.info("whatsapp.interactive.list.send_success", {
        phone: maskWhatsAppPhone(phone),
        providerMessageId: result.providerMessageId,
        attempts: result.attempts,
        raw: result.raw,
      });
      return result;
    } catch (error: any) {
      logger.error("whatsapp.interactive.list.send_failed", {
        phone: maskWhatsAppPhone(phone),
        status: error?.status || null,
        provider_code: error?.providerCode || null,
        error_code: error?.code || null,
        error: error?.message || String(error),
        raw: error?.raw || null,
        stack: error?.stack || null,
      });
      throw error;
    }
  }

  async sendOtp(input: {
    to: string;
    otp: string;
    purpose: string;
    /** OTP record id, so send logs join the rest of the lifecycle. */
    correlationId?: string;
  }): Promise<WhatsAppSendResult> {
    const phone = normalizeWhatsAppPhone(input.to);
    const templateName = process.env.WHATSAPP_OTP_TEMPLATE;
    if (!templateName) {
      throw new WhatsAppConfigError("WHATSAPP_OTP_TEMPLATE is not configured");
    }

    const url = `${this.config.baseUrl}/${this.config.phoneNumberId}/messages`;
    const isTextMessage = templateName.toLowerCase() === "text";
    const body = isTextMessage
      ? {
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: {
            body: `Your HMS verification code is: ${input.otp}. This code is for ${input.purpose}. Valid for 5 minutes.`
          }
        }
      : buildOtpTemplatePayload({ phone, otp: input.otp, purpose: input.purpose, templateName });

    if (!isTextMessage) {
      // Once per process. Template drift throws a descriptive config error;
      // an unreachable Graph API resolves UNVERIFIED and does not block the
      // send — a Meta outage must not also take OTP delivery down.
      await verifyOtpTemplateContractOnce();
    }

    const startedAt = Date.now();
    logger.info("otp.send.started", {
      correlation_id: input.correlationId || null,
      phone: maskWhatsAppPhone(phone),
      template: templateName,
      language: OTP_TEMPLATE_LANGUAGE,
      purpose: input.purpose,
      isTextMessage,
    });

    let lastError: WhatsAppProviderError | null = null;
    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      try {
        const result = await this.post(url, body, attempt);
        const providerMessageId = Array.isArray((result as any)?.messages)
          ? String((result as any).messages[0]?.id || "")
          : "";

        logger.info("otp.send.success", {
          correlation_id: input.correlationId || null,
          phone: maskWhatsAppPhone(phone),
          template: templateName,
          providerMessageId: providerMessageId || null,
          attempts: attempt,
          duration_ms: Date.now() - startedAt,
        });

        return {
          providerMessageId: providerMessageId || null,
          raw: result,
          attempts: attempt,
        };
      } catch (error: any) {
        if (error instanceof WhatsAppProviderError) {
          lastError = error;
          if (!error.retryable || attempt > this.config.maxRetries) {
            logger.error("otp.send.failed", {
          correlation_id: input.correlationId || null,
              phone: maskWhatsAppPhone(phone),
              template: templateName,
              attempts: attempt,
              duration_ms: Date.now() - startedAt,
              error_code: error.providerCode || error.code || "WHATSAPP_SEND_FAILED",
              error: error.message,
            });
            throw error;
          }
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
          continue;
        }
        logger.error("otp.send.failed", {
          correlation_id: input.correlationId || null,
          phone: maskWhatsAppPhone(phone),
          template: templateName,
          attempts: attempt,
          duration_ms: Date.now() - startedAt,
          error_code: "WHATSAPP_UNEXPECTED_ERROR",
          error: String(error?.message || error),
        });
        throw error;
      }
    }

    throw lastError || new WhatsAppProviderError({
      message: "WhatsApp OTP send failed",
      code: "WHATSAPP_OTP_SEND_FAILED",
      retryable: false,
      attempts: this.config.maxRetries + 1,
    });
  }

  async sendInvitation(input: {
    to: string;
    tenantName: string;
    ownerName: string;
    hostelName: string;
    roomNumber: string;
    roomRent: number;
    activationLink: string;
  }): Promise<WhatsAppSendResult> {
    const phone = normalizeWhatsAppPhone(input.to);
    const templateName = invitationTemplateName();
    const languageCode = invitationTemplateLanguage(templateName);
    const activationToken = extractActivationToken(input.activationLink);
    const url = `${this.config.baseUrl}/${this.config.phoneNumberId}/messages`;
    const useText = templateName.toLowerCase() === "text";
    const body = useText
      ? {
          messaging_product: "whatsapp",
          to: phone,
          type: "text",
          text: {
            body: `Hello ${input.tenantName}, you have been invited by ${input.ownerName} to join ${input.hostelName}, Room ${input.roomNumber}. Rent: ₹${input.roomRent}. Complete your onboarding here: ${input.activationLink}`
          }
        }
      : {
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: templateName,
            language: { code: languageCode },
            components: [
              {
                type: "body",
                parameters: templateName === "tenant_account_activation_v1"
                  ? [
                      { type: "text", text: String(input.tenantName) },
                      { type: "text", text: String(input.roomNumber) },
                      { type: "text", text: String(input.roomRent) }
                    ]
                  : [
                      { type: "text", text: String(input.tenantName) },
                      { type: "text", text: String(input.ownerName || "Srinivasa Rao") },
                      { type: "text", text: String(input.roomNumber) },
                      { type: "text", text: String(input.roomRent) }
                    ],
              },
              {
                type: "button",
                sub_type: "url",
                index: "0",
                parameters: [
                  { type: "text", text: activationToken },
                ],
              },
            ]
          }
        };

    logger.info("whatsapp.invitation.send_started", {
      phone: maskWhatsAppPhone(phone),
      templateName,
      languageCode,
      useText
    });

    let lastError: WhatsAppProviderError | null = null;
    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      try {
        const result = await this.post(url, body, attempt);
        const providerMessageId = Array.isArray((result as any)?.messages)
          ? String((result as any).messages[0]?.id || "")
          : "";

        logger.info("whatsapp.invitation.send_success", {
          phone: maskWhatsAppPhone(phone),
          attempts: attempt,
          providerMessageId,
        });

        return {
          providerMessageId: providerMessageId || null,
          raw: result,
          attempts: attempt,
        };
      } catch (error: any) {
        if (error instanceof WhatsAppProviderError) {
          lastError = error;
          if (!error.retryable || attempt > this.config.maxRetries) {
            logger.error("whatsapp.invitation.send_failed", {
              phone: maskWhatsAppPhone(phone),
              attempts: attempt,
              error_code: error.providerCode || error.code || "WHATSAPP_SEND_FAILED",
              error: error.message,
            });
            throw error;
          }
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
          continue;
        }
        logger.error("whatsapp.invitation.send_failed", {
          phone: maskWhatsAppPhone(phone),
          attempts: attempt,
          error: String(error?.message || error),
        });
        throw error;
      }
    }

    throw lastError || new WhatsAppProviderError({
      message: "WhatsApp invitation send failed",
      code: "WHATSAPP_INVITATION_SEND_FAILED",
      retryable: false,
      attempts: this.config.maxRetries + 1,
    });
  }

  /**
   * Owner-lead activation link (owner-acquisition funnel, phase 2). Needs
   * its own Meta-approved template — WHATSAPP_OWNER_ACTIVATION_TEMPLATE
   * defaults to a placeholder name that must be created/approved in the
   * Meta Business dashboard before this can actually deliver; until then
   * (and always in dev, since no WhatsApp credentials are configured) this
   * throws and the caller falls back to email, same as sendInvitation.
   */
  async sendOwnerActivation(input: {
    to: string;
    ownerName: string;
    hostelName: string;
    activationLink: string;
  }): Promise<WhatsAppSendResult> {
    const phone = normalizeWhatsAppPhone(input.to);
    const templateName = ownerActivationTemplateName();
    const languageCode = ownerActivationTemplateLanguage();
    const activationToken = extractActivationToken(input.activationLink);
    const url = `${this.config.baseUrl}/${this.config.phoneNumberId}/messages`;
    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: languageCode },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: String(input.ownerName) },
              { type: "text", text: String(input.hostelName) },
            ],
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: activationToken }],
          },
        ],
      },
    };

    logger.info("whatsapp.owner_activation.send_started", {
      phone: maskWhatsAppPhone(phone),
      templateName,
      languageCode,
    });

    let lastError: WhatsAppProviderError | null = null;
    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      try {
        const result = await this.post(url, body, attempt);
        const providerMessageId = Array.isArray((result as any)?.messages)
          ? String((result as any).messages[0]?.id || "")
          : "";

        logger.info("whatsapp.owner_activation.send_success", {
          phone: maskWhatsAppPhone(phone),
          attempts: attempt,
          providerMessageId,
        });

        return {
          providerMessageId: providerMessageId || null,
          raw: result,
          attempts: attempt,
        };
      } catch (error: any) {
        if (error instanceof WhatsAppProviderError) {
          lastError = error;
          if (!error.retryable || attempt > this.config.maxRetries) {
            logger.error("whatsapp.owner_activation.send_failed", {
              phone: maskWhatsAppPhone(phone),
              attempts: attempt,
              error_code: error.providerCode || error.code || "WHATSAPP_SEND_FAILED",
              error: error.message,
            });
            throw error;
          }
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
          continue;
        }
        logger.error("whatsapp.owner_activation.send_failed", {
          phone: maskWhatsAppPhone(phone),
          attempts: attempt,
          error: String(error?.message || error),
        });
        throw error;
      }
    }

    throw lastError || new WhatsAppProviderError({
      message: "WhatsApp owner-activation send failed",
      code: "WHATSAPP_OWNER_ACTIVATION_SEND_FAILED",
      retryable: false,
      attempts: this.config.maxRetries + 1,
    });
  }

  private async post(url: string, body: unknown, attempt: number): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const rawText = await response.text();
      const parsed = rawText ? safeJson(rawText) : {};
      if (response.ok) return parsed;

      const metaBody = parsed as MetaWhatsAppErrorBody;
      const code = providerCode(metaBody);
      const message = metaBody.error?.message || `WhatsApp API returned ${response.status}`;
      throw new WhatsAppProviderError({
        message,
        code: "WHATSAPP_PROVIDER_ERROR",
        providerCode: code,
        retryable: isRetryableStatus(response.status),
        status: response.status,
        attempts: attempt,
        raw: parsed,
      });
    } catch (error: any) {
      if (error instanceof WhatsAppProviderError) throw error;
      const isAbort = error?.name === "AbortError";
      logger.warn("whatsapp.request_failed", {
        attempt,
        retryable: true,
        error: isAbort ? "request_timeout" : String(error?.message || error),
      });
      throw new WhatsAppProviderError({
        message: isAbort ? "WhatsApp request timed out" : "WhatsApp network request failed",
        code: isAbort ? "WHATSAPP_TIMEOUT" : "WHATSAPP_NETWORK_ERROR",
        retryable: true,
        attempts: attempt,
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  private async sendBody(url: string, body: unknown, failureMessage: string): Promise<WhatsAppSendResult> {
    let lastError: WhatsAppProviderError | null = null;
    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt += 1) {
      try {
        const result = await this.post(url, body, attempt);
        const providerMessageId = Array.isArray((result as any)?.messages)
          ? String((result as any).messages[0]?.id || "")
          : "";
        return {
          providerMessageId: providerMessageId || null,
          raw: result,
          attempts: attempt,
        };
      } catch (error: any) {
        if (error instanceof WhatsAppProviderError) {
          lastError = error;
          if (!error.retryable || attempt > this.config.maxRetries) throw error;
          await sleep(Math.min(1000 * 2 ** (attempt - 1), 5000));
          continue;
        }
        throw error;
      }
    }

    throw lastError || new WhatsAppProviderError({
      message: failureMessage,
      code: "WHATSAPP_SEND_FAILED",
      retryable: false,
      attempts: this.config.maxRetries + 1,
    });
  }

  async getTemplateStatus(templateName: string): Promise<{ exists: boolean; status?: string }> {
    if (!this.config.businessAccountId) {
      logger.warn("whatsapp.template_health.missing_business_account_id", { templateName });
      return { exists: false };
    }
    const url = `${this.config.baseUrl}/${this.config.businessAccountId}/message_templates?name=${encodeURIComponent(templateName)}`;
    try {
      const res = await this.get(url) as any;
      if (res && Array.isArray(res.data) && res.data.length > 0) {
        const match = res.data.find((t: any) => t.name === templateName);
        if (match) {
          return { exists: true, status: match.status };
        }
      }
      return { exists: false };
    } catch (error: any) {
      logger.error("whatsapp.template_health.fetch_failed", {
        templateName,
        error: error.message || String(error),
      });
      return { exists: false };
    }
  }

  private async get(url: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
        },
        signal: controller.signal,
      });

      const rawText = await response.text();
      const parsed = rawText ? safeJson(rawText) : {};
      if (response.ok) return parsed;

      const metaBody = parsed as MetaWhatsAppErrorBody;
      const code = providerCode(metaBody);
      const message = metaBody.error?.message || `WhatsApp API returned ${response.status}`;
      throw new WhatsAppProviderError({
        message,
        code: "WHATSAPP_PROVIDER_ERROR",
        providerCode: code,
        retryable: isRetryableStatus(response.status),
        status: response.status,
        attempts: 1,
        raw: parsed,
      });
    } catch (error: any) {
      if (error instanceof WhatsAppProviderError) throw error;
      const isAbort = error?.name === "AbortError";
      throw new WhatsAppProviderError({
        message: isAbort ? "WhatsApp request timed out" : "WhatsApp network request failed",
        code: isAbort ? "WHATSAPP_TIMEOUT" : "WHATSAPP_NETWORK_ERROR",
        retryable: true,
        attempts: 1,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

// Startup check. Deliberately logged rather than thrown (2026-07-31, ADR-034):
// this runs at *module import*, so a half-configured environment used to
// hard-500 every route that transitively imports this file — including the
// signup OTP route, whose whole job is now to degrade gracefully when WhatsApp
// is unavailable. Throwing here fired before any of that fallback logic could
// run. `validateWhatsAppConfiguration()` still throws for callers that want to
// assert; only this import-time invocation is non-fatal.
if (process.env.OTP_PROVIDER === "whatsapp") {
  try {
    validateWhatsAppConfiguration();
  } catch (error) {
    logger.error("whatsapp.configuration_invalid", {
      error: error instanceof Error ? error.message : String(error),
      consequence: "phone verification degrades to skipped for signup purposes",
    });
  }
}
