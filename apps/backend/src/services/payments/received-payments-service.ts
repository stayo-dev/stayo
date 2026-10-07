import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  likePattern,
  toReceivedPayment,
  type ReceivedPayment,
  type ReceivedQuery,
  type ReceivedRowRaw,
} from "./received-payments-rules";

export type ReceivedPaymentsPage = {
  payments: ReceivedPayment[];
  /** Totals for the whole filtered set, not just this page. */
  summary: { count: number; total: number; reversedCount: number };
  hasMore: boolean;
};

/**
 * The owner's Received list — every rent collection, newest first.
 *
 * Reads the `payments` ledger directly, because that is where every rupee that
 * reduced an obligation lives regardless of how it arrived: cash and UPI typed
 * in by the owner, a confirmed tenant UPI claim (ADR-235), a quick-collect, or a
 * gateway capture. Nothing here recomputes what is owed — it only lists what
 * was received.
 *
 * Rows are grouped by `payment_group_id` (one collection split FIFO across
 * months by the settlement engine), falling back to the payment's own id for
 * rows written outside the engine. A reversal is a negative row whose reference
 * is `REVERSAL:<original id>`; the negative row is never listed, the original is
 * marked reversed and its amount is taken out of the totals.
 *
 * Ownership is enforced by joining `hostels.owner_id` — a caller-supplied hostel
 * id can only narrow the owner's own rows, never widen them.
 */
export async function listReceivedPayments(ownerId: string, q: ReceivedQuery): Promise<ReceivedPaymentsPage> {
  const hostelClause = q.hostelId ? Prisma.sql`AND p.hostel_id = ${q.hostelId}::uuid` : Prisma.empty;
  const fromClause = q.from ? Prisma.sql`AND p.payment_date >= ${q.from}::date` : Prisma.empty;
  const toClause = q.to ? Prisma.sql`AND p.payment_date <= ${q.to}::date` : Prisma.empty;
  const methodClause = q.method ? Prisma.sql`AND UPPER(p.payment_method) = ${q.method}` : Prisma.empty;
  const searchClause = q.search ? Prisma.sql`AND pr.name ILIKE ${likePattern(q.search)}` : Prisma.empty;

  const base = Prisma.sql`
    WITH reversed AS (
      SELECT DISTINCT substring(r.reference_number FROM 10) AS original_id
      FROM payments r
      JOIN hostels rh ON rh.id = r.hostel_id AND rh.owner_id = ${ownerId}::uuid
      WHERE r.reference_number LIKE 'REVERSAL:%'
    ),
    scoped AS (
      SELECT
        COALESCE(p.payment_group_id, p.id) AS key,
        p.tenant_id,
        p.hostel_id,
        p.amount_paid::float AS amount,
        p.payment_method,
        p.reference_number,
        p.payment_date,
        p.created_at,
        o.obligation_type::text AS type,
        o.rent_month,
        o.installment_label AS label,
        (rv.original_id IS NOT NULL) AS is_reversed
      FROM payments p
      JOIN hostels h ON h.id = p.hostel_id AND h.owner_id = ${ownerId}::uuid
      LEFT JOIN rent_obligations o ON o.id = p.obligation_id
      LEFT JOIN reversed rv ON rv.original_id = p.id::text
      WHERE p.amount_paid > 0
        AND (p.reference_number IS NULL OR p.reference_number NOT LIKE 'REVERSAL:%')
        ${hostelClause}
        ${fromClause}
        ${toClause}
        ${methodClause}
    ),
    grouped AS (
      SELECT
        key,
        (ARRAY_AGG(tenant_id ORDER BY created_at))[1] AS tenant_id,
        (ARRAY_AGG(hostel_id ORDER BY created_at))[1] AS hostel_id,
        (ARRAY_AGG(payment_method ORDER BY created_at))[1] AS method,
        (ARRAY_AGG(reference_number ORDER BY created_at))[1] AS reference,
        MAX(payment_date) AS paid_on,
        MIN(created_at) AS recorded_at,
        COALESCE(SUM(amount) FILTER (WHERE NOT is_reversed), 0)::float AS amount,
        COALESCE(SUM(amount) FILTER (WHERE is_reversed), 0)::float AS reversed_amount,
        JSONB_AGG(JSONB_BUILD_OBJECT(
          'type', type, 'rent_month', rent_month, 'label', label,
          'amount', amount, 'reversed', is_reversed
        )) AS covers
      FROM scoped
      GROUP BY key
    ),
    named AS (
      SELECT g.*, pr.name AS tenant_name, h.name AS hostel_name, room.room_no
      FROM grouped g
      JOIN hostels h ON h.id = g.hostel_id
      LEFT JOIN tenants t ON t.id = g.tenant_id
      LEFT JOIN profiles pr ON pr.id = t.profile_id
      LEFT JOIN LATERAL (
        SELECT rm.room_no
        FROM room_allocations ra
        JOIN rooms rm ON rm.id = ra.room_id
        WHERE ra.tenant_id = g.tenant_id
        ORDER BY ra.is_active DESC, ra.start_date DESC
        LIMIT 1
      ) room ON true
      WHERE TRUE ${searchClause}
    )`;

  const [rows, totals] = await Promise.all([
    prisma.$queryRaw<ReceivedRowRaw[]>`
      ${base}
      SELECT key::text, tenant_id::text, tenant_name, room_no, hostel_id::text, hostel_name,
             method, reference, paid_on, recorded_at, amount, reversed_amount, covers
      FROM named
      ORDER BY paid_on DESC, recorded_at DESC, key
      LIMIT ${q.limit + 1}
      OFFSET ${q.offset}`,
    prisma.$queryRaw<{ count: number; total: number; reversed_count: number }[]>`
      ${base}
      SELECT COUNT(*) FILTER (WHERE amount > 0)::int AS count,
             COALESCE(SUM(amount), 0)::float AS total,
             COUNT(*) FILTER (WHERE amount = 0 AND reversed_amount > 0)::int AS reversed_count
      FROM named`,
  ]);

  const hasMore = rows.length > q.limit;
  const t = totals[0] ?? { count: 0, total: 0, reversed_count: 0 };
  return {
    payments: rows.slice(0, q.limit).map(toReceivedPayment),
    summary: {
      count: Number(t.count) || 0,
      total: Math.round((Number(t.total) || 0) * 100) / 100,
      reversedCount: Number(t.reversed_count) || 0,
    },
    hasMore,
  };
}
