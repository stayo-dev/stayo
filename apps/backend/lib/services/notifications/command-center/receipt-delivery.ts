/**
 * Getting a receipt PDF onto a WhatsApp thread.
 *
 * Two ways exist and they are not equal. `document.link` makes Meta fetch the
 * file, which requires a publicly reachable URL — and that quietly made
 * receipt delivery depend on ImageKit being configured, because
 * `lib/imagekit.ts` mocks uploads without `IMAGEKIT_PRIVATE_KEY` and stores a
 * placeholder URL on the receipt. Uploading the bytes to Meta's own media
 * store has no such dependency, and the bytes are already in hand.
 *
 * So: upload first, fall back to a real URL, and report failure rather than
 * throwing — the caller owes the reader an explanation either way.
 */

import { getLogger } from "@/lib/logger";
import type { MetaWhatsAppProvider } from "../providers/whatsapp";
import type { ReceiptDocument } from "./context";

const logger = getLogger("whatsapp.command-center.receipt-delivery");

export async function sendReceiptDocument(
  provider: MetaWhatsAppProvider,
  phone: string,
  document: ReceiptDocument,
  caption?: string
): Promise<boolean> {
  if (document.bytes) {
    try {
      const mediaId = await provider.uploadMedia(document.bytes, "application/pdf", document.filename);
      await provider.sendDocumentMessage(phone, { mediaId }, document.filename, caption);
      return true;
    } catch (error: any) {
      logger.warn("receipt_delivery.media_upload_failed", {
        receipt_number: document.receiptNumber,
        error: error?.message || String(error),
      });
      // Fall through to the link, if there is a real one.
    }
  }

  if (document.url) {
    try {
      await provider.sendDocumentMessage(phone, { link: document.url }, document.filename, caption);
      return true;
    } catch (error: any) {
      logger.warn("receipt_delivery.link_send_failed", {
        receipt_number: document.receiptNumber,
        error: error?.message || String(error),
      });
    }
  }

  logger.error("receipt_delivery.failed", { receipt_number: document.receiptNumber });
  return false;
}
