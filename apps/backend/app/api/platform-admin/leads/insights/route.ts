export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any): asserts session is { sub: string; role: string } {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

/**
 * GET /api/platform-admin/leads/insights
 *
 * Feeds the console's "Feedback & insights" tab.
 *
 * Two deliberately different treatments:
 *
 *  - **Lost reasons are COUNTED.** `lost_reason` is an enum, so grouping it
 *    produces a chart that means something.
 *
 *  - **Discovery answers are LISTED, never counted.** `pain_point` and
 *    `current_tooling` are free-form by design (their schema comment warns a
 *    reworded option produces a new distinct value), and the discovery fields
 *    are prose. Bar-charting those would invent categories out of typos and
 *    phrasing. They are returned as quotes for a human to read.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const [lostGroups, totals, recentDiscovery, toolingGroups] = await Promise.all([
      prisma.platform_leads.groupBy({
        by: ["lost_reason"],
        where: { status: "LOST", lost_reason: { not: null } },
        _count: { _all: true },
      }),
      prisma.platform_leads.groupBy({
        by: ["status"],
        _count: { _all: true },
      }),
      prisma.platform_leads.findMany({
        where: {
          OR: [
            { discovery_problem: { not: null } },
            { discovery_why: { not: null } },
            { discovery_expect: { not: null } },
          ],
        },
        select: {
          id: true, name: true, hostel_name: true, city: true, status: true,
          discovery_problem: true, discovery_why: true, discovery_expect: true,
          updated_at: true, created_at: true,
        },
        orderBy: { updated_at: "desc" },
        take: 20,
      }),
      // Free-form, so this is exposed as "what they told us they use", not as
      // a chart. Normalising case is the only aggregation that is honest here.
      prisma.platform_leads.findMany({
        where: { current_tooling: { not: null } },
        select: { current_tooling: true },
        take: 500,
      }),
    ]);

    const statusCounts: Record<string, number> = {};
    for (const g of totals as any[]) statusCounts[String(g.status)] = g._count._all;

    const totalLeads = Object.values(statusCounts).reduce((a, b) => a + b, 0);
    const lost = statusCounts.LOST ?? 0;
    const live = statusCounts.LIVE ?? 0;

    const toolingTally = new Map<string, number>();
    for (const row of toolingGroups as any[]) {
      const key = String(row.current_tooling).trim().toLowerCase();
      if (!key) continue;
      toolingTally.set(key, (toolingTally.get(key) ?? 0) + 1);
    }

    return apiResponse({
      totals: {
        total_leads: totalLeads,
        lost,
        live,
        with_discovery: recentDiscovery.length,
        // Guarded: an empty pipeline must not produce NaN%.
        conversion_pct: totalLeads > 0 ? Number(((live / totalLeads) * 100).toFixed(1)) : null,
        loss_pct: totalLeads > 0 ? Number(((lost / totalLeads) * 100).toFixed(1)) : null,
      },
      lost_reasons: lostGroups
        .map((g: any) => ({ reason: String(g.lost_reason), count: g._count._all }))
        .sort((a: any, b: any) => b.count - a.count),
      tooling: Array.from(toolingTally.entries())
        .map(([label, count]) => ({ label, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      discovery: recentDiscovery,
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch lead insights");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
