export const dynamic = "force-dynamic";
export const runtime = "nodejs";
import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { moveOutService } from "@/lib/services/move-out-service";
import { getTenantSteps } from "@/lib/services/move-out-state-machine";
import { MoveOutStatus } from "@prisma/client";

/**
 * GET /api/move-out/timeline — Tenant-facing timeline with steps + events
 * Returns simplified steps (hiding internal complexity) + chronological events.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") return apiError("Forbidden", "FORBIDDEN", 403);

  try {
    const request = await moveOutService.getRequestForTenant(session.sub);
    if (!request) return apiResponse({ active: false, steps: [], events: [] });

    const steps = getTenantSteps(request.status as MoveOutStatus);

    // Build chronological event timeline
    const events: Array<{ timestamp: string; type: string; title: string; detail?: string }> = [];

    events.push({ timestamp: request.created_at.toISOString(), type: "REQUEST", title: "Move-out request submitted", detail: `Planned exit: ${new Date(request.planned_exit_date).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" })}` });

    if (request.inspection) {
      events.push({ timestamp: request.inspection.inspected_at.toISOString(), type: "INSPECTION", title: "Room inspection completed", detail: `Condition: ${request.inspection.room_condition} | Deductions: ₹${Number(request.inspection.total_deductions || 0).toLocaleString("en-IN")}` });
    }

    if (request.settlement) {
      events.push({ timestamp: request.settlement.created_at.toISOString(), type: "SETTLEMENT", title: "Settlement calculated", detail: `Net: ₹${Math.abs(Number(request.settlement.net_settlement_amount)).toLocaleString("en-IN")} (${request.settlement.settlement_direction === "OWNER_OWES_TENANT" ? "Refund to you" : request.settlement.settlement_direction === "TENANT_OWES_OWNER" ? "Due from you" : "Settled"})` });
      if (request.settlement.settled_at) {
        events.push({ timestamp: request.settlement.settled_at.toISOString(), type: "PAYMENT", title: `Payment ${request.settlement.settlement_direction === "OWNER_OWES_TENANT" ? "refunded" : "received"}`, detail: `Via ${request.settlement.payment_method || "N/A"}${request.settlement.payment_reference ? ` (Ref: ${request.settlement.payment_reference})` : ""}` });
      }
    }

    if (request.disputes?.length) {
      for (const d of request.disputes) {
        const amount = d.disputed_amount != null ? ` | Amount disputed: ₹${Number(d.disputed_amount).toLocaleString("en-IN")}` : "";
        events.push({ timestamp: d.created_at.toISOString(), type: "DISPUTE_RAISED", title: `Dispute raised: ${String(d.dispute_type).replace(/_/g, " ")}`, detail: `${d.description}${amount}` });
        if (d.status === "UNDER_REVIEW" && d.updated_at) {
          events.push({ timestamp: d.updated_at.toISOString(), type: "DISPUTE_REVIEWED", title: "Dispute under owner review", detail: d.resolution_notes || "Awaiting final resolution." });
        }
        if (d.resolved_at) {
          events.push({
            timestamp: d.resolved_at.toISOString(),
            type: d.status === "REJECTED" ? "DISPUTE_REJECTED" : "DISPUTE_RESOLVED",
            title: d.status === "REJECTED" ? "Dispute rejected" : "Dispute resolved",
            detail: d.resolution_notes || undefined,
          });
        }
      }
    }

    if ((request as any).completed_at) {
      events.push({ timestamp: (request as any).completed_at.toISOString(), type: "COMPLETED", title: "Move-out completed", detail: "Thank you for staying with us!" });
    }

    events.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    return apiResponse({
      active: true,
      request_id: request.id,
      status: request.status,
      planned_exit_date: request.planned_exit_date,
      steps,
      events,
      settlement: request.settlement ? {
        net_amount: Number(request.settlement.net_settlement_amount),
        net_settlement_amount: Number(request.settlement.net_settlement_amount),
        direction: request.settlement.settlement_direction,
        settlement_direction: request.settlement.settlement_direction,
        payment_status: request.settlement.payment_status,
        security_deposit_amount: Number(request.settlement.security_deposit_amount),
        advance_balance: Number(request.settlement.future_rent_credit_balance),
        pending_rent_dues: Number(request.settlement.pending_rent_dues),
        pending_late_fees: Number(request.settlement.pending_late_fees),
        pending_utility_dues: Number(request.settlement.pending_utility_dues),
        total_deductions: Number(request.settlement.total_deductions),
        total_dues: Number(request.settlement.total_dues),
      } : null,
      disputes: request.disputes ? request.disputes.map((d: any) => ({
        id: d.id,
        dispute_type: d.dispute_type,
        description: d.description,
        disputed_amount: d.disputed_amount != null ? Number(d.disputed_amount) : null,
        status: d.status,
        resolution_notes: d.resolution_notes,
        created_at: d.created_at,
        updated_at: d.updated_at,
        resolved_at: d.resolved_at
      })) : [],
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to fetch timeline");
  }
}
