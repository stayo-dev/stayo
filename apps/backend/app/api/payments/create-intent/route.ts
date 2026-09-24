export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";

/**
 * POST /api/payments/create-intent — retired.
 *
 * **DISCONNECTED.** Stayo no longer collects rent through a payment gateway.
 * Tenants pay the owner's UPI ID directly and the owner confirms it; see
 * `docs/superpowers/specs/2026-09-23-upi-collection-gateway-disconnect-design.md`.
 *
 * The gateway was never used in production — 0 `gateway_transactions` ever, 1
 * `payment_attempts` row with 0 successes, and all 40 real payments recorded
 * directly by owners. Nothing is being taken away from anyone.
 *
 * This handler is deliberately self-contained: it imports no service, no
 * provider and no payment machinery, so there is no path by which a request
 * here can reach a gateway. **Every service and provider file is untouched on
 * disk** — re-enabling this route means restoring this one file.
 *
 * Note `/api/payments/pay/[token]` is NOT disconnected: it is the page live
 * WhatsApp rent reminders link to, and it now serves the UPI flow instead.
 *
 */
function disconnected() {
  return NextResponse.json(
    {
      success: false,
      error: {
        message: "Online card/UPI checkout has been retired. Pay the hostel's UPI ID directly.",
        code: "GATEWAY_DISCONNECTED",
      },
    },
    { status: 410 },
  );
}

export async function POST() {
  return disconnected();
}
