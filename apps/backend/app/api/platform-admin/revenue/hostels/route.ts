export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * GET /api/platform-admin/revenue/hostels?search=&status=
 * Per-hostel subscription cards for the Revenue tab.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status") || undefined;

    const subscriptions = await prisma.hostel_subscriptions.findMany({
      where: {
        ...(status ? { status: status as any } : {}),
        hostels: search
          ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { city: { contains: search, mode: "insensitive" } }] }
          : undefined,
      },
      include: {
        subscription_plans: true,
        hostels: { select: { id: true, name: true, city: true } },
        platform_invoices: { where: { status: "PAID" }, select: { amount: true } },
      },
      orderBy: { created_at: "desc" },
    });

    const hostelIds = subscriptions.map((s: any) => s.hostel_id);
    const duesRows = hostelIds.length
      ? await prisma.rent_obligations.groupBy({
          by: ["hostel_id"],
          where: { hostel_id: { in: hostelIds }, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
          _sum: { amount: true },
        })
      : [];
    const duesByHostel = new Map(duesRows.map((r: any) => [r.hostel_id, Number(r._sum.amount ?? 0)]));

    const result = subscriptions.map((s: any) => ({
      hostel_id: s.hostel_id,
      hostel_name: s.hostels.name,
      city: s.hostels.city,
      status: s.status,
      plan_name: s.subscription_plans.name,
      billing_cycle: s.billing_cycle,
      amount: Number(s.amount),
      autopay_enabled: s.autopay_enabled,
      next_renewal_at: s.next_renewal_at,
      collected: s.platform_invoices.reduce((sum: number, i: any) => sum + Number(i.amount), 0),
      dues: duesByHostel.get(s.hostel_id) ?? 0,
    }));

    return apiResponse({ hostels: result });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch revenue hostels");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
