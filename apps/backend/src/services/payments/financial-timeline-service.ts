/**
 * 📜 Financial Timeline Service — Derived Read Model
 *
 * Replaces the obligation_events table with a computed timeline that
 * derives history from immutable financial sources:
 *
 *   payments           → PAYMENT events
 *   tenant_financial_ledger → CREDIT / DEBIT events
 *   rent_obligations    → CREATED / WAIVED / CANCELLED events (from lifecycle columns)
 *   payment_groups      → SETTLEMENT_GROUP events
 *
 * Properties:
 *   - Read-only: never writes to the database
 *   - Derived: computes events on demand from source tables
 *   - Consistent: impossible to become stale (reads current state)
 *   - No cron jobs, no event store, no dual-write complexity
 *
 * Trade-off: slightly higher query cost per read vs. O(1) event table lookup.
 * Acceptable because timeline reads are infrequent (admin/audit views).
 */

import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { changeRequestRepository } from "@/src/repositories/changeRequestRepository";

const logger = getLogger("financial-timeline");

// ── Timeline Event Types ─────────────────────────────────────────────────────

export type TimelineEventType =
  | "OBLIGATION_CREATED"
  | "PAYMENT_RECORDED"
  | "PAYMENT_GROUP_SETTLED"
  | "OBLIGATION_WAIVED"
  | "OBLIGATION_CANCELLED"
  | "LEDGER_CREDIT"
  | "LEDGER_DEBIT"
  | "STATUS_CHANGE"
  | "CHANGE_REQUEST";

export interface TimelineEvent {
  /** Unique identifier (source_type:source_id) */
  id: string;
  /** When this event occurred */
  timestamp: Date;
  /** Event type for filtering and display */
  type: TimelineEventType;
  /** Human-readable summary */
  summary: string;
  /** Amount involved (positive = money in, negative = money out, null = status change) */
  amount: number | null;
  /** Source entity */
  source: {
    table: string;
    id: string;
  };
  /** Related entity IDs for cross-referencing */
  references: {
    obligation_id?: string;
    payment_id?: string;
    payment_group_id?: string;
    ledger_entry_id?: string;
  };
  /** Actor who caused this event */
  actor_id: string | null;
  /** Additional structured metadata */
  metadata: Record<string, any>;
}

// A payment reversal is written as a negative-amount `payments` row whose
// `reference_number` is `REVERSAL:<originalPaymentId>` (see
// payment-correction-shared.ts::reverseObligationPayment). Classify such rows so
// the timeline can tag them distinctly instead of showing them as an incoming
// "Payment Received". The `REVERSAL:` prefix is the explicit signal; a negative
// amount is a defensive fallback (reversals are the only source of negative
// `amount_paid` in this system).
const REVERSAL_PREFIX = "REVERSAL:";

export function describePaymentReversal(payment: {
  amount_paid: unknown;
  payment_method: string;
  reference_number?: string | null;
}): { isReversal: boolean; reversesPaymentId: string | undefined; summary: string } {
  const amount = Number(payment.amount_paid);
  const hasReversalRef = payment.reference_number?.startsWith(REVERSAL_PREFIX) ?? false;
  const isReversal = hasReversalRef || amount < 0;
  const reversesPaymentId = hasReversalRef
    ? payment.reference_number!.slice(REVERSAL_PREFIX.length)
    : undefined;
  const summary = isReversal
    ? `Reversal of ₹${Math.abs(amount).toLocaleString("en-IN")} payment`
    : `₹${amount.toLocaleString("en-IN")} paid via ${payment.payment_method}`;
  return { isReversal, reversesPaymentId, summary };
}

// ── Service ──────────────────────────────────────────────────────────────────

class FinancialTimelineService {
  /**
   * Get the complete financial timeline for a tenant.
   * Merges events from all financial sources into a single chronological stream.
   */
  async getTenantTimeline(
    tenantId: string,
    options: {
      hostelId?: string;
      limit?: number;
      offset?: number;
      types?: TimelineEventType[];
      from?: Date;
      to?: Date;
    } = {}
  ): Promise<{ events: TimelineEvent[]; total: number }> {
    const { hostelId, limit = 50, offset = 0, types, from, to } = options;

    // Fetch all sources in parallel
    const [obligations, payments, ledgerEntries, paymentGroups, changeRequests] = await Promise.all([
      this.fetchObligationEvents(tenantId, hostelId, from, to),
      this.fetchPaymentEvents(tenantId, hostelId, from, to),
      this.fetchLedgerEvents(tenantId, from, to),
      this.fetchPaymentGroupEvents(tenantId, hostelId, from, to),
      this.fetchChangeRequestEvents(tenantId, hostelId, from, to),
    ]);

    // Merge all events
    let allEvents = [
      ...obligations,
      ...payments,
      ...ledgerEntries,
      ...paymentGroups,
      ...changeRequests,
    ];

    // Filter by type if requested
    if (types && types.length > 0) {
      allEvents = allEvents.filter(e => types.includes(e.type));
    }

    // Sort by timestamp descending (newest first)
    allEvents.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    const total = allEvents.length;

    // Apply pagination
    const paginated = allEvents.slice(offset, offset + limit);

    return { events: paginated, total };
  }

  /**
   * Get the financial timeline for a specific obligation.
   * Shows all payments, status changes, and corrections for one obligation.
   */
  async getObligationTimeline(obligationId: string): Promise<TimelineEvent[]> {
    const [obligation, payments] = await Promise.all([
      prisma.rent_obligations.findUnique({
        where: { id: obligationId },
        select: {
          id: true,
          tenant_id: true,
          obligation_type: true,
          amount: true,
          due_date: true,
          rent_month: true,
          status: true,
          created_at: true,
          created_by: true,
          waived_at: true,
          waived_reason: true,
          waived_by: true,
          waived_amount: true,
          cancelled_at: true,
          cancelled_reason: true,
          cancelled_by: true,
        },
      }),
      prisma.payments.findMany({
        where: { obligation_id: obligationId },
        orderBy: { created_at: "asc" },
        select: {
          id: true,
          amount_paid: true,
          payment_method: true,
          payment_date: true,
          created_at: true,
          offline_recorded_by: true,
          payment_group_id: true,
          reference_number: true,
          hostel_id: true,
        },
      }),
    ]);

    if (!obligation) return [];

    const events: TimelineEvent[] = [];

    // 1. CREATED event
    events.push({
      id: `obligation:${obligation.id}:created`,
      timestamp: obligation.created_at,
      type: "OBLIGATION_CREATED",
      summary: `${obligation.obligation_type.replaceAll("_", " ")} obligation created for ₹${Number(obligation.amount).toLocaleString("en-IN")}`,
      amount: Number(obligation.amount),
      source: { table: "rent_obligations", id: obligation.id },
      references: { obligation_id: obligation.id },
      actor_id: obligation.created_by,
      metadata: {
        obligation_type: obligation.obligation_type,
        due_date: obligation.due_date,
        rent_month: obligation.rent_month,
      },
    });

    // 2. PAYMENT events
    for (const payment of payments) {
      const reversal = describePaymentReversal(payment);
      events.push({
        id: `payment:${payment.id}`,
        timestamp: payment.created_at,
        type: "PAYMENT_RECORDED",
        summary: reversal.summary,
        amount: Number(payment.amount_paid),
        source: { table: "payments", id: payment.id },
        references: {
          obligation_id: obligationId,
          payment_id: payment.id,
          payment_group_id: payment.payment_group_id || undefined,
        },
        actor_id: payment.offline_recorded_by,
        metadata: {
          payment_method: payment.payment_method,
          payment_date: payment.payment_date,
          is_reversal: reversal.isReversal,
          reverses_payment_id: reversal.reversesPaymentId,
        },
      });
    }

    // 3. WAIVED event (if applicable)
    if (obligation.waived_at) {
      events.push({
        id: `obligation:${obligation.id}:waived`,
        timestamp: obligation.waived_at,
        type: "OBLIGATION_WAIVED",
        summary: `Waived ₹${Number(obligation.waived_amount || 0).toLocaleString("en-IN")}. Reason: ${obligation.waived_reason || "Not specified"}`,
        amount: -(Number(obligation.waived_amount || 0)),
        source: { table: "rent_obligations", id: obligation.id },
        references: { obligation_id: obligation.id },
        actor_id: obligation.waived_by,
        metadata: {
          waived_reason: obligation.waived_reason,
          waived_amount: Number(obligation.waived_amount || 0),
        },
      });
    }

    // 4. CANCELLED event (if applicable)
    if (obligation.cancelled_at) {
      events.push({
        id: `obligation:${obligation.id}:cancelled`,
        timestamp: obligation.cancelled_at,
        type: "OBLIGATION_CANCELLED",
        summary: `Obligation cancelled. Reason: ${obligation.cancelled_reason || "Not specified"}`,
        amount: null,
        source: { table: "rent_obligations", id: obligation.id },
        references: { obligation_id: obligation.id },
        actor_id: obligation.cancelled_by,
        metadata: {
          cancelled_reason: obligation.cancelled_reason,
        },
      });
    }

    // Sort chronologically (oldest first for obligation detail view)
    events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return events;
  }

  // ── Private: Source-specific event extraction ──────────────────────────────

  private async fetchObligationEvents(
    tenantId: string,
    hostelId?: string,
    from?: Date,
    to?: Date
  ): Promise<TimelineEvent[]> {
    const where: any = { tenant_id: tenantId };
    if (hostelId) where.hostel_id = hostelId;
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at.gte = from;
      if (to) where.created_at.lte = to;
    }

    const obligations = await prisma.rent_obligations.findMany({
      where,
      select: {
        id: true,
        obligation_type: true,
        amount: true,
        due_date: true,
        rent_month: true,
        status: true,
        created_at: true,
        created_by: true,
        waived_at: true,
        waived_reason: true,
        waived_by: true,
        waived_amount: true,
        cancelled_at: true,
        cancelled_reason: true,
        cancelled_by: true,
      },
      orderBy: { created_at: "desc" },
    });

    const events: TimelineEvent[] = [];

    for (const ob of obligations) {
      // CREATED event
      events.push({
        id: `obligation:${ob.id}:created`,
        timestamp: ob.created_at,
        type: "OBLIGATION_CREATED",
        summary: `${ob.obligation_type.replaceAll("_", " ")} — ₹${Number(ob.amount).toLocaleString("en-IN")} due`,
        amount: Number(ob.amount),
        source: { table: "rent_obligations", id: ob.id },
        references: { obligation_id: ob.id },
        actor_id: ob.created_by,
        metadata: { obligation_type: ob.obligation_type, due_date: ob.due_date },
      });

      // WAIVED event
      if (ob.waived_at) {
        events.push({
          id: `obligation:${ob.id}:waived`,
          timestamp: ob.waived_at,
          type: "OBLIGATION_WAIVED",
          summary: `Waived ₹${Number(ob.waived_amount || 0).toLocaleString("en-IN")} — ${ob.waived_reason || "No reason"}`,
          amount: -(Number(ob.waived_amount || 0)),
          source: { table: "rent_obligations", id: ob.id },
          references: { obligation_id: ob.id },
          actor_id: ob.waived_by,
          metadata: { waived_reason: ob.waived_reason },
        });
      }

      // CANCELLED event
      if (ob.cancelled_at) {
        events.push({
          id: `obligation:${ob.id}:cancelled`,
          timestamp: ob.cancelled_at,
          type: "OBLIGATION_CANCELLED",
          summary: `Cancelled — ${ob.cancelled_reason || "No reason"}`,
          amount: null,
          source: { table: "rent_obligations", id: ob.id },
          references: { obligation_id: ob.id },
          actor_id: ob.cancelled_by,
          metadata: { cancelled_reason: ob.cancelled_reason },
        });
      }
    }

    return events;
  }

  private async fetchPaymentEvents(
    tenantId: string,
    hostelId?: string,
    from?: Date,
    to?: Date
  ): Promise<TimelineEvent[]> {
    const where: any = { tenant_id: tenantId };
    if (hostelId) where.hostel_id = hostelId;
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at.gte = from;
      if (to) where.created_at.lte = to;
    }

    const payments = await prisma.payments.findMany({
      where,
      select: {
        id: true,
        obligation_id: true,
        amount_paid: true,
        payment_method: true,
        payment_date: true,
        created_at: true,
        offline_recorded_by: true,
        payment_group_id: true,
        reference_number: true,
      },
      orderBy: { created_at: "desc" },
    });

    return payments.map((p: any) => {
      const reversal = describePaymentReversal(p);
      return {
        id: `payment:${p.id}`,
        timestamp: p.created_at,
        type: "PAYMENT_RECORDED" as TimelineEventType,
        summary: reversal.summary,
        amount: Number(p.amount_paid),
        source: { table: "payments", id: p.id },
        references: {
          obligation_id: p.obligation_id,
          payment_id: p.id,
          payment_group_id: p.payment_group_id || undefined,
        },
        actor_id: p.offline_recorded_by,
        metadata: {
          payment_method: p.payment_method,
          payment_date: p.payment_date,
          is_reversal: reversal.isReversal,
          reverses_payment_id: reversal.reversesPaymentId,
        },
      };
    });
  }

  private async fetchLedgerEvents(
    tenantId: string,
    from?: Date,
    to?: Date
  ): Promise<TimelineEvent[]> {
    const where: any = { tenant_id: tenantId };
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at.gte = from;
      if (to) where.created_at.lte = to;
    }

    const entries = await prisma.tenant_financial_ledger.findMany({
      where,
      select: {
        id: true,
        type: true,
        amount: true,
        reason: true,
        notes: true,
        reference_id: true,
        reference_type: true,
        created_at: true,
        created_by: true,
      },
      orderBy: { created_at: "desc" },
    });

    return entries.map((e: any) => ({
      id: `ledger:${e.id}`,
      timestamp: e.created_at,
      type: (e.type === "CREDIT" ? "LEDGER_CREDIT" : "LEDGER_DEBIT") as TimelineEventType,
      summary: `${e.type} ₹${Number(e.amount).toLocaleString("en-IN")} — ${e.reason || ""}`,
      amount: e.type === "CREDIT" ? Number(e.amount) : -(Number(e.amount)),
      source: { table: "tenant_financial_ledger", id: e.id },
      references: {
        ledger_entry_id: e.id,
      },
      actor_id: e.created_by,
      metadata: {
        reason: e.reason,
        notes: e.notes,
        reference_id: e.reference_id,
        reference_type: e.reference_type,
      },
    }));
  }

  private async fetchPaymentGroupEvents(
    tenantId: string,
    hostelId?: string,
    from?: Date,
    to?: Date
  ): Promise<TimelineEvent[]> {
    const where: any = { tenant_id: tenantId };
    if (hostelId) where.hostel_id = hostelId;
    if (from || to) {
      where.created_at = {};
      if (from) where.created_at.gte = from;
      if (to) where.created_at.lte = to;
    }

    const groups = await prisma.payment_groups.findMany({
      where,
      select: {
        id: true,
        total_amount: true,
        method: true,
        source: true,
        status: true,
        settlement_breakdown: true,
        future_credit_amount: true,
        recorded_by: true,
        created_at: true,
        notes: true,
      },
      orderBy: { created_at: "desc" },
    });

    return groups.map((g: any) => {
      const breakdown = g.settlement_breakdown as any;
      const summary = breakdown?.summary || `₹${Number(g.total_amount).toLocaleString("en-IN")} settlement via ${g.method}`;

      return {
        id: `group:${g.id}`,
        timestamp: g.created_at,
        type: "PAYMENT_GROUP_SETTLED" as TimelineEventType,
        summary,
        amount: Number(g.total_amount),
        source: { table: "payment_groups", id: g.id },
        references: { payment_group_id: g.id },
        actor_id: g.recorded_by,
        metadata: {
          method: g.method,
          source: g.source,
          status: g.status,
          future_credit: Number(g.future_credit_amount || 0),
          allocations_count: breakdown?.allocations?.length || 0,
        },
      };
    });
  }

  /**
   * Read-only projection over change_requests / change_request_events —
   * no writes, no new event store. Uses changeRequestRepository (previously
   * unwired) rather than querying prisma.change_requests directly.
   */
  private async fetchChangeRequestEvents(
    tenantId: string,
    hostelId?: string,
    from?: Date,
    to?: Date
  ): Promise<TimelineEvent[]> {
    const where: any = { tenant_id: tenantId };
    if (hostelId) where.hostel_id = hostelId;
    if (from || to) {
      where.requested_at = {};
      if (from) where.requested_at.gte = from;
      if (to) where.requested_at.lte = to;
    }

    let requests: any[] = [];
    try {
      requests = await changeRequestRepository.findMany({
        where,
        orderBy: { requested_at: "desc" },
      });
    } catch (err: any) {
      logger.error("financial_timeline.change_requests_fetch_failed", { tenant_id: tenantId, err: err?.message });
      return [];
    }

    return requests.map((cr: any) => {
      const statusLabel = String(cr.status || "").replaceAll("_", " ").toLowerCase();
      return {
        id: `change_request:${cr.id}`,
        timestamp: cr.applied_at || cr.requested_at,
        type: "CHANGE_REQUEST" as TimelineEventType,
        summary: `${String(cr.change_type || "Change").replaceAll("_", " ")} request ${statusLabel}`,
        amount: null,
        source: { table: "change_requests", id: cr.id },
        references: {},
        actor_id: cr.approved_by || cr.requested_by || null,
        metadata: {
          entity_type: cr.entity_type,
          change_category: cr.change_category,
          change_type: cr.change_type,
          approval_level: cr.approval_level,
          status: cr.status,
          reason: cr.reason,
        },
      };
    });
  }
}

// ── Singleton ────────────────────────────────────────────────────────────────

export const financialTimelineService = new FinancialTimelineService();
