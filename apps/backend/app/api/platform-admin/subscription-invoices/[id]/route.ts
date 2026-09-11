export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30;

import { NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";
import { subscriptionInvoiceDocumentService } from "@/src/services/platform-billing/subscription-invoice-document-service";

/**
 * GET /api/platform-admin/subscription-invoices/[id]
 *
 * Streams any subscription invoice PDF for a platform-admin session (ADR-172,
 * Phase 6.2). Uses the existing `requireAdmin` gate — no new authorization
 * system. The admin subscription/payment screens link here; the raw ImageKit
 * URL is never exposed to the client.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
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
    return subscriptionErrorResponse(error, "platform-admin.subscription-invoices.download");
  }
}
