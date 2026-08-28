export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError, apiResponse, getSession } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { portfolioPerformanceService } from "@/lib/services/portfolio-performance-service";
import { getCachedDashboard, setDashboardCache } from "@/lib/cache/dashboard-cache";
import { redisKeys } from "@/lib/redis/keys";

import { resolveOwnerOrAdminScopeForHostel } from "@/lib/security/scoped-query";

type OverduePreviewRow = {
  obligation_id: string;
  tenant_id: string;
  tenant_name: string | null;
  tenant_phone: string | null;
  room_no: string | null;
  due_date: Date;
  amount: number;
  outstanding: number;
  days_overdue: number;
};

async function getOverduePreview(ownerId: string, hostelId: string) {
  const rows: OverduePreviewRow[] = await prisma.$queryRaw`
    SELECT
      ro.id::text AS obligation_id,
      ro.tenant_id::text AS tenant_id,
      CASE WHEN t.profile_id IS NULL THEN t.display_name ELSE p.name END AS tenant_name,
      COALESCE(t.phone_1, p.phone) AS tenant_phone,
      r.room_no AS room_no,
      ro.due_date AS due_date,
      COALESCE(ro.total_amount, ro.amount)::float AS amount,
      GREATEST(0, (COALESCE(ro.total_amount, ro.amount) - COALESCE(SUM(pay.amount_paid), 0)))::float AS outstanding,
      GREATEST(1, (CURRENT_DATE - ro.due_date)::int) AS days_overdue
    FROM rent_obligations ro
    JOIN tenants t ON t.id = ro.tenant_id
    LEFT JOIN profiles p ON p.id = t.profile_id
    LEFT JOIN room_allocations ra ON ra.id = ro.allocation_id
    LEFT JOIN rooms r ON r.id = ra.room_id
    LEFT JOIN payments pay ON pay.obligation_id = ro.id
    WHERE ro.owner_id = ${ownerId}::uuid
      AND ro.hostel_id = ${hostelId}::uuid
      AND ro.status IN ('PENDING', 'PARTIAL')
      AND t.status = 'ACTIVE'
      AND ro.due_date < CURRENT_DATE
    GROUP BY ro.id, ro.tenant_id, t.profile_id, t.display_name, p.name, t.phone_1, p.phone, r.room_no, ro.due_date, ro.amount, ro.total_amount
    HAVING GREATEST(0, (COALESCE(ro.total_amount, ro.amount) - COALESCE(SUM(pay.amount_paid), 0))) > 0
    ORDER BY outstanding DESC, ro.due_date ASC
    LIMIT 4
  `;

  return rows.map((row: OverduePreviewRow) => ({
    id: row.obligation_id,
    obligation_id: row.obligation_id,
    tenant_id: row.tenant_id,
    tenant: row.tenant_name || "Tenant",
    tenant_name: row.tenant_name || "Tenant",
    tenant_phone: row.tenant_phone || null,
    room: row.room_no || "",
    room_no: row.room_no || "",
    due_date: row.due_date,
    amount: Number(row.outstanding || row.amount || 0),
    outstanding: Number(row.outstanding || 0),
    days: Number(row.days_overdue || 1),
  }));
}

/**
 * GET /api/dashboard/portfolio-shell
 * Owner dashboard first-paint payload.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const ownerId = await resolveOwnerOrAdminScopeForHostel(session);
    const { searchParams } = new URL(req.url);
    const parsed = parseInt(searchParams.get("months") || "6", 10);
    const months = Number.isNaN(parsed) ? 6 : parsed;
    const cacheKey = redisKeys.portfolio.shell(ownerId, months);
    const cached = await getCachedDashboard(cacheKey);
    if (cached) return apiResponse(cached);

    const performance = await portfolioPerformanceService.getPortfolioPerformance(ownerId, months);
    const focusHostelId = performance.hostel_rankings?.[0]?.hostel_id ?? null;
    const overduePreview = focusHostelId
      ? await getOverduePreview(ownerId, focusHostelId)
      : [];

    const response = {
      ...performance,
      focus_hostel_id: focusHostelId,
      overdue_preview: overduePreview,
    };
    await setDashboardCache(cacheKey, response, 60, [
      redisKeys.tag.ownerDashboard(ownerId),
      ...(focusHostelId ? [redisKeys.tag.hostelDashboard(focusHostelId)] : []),
    ]);
    return apiResponse(response);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to fetch portfolio shell";
    return apiError(message);
  }
}
