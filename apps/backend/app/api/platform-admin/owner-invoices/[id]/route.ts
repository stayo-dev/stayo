export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { ownerInvoiceDocumentService } from "@/src/services/owner-billing/owner-invoice-document-service";
import { ownerBillingErrorResponse } from "@/src/services/owner-billing/owner-http";

/**
 * GET /api/platform-admin/owner-invoices/[id]
 *
 * Streams a generic owner-payment invoice PDF for a platform-admin/manager
 * session — mirrors `platform-admin/subscription-invoices/[id]/route.ts`
 * exactly, pointed at the owner-payment document service instead. The raw
 * ImageKit URL is never exposed to the client.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_SUBSCRIPTIONS");
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
    return ownerBillingErrorResponse(error, "platform-admin.owner-invoices.download");
  }
}
