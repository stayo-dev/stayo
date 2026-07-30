import { prisma } from "../lib/db";
import { Prisma } from "@prisma/client";
import { portfolioPerformanceService } from "../lib/services/portfolio-performance-service";

function formatShortMonth(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
}

function monthRanges(monthsCount: number) {
  const now = new Date();
  const currentUTCMonth = now.getUTCMonth();
  return Array.from({ length: monthsCount }, (_, i) => {
    const targetMonth = currentUTCMonth - (monthsCount - 1 - i);
    const targetYear = now.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const start = new Date(Date.UTC(targetYear, normalizedMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0, 23, 59, 59, 999));
    const monthKey = `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}`;
    return { start, end, monthKey, label: formatShortMonth(start) };
  });
}

async function main() {
  try {
    const ownerId = 'c39676a0-c867-4435-9660-a060b8bceab6';
    const profile = await prisma.profile.findUnique({
      where: { id: ownerId }
    });
    console.log("\n=== OWNER PROFILE ===");
    console.log({
      id: profile?.id,
      email: profile?.email,
      name: profile?.name,
      role: profile?.role,
      is_active: profile?.is_active
    });

    console.log("\n=== PORTFOLIO PERFORMANCE RAW QUERIES ===");
    
    // Let's run raw query to see if active hostels exist and check ranges
    const ranges = monthRanges(6);
    const rangeValues = Prisma.join(
      ranges.map((range) => Prisma.sql`
        (${range.monthKey}, ${range.label}, ${range.start}::date, ${range.end}::date)
      `),
      ","
    );
    
    const prismaHostels = await prisma.hostels.findMany();
    console.log("All Hostels in DB:", prismaHostels.map(h => ({
      id: h.id,
      name: h.name,
      owner_id: h.owner_id,
      status: h.status,
      archived_at: h.archived_at
    })));

    console.log("Altering database search path settings...");
    await prisma.$executeRawUnsafe('ALTER ROLE postgres SET search_path = public, test;');
    await prisma.$executeRawUnsafe('ALTER DATABASE postgres SET search_path = public, test;');
    console.log("Altered search path settings successfully.");

    const dbContext = await prisma.$queryRaw`
      SELECT current_database(), current_user, current_setting('search_path') as search_path
    `;
    console.log("DB Context after alter in same connection:", dbContext);

    const tablesList = await prisma.$queryRaw`
      SELECT table_schema, table_name 
      FROM information_schema.tables 
      WHERE table_name = 'hostels'
    `;
    console.log("Hostels table in information_schema:", tablesList);

    const hostelsDirectSql = await prisma.$queryRawUnsafe('SELECT id, name, status FROM public.hostels');
    console.log("Hostels count from queryRawUnsafe with public prefix:", hostelsDirectSql.length, hostelsDirectSql);

    const cashflowGrid = await prisma.$queryRaw`
        WITH ranges(month_key, month_label, start_date, end_date) AS (
          VALUES ${rangeValues}
        ), active_hostels AS (
          SELECT id, name, city
          FROM hostels
          WHERE owner_id = ${ownerId}::uuid AND status != 'ARCHIVED'
        ), pay_agg AS (
          SELECT obligation_id, SUM(amount_paid)::float AS total_paid
          FROM payments
          GROUP BY obligation_id
        )
        SELECT
          r.month_key,
          r.month_label,
          h.id::text AS hostel_id,
          h.name AS hostel_name,
          h.city,
          COALESCE(SUM(o.amount - GREATEST(o.amount - COALESCE(pay_agg.total_paid, 0), 0)), 0)::float AS revenue,
          COALESCE(SUM(o.amount - GREATEST(o.amount - COALESCE(pay_agg.total_paid, 0), 0)), 0)::float AS collections,
          COALESCE(SUM(GREATEST(o.amount - COALESCE(pay_agg.total_paid, 0), 0)), 0)::float AS pending_dues,
          CASE
            WHEN COALESCE(SUM(o.amount), 0) > 0
              THEN ROUND((COALESCE(SUM(o.amount - GREATEST(o.amount - COALESCE(pay_agg.total_paid, 0), 0)), 0) / SUM(o.amount) * 10000)::numeric) / 100
            ELSE 0
          END::float AS collection_rate
        FROM ranges r
        CROSS JOIN active_hostels h
        LEFT JOIN rent_obligations o
          ON o.owner_id = ${ownerId}::uuid
          AND o.hostel_id = h.id
          AND o.status <> 'WAIVED'
          AND o.rent_month >= r.start_date
          AND o.rent_month <= r.end_date
          AND EXISTS (
            SELECT 1
            FROM tenants t
            WHERE t.id = o.tenant_id
              AND t.status = 'ACTIVE'
          )
        LEFT JOIN pay_agg ON pay_agg.obligation_id = o.id
        GROUP BY r.month_key, r.month_label, h.id, h.name, h.city
        ORDER BY r.month_key ASC, h.name ASC
    `;
    console.log("Cashflow Grid:", cashflowGrid);

    const rentObligations = await prisma.rent_obligations.findMany({
      where: { owner_id: ownerId },
      include: { tenants: true }
    });
    console.log("Total Rent Obligations for owner:", rentObligations.length);
    if (rentObligations.length > 0) {
      console.log("First 3 rent obligations sample:", rentObligations.slice(0, 3).map(o => ({
        id: o.id,
        hostel_id: o.hostel_id,
        tenant_id: o.tenant_id,
        tenant_status: o.tenants?.status,
        amount: o.amount,
        status: o.status,
        rent_month: o.rent_month
      })));
    }

    const res = await portfolioPerformanceService.getPortfolioPerformance(ownerId, 6);
    console.log("Portfolio Response keys:", Object.keys(res));
    console.log("Hostel Rankings:", res.hostel_rankings);
    console.log("Insight Highest Profit:", res.business_health_insights);

  } catch (err: any) {
    console.error("Error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

main();


