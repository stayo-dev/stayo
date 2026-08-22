import { prisma } from "@/lib/db";
import { logger } from "@/lib/logger";
import { collectionQueueService } from "@/lib/services/collection-queue/collection-queue-service";
import { assembleMonth, type MonthBlock } from "./owner-payout-month";
import { scorePromises, istDateOf, type PromiseRecord } from "./payout-promise";

/**
 * Tagged-template raw SQL, so every interpolated value is parameterised by
 * Prisma rather than concatenated into the statement.
 *
 * Prisma's unchecked raw-query variant would be the easier fit for the one
 * query below that varies its column list, but that form is banned from
 * operational code for good reason, and an allowlist entry is a weaker
 * guarantee than not needing one. The varying query is written out twice
 * instead. (Naming that API here in full would trip the invariant check that
 * enforces this — the check greps for the string.)
 *
 * The cast exists only because this client is untyped here, which makes a type
 * argument a compile error rather than a hint.
 */
const sql = (strings: TemplateStringsArray, ...values: unknown[]): Promise<any[]> =>
  (prisma as any).$queryRaw(strings, ...values);


/**
 * What the owner's "Money in" screen reads.
 *
 * **Composes, never recalculates.** Outstanding comes from
 * `collectionQueueService` — the same figure the dues list below it shows, from
 * the same call — because the fastest way to lose an owner is for two numbers
 * on one screen to disagree. This follows `financial-read-model-service.ts`:
 * a read model's job is to assemble existing truths, not to derive a second
 * opinion about money.
 *
 * Everything here is owner-scoped at the SQL level. There is no code path that
 * takes an owner id from a caller-supplied parameter rather than the session.
 *
 * Raw SQL throughout: `gateway_transactions.tenant_id` and
 * `settlement_items.expected_payout_date` are intentionally absent from
 * schema.prisma (see migration 075), and these are aggregate joins across five
 * tables — exactly where an ORM costs more than it gives.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Facts, not presentation.
//
// The strip's voice — which of "someone paid you today" / "money is on its way"
// / "a transfer failed" / "you're all settled" the owner is told — is chosen in
// the frontend from these facts. The backend reporting a headline string would
// put copy behind a deploy and make the same numbers unusable anywhere else.
// ─────────────────────────────────────────────────────────────────────────────

export type PaidTodayEntry = {
  tenantId: string | null;
  name: string;
  amount: number;
  /** ISO instant of capture — the frontend renders it in the viewer's locale. */
  at: string;
};

export type OwnerPayoutSummary = {
  paidToday: { count: number; total: number; tenants: PaidTodayEntry[] };
  withStayo: { total: number; expectedBy: string | null };
  failed: { total: number; count: number; reason: string | null } | null;
  lastPaid: { total: number; paidAt: string } | null;
  /** Has any tenant rent EVER been captured for this owner. Drives the honest first-run state. */
  everOnline: boolean;
  promise: { judged: number; onTime: number; streak: number; allOnTime: boolean };
  month: MonthBlock;
  bank: { name: string | null; masked: string | null } | null;
  /**
   * True when the payout tables cannot be read as this feature expects — in
   * practice, migration 075 not yet applied. Reported rather than thrown so the
   * screen shows its honest empty state instead of an error the owner cannot act on.
   */
  degraded: boolean;
};

export type OwnerPayout = {
  id: string;
  amount: number;
  status: string;
  expectedPayoutDate: string | null;
  paidAt: string | null;
  method: string | null;
  reference: string | null;
  failureReason: string | null;
  paymentCount: number;
};

export type OwnerPayoutBreakdown = {
  payout: OwnerPayout;
  /**
   * Always zero, always sent. Stayo passes rent through in full, and an
   * unstated zero reads as a fee someone chose not to mention.
   */
  fee: 0;
  collected: number;
  tenants: {
    tenantId: string | null;
    name: string;
    room: string;
    hostelId: string | null;
    hostelName: string;
    amount: number;
    capturedAt: string;
  }[];
  byHostel: { hostelId: string; hostelName: string; amount: number }[];
  bank: { name: string | null; masked: string | null } | null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The UTC instant IST-today began. Owners think in IST; the column is UTC. */
function istTodayStart(now: Date = new Date()): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const midnightIst = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate());
  return new Date(midnightIst - IST_OFFSET_MS);
}

/** The UTC instant the current IST calendar month began. */
function istMonthStart(now: Date = new Date()): Date {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const firstIst = Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), 1);
  return new Date(firstIst - IST_OFFSET_MS);
}

function monthLabel(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toLocaleString("en-IN", {
    month: "long",
    timeZone: "UTC",
  });
}

/** `••••4471` — enough to match a passbook line, useless to a shoulder-surfer. */
function maskAccount(accountNo: string | null | undefined): string | null {
  const value = (accountNo ?? "").trim();
  return value ? `••••${value.slice(-4)}` : null;
}

export class OwnerPayoutReadModel {
  /**
   * Every rupee the gateway captured for this owner, split by whether Stayo
   * still holds it.
   *
   * `item_status <> 'PAID'` rather than an explicit pending list: an item that
   * is FAILED, CANCELLED, or attached to no run at all is money Stayo is still
   * holding. Enumerating "pending" statuses would mean a status added later
   * silently drops money out of the owner's total — the one direction this
   * screen must never fail in.
   */
  private async capturedPartition(ownerId: string, monthStart: Date) {
    const rows = await sql`
      WITH captured AS (
        SELECT g.amount, g.captured_at, COALESCE(si.status, 'UNATTACHED') AS item_status
        FROM gateway_transactions g
        LEFT JOIN settlement_item_transactions sit ON sit.transaction_id = g.id
        LEFT JOIN settlement_items si ON si.id = sit.item_id
        WHERE g.owner_id = ${ownerId}::uuid
          AND g.purpose = 'TENANT_RENT'
          AND g.status = 'CAPTURED'
      )
      SELECT
        COALESCE(SUM(amount) FILTER (WHERE item_status = 'PAID'  AND captured_at >= ${monthStart}), 0) AS month_in_bank,
        COALESCE(SUM(amount) FILTER (WHERE item_status <> 'PAID' AND captured_at >= ${monthStart}), 0) AS month_with_stayo,
        COALESCE(SUM(amount) FILTER (WHERE item_status <> 'PAID'), 0)                                  AS total_with_stayo,
        COUNT(*)                                                                                       AS ever_count
      FROM captured`;
    const row = rows[0] ?? {};
    return {
      monthInBank: num(row.month_in_bank),
      monthWithStayo: num(row.month_with_stayo),
      totalWithStayo: num(row.total_with_stayo),
      everCount: num(row.ever_count),
    };
  }

  /**
   * Who paid today, by name.
   *
   * This is the feature that replaces the moment of being handed cash. When
   * rent moves online it lands in Stayo's account, not the owner's, so the
   * payment stops being an event he witnesses — and online rent starts to feel
   * like less control than cash, which is fatal for the pipeline that feeds
   * everything else here.
   */
  private async paidToday(ownerId: string, since: Date): Promise<PaidTodayEntry[]> {
    return (
      await sql`
        SELECT g.tenant_id, g.amount, g.captured_at, COALESCE(pr.name, 'A tenant') AS name
        FROM gateway_transactions g
        LEFT JOIN tenants t   ON t.id = g.tenant_id
        LEFT JOIN profiles pr ON pr.id = t.profile_id
        WHERE g.owner_id = ${ownerId}::uuid
          AND g.purpose = 'TENANT_RENT'
          AND g.status = 'CAPTURED'
          AND g.captured_at >= ${since}
        ORDER BY g.captured_at DESC`
    ).map((r: any) => ({
      tenantId: r.tenant_id ?? null,
      name: String(r.name),
      amount: num(r.amount),
      at: new Date(r.captured_at).toISOString(),
    }));
  }

  /**
   * Rent the tenant handed the owner directly.
   *
   * Keyed on `payment_attempt_id IS NULL`, which means "no gateway attempt
   * produced this row". That is a display distinction, NOT a settleability one
   * — what Stayo owes still comes only from `gateway_transactions`, per
   * migration 070. Reversal rows are summed in rather than filtered out, so a
   * corrected payment nets to zero here instead of being counted forever.
   */
  private async directThisMonth(ownerId: string, monthStart: Date): Promise<number> {
    const rows = await sql`
      SELECT COALESCE(SUM(p.amount_paid), 0) AS total
      FROM payments p
      WHERE p.owner_id = ${ownerId}::uuid
        AND p.payment_attempt_id IS NULL
        AND p.payment_date >= ${istDateOf(monthStart)}::date`;
    return num(rows[0]?.total);
  }

  /**
   * The owner's settlement items, newest activity first. Also the promise record.
   *
   * Falls back to a promise-less query when `expected_payout_date` is missing
   * (migration 075 not yet applied). A payout list without dates is still worth
   * showing — it still names amounts, banks and UTRs. Losing the list entirely
   * because one column is absent would be a self-inflicted outage of the kind
   * this codebase has already had once.
   */
  private async items(ownerId: string, limit = 50): Promise<OwnerPayout[]> {
    let rows: any[];
    try {
      rows = await sql`
        SELECT id, amount, status, method, reference, paid_at, failure_reason,
               payment_count, expected_payout_date
        FROM settlement_items
        WHERE owner_id = ${ownerId}::uuid
        ORDER BY COALESCE(paid_at, created_at) DESC
        LIMIT ${limit}`;
    } catch {
      rows = await sql`
        SELECT id, amount, status, method, reference, paid_at, failure_reason,
               payment_count
        FROM settlement_items
        WHERE owner_id = ${ownerId}::uuid
        ORDER BY COALESCE(paid_at, created_at) DESC
        LIMIT ${limit}`;
    }

    return rows.map((r: any) => ({
      id: String(r.id),
      amount: num(r.amount),
      status: String(r.status),
      expectedPayoutDate: r.expected_payout_date ? istDateOf(r.expected_payout_date) : null,
      paidAt: r.paid_at ? new Date(r.paid_at).toISOString() : null,
      method: r.method ?? null,
      reference: r.reference ?? null,
      failureReason: r.failure_reason ?? null,
      paymentCount: num(r.payment_count),
    }));
  }

  private async bank(ownerId: string) {
    const profile = await prisma.profile.findUnique({
      where: { id: ownerId },
      select: { payout_bank_name: true, payout_account_no: true },
    });
    const masked = maskAccount(profile?.payout_account_no);
    return masked ? { name: profile?.payout_bank_name ?? null, masked } : null;
  }

  async getSummary(ownerId: string, now: Date = new Date()): Promise<OwnerPayoutSummary> {
    const monthStart = istMonthStart(now);
    const todayStart = istTodayStart(now);

    // The dues figure comes from the collection queue, not a second sum, so the
    // strip and the list beneath it can never disagree.
    const queue = await collectionQueueService
      .getQueue({ ownerId, hostelFilter: null })
      .catch((error: any) => {
        logger.error("owner_payouts.queue_failed", { owner_id: ownerId, error: String(error?.message || error) });
        return { totalOutstanding: 0, totalTenants: 0 };
      });

    let partition = { monthInBank: 0, monthWithStayo: 0, totalWithStayo: 0, everCount: 0 };
    let today: PaidTodayEntry[] = [];
    let items: OwnerPayout[] = [];
    let direct = 0;
    let degraded = false;

    // Settled independently, not Promise.all: these four read different tables
    // and one being unreadable — migration 075 pending, in practice — must not
    // blank the other three. An owner cannot act on a 500; he can act on a
    // screen that shows what it does know and stays quiet about the rest.
    const [partitionR, todayR, itemsR, directR] = await Promise.allSettled([
      this.capturedPartition(ownerId, monthStart),
      this.paidToday(ownerId, todayStart),
      this.items(ownerId),
      this.directThisMonth(ownerId, monthStart),
    ]);

    if (partitionR.status === "fulfilled") partition = partitionR.value;
    if (todayR.status === "fulfilled") today = todayR.value;
    if (itemsR.status === "fulfilled") items = itemsR.value;
    if (directR.status === "fulfilled") direct = directR.value;

    for (const [source, result] of [
      ["captured_partition", partitionR],
      ["paid_today", todayR],
      ["items", itemsR],
      ["direct", directR],
    ] as const) {
      if (result.status === "rejected") {
        degraded = true;
        logger.error("owner_payouts.degraded", {
          owner_id: ownerId,
          source,
          error: String((result.reason as any)?.message || result.reason),
        });
      }
    }

    const failedItems = items.filter((i) => i.status === "FAILED");
    const lastPaidItem = items.find((i) => i.status === "PAID" && i.paidAt);

    // The nearest promise outstanding — what the owner is waiting on now.
    const expectedBy = items
      .filter((i) => i.status !== "PAID" && i.status !== "CANCELLED" && i.expectedPayoutDate)
      .map((i) => i.expectedPayoutDate as string)
      .sort()[0] ?? null;

    const promiseRecords: PromiseRecord[] = items
      .filter((i) => i.status === "PAID")
      .map((i) => ({ expectedPayoutDate: i.expectedPayoutDate, paidAt: i.paidAt }));

    return {
      paidToday: {
        count: today.length,
        total: today.reduce((sum, t) => sum + t.amount, 0),
        tenants: today,
      },
      withStayo: { total: partition.totalWithStayo, expectedBy },
      failed: failedItems.length
        ? {
            total: failedItems.reduce((sum, i) => sum + i.amount, 0),
            count: failedItems.length,
            reason: failedItems[0]?.failureReason ?? null,
          }
        : null,
      lastPaid: lastPaidItem
        ? { total: lastPaidItem.amount, paidAt: lastPaidItem.paidAt as string }
        : null,
      everOnline: partition.everCount > 0,
      promise: scorePromises(promiseRecords),
      month: assembleMonth({
        monthLabel: monthLabel(now),
        direct,
        inYourBank: partition.monthInBank,
        withStayo: partition.monthWithStayo,
        stillToCollect: num((queue as any).totalOutstanding),
        tenantsOwing: num((queue as any).totalTenants),
      }),
      bank: await this.bank(ownerId),
      degraded,
    };
  }

  /**
   * The payout list, searchable the way the owner actually works.
   *
   * He reads his bank statement first and the app second, so the search has to
   * accept what the statement gives him: a UTR, or an amount. Tenant name is
   * matched too, for the other direction — "what happened to Ravi's rent".
   */
  async listPayouts(
    ownerId: string,
    opts: { q?: string; limit?: number } = {},
  ): Promise<OwnerPayout[]> {
    const all = await this.items(ownerId, Math.min(opts.limit ?? 60, 200)).catch(() => []);
    const q = (opts.q ?? "").trim().toLowerCase();
    if (!q) return all;

    const matchedByTenant = await this.itemIdsMatchingTenant(ownerId, q);
    const digits = q.replace(/[^0-9.]/g, "");

    return all.filter((item) => {
      if (item.reference && item.reference.toLowerCase().includes(q)) return true;
      if (item.method && item.method.toLowerCase().includes(q)) return true;
      if (digits && String(item.amount).includes(digits)) return true;
      return matchedByTenant.has(item.id);
    });
  }

  private async itemIdsMatchingTenant(ownerId: string, q: string): Promise<Set<string>> {
    try {
      const rows = await sql`
        SELECT DISTINCT si.id
        FROM settlement_items si
        JOIN settlement_item_transactions sit ON sit.item_id = si.id
        JOIN gateway_transactions g ON g.id = sit.transaction_id
        LEFT JOIN tenants t   ON t.id = g.tenant_id
        LEFT JOIN profiles pr ON pr.id = t.profile_id
        WHERE si.owner_id = ${ownerId}::uuid AND LOWER(pr.name) LIKE ${`%${q}%`}`;
      return new Set(rows.map((r: any) => String(r.id)));
    } catch {
      return new Set();
    }
  }

  /**
   * Which tenants make up one payout.
   *
   * This is the whole feature. A payout the owner cannot expand into names is a
   * number Stayo asserts; expanded, it is a claim he can check by phoning
   * someone. Verifiability is what earns trust here, not accuracy he has no way
   * to audit.
   *
   * Returns null when the item is not this owner's — never a 403 distinguishable
   * from a 404, so the endpoint cannot be used to probe for other owners' payouts.
   */
  async getBreakdown(ownerId: string, itemId: string): Promise<OwnerPayoutBreakdown | null> {
    const items = await this.items(ownerId, 500).catch(() => []);
    const payout = items.find((i) => i.id === itemId);
    if (!payout) return null;

    let rows: any[] = [];
    try {
      rows = await sql`
        SELECT g.tenant_id, g.amount, g.captured_at, g.hostel_id,
               COALESCE(pr.name, 'A tenant') AS name,
               COALESCE(h.name, '') AS hostel_name,
               COALESCE(r.room_no, '') AS room
        FROM settlement_item_transactions sit
        JOIN gateway_transactions g ON g.id = sit.transaction_id
        LEFT JOIN tenants t   ON t.id = g.tenant_id
        LEFT JOIN profiles pr ON pr.id = t.profile_id
        LEFT JOIN hostels h   ON h.id = g.hostel_id
        LEFT JOIN LATERAL (
          SELECT ro.room_id FROM room_allocations ro
          WHERE ro.tenant_id = t.id
          ORDER BY ro.created_at DESC LIMIT 1
        ) ra ON TRUE
        LEFT JOIN rooms r ON r.id = ra.room_id
        WHERE sit.item_id = ${itemId}::uuid
        ORDER BY g.captured_at ASC`;
    } catch (error: any) {
      logger.error("owner_payouts.breakdown_failed", {
        owner_id: ownerId,
        item_id: itemId,
        error: String(error?.message || error),
      });
    }

    const tenants = rows.map((r: any) => ({
      tenantId: r.tenant_id ?? null,
      name: String(r.name),
      room: String(r.room ?? ""),
      hostelId: r.hostel_id ?? null,
      hostelName: String(r.hostel_name ?? ""),
      amount: num(r.amount),
      capturedAt: new Date(r.captured_at).toISOString(),
    }));

    const byHostel: { hostelId: string; hostelName: string; amount: number }[] = [];
    for (const t of tenants) {
      if (!t.hostelId) continue;
      const existing = byHostel.find((h) => h.hostelId === t.hostelId);
      if (existing) existing.amount += t.amount;
      else byHostel.push({ hostelId: t.hostelId, hostelName: t.hostelName, amount: t.amount });
    }

    return {
      payout,
      fee: 0,
      collected: payout.amount,
      tenants,
      byHostel: byHostel.sort((a, b) => b.amount - a.amount),
      bank: await this.bank(ownerId),
    };
  }
}

export const ownerPayoutReadModel = new OwnerPayoutReadModel();
