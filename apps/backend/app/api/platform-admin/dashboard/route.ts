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
 * Composes the KPI overview, Leads/Hostels/Revenue previews, and a Recent
 * Activity feed — the activity feed is a derived union of recent rows
 * across leads/hostels/subscriptions/invoices (queried live), not a
 * dedicated log table — keeps this slice small; see docs/obsidian/Decisions.md ADR-030.
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
      leadsPreview,
      hostelsPreview,
      recentLeads,
      recentHostels,
      recentInvoices,
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
      prisma.platform_leads.findMany({ orderBy: { created_at: "desc" }, take: 3 }),
      prisma.hostels.findMany({
        orderBy: { created_at: "desc" },
        take: 3,
        select: { id: true, name: true, city: true, listing_status: true, _count: { select: { tenants: true } } },
      }),
      prisma.platform_leads.findMany({ orderBy: { updated_at: "desc" }, take: 5, where: { updated_at: { not: null } } }),
      prisma.hostels.findMany({ orderBy: { created_at: "desc" }, take: 5, select: { id: true, name: true, created_at: true } }),
      prisma.platform_invoices.findMany({ orderBy: { paid_at: "desc" }, take: 5, where: { status: "PAID" }, include: { hostels: { select: { name: true } } } }),
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

    const activity = [
      ...recentLeads.map((l: any) => ({
        id: `lead:${l.id}`,
        time: l.updated_at,
        title: `${l.name} → ${l.status.replace("_", " ")}`,
        sub: l.hostel_name,
        color: "var(--info)",
      })),
      ...recentHostels.map((h: any) => ({
        id: `hostel:${h.id}`,
        time: h.created_at,
        title: `New hostel: ${h.name}`,
        sub: "Onboarded",
        color: "var(--primary)",
      })),
      ...recentInvoices.map((i: any) => ({
        id: `invoice:${i.id}`,
        time: i.paid_at,
        title: `Payment collected — ${i.hostels.name}`,
        sub: `₹${Number(i.amount).toLocaleString("en-IN")}`,
        color: "var(--success)",
      })),
    ]
      .filter((a) => a.time)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
      .slice(0, 8);

    return apiResponse({
      kpis: {
        new_leads: newLeads,
        pending_approvals: pendingApprovals,
        active_hostels: activeHostels,
        total_tenants: totalTenants,
        active_tenants: activeTenants,
        platform_revenue: mrr,
        collections: Number(collectedThisMonth._sum.amount ?? 0),
        pending_dues: Number(pendingPlatformInvoices._sum.amount ?? 0),
      },
      leads_preview: leadsPreview,
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
      activity,
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch dashboard");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
