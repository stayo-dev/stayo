export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { amountMismatchNote } from "@/src/services/payments/upi/tenant-payment-claim-rules";

/**
 * GET /api/owner/payment-claims?state=PENDING&hostelId=
 *
 * The tenants who say they have paid, waiting on the owner.
 *
 * This list is the whole reconciliation surface now that the gateway is gone
 * (ADR-235): there is no webhook, so nothing enters the ledger until the owner
 * acts on a row here. It therefore leads with what he actually needs to check —
 * the UTR, which is the one part he can match against his own bank statement.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    const scope = resolveOwnerScope(session);

    const state = req.nextUrl.searchParams.get("state") || "PENDING";
    if (!["PENDING", "CONFIRMED", "REJECTED"].includes(state)) {
      return apiError("Unknown state", "VALIDATION_ERROR", 400);
    }

    // A hostel id is caller-supplied, so it is never trusted as a filter on its
    // own — owner_id scopes the query regardless of what is passed.
    const hostelId = req.nextUrl.searchParams.get("hostelId") || null;

    const claims = await prisma.tenant_payment_claims.findMany({
      where: {
        owner_id: scope.owner_id,
        state,
        ...(hostelId ? { hostel_id: hostelId } : {}),
      },
      orderBy: { created_at: "desc" },
      take: 100,
    });

    const obligationIds = claims.map((c: any) => c.obligation_id).filter(Boolean);
    const tenantIds = claims.map((c: any) => c.tenant_id);

    const [obligations, tenants] = await Promise.all([
      obligationIds.length
        ? prisma.rent_obligations.findMany({
            where: { id: { in: obligationIds } },
            select: { id: true, amount: true, rent_month: true, due_date: true },
          })
        : Promise.resolve([]),
      prisma.tenants.findMany({
        where: { id: { in: tenantIds } },
        select: {
          id: true,
          profiles: { select: { name: true } },
          hostels: { select: { name: true } },
        },
      }),
    ]);

    const obligationById = new Map<string, any>(obligations.map((o: any) => [o.id, o]));
    const tenantById = new Map<string, any>(tenants.map((t: any) => [t.id, t]));

    return apiResponse({
      claims: claims.map((c: any) => {
        const obligation = c.obligation_id ? obligationById.get(c.obligation_id) : null;
        const requestedPaise = obligation ? Math.round(Number(obligation.amount) * 100) : null;
        const claimedPaise = Number(c.claimed_amount);

        return {
          id: c.id,
          tenant_id: c.tenant_id,
          tenant_name: tenantById.get(c.tenant_id)?.profiles?.name ?? "Unknown",
          hostel_id: c.hostel_id,
          hostel_name: tenantById.get(c.tenant_id)?.hostels?.name ?? "",
          obligation_id: c.obligation_id,
          rent_month: obligation?.rent_month ?? null,
          claimed_amount: claimedPaise,
          // Routine rather than suspicious: most UPI apps let the payer edit
          // the amount on a P2P intent.
          mismatch_note:
            requestedPaise !== null ? amountMismatchNote(requestedPaise, claimedPaise) : null,
          utr: c.utr,
          proof_url: c.proof_url,
          state: c.state,
          created_at: c.created_at,
        };
      }),
    });
  } catch (error: any) {
    const msg = String(error?.message || "Could not read payment claims");
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    if (msg.startsWith("UNAUTHORIZED")) return apiError(msg.split(": ")[1] ?? msg, "UNAUTHORIZED", 401);
    return apiError(msg);
  }
}
