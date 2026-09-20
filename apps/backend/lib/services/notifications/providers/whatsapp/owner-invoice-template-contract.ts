import { WhatsAppConfigError } from "./errors";
import { countPlaceholders, fetchTemplate, type MetaTemplateDefinition } from "./otp-template-contract";

/**
 * Owner-invoice WhatsApp document-template contract.
 *
 * Fires after a generic owner payment ([[owner-payment-service.ts]]) is
 * recorded — this carries the invoice PDF itself as a WhatsApp document
 * header, not just a text nudge (see owner-invoice-whatsapp-service.ts for
 * why the earlier freeform-text approach was replaced: it only worked inside
 * Meta's 24h customer-service window).
 *
 * UNLIKE every other contract in this directory, this template's shape was
 * **not** read from a live, already-approved Graph API template — no such
 * template exists in this WABA yet. This file is the *specification* for
 * the template that needs to be created in WhatsApp Manager and submitted
 * for Meta approval:
 *
 *   Category: UTILITY
 *   Header:   DOCUMENT (dynamic — filled per-send via `headerDocument.link`)
 *   Body:     "Hello {{1}}, we've received your payment of {{2}} for {{3}}.
 *              Your invoice {{4}} is attached above as a PDF."
 *   Buttons:  none
 *
 * Until that template exists and is APPROVED, `ownerInvoiceTemplateName()`
 * still resolves to a name (env override or the default below) and sends
 * will legitimately fail — `owner-invoice-whatsapp-service.ts` surfaces that
 * as a clear `TEMPLATE_NOT_CONFIGURED`/`TEMPLATE_SEND_FAILED` reason rather
 * than silently falling back to a freeform message (business requirement).
 */
export const OWNER_INVOICE_TEMPLATE_CONTRACT = {
  /** BODY {{1..4}} = owner name, amount (formatted), description, invoice number. */
  bodyParameters: ["owner_name", "amount_label", "description", "invoice_number"] as const,
  /** DOCUMENT header, filled per-send from the invoice's own PDF URL. */
  headerType: "DOCUMENT" as const,
} as const;

export const EXPECTED_OWNER_INVOICE_BODY_PARAMETERS = OWNER_INVOICE_TEMPLATE_CONTRACT.bodyParameters.length;

const DEFAULT_OWNER_INVOICE_TEMPLATE = "owner_invoice_ready_v1";
const DEFAULT_OWNER_INVOICE_LANGUAGE = "en_IN";

/** `WHATSAPP_OWNER_INVOICE_TEMPLATE_NAME` — reuse this env var if it is already set for this purpose. */
export function ownerInvoiceTemplateName(): string {
  const configured = String(process.env.WHATSAPP_OWNER_INVOICE_TEMPLATE_NAME || "").trim();
  return configured || DEFAULT_OWNER_INVOICE_TEMPLATE;
}

export function ownerInvoiceTemplateLanguage(): string {
  const configured = String(process.env.WHATSAPP_OWNER_INVOICE_TEMPLATE_LANGUAGE || "").trim();
  return configured || DEFAULT_OWNER_INVOICE_LANGUAGE;
}

export interface OwnerInvoiceTemplateInput {
  ownerName: string;
  amountLabel: string;
  description: string;
  invoiceNumber: string;
}

/** Pure mapper — body parameters only, in the order Meta will fill {{1}}..{{4}}. */
export function buildOwnerInvoiceTemplatePayload(input: OwnerInvoiceTemplateInput): string[] {
  return [
    String(input.ownerName || "").trim() || "there",
    String(input.amountLabel || "").trim() || "—",
    String(input.description || "").trim() || "Payment to Stayo",
    String(input.invoiceNumber || "").trim() || "—",
  ];
}

type OwnerInvoiceTemplateShape = {
  bodyParameterCount: number;
  hasDocumentHeader: boolean;
};

function describeOwnerInvoiceTemplateShape(template: MetaTemplateDefinition): OwnerInvoiceTemplateShape {
  const body = template.components.find((component) => component.type?.toUpperCase() === "BODY");
  const header = template.components.find((component) => component.type?.toUpperCase() === "HEADER") as
    | { type: string; format?: string }
    | undefined;

  return {
    bodyParameterCount: countPlaceholders(body?.text || ""),
    hasDocumentHeader: String(header?.format || "").toUpperCase() === "DOCUMENT",
  };
}

/**
 * Throws a descriptive `WhatsAppConfigError` when the approved template no
 * longer matches (or never matched) the payload this code builds. Same
 * approach as every other `assertXTemplateMatchesContract` in this
 * directory — the one addition is checking for a DOCUMENT header, since no
 * prior template contract here has ever needed one.
 */
export function assertOwnerInvoiceTemplateMatchesContract(template: MetaTemplateDefinition): OwnerInvoiceTemplateShape {
  const shape = describeOwnerInvoiceTemplateShape(template);
  const problems: string[] = [];

  if (String(template.status).toUpperCase() !== "APPROVED") {
    problems.push(`status is ${template.status}, expected APPROVED`);
  }
  if (!shape.hasDocumentHeader) {
    problems.push("template has no DOCUMENT header — the invoice PDF cannot be attached without one");
  }
  if (shape.bodyParameterCount !== EXPECTED_OWNER_INVOICE_BODY_PARAMETERS) {
    problems.push(
      `body takes ${shape.bodyParameterCount} parameter(s), but the payload builder fills ` +
        `${EXPECTED_OWNER_INVOICE_BODY_PARAMETERS} (${OWNER_INVOICE_TEMPLATE_CONTRACT.bodyParameters.join(", ")})`
    );
  }

  if (problems.length > 0) {
    throw new WhatsAppConfigError(
      `WhatsApp owner-invoice template "${template.name}" (${template.language}) does not match what this code ` +
        `needs: ${problems.join("; ")}. Create/update the template in WhatsApp Manager (category UTILITY, a ` +
        "DOCUMENT header, and a 4-placeholder body — see the spec at the top of " +
        "lib/services/notifications/providers/whatsapp/owner-invoice-template-contract.ts), get it approved by " +
        "Meta, then set WHATSAPP_OWNER_INVOICE_TEMPLATE_NAME if its name differs from the default."
    );
  }

  return shape;
}

export type OwnerInvoiceContractCheckResult =
  | { status: "OK"; templateName: string; shape: OwnerInvoiceTemplateShape }
  | { status: "SKIPPED"; reason: string }
  | { status: "UNVERIFIED"; reason: string }
  | { status: "NOT_FOUND"; templateName: string; reason: string };

/**
 * Deploy-time / ops gate: does the configured owner-invoice template exist
 * and match the payload this code builds? Unlike the other `checkX...`
 * functions in this directory, `NOT_FOUND` is a real, expected status here
 * (not an exception) — the template most likely has not been created in
 * WhatsApp Manager yet. Call this from `scripts/check-whatsapp-template.ts`
 * or an admin diagnostics page, not from the hot send path.
 */
export async function checkOwnerInvoiceTemplateContract(options: {
  templateName?: string;
  wabaId?: string;
  accessToken?: string;
  baseUrl?: string;
  timeoutMs?: number;
} = {}): Promise<OwnerInvoiceContractCheckResult> {
  const templateName = options.templateName ?? ownerInvoiceTemplateName();
  const wabaId = options.wabaId ?? process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const accessToken = options.accessToken ?? process.env.WHATSAPP_ACCESS_TOKEN ?? process.env.WHATSAPP_TOKEN;
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
    return {
      status: "NOT_FOUND",
      templateName,
      reason:
        `No WhatsApp template named "${templateName}" exists on WABA ${wabaId} yet — create it in WhatsApp ` +
        "Manager per the spec in this file's header comment and submit it for Meta approval, then re-run this check.",
    };
  }

  const shape = assertOwnerInvoiceTemplateMatchesContract(template);
  return { status: "OK", templateName: template.name, shape };
}
