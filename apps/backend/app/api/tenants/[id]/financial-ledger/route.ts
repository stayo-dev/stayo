export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { tenantFinancialLedgerService } from "@/src/services/payments/tenant-financial-ledger-service";
import { prisma } from "@/lib/db";

/**
 * GET  /api/tenants/[id]/financial-ledger  — balance + ledger history
 * POST /api/tenants/[id]/financial-ledger  — record credit (DEPOSIT/TOPUP rent advance) or debit (DEDUCTION/REFUND/CORRECTION)
 *
 * Auth: OWNER or ADMIN only
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const ownerId = await resolveOwnerId(session);
    const result = await tenantFinancialLedgerService.getBalance(params.id, ownerId);
    return apiResponse(result);
  } catch (error: any) {
    return handleError(error);
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json();
    const { action, reason, amount, notes, reference_id, reference_type } = body;

    if (!action || !["credit", "debit"].includes(action)) {
      return apiError("action must be 'credit' or 'debit'", "VALIDATION_ERROR", 400);
    }
    if (!amount || typeof amount !== "number" || amount <= 0) {
      return apiError("amount must be a positive number", "VALIDATION_ERROR", 400);
    }

    const ownerId = await resolveOwnerId(session);

    if (action === "credit") {
      if (!["DEPOSIT", "TOPUP"].includes(reason)) {
        return apiError("reason must be DEPOSIT or TOPUP for credit", "VALIDATION_ERROR", 400);
      }
      const result = await tenantFinancialLedgerService.credit({
        tenantId: params.id,
        ownerId,
        createdBy: session.sub,
        reason,
        amount,
        notes,
        referenceId: reference_id,
        referenceType: reference_type,
      });
      return apiResponse(result, 201);
    }

    // debit
    if (!["DEDUCTION", "REFUND", "CORRECTION"].includes(reason)) {
      return apiError("reason must be DEDUCTION, REFUND, or CORRECTION for debit", "VALIDATION_ERROR", 400);
    }
    const result = await tenantFinancialLedgerService.debit({
      tenantId: params.id,
      ownerId,
      createdBy: session.sub,
      reason,
      amount,
      notes,
      referenceId: reference_id,
      referenceType: reference_type,
    });
    return apiResponse(result, 201);
  } catch (error: any) {
    return handleError(error);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function resolveOwnerId(session: any): Promise<string> {
  if (session.role === "OWNER") return session.sub;
  // ADMIN: must pass owner_id or act globally — use session.sub as fallback
  return session.sub;
}

function handleError(error: any) {
  const msg = String(error?.message ?? error);
  if (msg.includes("NOT_FOUND")) return apiError(msg, "NOT_FOUND", 404);
  if (msg.includes("FORBIDDEN")) return apiError(msg, "FORBIDDEN", 403);
  if (msg.includes("BAD_REQUEST")) return apiError(msg, "VALIDATION_ERROR", 400);
  return apiError(msg, "INTERNAL_ERROR", 500);
}
