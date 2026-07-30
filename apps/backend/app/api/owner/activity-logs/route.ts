export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const scope = resolveOwnerScope(session);
  const { searchParams } = new URL(req.url);

  const hostelIdParam = searchParams.get("hostelId") || undefined;
  const isUuid = hostelIdParam && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(hostelIdParam);
  const hostelId = isUuid ? hostelIdParam : undefined;

  const categoryFilter = searchParams.get("category") || undefined; // 'Payments' | 'Expenses' | 'Occupancy' | 'Documents' | 'Admissions' | 'Move Outs' | 'Billing' | 'Settings'
  const search = searchParams.get("search") || undefined;
  const limit = Math.max(1, Math.min(100, parseInt(searchParams.get("limit") || "50")));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0"));

  try {
    // 1. Resolve Hostel Context
    let activeHostelId = hostelId;
    if (!activeHostelId) {
      const firstHostel = await prisma.hostels.findFirst({
        where: { owner_id: scope.owner_id, status: { in: ["ACTIVE", "INACTIVE"] } },
        select: { id: true }
      });
      if (!firstHostel) {
        return apiResponse({
          items: [],
          total: 0,
          todaySummary: { payments: 0, expenses: 0, moveouts: 0, pendingActions: 0 },
          needsAttention: { overdueTenants: [], vacantBeds: { count: 0, rooms: [] }, pendingDocs: [], pendingMoveOuts: [] }
        });
      }
      activeHostelId = firstHostel.id;
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // 2. Fetch Baseline Financial & Occupancy Info for Before/After Reconstruction
    const [totalPaymentsSum, totalExpensesSum, rooms] = await Promise.all([
      prisma.payments.aggregate({
        where: { hostel_id: activeHostelId },
        _sum: { amount_paid: true }
      }),
      prisma.expenses.aggregate({
        where: { hostel_id: activeHostelId },
        _sum: { amount: true }
      }),
      prisma.rooms.findMany({
        where: { hostel_id: activeHostelId, is_active: true },
        select: { capacity: true }
      })
    ]);

    const totalPaid = Number(totalPaymentsSum._sum.amount_paid || 0);
    const totalExp = Number(totalExpensesSum._sum.amount || 0);
    const totalCapacity = rooms.reduce((sum, r) => sum + r.capacity, 0);

    const currentOccupied = await prisma.roomAllocation.count({
      where: { hostel_id: activeHostelId, is_active: true, end_date: null }
    });

    // Concurrently fetch all financial & occupancy timeline items to build maps
    const [allPayments, allExpenses, allAllocations, allMoveOutCompleted] = await Promise.all([
      prisma.payments.findMany({
        where: { hostel_id: activeHostelId },
        select: { id: true, amount_paid: true, created_at: true },
        orderBy: { created_at: 'desc' }
      }),
      prisma.expenses.findMany({
        where: { hostel_id: activeHostelId },
        select: { id: true, amount: true, created_at: true },
        orderBy: { created_at: 'desc' }
      }),
      prisma.roomAllocation.findMany({
        where: { hostel_id: activeHostelId },
        select: { id: true, start_date: true },
        orderBy: { start_date: 'desc' }
      }),
      prisma.move_out_requests.findMany({
        where: { hostel_id: activeHostelId, status: 'COMPLETED' },
        select: { id: true, completed_at: true },
        orderBy: { completed_at: 'desc' }
      })
    ]);

    // Reconstruct Cash Position Map
    const cashEvents = [
      ...allPayments.map(p => ({ id: p.id, amount: Number(p.amount_paid), type: 'payment' as const, date: p.created_at })),
      ...allExpenses.map(e => ({ id: e.id, amount: Number(e.amount), type: 'expense' as const, date: e.created_at }))
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const cashMap = new Map<string, { before: number; after: number }>();
    let runningCash = totalPaid - totalExp;
    for (const ev of cashEvents) {
      if (ev.type === 'payment') {
        const before = runningCash - ev.amount;
        cashMap.set(`payment-${ev.id}`, { before, after: runningCash });
        runningCash = before;
      } else {
        const before = runningCash + ev.amount;
        cashMap.set(`expense-${ev.id}`, { before, after: runningCash });
        runningCash = before;
      }
    }

    // Reconstruct Occupancy Map
    const occupancyEvents = [
      ...allAllocations.map(a => ({ id: a.id, type: 'allocation' as const, date: a.start_date })),
      ...allMoveOutCompleted.map(m => ({ id: m.id, type: 'moveout' as const, date: m.completed_at! }))
    ].sort((a, b) => b.date.getTime() - a.date.getTime());

    const occupancyMap = new Map<string, { before: number; after: number }>();
    let runningOccupancy = currentOccupied;
    for (const ev of occupancyEvents) {
      if (ev.type === 'allocation') {
        const before = runningOccupancy - 1;
        occupancyMap.set(`alloc-${ev.id}`, { before, after: runningOccupancy });
        runningOccupancy = before;
      } else {
        const before = runningOccupancy + 1;
        occupancyMap.set(`moveout-completed-${ev.id}`, { before, after: runningOccupancy });
        runningOccupancy = before;
      }
    }

    // 3. Fetch Domain Data in Parallel (last 200 items each for performance)
    const [
      dbPayments,
      dbExpenses,
      dbAllocations,
      dbMoveOuts,
      dbInvitations,
      dbDocuments,
      dbActivityLogs,
      dbSystemEvents
    ] = await Promise.all([
      // Payments
      prisma.payments.findMany({
        where: { hostel_id: activeHostelId },
        include: {
          tenants: { include: { profiles: { select: { name: true, email: true, phone: true } } } },
          obligation: true
        },
        orderBy: { created_at: 'desc' },
        take: 200
      }),
      // Expenses
      prisma.expenses.findMany({
        where: { hostel_id: activeHostelId },
        orderBy: { date: 'desc' },
        take: 200
      }),
      // Allocations
      prisma.roomAllocation.findMany({
        where: { hostel_id: activeHostelId },
        include: {
          tenant: { include: { profiles: { select: { name: true, phone: true } } } },
          room: true
        },
        orderBy: { start_date: 'desc' },
        take: 200
      }),
      // Move outs
      prisma.move_out_requests.findMany({
        where: { hostel_id: activeHostelId },
        include: {
          tenant: { include: { profiles: { select: { name: true, phone: true } } } }
        },
        orderBy: { created_at: 'desc' },
        take: 200
      }),
      // Tenant Invitations (Admissions)
      prisma.tenant_invitations.findMany({
        where: { hostel_id: activeHostelId },
        include: {
          room: true
        },
        orderBy: { created_at: 'desc' },
        take: 200
      }),
      // Documents
      prisma.identificationDocument.findMany({
        where: { tenant: { hostel_id: activeHostelId } },
        include: {
          tenant: { include: { profiles: { select: { name: true, phone: true } } } }
        },
        orderBy: { created_at: 'desc' },
        take: 200
      }),
      // System settings updates and billing rent generations
      prisma.activity_logs.findMany({
        where: {
          owner_id: scope.owner_id,
          OR: [
            // AGREEMENT_TEMPLATE is handled below but was missing from this filter,
            // so its rows never reached the mapper — same bug class as EXPENSE.
            { entity_type: { in: ['HOSTEL_POLICY', 'RENT', 'AGREEMENT_TEMPLATE'] } },
            // CREATE is already reconstructed from the live `expenses` table below
            // (with cash-position enrichment); only UPDATE/DELETE need the log here,
            // since a deleted expense's row — and with it its CREATE event — disappears
            // from that live reconstruction entirely.
            { entity_type: 'EXPENSE', action_type: { in: ['UPDATE', 'DELETE'] } }
          ]
        },
        orderBy: { timestamp: 'desc' },
        take: 200
      }),
      prisma.systemEventLog.findMany({
        where: {
          owner_id: scope.owner_id,
          event_type: { in: ['AGREEMENT_RENEWED'] }
        },
        orderBy: { created_at: 'desc' },
        take: 200
      })
    ]);

    // 4. Map Domain Items to Unified Event List
    const events: any[] = [];

    // Map Payments
    dbPayments.forEach((p: any) => {
      const pId = `payment-${p.id}`;
      const cashPos = cashMap.get(pId) || { before: 0, after: 0 };
      const outstandingBefore = Number(p.obligation?.total_amount || 0);
      const outstandingAfter = Math.max(0, outstandingBefore - Number(p.amount_paid));

      events.push({
        id: pId,
        category: 'Payments',
        title: `${p.tenants?.profiles?.name || 'Tenant'} paid ₹${Number(p.amount_paid).toLocaleString('en-IN')}`,
        subtitle: `Outstanding ₹${outstandingBefore.toLocaleString('en-IN')} → ₹${outstandingAfter.toLocaleString('en-IN')}`,
        timestamp: p.created_at,
        badgeColor: 'emerald',
        actor: { name: p.offline_recorded_by ? 'Staff' : 'Tenant', email: '' },
        metadata: {
          payment_id: p.id,
          tenant_name: p.tenants?.profiles?.name || 'Tenant',
          amount: Number(p.amount_paid),
          method: p.payment_method,
          reference: p.reference_number || 'N/A',
          payment_date: p.payment_date,
          rent_month: p.obligation?.rent_month,
          outstanding_before: outstandingBefore,
          outstanding_after: outstandingAfter,
          cash_before: cashPos.before,
          cash_after: cashPos.after
        }
      });
    });

    // Map Expenses
    dbExpenses.forEach((e: any) => {
      const eId = `expense-${e.id}`;
      const cashPos = cashMap.get(eId) || { before: 0, after: 0 };

      events.push({
        id: eId,
        category: 'Expenses',
        title: `${e.title} — ₹${Number(e.amount).toLocaleString('en-IN')}`,
        subtitle: `Cash Position ₹${cashPos.before.toLocaleString('en-IN')} → ₹${cashPos.after.toLocaleString('en-IN')}`,
        timestamp: e.created_at,
        badgeColor: 'rose',
        actor: { name: 'Owner', email: '' },
        metadata: {
          expense_id: e.id,
          title: e.title,
          amount: Number(e.amount),
          category: e.category,
          vendor: e.vendor_name || 'N/A',
          method: e.payment_method || 'N/A',
          notes: e.notes || 'None',
          receipt_url: e.receipt_url,
          cash_before: cashPos.before,
          cash_after: cashPos.after
        }
      });
    });

    // Map Occupancy/Check-ins
    dbAllocations.forEach((a: any) => {
      const aId = `alloc-${a.id}`;
      const occPos = occupancyMap.get(aId) || { before: 0, after: 0 };

      events.push({
        id: aId,
        category: 'Occupancy',
        title: `${a.tenant?.profiles?.name || 'Tenant'} checked in`,
        subtitle: `Occupancy ${occPos.before}/${totalCapacity} → ${occPos.after}/${totalCapacity} beds`,
        timestamp: a.start_date,
        badgeColor: 'blue',
        actor: { name: 'System', email: '' },
        metadata: {
          allocation_id: a.id,
          tenant_name: a.tenant?.profiles?.name || 'Tenant',
          room_no: a.room?.room_no || 'N/A',
          start_date: a.start_date,
          occupancy_before: occPos.before,
          occupancy_after: occPos.after,
          total_capacity: totalCapacity
        }
      });
    });

    // Map Move Outs
    dbMoveOuts.forEach((m: any) => {
      // We can have two log milestones: requested, and completed
      const name = m.tenant?.profiles?.name || 'Tenant';

      // Requested event
      events.push({
        id: `moveout-requested-${m.id}`,
        category: 'Move Outs',
        title: `Move-out requested: ${name}`,
        subtitle: `Planned Exit: ${new Date(m.planned_exit_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`,
        timestamp: m.created_at,
        badgeColor: 'indigo',
        actor: { name: m.initiated_by_role === 'TENANT' ? 'Tenant' : 'Owner', email: '' },
        metadata: {
          request_id: m.id,
          tenant_name: name,
          reason: m.reason,
          reason_text: m.reason_text || 'No description',
          planned_exit_date: m.planned_exit_date,
          status: m.status
        }
      });

      // Completed event
      if (m.status === 'COMPLETED' && m.completed_at) {
        const occPos = occupancyMap.get(`moveout-completed-${m.id}`) || { before: 0, after: 0 };
        events.push({
          id: `moveout-completed-${m.id}`,
          category: 'Move Outs',
          title: `Move-out completed: ${name}`,
          subtitle: `Occupancy ${occPos.before}/${totalCapacity} → ${occPos.after}/${totalCapacity} beds`,
          timestamp: m.completed_at,
          badgeColor: 'slate',
          actor: { name: 'System', email: '' },
          metadata: {
            request_id: m.id,
            tenant_name: name,
            actual_exit_date: m.actual_exit_date || m.completed_at,
            status: m.status,
            occupancy_before: occPos.before,
            occupancy_after: occPos.after,
            total_capacity: totalCapacity
          }
        });
      }

      // Cancelled event
      if (m.status === 'REJECTED' && m.cancelled_at) {
        events.push({
          id: `moveout-cancelled-${m.id}`,
          category: 'Move Outs',
          title: `Move-out cancelled: ${name}`,
          subtitle: `Cancelled by: ${m.cancelled_by ? 'Owner' : 'Tenant'}`,
          timestamp: m.cancelled_at,
          badgeColor: 'slate',
          actor: { name: 'System', email: '' },
          metadata: {
            request_id: m.id,
            tenant_name: name,
            cancelled_at: m.cancelled_at,
            reason: m.cancellation_reason || 'No reason specified'
          }
        });
      }
    });

    // Map Tenant Invitations (Admissions)
    dbInvitations.forEach((inv: any) => {
      events.push({
        id: `invite-${inv.id}`,
        category: 'Admissions',
        title: `Invitation sent to ${inv.name}`,
        subtitle: `Reserved Room ${inv.room?.room_no || 'N/A'}`,
        timestamp: inv.created_at,
        badgeColor: 'sky',
        actor: { name: 'Owner', email: '' },
        metadata: {
          invitation_id: inv.id,
          name: inv.name,
          email: inv.email,
          phone: inv.phone || 'N/A',
          room_no: inv.room?.room_no || 'N/A',
          expires_at: inv.expires_at,
          status: inv.status
        }
      });
    });

    // Map Documents (uploads & reviews)
    dbDocuments.forEach((doc: any) => {
      const name = doc.tenant?.profiles?.name || 'Tenant';

      // Document Uploaded event
      events.push({
        id: `doc-uploaded-${doc.id}`,
        category: 'Documents',
        title: `${doc.doc_type} Uploaded: ${name}`,
        subtitle: `Status: Pending Verification`,
        timestamp: doc.created_at,
        badgeColor: 'amber',
        actor: { name: 'Tenant', email: '' },
        metadata: {
          doc_id: doc.id,
          tenant_name: name,
          doc_type: doc.doc_type,
          doc_number: doc.doc_number || 'N/A',
          status: doc.document_status,
          uploaded_at: doc.created_at
        }
      });

      // Document Approved/Rejected events
      if (doc.document_status === 'APPROVED' && doc.approved_at) {
        events.push({
          id: `doc-approved-${doc.id}`,
          category: 'Documents',
          title: `${doc.doc_type} Approved: ${name}`,
          subtitle: `Verified by Owner`,
          timestamp: doc.approved_at,
          badgeColor: 'emerald',
          actor: { name: 'Owner', email: '' },
          metadata: {
            doc_id: doc.id,
            tenant_name: name,
            doc_type: doc.doc_type,
            status: doc.document_status,
            approved_at: doc.approved_at
          }
        });
      } else if (doc.document_status === 'REJECTED' && doc.rejected_at) {
        events.push({
          id: `doc-rejected-${doc.id}`,
          category: 'Documents',
          title: `${doc.doc_type} Rejected: ${name}`,
          subtitle: `Reason: ${doc.rejection_reason || 'Incomplete details'}`,
          timestamp: doc.rejected_at,
          badgeColor: 'rose',
          actor: { name: 'Owner', email: '' },
          metadata: {
            doc_id: doc.id,
            tenant_name: name,
            doc_type: doc.doc_type,
            status: doc.document_status,
            rejection_reason: doc.rejection_reason || 'Incomplete details',
            rejected_at: doc.rejected_at
          }
        });
      }
    });

    // Map Settings and Billing from activity_logs
    dbActivityLogs.forEach((log: any) => {
      const meta = (log.metadata as any) || {};

      if (log.entity_type === 'HOSTEL_POLICY') {
        const domains = Array.isArray(meta.changed_domains) ? meta.changed_domains.join(', ') : 'settings';
        events.push({
          id: `policy-${log.id}`,
          category: 'Settings',
          title: `Settings Changed: ${domains}`,
          subtitle: `Updated by Owner`,
          timestamp: log.timestamp,
          badgeColor: 'purple',
          actor: { name: 'Owner', email: '' },
          metadata: {
            log_id: log.id,
            changed_domains: meta.changed_domains || [],
            policy_version: meta.policy_version || 'N/A'
          }
        });
      } else if (log.entity_type === 'RENT') {
        events.push({
          id: `rent-${log.id}`,
          category: 'Billing',
          title: `Rent Invoice Generated`,
          subtitle: `Invoiced for ${meta.tenant_count || 'active'} tenants`,
          timestamp: log.timestamp,
          badgeColor: 'indigo',
          actor: { name: 'System', email: '' },
          metadata: {
            log_id: log.id,
            tenant_count: meta.tenant_count || 0,
            total_amount: meta.total_amount || 0,
            billing_month: meta.billing_month || 'N/A'
          }
        });
      } else if (log.entity_type === 'AGREEMENT_TEMPLATE') {
        const actionLabel = log.action_type === 'UPDATE_SIGNATURE' ? 'Signature Stamp Updated' : 'Agreement Template Updated';
        events.push({
          id: `template-${log.id}`,
          category: 'Settings',
          title: actionLabel,
          subtitle: `Version: ${meta.version || 'v1'}`,
          timestamp: log.timestamp,
          badgeColor: 'purple',
          actor: { name: 'Owner', email: '' },
          metadata: {
            log_id: log.id,
            version: meta.version || 'N/A',
            title: meta.title || 'N/A',
            owner_signature_url: meta.owner_signature_url || 'N/A',
            hostel_id: meta.hostel_id || 'N/A'
          }
        });
      } else if (log.entity_type === 'EXPENSE') {
        // Only UPDATE/DELETE land here (see the query above) — CREATE is already
        // represented by the live-table reconstruction in "Map Expenses", which
        // carries the cash-position before/after that this log's metadata doesn't.
        const isDelete = log.action_type === 'DELETE';
        events.push({
          id: `expense-log-${log.id}`,
          category: 'Expenses',
          title: `${isDelete ? 'Expense deleted' : 'Expense updated'}: ${meta.title || 'Expense'} — ₹${Number(meta.amount || 0).toLocaleString('en-IN')}`,
          subtitle: isDelete ? 'Removed from records' : 'Details changed',
          timestamp: log.timestamp,
          badgeColor: 'rose',
          actor: { name: 'Owner', email: '' },
          metadata: {
            log_id: log.id,
            expense_id: log.entity_id,
            title: meta.title || 'N/A',
            amount: Number(meta.amount || 0),
            hostel_id: meta.hostel_id || null,
            action: log.action_type
          }
        });
      }
    });

    // Map Agreement system events
    dbSystemEvents.forEach((log: any) => {
      const meta = (log.metadata as any) || {};
      if (log.event_type === 'AGREEMENT_RENEWED') {
        const fromVersion = meta.previous_agreement_version || meta.old_agreement_version || meta.from_version;
        const toVersion = meta.agreement_version || meta.new_agreement_version || meta.to_version;
        const versionText = fromVersion && toVersion ? `Version ${fromVersion} -> ${toVersion}` : 'Renewal signed';
        events.push({
          id: `agreement-renewed-${log.id}`,
          category: 'Documents',
          title: 'Agreement renewed',
          subtitle: versionText,
          timestamp: log.created_at,
          badgeColor: 'emerald',
          actor: { name: meta.signed_by || 'Tenant', email: '' },
          metadata: {
            log_id: log.id,
            tenant_id: log.tenant_id || meta.tenant_id || 'N/A',
            old_agreement_id: meta.old_agreement_id || 'N/A',
            new_agreement_id: meta.new_agreement_id || 'N/A',
            renewed_at: meta.renewed_at || log.created_at,
            pdf_generated: Boolean(meta.pdf_generated),
          }
        });
      }
    });

    // 5. Sort Unified Events by Timestamp Descending
    let enrichedEvents = events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

    // 6. Apply Search and Category Filters
    if (categoryFilter) {
      enrichedEvents = enrichedEvents.filter(e => e.category.toLowerCase() === categoryFilter.toLowerCase());
    }

    if (search) {
      const q = search.toLowerCase();
      enrichedEvents = enrichedEvents.filter(e =>
        e.title.toLowerCase().includes(q) ||
        e.subtitle.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        JSON.stringify(e.metadata).toLowerCase().includes(q)
      );
    }

    // 7. Calculate "Today" Operational Summary
    const startOfTodayDate = new Date();
    startOfTodayDate.setHours(0, 0, 0, 0);

    const [todayPayments, todayExpenses, todayMoveOutsCount] = await Promise.all([
      prisma.payments.aggregate({
        where: {
          hostel_id: activeHostelId,
          created_at: { gte: startOfTodayDate }
        },
        _sum: { amount_paid: true }
      }),
      prisma.expenses.aggregate({
        where: {
          hostel_id: activeHostelId,
          created_at: { gte: startOfTodayDate }
        },
        _sum: { amount: true }
      }),
      prisma.move_out_requests.count({
        where: {
          hostel_id: activeHostelId,
          status: 'COMPLETED',
          completed_at: { gte: startOfTodayDate }
        }
      })
    ]);

    // 8. Fetch "Needs Attention" Panel Data
    // Overdue Tenants
    const overdueObligations = await prisma.rent_obligations.findMany({
      where: {
        hostel_id: activeHostelId,
        status: { in: ['PENDING', 'PARTIAL'] },
        due_date: { lt: new Date() },
        tenants: { status: 'ACTIVE' }
      },
      include: {
        tenants: {
          include: {
            profiles: { select: { name: true, phone: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { room_no: true } } }
            }
          }
        }
      }
    });

    const overdueMap = new Map<string, any>();
    overdueObligations.forEach((o: any) => {
      const t = o.tenants;
      if (!t) return;
      const tenantId = t.id;
      const name = t.profiles?.name || 'Tenant';
      const phone = t.profiles?.phone || t.phone_1 || '';
      const roomNo = t.room_allocations[0]?.room?.room_no || 'N/A';
      const amount = Number(o.amount) - (Number(o.amount_paid) || 0);
      const diffDays = Math.max(0, Math.floor((Date.now() - new Date(o.due_date).getTime()) / (1000 * 60 * 60 * 24)));

      if (overdueMap.has(tenantId)) {
        const existing = overdueMap.get(tenantId);
        existing.amountOverdue += amount;
        existing.daysOverdue = Math.max(existing.daysOverdue, diffDays);
      } else {
        overdueMap.set(tenantId, {
          tenantId,
          name,
          phone,
          roomNo,
          amountOverdue: amount,
          daysOverdue: diffDays
        });
      }
    });
    const overdueTenantsList = Array.from(overdueMap.values());

    // Vacant Beds & Rooms
    const vacantRooms = await prisma.rooms.findMany({
      where: { hostel_id: activeHostelId, is_active: true },
      select: {
        id: true,
        room_no: true,
        capacity: true,
        room_allocations: {
          where: { is_active: true, end_date: null }
        }
      }
    });
    const vacantRoomsList: any[] = [];
    let vacantBedsCount = 0;
    vacantRooms.forEach((r: any) => {
      const occupied = r.room_allocations.length;
      const vacant = Math.max(0, r.capacity - occupied);
      if (vacant > 0) {
        vacantBedsCount += vacant;
        vacantRoomsList.push({
          roomId: r.id,
          roomNo: r.room_no,
          vacantBeds: vacant
        });
      }
    });

    // Pending Documents
    const pendingDocuments = await prisma.identificationDocument.findMany({
      where: {
        tenant: {
          hostel_id: activeHostelId,
          status: 'ACTIVE'
        },
        document_status: 'PENDING',
        is_active: true
      },
      include: {
        tenant: {
          include: {
            profiles: { select: { name: true, phone: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { room_no: true } } }
            }
          }
        }
      }
    });
    const pendingDocsList = pendingDocuments.map((d: any) => ({
      docId: d.id,
      tenantId: d.tenant_id,
      name: d.tenant?.profiles?.name || 'Tenant',
      phone: d.tenant?.profiles?.phone || d.tenant?.phone_1 || '',
      roomNo: d.tenant?.room_allocations[0]?.room?.room_no || 'N/A',
      docType: d.doc_type,
      uploadedAt: d.created_at
    }));

    // Pending Move-out Requests
    const pendingMoveOuts = await prisma.move_out_requests.findMany({
      where: {
        hostel_id: activeHostelId,
        status: { notIn: ['COMPLETED', 'REJECTED'] }
      },
      include: {
        disputes: {
          where: { status: { in: ['OPEN', 'UNDER_REVIEW'] } },
          orderBy: { created_at: 'desc' }
        },
        tenant: {
          include: {
            profiles: { select: { name: true, phone: true } },
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: { select: { room_no: true } } }
            }
          }
        }
      }
    });
    const pendingMoveOutsList = pendingMoveOuts.map((m: any) => ({
      requestId: m.id,
      tenantId: m.tenant_id,
      name: m.tenant?.profiles?.name || 'Tenant',
      phone: m.tenant?.profiles?.phone || m.tenant?.phone_1 || '',
      roomNo: m.tenant?.room_allocations[0]?.room?.room_no || 'N/A',
      plannedExitDate: m.planned_exit_date,
      activeDisputes: (m.disputes || []).map((d: any) => ({
        disputeId: d.id,
        disputeType: d.dispute_type,
        disputedAmount: d.disputed_amount != null ? Number(d.disputed_amount) : null,
        status: d.status,
        raisedAt: d.created_at
      })),
      requiresReview: (m.disputes || []).length > 0
    }));

    const totalTasks = overdueTenantsList.length + pendingDocsList.length + pendingMoveOutsList.length;

    // Apply pagination
    const paginatedEvents = enrichedEvents.slice(offset, offset + limit);

    return apiResponse({
      items: paginatedEvents,
      total: enrichedEvents.length,
      todaySummary: {
        payments: Number(todayPayments._sum.amount_paid || 0),
        expenses: Number(todayExpenses._sum.amount || 0),
        moveouts: todayMoveOutsCount,
        pendingActions: totalTasks
      },
      needsAttention: {
        overdueTenants: overdueTenantsList,
        vacantBeds: {
          count: vacantBedsCount,
          rooms: vacantRoomsList
        },
        pendingDocs: pendingDocsList,
        pendingMoveOuts: pendingMoveOutsList
      }
    });

  } catch (error: any) {
    console.error("Failed to query operational activity logs:", error);
    return apiError(error.message || "Failed to fetch activity logs");
  }
}
