export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") {
    throw new Error("FORBIDDEN: Admin access only");
  }
}

/**
 * GET /api/platform-admin/activity — Super Admin's view of manager/admin
 * activity. Filters: managerId (user_id), hostelId, actionType, entityType,
 * from/to (timestamp range).
 *
 * Reads `activity_logs` — the same table `hostel-activity-feed-service.ts`
 * reads for the owner-facing feed, and the same table pre-existing
 * owner-side event handlers (`lib/events/index.ts` — tenant/room
 * create/update/allocate, etc.) already write to for completely unrelated
 * reasons. That table is NOT manager-scoped by construction, so this route
 * must scope it itself: the default (and floor — it cannot be widened by
 * any query param) is `profiles.role IN ('MANAGER', 'ADMIN')` on the
 * acting user, applied in SQL so it also governs the LIMIT/pagination
 * correctly, not filtered client-side after the fact. Owner-generated
 * activity (ALLOCATE/CREATE/UPDATE/DELETE from the owner app) never enters
 * this feed, regardless of `managerId`/`hostelId`/etc. — see
 * tests/platform-admin-activity-scope.test.ts.
 *
 * `hostel_id` lives in `metadata` (migrations/082_activity_logs_hostel_index.sql),
 * so the hostel filter uses raw SQL for the same reason
 * hostel-activity-feed-service.ts does: Prisma's JSON path filter does not
 * use the expression index.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const { searchParams } = new URL(req.url);
    const managerId = searchParams.get("managerId") || undefined;
    const hostelId = searchParams.get("hostelId") || undefined;
    const actionType = searchParams.get("actionType") || undefined;
    const entityType = searchParams.get("entityType") || undefined;
    const from = searchParams.get("from") || undefined;
    const to = searchParams.get("to") || undefined;
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 200);

    // The floor scope — not a filter a query param can widen or bypass.
    const conditions: Prisma.Sql[] = [
      Prisma.sql`user_id IN (SELECT id FROM profiles WHERE role IN ('MANAGER', 'ADMIN'))`,
    ];
    if (managerId) conditions.push(Prisma.sql`user_id = ${managerId}::uuid`);
    if (hostelId) conditions.push(Prisma.sql`metadata->>'hostel_id' = ${hostelId}`);
    if (actionType) conditions.push(Prisma.sql`action_type = ${actionType}`);
    if (entityType) conditions.push(Prisma.sql`entity_type = ${entityType}`);
    if (from) conditions.push(Prisma.sql`timestamp >= ${from}::timestamptz`);
    if (to) conditions.push(Prisma.sql`timestamp <= ${to}::timestamptz`);

    const rows: any[] = await prisma.$queryRaw`
      SELECT id, user_id, owner_id, action_type, entity_type, entity_id, metadata, timestamp
      FROM activity_logs
      WHERE ${Prisma.join(conditions, " AND ")}
      ORDER BY timestamp DESC
      LIMIT ${limit}
    `;

    const actorIds = Array.from(new Set(rows.map((r) => r.user_id).filter(Boolean)));
    const actors: Array<{ id: string; name: string; role: string }> = actorIds.length
      ? await prisma.profile.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true, role: true } })
      : [];
    const actorsById = new Map(actors.map((a) => [a.id, a]));

    const activity = rows.map((row) => ({
      id: row.id,
      actionType: row.action_type,
      entityType: row.entity_type,
      entityId: row.entity_id,
      hostelId: row.metadata?.hostel_id ?? null,
      actorProfileId: row.user_id,
      actorName: actorsById.get(row.user_id)?.name ?? row.metadata?.actor_name ?? null,
      actorRole: actorsById.get(row.user_id)?.role ?? row.metadata?.actor_role ?? null,
      metadata: row.metadata,
      timestamp: row.timestamp,
    }));

    return apiResponse({ activity });
  } catch (error: any) {
    return apiError(error.message, "ERROR", 500);
  }
}
