export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * GET /api/platform-admin/revenue
 * Platform-wide subscription-revenue KPIs — MRR/ARR/collected/pending/
 * lifetime, plus hostel-count metrics by subscription status. All computed
 * live from `hostel_subscriptions`/`platform_invoices`, no cached snapshot.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const subscriptions = await prisma.hostel_subscriptions.findMany({ select: { status: true, billing_cycle: true, amount: true } });

    let mrr = 0;
    for (const s of subscriptions) {
      if (s.status !== "ACTIVE") continue;
      mrr += s.billing_cycle === "YEARLY" ? Number(s.amount) / 12 : Number(s.amount);
    }
    const arr = mrr * 12;

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const [collectedThisMonth, pending, lifetime, activeTenants, activeHostels] = await Promise.all([
      prisma.platform_invoices.aggregate({ where: { status: "PAID", paid_at: { gte: monthStart } }, _sum: { amount: true } }),
      prisma.platform_invoices.aggregate({ where: { status: { in: ["PENDING", "FAILED"] } }, _sum: { amount: true } }),
      prisma.platform_invoices.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }),
      prisma.tenants.count({ where: { status: "ACTIVE" } }),
      prisma.hostels.count({ where: { listing_status: "LIVE" } }),
    ]);

    const statusCounts: Record<string, number> = { TRIAL: 0, ACTIVE: 0, RENEWAL_DUE: 0, PAYMENT_FAILED: 0, CANCELLED: 0 };
    for (const s of subscriptions) statusCounts[s.status] = (statusCounts[s.status] ?? 0) + 1;

    return apiResponse({
      kpis: {
        mrr,
        arr,
        collected_this_month: Number(collectedThisMonth._sum.amount ?? 0),
        pending_collections: Number(pending._sum.amount ?? 0),
        lifetime_revenue: Number(lifetime._sum.amount ?? 0),
      },
      metrics: {
        active_hostels: activeHostels,
        active_paying: statusCounts.ACTIVE,
        active_tenants: activeTenants,
        trial_hostels: statusCounts.TRIAL,
        renewal_due: statusCounts.RENEWAL_DUE,
        payment_failed: statusCounts.PAYMENT_FAILED,
        cancelled: statusCounts.CANCELLED,
      },
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch revenue");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
