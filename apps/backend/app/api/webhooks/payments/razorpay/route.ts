export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextResponse } from "next/server";

/**
 * POST /api/webhooks/payments/razorpay — retired.
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
 * This one mattered most: it was an unauthenticated, internet-facing POST
 * endpoint on a subsystem nobody was going to keep patching.
 *
 */
function disconnected() {
  return NextResponse.json(
    {
      success: false,
      error: {
        message: "This webhook is no longer in service.",
        code: "GATEWAY_DISCONNECTED",
      },
    },
    { status: 410 },
  );
}

export async function POST() {
  return disconnected();
}

export async function GET() {
  return disconnected();
}
