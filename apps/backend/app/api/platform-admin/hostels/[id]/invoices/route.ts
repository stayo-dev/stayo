export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import crypto from "crypto";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * POST /api/platform-admin/hostels/[id]/invoices
 * Records a subscription payment collected from the owner — marks the
 * invoice PAID, flips the subscription to ACTIVE, and advances
 * `next_renewal_at` by one billing cycle. There is no real payment-gateway
 * integration on this side yet (owners are billed/collected outside the
 * app for V1) — this is the admin manually recording that collection.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireAdmin(session);

    const subscription = await prisma.hostel_subscriptions.findUnique({ where: { hostel_id: id } });
    if (!subscription) return apiError("Hostel has no subscription yet", "NOT_FOUND", 404);

    const invoiceNumber = `INV-${new Date().getFullYear()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const invoice = await prisma.platform_invoices.create({
      data: {
        hostel_subscription_id: subscription.id,
        hostel_id: id,
        amount: subscription.amount,
        status: "PAID",
        invoice_number: invoiceNumber,
        paid_at: new Date(),
      },
    });

    const cycleDays = subscription.billing_cycle === "YEARLY" ? 365 : 30;
    await prisma.hostel_subscriptions.update({
      where: { hostel_id: id },
      data: {
        status: "ACTIVE",
        next_renewal_at: new Date(Date.now() + cycleDays * 24 * 60 * 60 * 1000),
        updated_at: new Date(),
      },
    });

    return apiResponse(invoice, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to record invoice");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
