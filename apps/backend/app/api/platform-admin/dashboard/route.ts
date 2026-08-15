export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * GET /api/platform-admin/dashboard
 * Composes the KPI overview, the Hostels preview, and the Revenue summary.
 * Recent activity moved to the notification bell (GET /api/platform-admin/
 * notifications, composeRecentActivity), and the Owner Leads preview card
 * was removed outright in favor of the header's dedicated leads badge
 * (GET /api/platform-admin/leads) — both used to render inline here with
 * a different interaction model than their dedicated surface; see
 * docs/obsidian/Bugs.md, 2026-08-07.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const [
      newLeads,
      pendingApprovals,
      activeHostels,
      totalTenants,
      activeTenants,
      subscriptions,
      collectedThisMonth,
      pendingPlatformInvoices,
      lifetimePlatformRevenue,
      hostelsPreview,
      documentsAwaitingReview,
      ownersTotal,
    ] = await Promise.all([
      prisma.platform_leads.count({ where: { status: "NEW" } }),
      prisma.hostels.count({ where: { verification_status: "PENDING" } }),
      prisma.hostels.count({ where: { listing_status: "LIVE" } }),
      prisma.tenants.count(),
      prisma.tenants.count({ where: { status: "ACTIVE" } }),
      prisma.hostel_subscriptions.findMany({ select: { status: true, billing_cycle: true, amount: true } }),
      prisma.platform_invoices.aggregate({ where: { status: "PAID", paid_at: { gte: monthStart } }, _sum: { amount: true } }),
      // Pending Dues here means unpaid PLATFORM subscription invoices (what
      // hostel owners owe Stayo) — same domain as /api/platform-admin/
      // revenue's `pending_collections`, deliberately NOT tenant-level rent
      // dues (a different revenue stream: what tenants owe their hostel).
      prisma.platform_invoices.aggregate({ where: { status: { in: ["PENDING", "FAILED"] } }, _sum: { amount: true } }),
      prisma.platform_invoices.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
      prisma.hostels.findMany({
        orderBy: { created_at: "desc" },
        take: 3,
        select: { id: true, name: true, city: true, listing_status: true, _count: { select: { tenants: true } } },
      }),
      // The admin's other real queue. Counted here so the dashboard can route
      // into it without the client fetching the whole documents page first.
      prisma.owner_documents.count({ where: { status: "PENDING", is_active: true } }),
      prisma.profile.count({ where: { role: "OWNER" } }),
    ]);

    // MRR composed the same way as /api/platform-admin/revenue — one
    // recurring-revenue figure, not reimplemented differently here.
    let mrr = 0;
    for (const s of subscriptions) {
      if (s.status !== "ACTIVE") continue;
      mrr += s.billing_cycle === "YEARLY" ? Number(s.amount) / 12 : Number(s.amount);
    }

    // Per-hostel occupancy/revenue/dues for the 3 preview hostels — same
    // composition as /api/platform-admin/hostels's list endpoint, scoped
    // down to just these IDs rather than reimplementing the aggregation.
    const previewIds = hostelsPreview.map((h: any) => h.id);
    const [revenueSums, duesSums, capacitySums, activeTenantCounts] = await Promise.all([
      prisma.payments.groupBy({ by: ["hostel_id"], where: { hostel_id: { in: previewIds }, payment_date: { gte: monthStart } }, _sum: { amount_paid: true } }),
      prisma.rent_obligations.groupBy({ by: ["hostel_id"], where: { hostel_id: { in: previewIds }, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } }, _sum: { amount: true } }),
      prisma.rooms.groupBy({ by: ["hostel_id"], where: { hostel_id: { in: previewIds } }, _sum: { capacity: true } }),
      prisma.tenants.groupBy({ by: ["hostel_id"], where: { hostel_id: { in: previewIds }, status: "ACTIVE" }, _count: { _all: true } }),
    ]);
    const revenueByHostel = new Map(revenueSums.map((r: any) => [r.hostel_id, Number(r._sum.amount_paid ?? 0)]));
    const duesByHostel = new Map(duesSums.map((r: any) => [r.hostel_id, Number(r._sum.amount ?? 0)]));
    const capacityByHostel = new Map(capacitySums.map((r: any) => [r.hostel_id, Number(r._sum.capacity ?? 0)]));
    const activeByHostel = new Map(activeTenantCounts.map((r: any) => [r.hostel_id, r._count._all]));

    return apiResponse({
      kpis: {
        new_leads: newLeads,
        pending_approvals: pendingApprovals, // hostels awaiting verification, not leads
        active_hostels: activeHostels,
        total_tenants: totalTenants,
        active_tenants: activeTenants,
        platform_revenue: mrr,
        collections: Number(collectedThisMonth._sum.amount ?? 0),
        pending_dues: Number(pendingPlatformInvoices._sum.amount ?? 0),
        documents_awaiting_review: documentsAwaitingReview,
        owners_total: ownersTotal,
      },
      hostels_preview: hostelsPreview.map((h: any) => {
        const capacity = Number(capacityByHostel.get(h.id) ?? 0);
        const active = Number(activeByHostel.get(h.id) ?? h._count.tenants);
        return {
          id: h.id,
          name: h.name,
          city: h.city,
          listing_status: h.listing_status,
          tenants: active,
          occupancy: capacity > 0 ? Math.round((active / capacity) * 100) : 0,
          revenue: revenueByHostel.get(h.id) ?? 0,
          dues: duesByHostel.get(h.id) ?? 0,
        };
      }),
      revenue_summary: {
        total_revenue: Number(lifetimePlatformRevenue._sum.amount ?? 0),
        platform_earnings: mrr,
        pending_collections: Number(pendingPlatformInvoices._sum.amount ?? 0),
        this_month: Number(collectedThisMonth._sum.amount ?? 0),
      },
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch dashboard");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
