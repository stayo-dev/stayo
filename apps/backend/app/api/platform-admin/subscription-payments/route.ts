export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";
import { subscriptionPaymentService } from "@/src/services/platform-billing/subscription-payment-service";

/**
 * GET /api/platform-admin/subscription-payments?status=SUBMITTED&limit=&offset=
 *
 * The admin review queue for owner subscription payments (ADR-172, Phase 2).
 * Cross-owner (admin persona). Default status filter = the reviewable ones.
 */
const REVIEWABLE = ["SUBMITTED", "UNDER_REVIEW"];

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status")?.toUpperCase();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 50), 1), 100);
    const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

    const where =
      statusParam && statusParam !== "ALL"
        ? { status: statusParam as any }
        : { status: { in: REVIEWABLE as any } };

    const [rows, total] = await Promise.all([
      prisma.subscription_payments.findMany({
        where,
        orderBy: { submitted_at: "asc" },
        skip: offset,
        take: limit,
      }),
      prisma.subscription_payments.count({ where }),
    ]);

    const ownerIds = Array.from(new Set(rows.map((r: any) => r.owner_id)));
    const planIds = Array.from(new Set(rows.map((r: any) => r.plan_id)));
    const paymentIds = rows.map((r: any) => r.id);
    const [owners, plans, invoices] = await Promise.all([
      prisma.profile.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true, phone: true } }),
      prisma.subscription_plans.findMany({ where: { id: { in: planIds } }, select: { id: true, code: true, name: true, price_paise: true } }),
      // One invoice per approved payment (UNIQUE payment_id). Lets the review
      // queue link to the issued invoice document without a second request.
      prisma.subscription_invoices.findMany({
        where: { payment_id: { in: paymentIds } },
        select: { id: true, payment_id: true, invoice_number: true, document_url: true },
      }),
    ]);
    const ownerById = new Map(owners.map((o: any) => [o.id, o]));
    const planById = new Map(plans.map((p: any) => [p.id, p]));
    const invoiceByPayment = new Map(invoices.map((inv: any) => [inv.payment_id, inv]));

    // Payment-amount mismatch signal (Phase 6.9) — informational only, never
    // blocks review; the invoice (once approved) always derives its own
    // amount independently of what's shown here. Computed per row, not
    // stored — always reflects current plan pricing at the moment the queue
    // is viewed.
    const expectedByPayment = new Map<string, Awaited<ReturnType<typeof subscriptionPaymentService.getExpectedAmount>>>(
      await Promise.all(
        rows.map(async (r: any) => [r.id, await subscriptionPaymentService.getExpectedAmount(r.id)] as const),
      ),
    );

    return apiResponse({
      payments: rows.map((r: any) => {
        const expected = expectedByPayment.get(r.id);
        return {
          id: r.id,
          owner: ownerById.get(r.owner_id) ?? { id: r.owner_id },
          subscription_id: r.subscription_id,
          plan: planById.get(r.plan_id) ?? { id: r.plan_id },
          amount_paise: r.amount_paise,
          expected_amount_paise: expected?.expectedAmountPaise ?? null,
          amount_mismatch: expected?.mismatch ?? false,
          currency: r.currency,
          payment_method: r.payment_method,
          transaction_reference: r.transaction_reference,
          proof_file: r.proof_file,
          status: r.status,
          rejection_reason: r.rejection_reason,
          submitted_at: r.submitted_at,
          reviewed_at: r.reviewed_at,
          reviewed_by: r.reviewed_by,
          invoice: (() => {
            const inv: any = invoiceByPayment.get(r.id);
            return inv
              ? { id: inv.id, invoice_number: inv.invoice_number, document_ready: Boolean(inv.document_url) }
              : null;
          })(),
        };
      }),
      total,
      limit,
      offset,
      has_more: offset + rows.length < total,
    });
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.subscription-payments.list");
  }
}
