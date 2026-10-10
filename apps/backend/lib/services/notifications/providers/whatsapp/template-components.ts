import type { WhatsAppTemplateMessage } from "./types";

/**
 * Meta's template `components` array, extracted from `sendTemplate` so it can
 * be tested without a network. Quick-reply payloads (special-meal choices) sit
 * alongside the long-standing URL-button suffixes. A template has one or the
 * other, never both, so their indexes never collide.
 *
 * PURE MODULE.
 */
export function buildTemplateComponents(
  message: Pick<WhatsAppTemplateMessage, "headerDocument" | "bodyParameters" | "buttonParameters" | "quickReplyPayloads">,
): any[] {
  const components: any[] = [];
  if (message.headerDocument) {
    const docObj: Record<string, string> = {};
    if (message.headerDocument.mediaId) docObj.id = message.headerDocument.mediaId;
    else if (message.headerDocument.link) docObj.link = message.headerDocument.link;
    if (message.headerDocument.filename) docObj.filename = message.headerDocument.filename;
    components.push({ type: "header", parameters: [{ type: "document", document: docObj }] });
  }
  if (message.bodyParameters?.length) {
    components.push({ type: "body", parameters: message.bodyParameters.map((text) => ({ type: "text", text: String(text) })) });
  }
  message.buttonParameters?.forEach((suffix, index) => {
    components.push({ type: "button", sub_type: "url", index, parameters: [{ type: "text", text: String(suffix) }] });
  });
  message.quickReplyPayloads?.forEach((payload, index) => {
    components.push({ type: "button", sub_type: "quick_reply", index, parameters: [{ type: "payload", payload: String(payload) }] });
  });
  return components;
}
