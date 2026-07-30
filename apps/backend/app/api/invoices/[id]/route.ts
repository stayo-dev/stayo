export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { invoiceService } from "@/src/services/payments/invoice-service";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const session = await getSession(req);
  if (!session) {
    return apiError("Unauthorized", "UNAUTHORIZED", 401);
  }

  try {
    const { id: paymentId } = params;
    
    // Verify ownership before generation
    const payment = await prisma.payments.findUnique({
      where: { id: paymentId },
      select: { owner_id: true }
    });

    if (!payment || payment.owner_id !== session.sub) {
      console.warn(`[invoices.id.GET] Access denied for payment ${paymentId} to owner ${session.sub}`);
      return apiError("Invoice not found or access denied", "NOT_FOUND", 404);
    }

    // Generates or fetches cached PDF URL
    const result = await invoiceService.generateInvoicePDF(paymentId);
    
    // Return URL as JSON — 307 redirect breaks CORS with ImageKit's wildcard origin
    return NextResponse.json({ url: result.url, cached: result.cached });

  } catch (error: any) {
    console.error("Invoice generation failed:", error);
    return apiError(error.message || "Failed to generate invoice rendering");
  }
}
