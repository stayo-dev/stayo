export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOwnerId, ownerBillingErrorResponse } from "@/src/services/owner-billing/owner-http";
import { ownerInvoiceDocumentService } from "@/src/services/owner-billing/owner-invoice-document-service";

/**
 * GET /api/owner/payments/invoices/[id]
 *
 * Streams the owner's own generic-payment invoice PDF — mirrors
 * `owner/subscription/invoices/[id]/route.ts` exactly (row-ownership check
 * first, mismatch is a 404 not a 403, PDF proxied rather than handing back
 * the raw ImageKit URL), pointed at `owner_invoices` instead of
 * `subscription_invoices`.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    const ownerId = resolveOwnerId(session);

    const invoice = await prisma.owner_invoices.findUnique({
      where: { id },
      select: { id: true, owner_id: true },
    });
    if (!invoice || invoice.owner_id !== ownerId) {
      return apiError("Invoice not found.", "NOT_FOUND", 404);
    }

    const { bytes, fileName } = await ownerInvoiceDocumentService.getDocumentBytes(id);
    return new Response(bytes as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return ownerBillingErrorResponse(error, "owner.payments.invoices.download");
  }
}
