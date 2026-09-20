export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { activityService } from "@/lib/services/activity.service";
import { ownerInvoiceEmailService } from "@/src/services/owner-billing/owner-invoice-email-service";
import { OwnerBillingError } from "@/src/services/owner-billing/owner-billing-errors";
import { ownerBillingErrorResponse } from "@/src/services/owner-billing/owner-http";

/**
 * POST /api/platform-admin/owner-invoices/[id]/resend
 *
 * Admin/manager action to retry emailing an owner-payment invoice — the
 * escape hatch for "owner had no email on file" or a transient send
 * failure (business requirement: sending is best-effort, and the admin
 * must be able to resend after the owner's email is corrected).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_SUBSCRIPTIONS");

    const invoice = await prisma.owner_invoices.findUnique({ where: { id }, select: { id: true, owner_id: true, invoice_number: true } });
    if (!invoice) throw new OwnerBillingError("Invoice not found.", "NOT_FOUND", 404);

    const result = await ownerInvoiceEmailService.sendOwnerInvoiceEmail(id);

    await activityService.log({
      userId: (session as any).sub,
      ownerId: invoice.owner_id,
      actionType: result.sent ? "OWNER_INVOICE_SENT" : "OWNER_INVOICE_SEND_FAILED",
      entityType: "owner_invoices",
      entityId: invoice.id,
      metadata: { invoice_number: invoice.invoice_number, reason: result.reason ?? null, resent: true },
    });

    return apiResponse({ sent: result.sent, reason: result.reason ?? null });
  } catch (error) {
    return ownerBillingErrorResponse(error, "platform-admin.owner-invoices.resend");
  }
}
