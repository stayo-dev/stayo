export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOwnerId, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET /api/owner/subscription/payment-context
 *
 * Everything the owner's "submit a payment" screen needs that isn't a plan
 * price or an upgrade quote (those come from `/plans` and `/upgrade-preview`):
 *
 *  - `payee`   — Stayo's UPI / bank details + QR, read from the
 *                `platform_settings` row keyed `"billing"`. Returns `null`
 *                until an admin configures it — the UI shows a safe placeholder,
 *                never an invented VPA.
 *  - `methods` — the payment methods the backend actually accepts right now
 *                (`UPI_MANUAL`, `CASH`). `GATEWAY` is deliberately absent.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    resolveOwnerId(session); // owner-gate; value unused (this returns no owner data)

    const row = await prisma.platform_settings.findUnique({ where: { key: "billing" } });
    const value = (row?.value ?? null) as Record<string, unknown> | null;

    const payee =
      value && (value.upi_vpa || value.qr_image_url || value.account_name || value.bank)
        ? {
            upi_vpa: (value.upi_vpa as string) ?? null,
            qr_image_url: (value.qr_image_url as string) ?? null,
            account_name: (value.account_name as string) ?? null,
            note: (value.note as string) ?? null,
            bank: (value.bank as Record<string, unknown>) ?? null,
          }
        : null;

    return apiResponse({
      currency: "INR",
      methods: ["UPI_MANUAL", "CASH"],
      payee,
      payee_configured: payee !== null,
    });
  } catch (error) {
    return subscriptionErrorResponse(error, "owner.subscription.payment-context");
  }
}
