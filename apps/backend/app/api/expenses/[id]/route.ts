import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { expenseService } from "@/lib/services/expense-service";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { assertOwnerSubscriptionActive, billingErrorResponse } from "@/src/services/platform-billing/subscription-http";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


/**
 * 💸 Expense Member
 * Access: Owner/Admin only
 */
export async function PUT(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    await assertOwnerSubscriptionActive(scope.owner_id, "expenses.id");
    const body = await req.json();
    const nextHostelId = body.hostelId ?? body.hostel_id;
    if (nextHostelId) await requireHostelBelongsToOwner(scope.owner_id, nextHostelId);
    const expense = await expenseService.updateExpense(params.id, scope.owner_id, body);
    return apiResponse(expense);
  } catch (error: any) {
    const billing = billingErrorResponse(error);
    if (billing) return billing;
    const msg = String(error?.message || "");
    if (msg.startsWith("VALIDATION"))
      return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    if (msg.startsWith("NOT_FOUND"))
      return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    return apiError(msg || "Failed to update expense");
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const scope = resolveOwnerScope(session);
    await assertOwnerSubscriptionActive(scope.owner_id, "expenses.id");
    const expense = await expenseService.deleteExpense(params.id, scope.owner_id);
    return apiResponse(expense);
  } catch (error: any) {
    const billing = billingErrorResponse(error);
    if (billing) return billing;
    const msg = String(error?.message || "");
    if (msg.startsWith("NOT_FOUND"))
      return apiError(msg.split(": ")[1] ?? msg, "NOT_FOUND", 404);
    return apiError(msg || "Failed to delete expense");
  }
}
