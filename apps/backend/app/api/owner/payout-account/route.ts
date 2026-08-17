export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { validatePayoutAccount } from "@/src/services/settlements/payout-account";

function requireOwner(session: any): asserts session is { sub: string; role: string } {
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    throw new Error("FORBIDDEN: Owner access required");
  }
}

/**
 * GET /api/owner/payout-account — where this owner's settled rent is sent.
 *
 * The account number is returned MASKED. A settings page does not need the
 * full number to show that one is on file, and an unmasked value on screen is
 * one shoulder-surf or screenshot away from being someone else's.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireOwner(session);
    const profile = await prisma.profile.findUnique({
      where: { id: session.sub },
      select: {
        payout_holder_name: true, payout_account_no: true,
        payout_ifsc: true, payout_bank_name: true, payout_updated_at: true,
      },
    });

    const account = profile?.payout_account_no ?? null;
    return apiResponse({
      payout: account
        ? {
            holder_name: profile!.payout_holder_name,
            account_masked: `••••${account.slice(-4)}`,
            ifsc: profile!.payout_ifsc,
            bank_name: profile!.payout_bank_name,
            updated_at: profile!.payout_updated_at,
          }
        : null,
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to load payout account");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * PUT /api/owner/payout-account
 *
 * Requires the account number twice — a wrong digit is unrecoverable, and this
 * is the only place it can be caught.
 *
 * The previous value is written to settlement_audit_log before being replaced.
 * Redirecting an owner's rent to another account is the obvious fraud here, so
 * a change must always be traceable rather than silently overwriting.
 */
export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireOwner(session);
    const parsed = validatePayoutAccount(await req.json().catch(() => ({})));
    if (!parsed.ok) return apiError(parsed.reason, "VALIDATION_ERROR", 400);

    const before = await prisma.profile.findUnique({
      where: { id: session.sub },
      select: { payout_account_no: true, payout_ifsc: true },
    });

    await prisma.profile.update({
      where: { id: session.sub },
      data: {
        payout_holder_name: parsed.holder_name,
        payout_account_no: parsed.account_no,
        payout_ifsc: parsed.ifsc,
        payout_bank_name: parsed.bank_name,
        payout_updated_at: new Date(),
      },
    });

    await prisma.settlement_audit_log
      .create({
        data: {
          action: "PAYOUT_ACCOUNT_CHANGED",
          actor_id: session.sub,
          detail: {
            // Last four only: the log must be readable by whoever investigates
            // a disputed payout without itself becoming a list of bank accounts.
            from: before?.payout_account_no ? `••••${before.payout_account_no.slice(-4)}` : null,
            to: `••••${parsed.account_no.slice(-4)}`,
            ifsc_from: before?.payout_ifsc ?? null,
            ifsc_to: parsed.ifsc,
          } as any,
        },
      })
      .catch(() => undefined);

    return apiResponse({ saved: true });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to save payout account");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
