export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOwnerId, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";
import { subscriptionInvoiceDocumentService } from "@/src/services/platform-billing/subscription-invoice-document-service";

/**
 * GET /api/owner/subscription/invoices/[id]
 *
 * Streams the owner's own subscription invoice PDF (ADR-172, Phase 6.2).
 *
 * Authorization is the row's `owner_id` vs the session owner — the request
 * never supplies an owner id, and a mismatch is a 404 (not a 403), so the
 * endpoint does not confirm the existence of another owner's invoice. The
 * generated PDF is proxied through here rather than handing back the raw
 * ImageKit URL.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    const ownerId = resolveOwnerId(session);

    const invoice = await prisma.subscription_invoices.findUnique({
      where: { id },
      select: { id: true, owner_id: true },
    });
    if (!invoice || invoice.owner_id !== ownerId) {
      return apiError("Invoice not found.", "NOT_FOUND", 404);
    }

    const { bytes, fileName } = await subscriptionInvoiceDocumentService.getDocumentBytes(id);
    return new Response(bytes as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.invoices.download");
  }
}
