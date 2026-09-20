export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { activityService } from "@/lib/services/activity.service";
import { ownerInvoiceWhatsAppService } from "@/src/services/owner-billing/owner-invoice-whatsapp-service";
import { OwnerBillingError } from "@/src/services/owner-billing/owner-billing-errors";
import { ownerBillingErrorResponse } from "@/src/services/owner-billing/owner-http";

/**
 * POST /api/platform-admin/owner-invoices/[id]/resend-whatsapp
 *
 * Admin/manager "Retry WhatsApp" action — sends the SAME already-generated
 * invoice PDF again as a WhatsApp document-template message, under a fresh
 * idempotency key (`owner-invoice-whatsapp-service.ts`). Never creates
 * another payment or invoice; the escape hatch for a missed 24h window /
 * transient provider error / a just-verified WhatsApp connection.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_SUBSCRIPTIONS");

    const invoice = await prisma.owner_invoices.findUnique({
      where: { id },
      select: { id: true, owner_id: true, invoice_number: true },
    });
    if (!invoice) throw new OwnerBillingError("Invoice not found.", "NOT_FOUND", 404);

    const result = await ownerInvoiceWhatsAppService.retryOwnerInvoiceWhatsApp(id);

    await activityService.log({
      userId: (session as any).sub,
      ownerId: invoice.owner_id,
      actionType: result.sent ? "OWNER_INVOICE_WHATSAPP_SENT" : "OWNER_INVOICE_WHATSAPP_FAILED",
      entityType: "owner_invoices",
      entityId: invoice.id,
      metadata: {
        invoice_number: invoice.invoice_number,
        message_id: result.messageId ?? null,
        reason: result.reason ?? null,
        detail: result.detail ?? null,
        retried: true,
      },
    });

    return apiResponse({ sent: result.sent, reason: result.reason ?? null, detail: result.detail ?? null });
  } catch (error) {
    return ownerBillingErrorResponse(error, "platform-admin.owner-invoices.resend-whatsapp");
  }
}
