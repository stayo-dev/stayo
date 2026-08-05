import { prisma } from "../../db";
import { financialService } from "../../../src/services/payments/financial-service";
import { isOverdue } from "../../../src/services/payments/settlement-planner";
import {
  prioritise,
  sortQueue,
  daysBetween,
  BUCKETS,
  DEFAULT_PRIORITY_CONFIG,
  type BucketId,
  type PriorityFactor,
  type PriorityConfig,
} from "./prioritisation";

/**
 * The owner's rent-collection work queue (ADR-045).
 *
 * **Money is never recalculated here.** `financialService.getTenantPaymentSummary`
 * — sync, and explicitly built to take pre-fetched rows for batch/list views —
 * produces `outstanding` and `last payment`. `isOverdue()` from the settlement
 * planner decides what counts as overdue. This service's only job is to
 * assemble those existing answers, attach the signals prioritisation needs, and
 * order the result.
 *
 * Query budget is **fixed at 4** regardless of tenant count: tenants,
 * obligations (+payments), reminders, historical late payments. The per-tenant
 * fan-out that `/api/payments/quick-collect/search` uses would be 2N here.
 */

export interface CollectionQueueRow {
  tenantId: string;
  tenantName: string;
  phone: string;
  hostelId: string;
  hostelName: string;
  room: string;
  outstanding: number;
  daysOverdue: number;
  daysUntilDue: number | null;
  lastPaymentAt: string | null;
  lastPaymentAmount: number;
  lastReminderAt: string | null;
  reminderCount: number;
  previousLatePayments: number;
  bucket: BucketId;
  score: number;
  /** Every point, attributed. The UI shows these as the "why". */
  factors: PriorityFactor[];
  /** Reserved for the recommendation engine — not built. See ADR-045. */
  recommendation: null;
}

export interface CollectionQueueGroup {
  id: BucketId;
  label: string;
  order: number;
  count: number;
  totalOutstanding: number;
  rows: CollectionQueueRow[];
}

export interface CollectionQueue {
  groups: CollectionQueueGroup[];
  totalTenants: number;
  totalOutstanding: number;
  generatedAt: string;
}

/** Statuses whose obligations can still be collected. */
const OPEN_STATUSES = ["PENDING", "PARTIAL", "OVERDUE"] as const;

export class CollectionQueueService {
  async getQueue(params: {
    ownerId: string;
    /**
     * A hostel id to scope to, or `null` for the whole portfolio.
     *
     * **Deliberately required, not optional.** The architectural invariant
     * bans an *optional* hostel id on operational service contracts, because
     * absent hostel context previously let code silently operate on the wrong
     * hostel for multi-hostel owners. (The check is a plain regex over source,
     * so quoting the banned signature here would itself trip it.) Making
     * the caller pass an explicit `null` keeps "all hostels" a stated decision
     * rather than a forgotten argument — and this service genuinely never
     * picks a single hostel on the caller's behalf; `null` fans out across
     * every hostel the owner owns.
     */
    hostelFilter: string | null;
    config?: PriorityConfig;
    today?: Date;
  }): Promise<CollectionQueue> {
    const { ownerId, hostelFilter } = params;
    const config = params.config ?? DEFAULT_PRIORITY_CONFIG;
    const today = params.today ?? new Date();

    // ── 1. Tenants in scope ────────────────────────────────────────────────
    const tenants = await prisma.tenants.findMany({
      where: {
        owner_id: ownerId,
        status: "ACTIVE",
        ...(hostelFilter ? { hostel_id: hostelFilter } : {}),
      },
      select: {
        id: true,
        phone_1: true,
        hostel_id: true,
        profiles: { select: { name: true, phone: true } },
        hostels: { select: { name: true } },
        room_allocations: {
          where: { is_active: true, end_date: null },
          select: { room: { select: { room_no: true } } },
          take: 1,
        },
      },
    });

    if (tenants.length === 0) {
      return { groups: [], totalTenants: 0, totalOutstanding: 0, generatedAt: today.toISOString() };
    }

    const tenantIds = tenants.map((t: any) => t.id);

    // ── 2-4. Everything else, in parallel, batched across all tenants ──────
    const [openObligations, reminders, latePaidObligations] = await Promise.all([
      prisma.rent_obligations.findMany({
        where: { tenant_id: { in: tenantIds }, is_superseded: false, status: { in: [...OPEN_STATUSES] } },
        select: {
          tenant_id: true,
          status: true,
          amount: true,
          total_amount: true,
          due_date: true,
          payments: { select: { amount_paid: true, payment_date: true } },
        },
      }),

      prisma.reminder_logs.groupBy({
        by: ["tenant_id"],
        where: { tenant_id: { in: tenantIds }, converted_to_payment: false },
        _max: { sent_at: true },
        _count: { _all: true },
      }),

      // Repeat-issue signal: obligations already settled, but settled after
      // their due date. Counting these is a history lookup, not a re-derivation
      // of anything owed now.
      prisma.rent_obligations.findMany({
        where: { tenant_id: { in: tenantIds }, is_superseded: false, status: "PAID" },
        select: {
          tenant_id: true,
          due_date: true,
          payments: { select: { payment_date: true }, orderBy: { payment_date: "desc" }, take: 1 },
        },
      }),
    ]);

    // ── Group the batched rows by tenant ───────────────────────────────────
    const obligationsByTenant = new Map<string, any[]>();
    for (const ob of openObligations as any[]) {
      const list = obligationsByTenant.get(ob.tenant_id);
      if (list) list.push(ob);
      else obligationsByTenant.set(ob.tenant_id, [ob]);
    }

    const remindersByTenant = new Map<string, { lastSentAt: Date | null; count: number }>(
      (reminders as any[]).map((r) => [r.tenant_id, { lastSentAt: r._max.sent_at ?? null, count: r._count._all ?? 0 }]),
    );

    const lateCountByTenant = new Map<string, number>();
    for (const ob of latePaidObligations as any[]) {
      const paidAt = ob.payments?.[0]?.payment_date;
      if (!paidAt || !ob.due_date) continue;
      if (new Date(paidAt) > new Date(ob.due_date)) {
        lateCountByTenant.set(ob.tenant_id, (lateCountByTenant.get(ob.tenant_id) ?? 0) + 1);
      }
    }

    // ── Assemble ───────────────────────────────────────────────────────────
    const rows: CollectionQueueRow[] = [];

    for (const t of tenants as any[]) {
      const obligations = obligationsByTenant.get(t.id) ?? [];

      // THE outstanding figure and last payment — composed, never recomputed.
      const summary = financialService.getTenantPaymentSummary(t.id, obligations as any);
      if (summary.pending_amount <= 0) continue;

      // Oldest overdue and nearest upcoming due date, using the canonical
      // overdue predicate rather than a local date comparison.
      let oldestOverdueDue: Date | null = null;
      let nearestUpcomingDue: Date | null = null;

      for (const ob of obligations) {
        if (!ob.due_date) continue;
        const due = new Date(ob.due_date);
        const paid = (ob.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount_paid), 0);
        const remaining = Number(ob.total_amount || ob.amount) - paid;
        if (remaining <= 0) continue;

        if (isOverdue({ status: ob.status, due_date: due }, today)) {
          if (!oldestOverdueDue || due < oldestOverdueDue) oldestOverdueDue = due;
        } else if (!nearestUpcomingDue || due < nearestUpcomingDue) {
          nearestUpcomingDue = due;
        }
      }

      const reminder = remindersByTenant.get(t.id);
      const signals = {
        outstanding: summary.pending_amount,
        daysOverdue: oldestOverdueDue ? Math.max(daysBetween(oldestOverdueDue, today), 0) : 0,
        daysUntilDue: oldestOverdueDue ? null : nearestUpcomingDue ? daysBetween(today, nearestUpcomingDue) : null,
        lastPaymentAt: summary.last_paid_at,
        lastReminderAt: reminder?.lastSentAt ?? null,
        reminderCount: reminder?.count ?? 0,
        previousLatePayments: lateCountByTenant.get(t.id) ?? 0,
      };

      const prioritised = prioritise(signals, today, config);
      if (!prioritised) continue;

      rows.push({
        tenantId: t.id,
        tenantName: t.profiles?.name || "Tenant",
        phone: t.profiles?.phone || t.phone_1 || "",
        hostelId: t.hostel_id,
        hostelName: t.hostels?.name ?? "",
        room: t.room_allocations?.[0]?.room?.room_no ?? "",
        outstanding: signals.outstanding,
        daysOverdue: signals.daysOverdue,
        daysUntilDue: signals.daysUntilDue,
        lastPaymentAt: summary.last_paid_at ? new Date(summary.last_paid_at).toISOString() : null,
        lastPaymentAmount: summary.last_payment_amount,
        lastReminderAt: signals.lastReminderAt ? new Date(signals.lastReminderAt).toISOString() : null,
        reminderCount: signals.reminderCount,
        previousLatePayments: signals.previousLatePayments,
        bucket: prioritised.bucket,
        score: prioritised.score,
        factors: prioritised.factors,
        recommendation: prioritised.recommendation,
      });
    }

    const sorted = sortQueue(rows);

    // Only non-empty groups are returned — an empty section is a decision the
    // owner has to make ("is this bucket relevant?") for no benefit.
    const groups: CollectionQueueGroup[] = [];
    for (const key of Object.keys(BUCKETS) as BucketId[]) {
      const bucketRows = sorted.filter((r) => r.bucket === key);
      if (bucketRows.length === 0) continue;
      groups.push({
        id: key,
        label: BUCKETS[key].label,
        order: BUCKETS[key].order,
        count: bucketRows.length,
        totalOutstanding: bucketRows.reduce((n, r) => n + r.outstanding, 0),
        rows: bucketRows,
      });
    }
    groups.sort((a, b) => a.order - b.order);

    return {
      groups,
      totalTenants: sorted.length,
      totalOutstanding: sorted.reduce((n, r) => n + r.outstanding, 0),
      generatedAt: today.toISOString(),
    };
  }
}

export const collectionQueueService = new CollectionQueueService();
