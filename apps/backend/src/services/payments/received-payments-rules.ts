/**
 * "Who paid?" — the rules behind the owner's Received list.
 *
 * Pure: no database, no clock unless one is passed. The service runs the query;
 * everything that decides what a request means or what a row says lives here so
 * it can be tested without Postgres.
 *
 * One row per COLLECTION, not per `payments` row. A single collection is split
 * FIFO across several obligations by the settlement engine (one `payment_groups`
 * row, many `payments` rows), and the owner took one amount from one person —
 * showing him three rows for it would read as three payments.
 */

export const RECEIVED_METHODS = ["CASH", "UPI", "BANK_TRANSFER", "CHEQUE", "ONLINE", "OTHER"] as const;
export type ReceivedMethod = (typeof RECEIVED_METHODS)[number];

export const RECEIVED_PAGE_MAX = 50;
export const RECEIVED_PAGE_DEFAULT = 20;

export type ReceivedQuery = {
  hostelId: string | null;
  /** Inclusive, YYYY-MM-DD, on the date the money was received. Null = no bound. */
  from: string | null;
  to: string | null;
  method: ReceivedMethod | null;
  /** Tenant-name search, trimmed. Null when blank. */
  search: string | null;
  limit: number;
  offset: number;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function validDay(v: string): boolean {
  if (!DAY.test(v)) return false;
  const d = new Date(`${v}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
}

/**
 * Reads the query string. Throws `VALIDATION: <message>` on anything malformed
 * rather than silently dropping it — a filter that is ignored shows the owner
 * rows he asked not to see, and he cannot tell.
 */
export function parseReceivedQuery(params: URLSearchParams): ReceivedQuery {
  const hostelRaw = params.get("hostelId");
  const hostelId = hostelRaw && hostelRaw !== "all" ? hostelRaw : null;
  if (hostelId && !UUID.test(hostelId)) throw new Error("VALIDATION: hostelId must be a valid UUID");

  const from = params.get("from") || null;
  const to = params.get("to") || null;
  if (from && !validDay(from)) throw new Error("VALIDATION: from must be YYYY-MM-DD");
  if (to && !validDay(to)) throw new Error("VALIDATION: to must be YYYY-MM-DD");
  if (from && to && from > to) throw new Error("VALIDATION: from is after to");

  const methodRaw = (params.get("method") || "").toUpperCase();
  let method: ReceivedMethod | null = null;
  if (methodRaw && methodRaw !== "ALL") {
    if (!(RECEIVED_METHODS as readonly string[]).includes(methodRaw)) {
      throw new Error("VALIDATION: unknown payment method");
    }
    method = methodRaw as ReceivedMethod;
  }

  const searchRaw = (params.get("q") || "").trim().slice(0, 80);

  const limitNum = Number(params.get("limit"));
  const offsetNum = Number(params.get("offset"));
  const limit = Number.isInteger(limitNum) && limitNum > 0 ? Math.min(limitNum, RECEIVED_PAGE_MAX) : RECEIVED_PAGE_DEFAULT;
  const offset = Number.isInteger(offsetNum) && offsetNum > 0 ? offsetNum : 0;

  return { hostelId, from, to, method, search: searchRaw || null, limit, offset };
}

/** Escapes LIKE wildcards so a name with `%` or `_` matches literally. */
export function likePattern(search: string): string {
  return `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** What one collection paid for, as the query returns it. */
export type ReceivedCoverRaw = {
  type: string | null;
  rent_month: string | Date | null;
  label: string | null;
  amount: number | string;
  reversed: boolean;
};

export type ReceivedRowRaw = {
  key: string;
  tenant_id: string;
  tenant_name: string | null;
  room_no: string | null;
  hostel_id: string;
  hostel_name: string | null;
  method: string | null;
  reference: string | null;
  paid_on: string | Date;
  recorded_at: string | Date;
  amount: number | string;
  reversed_amount: number | string;
  covers: ReceivedCoverRaw[] | null;
};

export type ReceivedCover = {
  type: string;
  /** YYYY-MM, or null for a one-off charge (deposit, advance). */
  month: string | null;
  label: string | null;
  amount: number;
  reversed: boolean;
};

export type ReceivedPayment = {
  id: string;
  tenantId: string;
  tenantName: string;
  room: string | null;
  hostelId: string;
  hostelName: string;
  method: string;
  reference: string | null;
  /** The day the money changed hands, YYYY-MM-DD. */
  paidOn: string;
  /** When it was entered into Stayo, ISO. */
  recordedAt: string;
  /** Rupees received and still standing (reversals already taken off). */
  amount: number;
  /** Rupees later reversed out of this collection. */
  reversedAmount: number;
  covers: ReceivedCover[];
};

function day(v: string | Date): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function iso(v: string | Date): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

function rupees(v: number | string | null | undefined): number {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** Oldest month first, one-off charges last — the order the money was applied in. */
function coverOrder(a: ReceivedCover, b: ReceivedCover): number {
  if (a.month && b.month) return a.month.localeCompare(b.month);
  if (a.month) return -1;
  if (b.month) return 1;
  return a.type.localeCompare(b.type);
}

export function toReceivedPayment(row: ReceivedRowRaw): ReceivedPayment {
  const covers = (row.covers ?? [])
    .map((c) => ({
      type: String(c.type || "RENT"),
      month: c.rent_month ? day(c.rent_month).slice(0, 7) : null,
      label: c.label ? String(c.label) : null,
      amount: rupees(c.amount),
      reversed: Boolean(c.reversed),
    }))
    .sort(coverOrder);

  return {
    id: row.key,
    tenantId: row.tenant_id,
    tenantName: row.tenant_name?.trim() || "Tenant",
    room: row.room_no ? String(row.room_no) : null,
    hostelId: row.hostel_id,
    hostelName: row.hostel_name ?? "",
    method: String(row.method || "OTHER").toUpperCase(),
    reference: row.reference ? String(row.reference) : null,
    paidOn: day(row.paid_on),
    recordedAt: iso(row.recorded_at),
    amount: rupees(row.amount),
    reversedAmount: rupees(row.reversed_amount),
    covers,
  };
}
