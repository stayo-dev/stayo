import { prisma } from "../db";

export interface ActivityItem {
  id: string;
  time: Date;
  title: string;
  sub: string;
  color: string;
}

/**
 * Composes a Recent Activity feed — a live union of recent rows across
 * leads/hostels/paid invoices, not a dedicated log table. Originally
 * inline in GET /api/platform-admin/dashboard; extracted so the admin
 * notification bell (GET /api/platform-admin/notifications) can reuse the
 * exact same composition instead of reimplementing it — see
 * docs/obsidian/Decisions.md ADR-030 for why this stays a derived query
 * rather than a dedicated table, and the "compose, don't reimplement"
 * convention used elsewhere (e.g. financial-read-model-service.ts).
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

export async function composeRecentActivity(limit = 8): Promise<ActivityItem[]> {
  // Fetch more per-source than the final limit, since the final ranking is
  // a merge-by-time across all three sources — under-fetching one source
  // could silently drop a genuinely-recent item in its favor.
  const perSourceTake = Math.max(limit, 10);
  const [recentLeads, recentHostels, recentInvoices] = await Promise.all([
    prisma.platform_leads.findMany({ orderBy: { updated_at: "desc" }, take: perSourceTake, where: { updated_at: { not: null } } }),
    prisma.hostels.findMany({ orderBy: { created_at: "desc" }, take: perSourceTake, select: { id: true, name: true, created_at: true, verification_status: true, listing_status: true } }),
    prisma.platform_invoices.findMany({ orderBy: { paid_at: "desc" }, take: perSourceTake, where: { status: "PAID" }, include: { hostels: { select: { name: true } } } }),
  ]);

  const activity: ActivityItem[] = [
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
      ...describeHostelStatus(h),
    })),
    ...recentInvoices.map((i: any) => ({
      id: `invoice:${i.id}`,
      time: i.paid_at,
      title: `Payment collected — ${i.hostels.name}`,
      sub: `₹${Number(i.amount).toLocaleString("en-IN")}`,
      color: "var(--success)",
    })),
  ];

  return activity
    .filter((a) => a.time)
    .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
    .slice(0, limit);
}
