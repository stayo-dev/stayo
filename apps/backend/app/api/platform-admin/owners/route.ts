export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") {
    throw new Error("FORBIDDEN: Admin access only");
  }
}

const REQUIRED_DOCS = ["AADHAAR", "PAN"];

/**
 * GET /api/platform-admin/owners?search=&limit=&offset=
 *
 * The platform's customers, one row each — the entity the admin actually
 * manages. `/platform-admin/hostels` lists properties, so an owner running
 * three hostels appears there as three unrelated rows with no way to see them
 * as one business.
 *
 * Returns **raw signals, not a verdict.** Health, at-risk reasons and
 * needs-attention bucketing are derived in one pure, tested frontend module
 * (`ownerHealth.ts`) so the rules live in one readable place and can be tested
 * without a database — the same split the owner-facing dashboard uses.
 *
 * Two signals are deliberately absent because nothing records them:
 * engagement (there is no last-login tracking anywhere) and support issues
 * (there is no ticketing backend). They are not approximated — a fabricated
 * "healthy" is worse than an honest gap.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 100);
    const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

    const where = {
      role: "OWNER" as const,
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [owners, total] = await Promise.all([
      prisma.profile.findMany({
        where,
        select: { id: true, name: true, email: true, phone: true, created_at: true, is_active: true },
        orderBy: { created_at: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.profile.count({ where }),
    ]);

    const ownerIds = owners.map((o) => o.id);
    if (ownerIds.length === 0) {
      return apiResponse({ owners: [], total, offset, has_more: false });
    }

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    // Every hostel belonging to this page of owners, so per-hostel figures can
    // be rolled up without a second round trip per owner.
    const hostels = await prisma.hostels.findMany({
      where: { owner_id: { in: ownerIds } },
      select: { id: true, owner_id: true, name: true, listing_status: true, verification_status: true },
    });
    const hostelIds = hostels.map((h) => h.id);

    const [
      tenantCounts,
      activeTenantCounts,
      capacitySums,
      collectionSums,
      duesSums,
      documents,
      subscriptions,
      lastActivity,
    ] = await Promise.all([
      prisma.tenants.groupBy({ by: ["owner_id"], where: { owner_id: { in: ownerIds } }, _count: { _all: true } }),
      prisma.tenants.groupBy({
        by: ["owner_id"],
        where: { owner_id: { in: ownerIds }, status: "ACTIVE" },
        _count: { _all: true },
      }),
      prisma.rooms.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, is_active: true },
        _sum: { capacity: true },
      }),
      prisma.payments.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, payment_date: { gte: monthStart } },
        _sum: { amount_paid: true },
      }),
      prisma.rent_obligations.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        _sum: { amount: true },
      }),
      prisma.owner_documents.findMany({
        where: { profile_id: { in: ownerIds }, is_active: true },
        select: { profile_id: true, doc_type: true, status: true },
      }),
      // Billing is still per hostel; an owner's figure is the roll-up of their
      // hostels' subscriptions until owner-level subscriptions land.
      prisma.hostel_subscriptions.findMany({
        where: { hostel_id: { in: hostelIds } },
        select: { hostel_id: true, status: true, amount: true, billing_cycle: true, next_renewal_at: true },
      }),
      // Real, but sparse: only a few services write activity_logs, so this is
      // "last recorded action", never "last seen". The UI must not present it
      // as a login.
      prisma.activity_logs.groupBy({
        by: ["owner_id"],
        where: { owner_id: { in: ownerIds } },
        _max: { timestamp: true },
      }),
    ]);

    const byOwner = <T>(rows: any[], key: string, pick: (row: any) => T) =>
      new Map<string, T>(rows.map((r) => [r[key] as string, pick(r)]));

    const tenantsByOwner = byOwner(tenantCounts, "owner_id", (r) => r._count._all as number);
    const activeByOwner = byOwner(activeTenantCounts, "owner_id", (r) => r._count._all as number);
    const capacityByHostel = byOwner(capacitySums, "hostel_id", (r) => Number(r._sum.capacity ?? 0));
    const collectedByHostel = byOwner(collectionSums, "hostel_id", (r) => Number(r._sum.amount_paid ?? 0));
    const duesByHostel = byOwner(duesSums, "hostel_id", (r) => Number(r._sum.amount ?? 0));
    const lastActivityByOwner = byOwner(lastActivity, "owner_id", (r) => r._max.timestamp as Date | null);
    const subscriptionByHostel = new Map(subscriptions.map((s) => [s.hostel_id, s]));

    const result = owners.map((owner) => {
      const own = hostels.filter((h) => h.owner_id === owner.id);
      const ids = own.map((h) => h.id);

      const sum = (map: Map<string, number>) => ids.reduce((acc, id) => acc + (map.get(id) ?? 0), 0);
      const capacity = sum(capacityByHostel);
      const activeTenants = activeByOwner.get(owner.id) ?? 0;

      const ownerDocs = documents.filter((d) => d.profile_id === owner.id);
      const verifiedTypes = new Set(
        ownerDocs.filter((d) => String(d.status).toUpperCase() === "VERIFIED").map((d) => String(d.doc_type).toUpperCase()),
      );

      const subs = ids.map((id) => subscriptionByHostel.get(id)).filter(Boolean) as typeof subscriptions;
      const mrr = subs.reduce(
        (acc, s) =>
          String(s.status) === "ACTIVE"
            ? acc + (String(s.billing_cycle) === "YEARLY" ? Number(s.amount) / 12 : Number(s.amount))
            : acc,
        0,
      );
      const renewals = subs.map((s) => s.next_renewal_at).filter(Boolean) as Date[];

      return {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        joined_at: owner.created_at,
        is_active: owner.is_active,

        hostels: own.length,
        hostels_live: own.filter((h) => String(h.listing_status) === "LIVE").length,
        hostels_awaiting_approval: own.filter((h) => String(h.verification_status) === "PENDING").length,
        hostel_names: own.slice(0, 3).map((h) => h.name),

        tenants: tenantsByOwner.get(owner.id) ?? 0,
        active_tenants: activeTenants,
        capacity,
        occupancy: capacity > 0 ? Math.round((activeTenants / capacity) * 100) : 0,

        collected_this_month: sum(collectedByHostel),
        outstanding: sum(duesByHostel),

        documents_verified: REQUIRED_DOCS.every((t) => verifiedTypes.has(t)),
        documents_rejected: ownerDocs.some((d) => String(d.status).toUpperCase() === "REJECTED"),
        documents_submitted: ownerDocs.length,

        mrr,
        subscription_statuses: subs.map((s) => String(s.status)),
        next_renewal_at: renewals.length > 0 ? new Date(Math.min(...renewals.map((d) => d.getTime()))) : null,

        /** Last recorded *action*, not a login — see the note above. */
        last_activity_at: lastActivityByOwner.get(owner.id) ?? null,
      };
    });

    return apiResponse({
      owners: result,
      total,
      offset,
      has_more: offset + owners.length < total,
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch owners");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
