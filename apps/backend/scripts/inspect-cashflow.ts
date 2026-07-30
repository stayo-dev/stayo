import { prisma } from "../lib/db";
import { Prisma } from "@prisma/client";
import { formatShortMonth } from "../lib/format";

function monthRanges(months: number) {
  const now = new Date();
  return Array.from({ length: months }, (_, i) => {
    const targetMonth = now.getUTCMonth() - (months - 1 - i);
    const targetYear = now.getUTCFullYear() + Math.floor(targetMonth / 12);
    const normalizedMonth = ((targetMonth % 12) + 12) % 12;
    const start = new Date(Date.UTC(targetYear, normalizedMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0, 23, 59, 59, 999));
    const monthKey = `${targetYear}-${String(normalizedMonth + 1).padStart(2, "0")}`;
    return { start, end, monthKey, label: formatShortMonth(start) };
  });
}

async function main() {
  const ownerId = "0b301633-272e-4856-b9a5-773faf3a58da";
  const ranges = monthRanges(6);
  console.log("Ranges:", ranges);

  const rangeValues = Prisma.join(
    ranges.map((range) => Prisma.sql`
      (${range.monthKey}, ${range.label}, ${range.start}::date, ${range.end}::date)
    `),
    ","
  );

  try {
    const activeHostels = await prisma.$queryRaw`
      SELECT id, name, city
      FROM hostels
      WHERE owner_id = ${ownerId}::uuid AND is_active = true
    `;
    console.log("Active Hostels Raw:", activeHostels);

    const cashflowGrid = await prisma.$queryRaw`
      WITH ranges(month_key, month_label, start_date, end_date) AS (
        VALUES ${rangeValues}
      ), active_hostels AS (
        SELECT id, name, city
        FROM hostels
        WHERE owner_id = ${ownerId}::uuid AND is_active = true
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
        h.city
      FROM ranges r
      CROSS JOIN active_hostels h
    `;
    console.log("Cashflow Grid (Simple CROSS JOIN):", cashflowGrid);

    const fullCashflowGrid = await prisma.$queryRaw`
      WITH ranges(month_key, month_label, start_date, end_date) AS (
        VALUES ${rangeValues}
      ), active_hostels AS (
        SELECT id, name, city
        FROM hostels
        WHERE owner_id = ${ownerId}::uuid AND is_active = true
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
        COALESCE(SUM(GREATEST(o.amount - COALESCE(pay_agg.total_paid, 0), 0)), 0)::float AS pending_dues
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
        )
      LEFT JOIN pay_agg ON pay_agg.obligation_id = o.id
      GROUP BY r.month_key, r.month_label, h.id, h.name, h.city
    `;
    console.log("Full Cashflow Grid:", fullCashflowGrid);

  } catch (err) {
    console.error(err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
