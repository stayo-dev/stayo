import { prisma } from "../db";

export interface ActivityItem {
  id: string;
  time: Date;
  title: string;
  sub: string;
  color: string;
}

/**
 * Composes the admin notification-bell feed — a live union of recent rows
 * across hostels/paid invoices, not a dedicated log table. See
 * docs/obsidian/Decisions.md ADR-030 for why this stays a derived query
 * rather than a dedicated table, and the "compose, don't reimplement"
 * convention used elsewhere (e.g. financial-read-model-service.ts).
 *
 * Deliberately excludes leads — leads already have a dedicated place (the
 * Owner Leads dashboard card and /admin/leads), so surfacing them here too
 * meant the same event showed up in two places with two different
 * interaction models. See docs/obsidian/Bugs.md, 2026-08-07.
 */
/**
 * Mirrors the listing/verification status vocabulary shown on the Hostels
 * page (`LISTING_CHIP`/`VERIFICATION_CHIP` in AdminHostelsPage.tsx) so the
 * activity feed doesn't invent its own status language.
 */
function describeHostelStatus(h: { verification_status: string; listing_status: string }): { sub: string; color: string } {
  if (h.listing_status === "SUSPENDED") return { sub: "Suspended", color: "var(--destructive)" };
  if (h.listing_status === "LIVE") return { sub: "Onboarded", color: "var(--success)" };
  if (h.verification_status === "VERIFIED") return { sub: "Verified — pending listing", color: "var(--warning)" };
  return { sub: "Pending verification", color: "var(--warning)" };
}

// Human labels for ServiceRequestType — no shared label map exists between
// the backend and the tenant-facing frontend config, so this stays local.
const SERVICE_REQUEST_LABELS: Record<string, string> = {
  MAINTENANCE: "Maintenance request",
  ROOM_CHANGE: "Room change request",
  CLEANING: "Cleaning request",
  LOST_KEY: "Lost key request",
  VISITOR_PASS: "Visitor pass request",
  EXTRA_MATTRESS: "Extra mattress request",
};

function describeServiceRequestStatus(status: string): { color: string } {
  if (status === "RESOLVED" || status === "CLOSED") return { color: "var(--success)" };
  if (status === "IN_PROGRESS") return { color: "var(--warning)" };
  return { color: "var(--destructive)" }; // RAISED — needs attention
}

export async function composeRecentActivity(limit = 8): Promise<ActivityItem[]> {
  // Fetch more per-source than the final limit, since the final ranking is
  // a merge-by-time across all three sources — under-fetching one source
  // could silently drop a genuinely-recent item in its favor.
  const perSourceTake = Math.max(limit, 10);
  const [recentHostels, recentInvoices, recentServiceRequests] = await Promise.all([
    prisma.hostels.findMany({ orderBy: { created_at: "desc" }, take: perSourceTake, select: { id: true, name: true, created_at: true, verification_status: true, listing_status: true } }),
    prisma.platform_invoices.findMany({ orderBy: { paid_at: "desc" }, take: perSourceTake, where: { status: "PAID" }, include: { hostels: { select: { name: true } } } }),
    prisma.tenant_service_requests.findMany({
      orderBy: { created_at: "desc" },
      take: perSourceTake,
      include: { hostels: { select: { name: true } }, tenants: { include: { profiles: true } } },
    }),
  ]);

  const activity: ActivityItem[] = [
    ...recentHostels.map((h: any) => ({
      id: `hostel:${h.id}`,
      time: h.created_at,
      title: `New hostel: ${h.name}`,
      ...describeHostelStatus(h),
    })),
    ...recentInvoices.map((i: any) => ({
      id: `invoice:${i.id}`,
      time: i.paid_at,
      title: `Payment collected — ${i.hostels.name}`,
      sub: `₹${Number(i.amount).toLocaleString("en-IN")}`,
      color: "var(--success)",
    })),
    ...recentServiceRequests.map((r: any) => ({
      id: `service-request:${r.id}`,
      time: r.created_at,
      title: `${SERVICE_REQUEST_LABELS[r.type] ?? "Service request"} — ${r.hostels.name}`,
      sub: r.tenants?.profiles?.name || r.description || "Tenant request",
      ...describeServiceRequestStatus(r.status),
    })),
  ];

  return activity
    .filter((a) => a.time)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, limit);
}
