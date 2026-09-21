import { normalizeExpenseStatus } from "@/lib/services/expenses/expense-ledger-query";
import { EXPORT_DOCUMENTS, type ExportDocumentId } from "./export-documents";
import { resolvePreset, customPeriod, type Period, type PeriodPresetId } from "./financial-year";

/**
 * What an export request may say, and how it is read.
 *
 * **PURE MODULE — no I/O.** It is split from `export-request.ts` because that
 * file must reach a database to answer "does this hostel belong to this owner",
 * and pulling `lib/security/scoped-query` (and therefore Prisma) into this
 * module would make every validation rule below untestable in an environment
 * with no test database. Those rules are the ones most worth testing: a bad one
 * hands an owner someone else's data or an empty file.
 */

/** The expense filters an export can carry, mirroring the Expenses screen. */
export type ExpenseQueryParams = {
  search?: string;
  status?: string;
  vendor?: string;
  paymentMethod?: string;
  amountMin?: number;
  amountMax?: number;
  recurring?: boolean;
  sort?: string;
};

export type ExportParams = {
  document: ExportDocumentId;
  period: Period;
  /** A real hostel id, or null for every hostel. Never a view sentinel. */
  hostelId: string | null;
  /** `'business'` = portfolio-level (HQ) expenses. Never a hostel id. */
  scope: "business" | null;
  /** Empty for any document but `expenses`. */
  expenses: ExpenseQueryParams;
};

const PRESETS: PeriodPresetId[] = [
  "today", "this_week", "this_month", "last_month", "this_fy", "last_fy", "all_time",
];

const SORTS = ["recent", "oldest", "highest", "lowest"];

/**
 * Presets resolve on the SERVER rather than being sent as dates.
 *
 * "This financial year" then always means April–March, whatever a client
 * believes a year is — the mistake this feature is most likely to make
 * silently, and the one an accountant discovers months later.
 */
export function resolvePeriod(params: URLSearchParams): Period {
  const preset = params.get("preset");
  if (preset) {
    if (!PRESETS.includes(preset as PeriodPresetId)) throw new Error("VALIDATION: Unknown period");
    return resolvePreset(preset as PeriodPresetId);
  }
  // Either end may be omitted — the Expenses screen's custom range allows a
  // one-sided window. Both omitted is not a range and is refused, as is a
  // reversed one: repaired quietly, it produces a document that looks right and
  // covers the wrong period (ADR-095).
  return customPeriod(params.get("from"), params.get("to"));
}

function numberParam(params: URLSearchParams, key: string): number | undefined {
  const raw = params.get(key);
  if (raw === null || raw.trim() === "") return undefined;
  const value = Number(raw);
  // `Infinity` is what `Number('') || Infinity` produces on the client; a
  // non-finite bound must never reach a WHERE clause.
  if (!Number.isFinite(value)) throw new Error(`VALIDATION: ${key} must be a number`);
  return value;
}

function textParam(params: URLSearchParams, key: string): string | undefined {
  const raw = params.get(key);
  const trimmed = raw?.trim();
  return trimmed ? trimmed : undefined;
}

function parseExpenseParams(params: URLSearchParams): ExpenseQueryParams {
  const recurring = params.get("recurring");
  const sort = textParam(params, "sort");
  if (sort && !SORTS.includes(sort)) throw new Error("VALIDATION: Unknown sort");

  return {
    search: textParam(params, "search"),
    // The screen says 'Paid'; the column holds 'paid'. Normalised once, here,
    // so an export can never quietly match nothing.
    status: normalizeExpenseStatus(params.get("status")),
    vendor: textParam(params, "vendor"),
    paymentMethod: textParam(params, "paymentMethod"),
    amountMin: numberParam(params, "amountMin"),
    amountMax: numberParam(params, "amountMax"),
    recurring: recurring === "true" ? true : recurring === "false" ? false : undefined,
    sort,
  };
}

/** PURE. Every rule about what a request may say lives here. */
export function parseExportParams(params: URLSearchParams): ExportParams {
  const document = params.get("document") as ExportDocumentId;
  if (!document || !(document in EXPORT_DOCUMENTS)) throw new Error("VALIDATION: Unknown document");

  const hostelId = params.get("hostelId") || null;
  const scopeRaw = params.get("scope");
  if (scopeRaw && scopeRaw !== "business") throw new Error("VALIDATION: Unknown scope");
  const scope = scopeRaw === "business" ? ("business" as const) : null;

  // `business` is a scope, not a hostel. Asking for both is a contradiction,
  // and silently preferring one is how the Money screen's `business` option
  // used to end up meaning "every hostel" (ADR-003).
  if (scope && hostelId) throw new Error("VALIDATION: Pick a hostel or the business, not both");
  // A rent payment has no business-HQ scope — only an expense does.
  if (scope && document !== "expenses") {
    throw new Error("VALIDATION: Business scope applies to expenses only");
  }

  return {
    document,
    period: resolvePeriod(params),
    hostelId,
    scope,
    // Expense filters are meaningless on the other two documents. Dropped
    // rather than carried, so they cannot quietly narrow a collections file.
    expenses: document === "expenses" ? parseExpenseParams(params) : {},
  };
}

