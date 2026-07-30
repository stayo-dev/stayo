export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 30; // Puppeteer needs more time than default

import { NextResponse, NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { receiptService } from "@/src/services/payments/receipt-service";
import { authService } from "@/lib/services/auth-service";
import { prisma } from "@/lib/db";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session) {
      return ApiResponse.error(ApiError.unauthorized("Unauthorized"));
    }

    const { id: paymentId } = params;

    // 1. Rate Limiting: Tenant limit (Max 10 requests/min)
    if (session.role === "TENANT") {
      const tenantLimit = await checkFixedWindowLimit({
        scope: "receipt:tenant",
        identifier: session.sub,
        maxAttempts: 10,
        windowSeconds: 60,
      });

      if (!tenantLimit.allowed) {
        return ApiResponse.error(
          new ApiError(
            "Rate limit exceeded: Max 10 receipt downloads per minute allowed.",
            429,
            "TOO_MANY_REQUESTS",
            {
              limit_type: "tenant",
              attempts_remaining: tenantLimit.attemptsRemaining,
              retry_after: tenantLimit.retryAfterSeconds,
            }
          )
        );
      }
    }

    // 2. Rate Limiting: Payment limit (Max 3 requests/min per payment ID)
    const paymentLimit = await checkFixedWindowLimit({
      scope: "receipt:payment",
      identifier: paymentId,
      maxAttempts: 3,
      windowSeconds: 60,
    });

    if (!paymentLimit.allowed) {
      return ApiResponse.error(
        new ApiError(
          "Rate limit exceeded: Max 3 downloads per payment ID allowed per minute.",
          429,
          "TOO_MANY_REQUESTS",
          {
            limit_type: "payment",
            attempts_remaining: paymentLimit.attemptsRemaining,
            retry_after: paymentLimit.retryAfterSeconds,
          }
        )
      );
    }

    if (paymentId.startsWith("advance-")) {
      const ledgerId = paymentId.replace("advance-", "");
      const ledgerEntry = await prisma.tenant_advance_ledger.findUnique({
        where: { id: ledgerId },
        select: {
          id: true,
          owner_id: true,
          tenant_id: true,
          hostel_id: true,
          tenants: { select: { profile_id: true, owner_id: true, id: true } },
        },
      });
      if (!ledgerEntry) {
        return ApiResponse.error(ApiError.notFound("Advance payment record not found"));
      }

      if (session.role === "TENANT") {
        const tenantRecord = await prisma.tenants.findFirst({
          where: { profile_id: session.sub },
          select: { id: true },
        });
        if (!tenantRecord || tenantRecord.id !== ledgerEntry.tenant_id) {
          return ApiResponse.error(ApiError.forbidden("Forbidden"));
        }
      } else if (session.role === "OWNER") {
        if (ledgerEntry.owner_id !== session.sub && ledgerEntry.tenants?.owner_id !== session.sub) {
          return ApiResponse.error(ApiError.forbidden("Forbidden"));
        }
        const hostel = await prisma.hostels.findUnique({ where: { id: ledgerEntry.hostel_id }, select: { owner_id: true } });
        if (!hostel || hostel.owner_id !== session.sub) {
          return ApiResponse.error(ApiError.forbidden("Forbidden"));
        }
      } else {
        return ApiResponse.error(ApiError.forbidden("Forbidden"));
      }

      const pdfBuffer = await receiptService.generateLedgerPdfBuffer(ledgerId);

      return new NextResponse(pdfBuffer as any, {
        status: 200,
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="receipt_${paymentId.substring(0, 16)}.pdf"`,
          "Cache-Control": "private, max-age=300",
        },
      });
    }

    const payment = await prisma.payments.findUnique({
      where: { id: paymentId },
      select: {
        id: true,
        owner_id: true,
        tenant_id: true,
        hostel_id: true,
        tenants: { select: { profile_id: true, owner_id: true, id: true } },
      },
    });
    if (!payment) {
      return ApiResponse.error(ApiError.notFound("Payment not found"));
    }

    if (session.role === "TENANT") {
      const tenantRecord = await prisma.tenants.findFirst({
        where: { profile_id: session.sub },
        select: { id: true },
      });
      if (!tenantRecord || tenantRecord.id !== payment.tenant_id) {
        return ApiResponse.error(ApiError.forbidden("Forbidden"));
      }
    } else if (session.role === "OWNER") {
      if (payment.owner_id !== session.sub && payment.tenants?.owner_id !== session.sub) {
        return ApiResponse.error(ApiError.forbidden("Forbidden"));
      }
      const hostel = await prisma.hostels.findUnique({ where: { id: payment.hostel_id }, select: { owner_id: true } });
      if (!hostel || hostel.owner_id !== session.sub) {
        return ApiResponse.error(ApiError.forbidden("Forbidden"));
      }
    } else {
      return ApiResponse.error(ApiError.forbidden("Forbidden"));
    }

    const canAutoCreateReceipt = true;
    const pdfBuffer = await receiptService.generatePdfBuffer(paymentId, {
      autoCreate: canAutoCreateReceipt,
    });

    return new NextResponse(pdfBuffer as any, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="receipt_${paymentId.substring(0, 8)}.pdf"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch (error: any) {
    console.error("Error downloading receipt:", error);
    const message = error?.message || "Unknown error";
    if (message.includes("NOT_FOUND")) {
      return ApiResponse.error(ApiError.notFound(message));
    }
    if (message.includes("PLAN_UPGRADE_REQUIRED")) {
      return ApiResponse.error(ApiError.forbidden(message));
    }
    return ApiResponse.error(ApiError.internal(message));
  }
}
