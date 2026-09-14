import { prisma } from "../db";

/**
 * 📜 Hostel Activity Feed
 *
 * The per-hostel "what happened here" timeline, composed from the domain
 * tables plus the two audit tables (`activity_logs`, `system_event_logs`).
 * Extracted out of `app/api/owner/activity-logs/route.ts` so the same feed
 * can back both the Overview card (a handful of rows, cheap) and the full
 * history screen (paginated, filterable, enriched) without a second
 * implementation drifting away from the first.
 *
 * Two things to know before changing this file:
 *
 * 1. **Most of this is reconstruction, not an audit trail.** Payments,
 *    expenses, allocations, move-outs, invitations and documents are read
 *    back from the live tables — an action whose row was later deleted or
 *    overwritten leaves no trace here. Only the `activity_logs` /
 *    `system_event_logs` branches are true write-time records.
 *
 * 2. **Everything must be hostel-scoped.** This feed answers "what happened
 *    in *this* hostel". The audit tables make that awkward — see
 *    `fetchHostelScopedActivityLogs` / `fetchHostelScopedSystemEvents`.
 */

export type ActivityCategory =
  | "Payments"
  | "Expenses"
  | "Occupancy"
  | "Documents"
  | "Admissions"
  | "Move Outs"
  | "Billing"
  | "Settings";

export interface ActivityFeedEvent {
  id: string;
  category: ActivityCategory;
  title: string;
  subtitle: string;
  timestamp: Date;
  badgeColor: string;
  actor: { name: string; email: string };
  metadata: Record<string, any>;
}

export interface GetEventsParams {
  hostelId: string;
  ownerId: string;
  limit?: number;
  offset?: number;
  category?: string;
  search?: string;
  /**
   * Reconstruct the running cash and occupancy position at each event.
   *
   * This is the expensive half of the feed: it reads *every* payment,
   * expense, allocation and completed move-out for the hostel and walks
   * them backwards from the current balance. Fine for the full history
   * screen, far too heavy for a five-row card that renders on every
   * hostel open — so the card passes `false` and gets plainer subtitles.
   */
  withPositions?: boolean;
}

interface PositionPair {
  before: number;
  after: number;
}

interface ReconstructedPositions {
  cash: Map<string, PositionPair>;
  occupancy: Map<string, PositionPair>;
  totalCapacity: number;
}

/** Per-table cap on the domain reads that feed the timeline. */
const DOMAIN_TAKE = 200;

const inr = (value: number) => `₹${Number(value || 0).toLocaleString("en-IN")}`;

class HostelActivityFeedService {
  /**
   * The unified, hostel-scoped, newest-first timeline.
   *
   * `category` and `search` are applied after the merge (the events come
   * from eight different tables, so there is no single query to push them
   * into), which is also why `total` reflects the filtered count.
   */
  async getEvents(params: GetEventsParams): Promise<{ items: ActivityFeedEvent[]; total: number }> {
    const {
      hostelId,
      ownerId,
      limit = 50,
      offset = 0,
      category,
      search,
      withPositions = true,
    } = params;

    const positions = withPositions ? await this.reconstructPositions(hostelId) : null;

    const [
      dbPayments,
      dbExpenses,
      dbAllocations,
      dbMoveOuts,
      dbInvitations,
      dbDocuments,
      dbActivityLogs,
      dbSystemEvents,
    ] = await Promise.all([
      prisma.payments.findMany({
        where: { hostel_id: hostelId },
        include: {
          tenants: { include: { profiles: { select: { name: true, email: true, phone: true } } } },
          obligation: true,
        },
        orderBy: { created_at: "desc" },
        take: DOMAIN_TAKE,
      }),
      prisma.expenses.findMany({
        where: { hostel_id: hostelId },
        orderBy: { date: "desc" },
        take: DOMAIN_TAKE,
      }),
      prisma.roomAllocation.findMany({
        where: { hostel_id: hostelId },
        include: {
          tenant: { include: { profiles: { select: { name: true, phone: true } } } },
          room: true,
        },
        orderBy: { start_date: "desc" },
        take: DOMAIN_TAKE,
      }),
      prisma.move_out_requests.findMany({
        where: { hostel_id: hostelId },
        include: {
          tenant: { include: { profiles: { select: { name: true, phone: true } } } },
        },
        orderBy: { created_at: "desc" },
        take: DOMAIN_TAKE,
      }),
      prisma.tenant_invitations.findMany({
        where: { hostel_id: hostelId },
        include: { room: true },
        orderBy: { created_at: "desc" },
        take: DOMAIN_TAKE,
      }),
      prisma.identificationDocument.findMany({
        where: { tenant: { hostel_id: hostelId } },
        include: {
          tenant: { include: { profiles: { select: { name: true, phone: true } } } },
        },
        orderBy: { created_at: "desc" },
        take: DOMAIN_TAKE,
      }),
      this.fetchHostelScopedActivityLogs(ownerId, hostelId),
      this.fetchHostelScopedSystemEvents(ownerId, hostelId),
    ]);

    const events: ActivityFeedEvent[] = [];

    this.mapPayments(events, dbPayments, positions);
    this.mapExpenses(events, dbExpenses, positions);
    this.mapAllocations(events, dbAllocations, positions);
    this.mapMoveOuts(events, dbMoveOuts, positions);
    this.mapInvitations(events, dbInvitations);
    this.mapDocuments(events, dbDocuments);
    this.mapActivityLogs(events, dbActivityLogs);
    this.mapSystemEvents(events, dbSystemEvents);

    let merged = events.sort(
      (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );

    if (category) {
      const wanted = category.toLowerCase();
      merged = merged.filter((e) => e.category.toLowerCase() === wanted);
    }

    if (search) {
      const q = search.toLowerCase();
      merged = merged.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.subtitle.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          JSON.stringify(e.metadata).toLowerCase().includes(q),
      );
    }

    return {
      items: merged.slice(offset, offset + limit),
      total: merged.length,
    };
  }

  // ── Hostel-scoped audit-table reads ──────────────────────────────
  //
  // Neither audit table has a `hostel_id` column, so both used to be read
  // with an owner-only filter — which meant a multi-hostel owner saw other
  // properties' settings changes, rent runs and expense edits on every
  // hostel's timeline. Each table needs a different fix, because each
  // records the hostel differently.

  /**
   * `activity_logs` keeps the hostel in `metadata.hostel_id`. Every writer
   * of the entity types read here sets it — verified against the handlers
   * in `lib/events/index.ts` (HOSTEL_POLICY, RENT, AGREEMENT_TEMPLATE,
   * EXPENSE, ROOM). Raw SQL rather than Prisma's JSON path filter so the
   * expression index on `(metadata->>'hostel_id', timestamp DESC)` is
   * actually usable; Prisma's `path` filter compiles to a jsonb comparison
   * the index does not match.
   */
  private async fetchHostelScopedActivityLogs(ownerId: string, hostelId: string) {
    return prisma.$queryRaw<
      {
        id: string;
        action_type: string;
        entity_type: string;
        entity_id: string | null;
        metadata: any;
        timestamp: Date;
      }[]
    >`
      SELECT id, action_type, entity_type, entity_id, metadata, timestamp
      FROM activity_logs
      WHERE owner_id = ${ownerId}::uuid
        AND metadata->>'hostel_id' = ${hostelId}
        AND (
          entity_type IN ('HOSTEL_POLICY', 'RENT', 'AGREEMENT_TEMPLATE', 'ROOM')
          OR (entity_type = 'EXPENSE' AND action_type IN ('UPDATE', 'DELETE'))
        )
      ORDER BY timestamp DESC
      LIMIT ${DOMAIN_TAKE}
    `;
  }

  /**
   * `system_event_logs` has no hostel in its metadata either — the
   * AGREEMENT_RENEWED writer records `tenant_id` and nothing else
   * (`agreement-renewal-signing-service.ts`). So the hostel is resolved
   * through the tenancy rather than the JSON, which is exact: a renewal
   * belongs to the hostel its tenant lives in.
   */
  private async fetchHostelScopedSystemEvents(ownerId: string, hostelId: string) {
    return prisma.$queryRaw<
      {
        id: string;
        event_type: string;
        tenant_id: string | null;
        metadata: any;
        created_at: Date;
      }[]
    >`
      SELECT s.id, s.event_type, s.tenant_id, s.metadata, s.created_at
      FROM system_event_logs s
      JOIN tenants t ON t.id = s.tenant_id
      WHERE s.owner_id = ${ownerId}::uuid
        AND t.hostel_id = ${hostelId}::uuid
        AND s.event_type IN ('AGREEMENT_RENEWED')
      ORDER BY s.created_at DESC
      LIMIT ${DOMAIN_TAKE}
    `;
  }

  // ── Mappers ──────────────────────────────────────────────────────

  private mapPayments(
    events: ActivityFeedEvent[],
    rows: any[],
    positions: ReconstructedPositions | null,
  ) {
    rows.forEach((p: any) => {
      const pId = `payment-${p.id}`;
      const cashPos = positions?.cash.get(pId) ?? null;
      const outstandingBefore = Number(p.obligation?.total_amount || 0);
      const outstandingAfter = Math.max(0, outstandingBefore - Number(p.amount_paid));

      events.push({
        id: pId,
        category: "Payments",
        title: `${p.tenants?.profiles?.name || "Tenant"} paid ${inr(Number(p.amount_paid))}`,
        subtitle: `Outstanding ${inr(outstandingBefore)} → ${inr(outstandingAfter)}`,
        timestamp: p.created_at,
        badgeColor: "emerald",
        actor: { name: p.offline_recorded_by ? "Staff" : "Tenant", email: "" },
        metadata: {
          payment_id: p.id,
          tenant_name: p.tenants?.profiles?.name || "Tenant",
          amount: Number(p.amount_paid),
          method: p.payment_method,
          reference: p.reference_number || "N/A",
          payment_date: p.payment_date,
          rent_month: p.obligation?.rent_month,
          outstanding_before: outstandingBefore,
          outstanding_after: outstandingAfter,
          ...(cashPos ? { cash_before: cashPos.before, cash_after: cashPos.after } : {}),
        },
      });
    });
  }

  private mapExpenses(
    events: ActivityFeedEvent[],
    rows: any[],
    positions: ReconstructedPositions | null,
  ) {
    rows.forEach((e: any) => {
      const eId = `expense-${e.id}`;
      const cashPos = positions?.cash.get(eId) ?? null;

      // Without a reconstructed position, say something true about the
      // expense rather than printing "Cash Position ₹0 → ₹0" — which is
      // what the old zero-fallback did whenever the map missed.
      const subtitle = cashPos
        ? `Cash Position ${inr(cashPos.before)} → ${inr(cashPos.after)}`
        : [e.category, e.vendor_name].filter(Boolean).join(" · ") || "Expense recorded";

      events.push({
        id: eId,
        category: "Expenses",
        title: `${e.title} — ${inr(Number(e.amount))}`,
        subtitle,
        timestamp: e.created_at,
        badgeColor: "rose",
        actor: { name: "Owner", email: "" },
        metadata: {
          expense_id: e.id,
          title: e.title,
          amount: Number(e.amount),
          category: e.category,
          vendor: e.vendor_name || "N/A",
          method: e.payment_method || "N/A",
          notes: e.notes || "None",
          receipt_url: e.receipt_url,
          ...(cashPos ? { cash_before: cashPos.before, cash_after: cashPos.after } : {}),
        },
      });
    });
  }

  private mapAllocations(
    events: ActivityFeedEvent[],
    rows: any[],
    positions: ReconstructedPositions | null,
  ) {
    rows.forEach((a: any) => {
      const aId = `alloc-${a.id}`;
      const occPos = positions?.occupancy.get(aId) ?? null;
      const capacity = positions?.totalCapacity ?? 0;
      const roomNo = a.room?.room_no || "N/A";

      events.push({
        id: aId,
        category: "Occupancy",
        title: `${a.tenant?.profiles?.name || "Tenant"} checked in`,
        subtitle: occPos
          ? `Occupancy ${occPos.before}/${capacity} → ${occPos.after}/${capacity} beds`
          : `Room ${roomNo}`,
        timestamp: a.start_date,
        badgeColor: "blue",
        actor: { name: "System", email: "" },
        metadata: {
          allocation_id: a.id,
          tenant_name: a.tenant?.profiles?.name || "Tenant",
          room_no: roomNo,
          start_date: a.start_date,
          ...(occPos
            ? {
                occupancy_before: occPos.before,
                occupancy_after: occPos.after,
                total_capacity: capacity,
              }
            : {}),
        },
      });
    });
  }

  private mapMoveOuts(
    events: ActivityFeedEvent[],
    rows: any[],
    positions: ReconstructedPositions | null,
  ) {
    rows.forEach((m: any) => {
      const name = m.tenant?.profiles?.name || "Tenant";

      events.push({
        id: `moveout-requested-${m.id}`,
        category: "Move Outs",
        title: `Move-out requested: ${name}`,
        subtitle: `Planned Exit: ${new Date(m.planned_exit_date).toLocaleDateString("en-IN", {
          day: "numeric",
          month: "short",
          timeZone: "Asia/Kolkata",
        })}`,
        timestamp: m.created_at,
        badgeColor: "indigo",
        actor: { name: m.initiated_by_role === "TENANT" ? "Tenant" : "Owner", email: "" },
        metadata: {
          request_id: m.id,
          tenant_name: name,
          reason: m.reason,
          reason_text: m.reason_text || "No description",
          planned_exit_date: m.planned_exit_date,
          status: m.status,
        },
      });

      if (m.status === "COMPLETED" && m.completed_at) {
        const occPos = positions?.occupancy.get(`moveout-completed-${m.id}`) ?? null;
        const capacity = positions?.totalCapacity ?? 0;
        events.push({
          id: `moveout-completed-${m.id}`,
          category: "Move Outs",
          title: `Move-out completed: ${name}`,
          subtitle: occPos
            ? `Occupancy ${occPos.before}/${capacity} → ${occPos.after}/${capacity} beds`
            : "Tenant has exited",
          timestamp: m.completed_at,
          badgeColor: "slate",
          actor: { name: "System", email: "" },
          metadata: {
            request_id: m.id,
            tenant_name: name,
            actual_exit_date: m.actual_exit_date || m.completed_at,
            status: m.status,
            ...(occPos
              ? {
                  occupancy_before: occPos.before,
                  occupancy_after: occPos.after,
                  total_capacity: capacity,
                }
              : {}),
          },
        });
      }

      if (m.status === "REJECTED" && m.cancelled_at) {
        events.push({
          id: `moveout-cancelled-${m.id}`,
          category: "Move Outs",
          title: `Move-out cancelled: ${name}`,
          subtitle: `Cancelled by: ${m.cancelled_by ? "Owner" : "Tenant"}`,
          timestamp: m.cancelled_at,
          badgeColor: "slate",
          actor: { name: "System", email: "" },
          metadata: {
            request_id: m.id,
            tenant_name: name,
            cancelled_at: m.cancelled_at,
            reason: m.cancellation_reason || "No reason specified",
          },
        });
      }
    });
  }

  private mapInvitations(events: ActivityFeedEvent[], rows: any[]) {
    rows.forEach((inv: any) => {
      events.push({
        id: `invite-${inv.id}`,
        category: "Admissions",
        title: `Invitation sent to ${inv.name}`,
        subtitle: `Reserved Room ${inv.room?.room_no || "N/A"}`,
        timestamp: inv.created_at,
        badgeColor: "sky",
        actor: { name: "Owner", email: "" },
        metadata: {
          invitation_id: inv.id,
          name: inv.name,
          email: inv.email,
          phone: inv.phone || "N/A",
          room_no: inv.room?.room_no || "N/A",
          expires_at: inv.expires_at,
          status: inv.status,
        },
      });
    });
  }

  private mapDocuments(events: ActivityFeedEvent[], rows: any[]) {
    rows.forEach((doc: any) => {
      const name = doc.tenant?.profiles?.name || "Tenant";

      events.push({
        id: `doc-uploaded-${doc.id}`,
        category: "Documents",
        title: `${doc.doc_type} Uploaded: ${name}`,
        subtitle: `Status: Pending Verification`,
        timestamp: doc.created_at,
        badgeColor: "amber",
        actor: { name: "Tenant", email: "" },
        metadata: {
          doc_id: doc.id,
          tenant_name: name,
          doc_type: doc.doc_type,
          doc_number: doc.doc_number || "N/A",
          status: doc.document_status,
          uploaded_at: doc.created_at,
        },
      });

      if (doc.document_status === "APPROVED" && doc.approved_at) {
        events.push({
          id: `doc-approved-${doc.id}`,
          category: "Documents",
          title: `${doc.doc_type} Approved: ${name}`,
          subtitle: `Verified by Owner`,
          timestamp: doc.approved_at,
          badgeColor: "emerald",
          actor: { name: "Owner", email: "" },
          metadata: {
            doc_id: doc.id,
            tenant_name: name,
            doc_type: doc.doc_type,
            status: doc.document_status,
            approved_at: doc.approved_at,
          },
        });
      } else if (doc.document_status === "REJECTED" && doc.rejected_at) {
        events.push({
          id: `doc-rejected-${doc.id}`,
          category: "Documents",
          title: `${doc.doc_type} Rejected: ${name}`,
          subtitle: `Reason: ${doc.rejection_reason || "Incomplete details"}`,
          timestamp: doc.rejected_at,
          badgeColor: "rose",
          actor: { name: "Owner", email: "" },
          metadata: {
            doc_id: doc.id,
            tenant_name: name,
            doc_type: doc.doc_type,
            status: doc.document_status,
            rejection_reason: doc.rejection_reason || "Incomplete details",
            rejected_at: doc.rejected_at,
          },
        });
      }
    });
  }

  private mapActivityLogs(events: ActivityFeedEvent[], rows: any[]) {
    rows.forEach((log: any) => {
      const meta = (log.metadata as any) || {};

      if (log.entity_type === "HOSTEL_POLICY") {
        const domains = Array.isArray(meta.changed_domains)
          ? meta.changed_domains.join(", ")
          : "settings";
        events.push({
          id: `policy-${log.id}`,
          category: "Settings",
          title: `Settings Changed: ${domains}`,
          subtitle: `Updated by Owner`,
          timestamp: log.timestamp,
          badgeColor: "purple",
          actor: { name: "Owner", email: "" },
          metadata: {
            log_id: log.id,
            changed_domains: meta.changed_domains || [],
            policy_version: meta.policy_version || "N/A",
          },
        });
      } else if (log.entity_type === "RENT") {
        events.push({
          id: `rent-${log.id}`,
          category: "Billing",
          title: `Rent Invoice Generated`,
          subtitle: `Invoiced for ${meta.tenant_count || "active"} tenants`,
          timestamp: log.timestamp,
          badgeColor: "indigo",
          actor: { name: "System", email: "" },
          metadata: {
            log_id: log.id,
            tenant_count: meta.tenant_count || 0,
            total_amount: meta.total_amount || 0,
            billing_month: meta.billing_month || "N/A",
          },
        });
      } else if (log.entity_type === "AGREEMENT_TEMPLATE") {
        const actionLabel =
          log.action_type === "UPDATE_SIGNATURE"
            ? "Signature Stamp Updated"
            : "Agreement Template Updated";
        events.push({
          id: `template-${log.id}`,
          category: "Settings",
          title: actionLabel,
          subtitle: `Version: ${meta.version || "v1"}`,
          timestamp: log.timestamp,
          badgeColor: "purple",
          actor: { name: "Owner", email: "" },
          metadata: {
            log_id: log.id,
            version: meta.version || "N/A",
            title: meta.title || "N/A",
            owner_signature_url: meta.owner_signature_url || "N/A",
            hostel_id: meta.hostel_id || "N/A",
          },
        });
      } else if (log.entity_type === "ROOM") {
        // Written by lib/events/index.ts on every room create/update/delete
        // since those handlers were added, but never read back until now —
        // room changes were simply invisible on the timeline. There is no
        // live-table reconstruction for rooms (a retired room keeps
        // `is_active: false`, so a "deletion" leaves no dated trace), which
        // makes the log the only source for these.
        const roomNo = meta.room_no ? `Room ${meta.room_no}` : "Room";
        const label =
          log.action_type === "CREATE"
            ? `${roomNo} added`
            : log.action_type === "DELETE"
              ? `${roomNo} retired`
              : `${roomNo} updated`;
        events.push({
          id: `room-${log.id}`,
          category: "Occupancy",
          title: label,
          subtitle:
            log.action_type === "CREATE" && meta.capacity
              ? `Capacity ${meta.capacity} beds`
              : "Changed by Owner",
          timestamp: log.timestamp,
          badgeColor: log.action_type === "DELETE" ? "slate" : "blue",
          actor: { name: "Owner", email: "" },
          metadata: {
            log_id: log.id,
            room_id: log.entity_id,
            room_no: meta.room_no || "N/A",
            capacity: meta.capacity ?? null,
            action: log.action_type,
          },
        });
      } else if (log.entity_type === "EXPENSE") {
        // Only UPDATE/DELETE land here (see the query above) — CREATE is
        // already represented by the live-table reconstruction in
        // `mapExpenses`, which carries a cash position this log's metadata
        // does not.
        const isDelete = log.action_type === "DELETE";
        events.push({
          id: `expense-log-${log.id}`,
          category: "Expenses",
          title: `${isDelete ? "Expense deleted" : "Expense updated"}: ${
            meta.title || "Expense"
          } — ${inr(Number(meta.amount || 0))}`,
          subtitle: isDelete ? "Removed from records" : "Details changed",
          timestamp: log.timestamp,
          badgeColor: "rose",
          actor: { name: "Owner", email: "" },
          metadata: {
            log_id: log.id,
            expense_id: log.entity_id,
            title: meta.title || "N/A",
            amount: Number(meta.amount || 0),
            hostel_id: meta.hostel_id || null,
            action: log.action_type,
          },
        });
      }
    });
  }

  private mapSystemEvents(events: ActivityFeedEvent[], rows: any[]) {
    rows.forEach((log: any) => {
      const meta = (log.metadata as any) || {};
      if (log.event_type !== "AGREEMENT_RENEWED") return;

      const fromVersion =
        meta.previous_agreement_version || meta.old_agreement_version || meta.from_version;
      const toVersion = meta.agreement_version || meta.new_agreement_version || meta.to_version;
      const versionText =
        fromVersion && toVersion ? `Version ${fromVersion} -> ${toVersion}` : "Renewal signed";

      events.push({
        id: `agreement-renewed-${log.id}`,
        category: "Documents",
        title: "Agreement renewed",
        subtitle: versionText,
        timestamp: log.created_at,
        badgeColor: "emerald",
        actor: { name: meta.signed_by || "Tenant", email: "" },
        metadata: {
          log_id: log.id,
          tenant_id: log.tenant_id || meta.tenant_id || "N/A",
          old_agreement_id: meta.old_agreement_id || "N/A",
          new_agreement_id: meta.new_agreement_id || "N/A",
          renewed_at: meta.renewed_at || log.created_at,
          pdf_generated: Boolean(meta.pdf_generated),
        },
      });
    });
  }

  // ── Position reconstruction ──────────────────────────────────────

  /**
   * Walks the hostel's full cash and occupancy history backwards from the
   * current balance so each event can show the position before and after
   * it. Unavoidably reads every payment, expense, allocation and completed
   * move-out for the hostel — hence `withPositions`.
   */
  private async reconstructPositions(hostelId: string): Promise<ReconstructedPositions> {
    const [totalPaymentsSum, totalExpensesSum, rooms] = await Promise.all([
      prisma.payments.aggregate({
        where: { hostel_id: hostelId },
        _sum: { amount_paid: true },
      }),
      prisma.expenses.aggregate({
        where: { hostel_id: hostelId },
        _sum: { amount: true },
      }),
      prisma.rooms.findMany({
        where: { hostel_id: hostelId, is_active: true },
        select: { capacity: true },
      }),
    ]);

    const totalPaid = Number(totalPaymentsSum._sum.amount_paid || 0);
    const totalExp = Number(totalExpensesSum._sum.amount || 0);
    const totalCapacity = rooms.reduce((sum: number, r: any) => sum + r.capacity, 0);

    const currentOccupied = await prisma.roomAllocation.count({
      where: { hostel_id: hostelId, is_active: true, end_date: null },
    });

    const [allPayments, allExpenses, allAllocations, allMoveOutCompleted] = await Promise.all([
      prisma.payments.findMany({
        where: { hostel_id: hostelId },
        select: { id: true, amount_paid: true, created_at: true },
        orderBy: { created_at: "desc" },
      }),
      prisma.expenses.findMany({
        where: { hostel_id: hostelId },
        select: { id: true, amount: true, created_at: true },
        orderBy: { created_at: "desc" },
      }),
      prisma.roomAllocation.findMany({
        where: { hostel_id: hostelId },
        select: { id: true, start_date: true },
        orderBy: { start_date: "desc" },
      }),
      prisma.move_out_requests.findMany({
        where: { hostel_id: hostelId, status: "COMPLETED" },
        select: { id: true, completed_at: true },
        orderBy: { completed_at: "desc" },
      }),
    ]);

    const cashEvents = [
      ...allPayments.map((p: any) => ({
        id: p.id,
        amount: Number(p.amount_paid),
        type: "payment" as const,
        date: p.created_at,
      })),
      ...allExpenses.map((e: any) => ({
        id: e.id,
        amount: Number(e.amount),
        type: "expense" as const,
        date: e.created_at,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const cash = new Map<string, PositionPair>();
    let runningCash = totalPaid - totalExp;
    for (const ev of cashEvents) {
      if (ev.type === "payment") {
        const before = runningCash - ev.amount;
        cash.set(`payment-${ev.id}`, { before, after: runningCash });
        runningCash = before;
      } else {
        const before = runningCash + ev.amount;
        cash.set(`expense-${ev.id}`, { before, after: runningCash });
        runningCash = before;
      }
    }

    const occupancyEvents = [
      ...allAllocations.map((a: any) => ({ id: a.id, type: "allocation" as const, date: a.start_date })),
      ...allMoveOutCompleted.map((m: any) => ({
        id: m.id,
        type: "moveout" as const,
        date: m.completed_at!,
      })),
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const occupancy = new Map<string, PositionPair>();
    let runningOccupancy = currentOccupied;
    for (const ev of occupancyEvents) {
      if (ev.type === "allocation") {
        const before = runningOccupancy - 1;
        occupancy.set(`alloc-${ev.id}`, { before, after: runningOccupancy });
        runningOccupancy = before;
      } else {
        const before = runningOccupancy + 1;
        occupancy.set(`moveout-completed-${ev.id}`, { before, after: runningOccupancy });
        runningOccupancy = before;
      }
    }

    return { cash, occupancy, totalCapacity };
  }

  // ── Side panels ──────────────────────────────────────────────────

  /** Money in, money out and exits since IST midnight. */
  async getTodaySummary(hostelId: string, pendingActions: number) {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const [todayPayments, todayExpenses, todayMoveOutsCount] = await Promise.all([
      prisma.payments.aggregate({
        where: { hostel_id: hostelId, created_at: { gte: startOfToday } },
        _sum: { amount_paid: true },
      }),
      prisma.expenses.aggregate({
        where: { hostel_id: hostelId, created_at: { gte: startOfToday } },
        _sum: { amount: true },
      }),
      prisma.move_out_requests.count({
        where: {
          hostel_id: hostelId,
          status: "COMPLETED",
          completed_at: { gte: startOfToday },
        },
      }),
    ]);

    return {
      payments: Number(todayPayments._sum.amount_paid || 0),
      expenses: Number(todayExpenses._sum.amount || 0),
      moveouts: todayMoveOutsCount,
      pendingActions,
    };
  }

  /** Overdue tenants, vacant beds, unverified documents and open move-outs. */
  async getNeedsAttention(hostelId: string) {
    const overdueObligations = await prisma.rent_obligations.findMany({
      where: {
        hostel_id: hostelId,
        status: { in: ["PENDING", "PARTIAL"] },
        due_date: { lt: new Date() },
        tenants: { status: "ACTIVE" },
      },
      include: {
        tenants: {
          include: {
            profiles: { select: { name: true, phone: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { room_no: true } } },
            },
          },
        },
      },
    });

    const overdueMap = new Map<string, any>();
    overdueObligations.forEach((o: any) => {
      const t = o.tenants;
      if (!t) return;
      const amount = Number(o.amount) - (Number(o.amount_paid) || 0);
      const diffDays = Math.max(
        0,
        Math.floor((Date.now() - new Date(o.due_date).getTime()) / (1000 * 60 * 60 * 24)),
      );

      const existing = overdueMap.get(t.id);
      if (existing) {
        existing.amountOverdue += amount;
        existing.daysOverdue = Math.max(existing.daysOverdue, diffDays);
      } else {
        overdueMap.set(t.id, {
          tenantId: t.id,
          name: t.profiles?.name || "Tenant",
          phone: t.profiles?.phone || t.phone_1 || "",
          roomNo: t.room_allocations[0]?.room?.room_no || "N/A",
          amountOverdue: amount,
          daysOverdue: diffDays,
        });
      }
    });
    const overdueTenants = Array.from(overdueMap.values());

    const rooms = await prisma.rooms.findMany({
      where: { hostel_id: hostelId, is_active: true },
      select: {
        id: true,
        room_no: true,
        capacity: true,
        room_allocations: { where: { is_active: true, end_date: null } },
      },
    });
    const vacantRoomsList: any[] = [];
    let vacantBedsCount = 0;
    rooms.forEach((r: any) => {
      const vacant = Math.max(0, r.capacity - r.room_allocations.length);
      if (vacant > 0) {
        vacantBedsCount += vacant;
        vacantRoomsList.push({ roomId: r.id, roomNo: r.room_no, vacantBeds: vacant });
      }
    });

    const pendingDocuments = await prisma.identificationDocument.findMany({
      where: {
        tenant: { hostel_id: hostelId, status: "ACTIVE" },
        document_status: "PENDING",
        is_active: true,
      },
      include: {
        tenant: {
          include: {
            profiles: { select: { name: true, phone: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { room_no: true } } },
            },
          },
        },
      },
    });
    const pendingDocs = pendingDocuments.map((d: any) => ({
      docId: d.id,
      tenantId: d.tenant_id,
      name: d.tenant?.profiles?.name || "Tenant",
      phone: d.tenant?.profiles?.phone || d.tenant?.phone_1 || "",
      roomNo: d.tenant?.room_allocations[0]?.room?.room_no || "N/A",
      docType: d.doc_type,
      uploadedAt: d.created_at,
    }));

    const openMoveOuts = await prisma.move_out_requests.findMany({
      where: { hostel_id: hostelId, status: { notIn: ["COMPLETED", "REJECTED"] } },
      include: {
        disputes: {
          where: { status: { in: ["OPEN", "UNDER_REVIEW"] } },
          orderBy: { created_at: "desc" },
        },
        tenant: {
          include: {
            profiles: { select: { name: true, phone: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { room_no: true } } },
            },
          },
        },
      },
    });
    const pendingMoveOuts = openMoveOuts.map((m: any) => ({
      requestId: m.id,
      tenantId: m.tenant_id,
      name: m.tenant?.profiles?.name || "Tenant",
      phone: m.tenant?.profiles?.phone || m.tenant?.phone_1 || "",
      roomNo: m.tenant?.room_allocations[0]?.room?.room_no || "N/A",
      plannedExitDate: m.planned_exit_date,
      activeDisputes: (m.disputes || []).map((d: any) => ({
        disputeId: d.id,
        disputeType: d.dispute_type,
        disputedAmount: d.disputed_amount != null ? Number(d.disputed_amount) : null,
        status: d.status,
        raisedAt: d.created_at,
      })),
      requiresReview: (m.disputes || []).length > 0,
    }));

    return {
      overdueTenants,
      vacantBeds: { count: vacantBedsCount, rooms: vacantRoomsList },
      pendingDocs,
      pendingMoveOuts,
    };
  }
}

export const hostelActivityFeedService = new HostelActivityFeedService();
