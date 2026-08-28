/**
 * The message that closes the loop after a payment lands.
 *
 * The old flow went silent here. A guardian tapped a payment link, paid, and
 * WhatsApp said nothing — the thread that had asked for money never
 * acknowledged receiving it. That silence is where a collections channel loses
 * its credibility: the next reminder arrives from a number that, for all the
 * reader knows, has no idea they already paid.
 *
 * Sent to the resident, and to every guardian who has completed verification —
 * an unverified guardian number is not told what a family paid, for the same
 * reason it is not told what they owe.
 *
 * Never throws. A confirmation that fails must not roll back a payment that
 * succeeded, which is why the caller is an event listener and not the
 * transaction.
 */

import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { MetaWhatsAppProvider } from "../providers/whatsapp";
import { buildReceipt, ensureReceiptDocument, listPayments, loadResidentContext } from "./context";
import { formatPaymentConfirmation } from "./receipt";
import { isGuardianVerified } from "./guardian-access";
import { actionsFor } from "./menu";
import { COMMANDS } from "./commands";

const logger = getLogger("whatsapp.command-center.payment-confirmation");

export type PaymentConfirmationResult = {
  sent: number;
  skipped: string[];
};

/**
 * Announce a recorded payment on WhatsApp.
 *
 * `paymentId` is not needed: the confirmation always describes the most recent
 * payment on the account, which is the one just written. Taking the id would
 * imply we can confirm an arbitrary historical payment, which is not what this
 * is for — `RECEIPT` covers that.
 */
export async function sendPaymentConfirmation(tenantId: string): Promise<PaymentConfirmationResult> {
  const result: PaymentConfirmationResult = { sent: 0, skipped: [] };

  try {
    const context = await loadResidentContext(tenantId);
    if (!context) {
      result.skipped.push("TENANT_NOT_LIVE");
      return result;
    }

    const receipt = await buildReceipt(context);
    if (!receipt.payment) {
      result.skipped.push("NO_PAYMENT_RECORDED");
      return result;
    }

    const tenant = await prisma.tenants.findUnique({
      where: { id: tenantId },
      select: {
        phone_1: true,
        guardian_phone: true,
        profiles: { select: { phone: true } },
      },
    });

    const residentPhone = tenant?.phone_1 || tenant?.profiles?.phone || null;
    const guardianPhone = tenant?.guardian_phone || null;
    const provider = new MetaWhatsAppProvider();

    const buttons = actionsFor({
      command: COMMANDS.RECEIPT,
      tenantId,
      payableNow: receipt.stillDue,
      hasPayments: true,
    });

    // Render (or reuse) the receipt once, not once per recipient. Best-effort:
    // a confirmation without an attachment is still a useful confirmation, and
    // this runs on the payment event path where nothing may block.
    // `buildReceipt` describes the newest payment but does not carry its id,
    // so take it from the same ordering rather than re-deriving "newest".
    const [newest] = await listPayments(tenantId, 1);
    const document = newest ? await ensureReceiptDocument(newest.paymentId).catch(() => null) : null;

    const deliver = async (phone: string, audience: "RESIDENT" | "GUARDIAN") => {
      const text = formatPaymentConfirmation({ ...receipt, audience, subject: context.subject });
      await provider.sendTextMessage(phone, text);

      if (document) {
        // The receipt itself, not a reference to one the reader has to go find.
        await provider
          .sendDocumentMessage(phone, document.url, document.filename)
          .catch((error: any) =>
            logger.warn("payment_confirmation.document_failed", {
              tenant_id: tenantId,
              error: error?.message || String(error),
            })
          );
      }

      if (buttons.length > 0) {
        // Best-effort: the confirmation itself already landed.
        await provider.sendButtonMessage(phone, "Anything else?", buttons).catch(() => {});
      }
      result.sent += 1;
    };

    if (residentPhone) {
      try {
        await deliver(residentPhone, "RESIDENT");
      } catch (error: any) {
        logger.warn("payment_confirmation.resident_failed", {
          tenant_id: tenantId,
          error: error?.message || String(error),
        });
        result.skipped.push("RESIDENT_SEND_FAILED");
      }
    } else {
      result.skipped.push("NO_RESIDENT_PHONE");
    }

    if (!guardianPhone) {
      result.skipped.push("NO_GUARDIAN_PHONE");
    } else if (residentPhone && guardianPhone === residentPhone) {
      // One handset in both fields — do not send the same message twice.
      result.skipped.push("GUARDIAN_SAME_AS_RESIDENT");
    } else if (!(await isGuardianVerified(guardianPhone))) {
      // Same rule as every other financial answer: an unverified number is not
      // told what this family paid.
      result.skipped.push("GUARDIAN_UNVERIFIED");
    } else {
      try {
        await deliver(guardianPhone, "GUARDIAN");
      } catch (error: any) {
        logger.warn("payment_confirmation.guardian_failed", {
          tenant_id: tenantId,
          error: error?.message || String(error),
        });
        result.skipped.push("GUARDIAN_SEND_FAILED");
      }
    }

    logger.info("payment_confirmation.done", {
      tenant_id: tenantId,
      sent: result.sent,
      skipped: result.skipped,
    });
  } catch (error: any) {
    // A confirmation must never unwind a payment that already succeeded.
    logger.error("payment_confirmation.failed", {
      tenant_id: tenantId,
      error: error?.message || String(error),
    });
    result.skipped.push("UNEXPECTED_ERROR");
  }

  return result;
}
