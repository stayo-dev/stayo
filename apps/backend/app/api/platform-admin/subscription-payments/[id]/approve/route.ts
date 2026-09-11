export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";
import { subscriptionInvoiceDocumentService } from "@/src/services/platform-billing/subscription-invoice-document-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * POST /api/platform-admin/subscription-payments/[id]/approve
 *
 * Admin-only (ADR-172, Phase 2). Follows the same review posture as
 * `app/api/platform-admin/owner-documents/[id]/review/route.ts`: the uploader
 * (owner) can never do this, and a payment can be approved only once.
 *
 * One transaction: payment → APPROVED, subscription activated/updated (billing
 * period, next renewal, plan applied — upgrade immediate, downgrade deferred to
 * next renewal), and a `subscription_invoices` record created.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);
    const result = await subscriptionPaymentService.reviewPayment({
      paymentId: id,
      decision: "APPROVE",
      adminId: (session as any).sub,
    });

    // Generate the invoice PDF now, but OUTSIDE the approval transaction: a
    // storage failure must never make an already-approved payment / issued
    // invoice inconsistent. If this fails the row keeps `document_url = null`
    // and the first download regenerates it.
    let invoiceDocumentReady = false;
    if (result.invoice?.id) {
      try {
        const doc = await subscriptionInvoiceDocumentService.generateDocument(result.invoice.id);
        invoiceDocumentReady = Boolean(doc.documentUrl);
      } catch (docErr: any) {
        console.warn("[subscription-payments.approve] invoice document generation failed (non-fatal):", docErr?.message);
      }
    }

    return apiResponse({ ...result, invoice_document_ready: invoiceDocumentReady });
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscription-payments.approve");
  }
}
