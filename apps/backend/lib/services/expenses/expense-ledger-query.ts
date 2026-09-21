/**
 * How an expense query is built — the one place it is built.
 *
 * Every surface that lists or exports expenses resolves through
 * `buildExpenseLedgerWhere` (ADR-009). A filter added to one caller's inline
 * logic would silently not apply to the other, and the failure is invisible:
 * the file looks right and contains the wrong rows.
 *
 * **PURE MODULE — no I/O, no `prisma` import.** It was previously inside
 * `expense-service.ts`, which meant the rules that decide what an export
 * contains could not be tested without a database — and this environment has
 * none. Split out, every branch below is covered by
 * `tests/expense-ledger-query.test.ts`. `expense-service.ts` re-exports
 * everything here, so no existing importer changed.
 */

export const EXPENSE_CATEGORIES = [
  "Food & Groceries",
  "Staff Salary",
  "Electricity",
  "Water",
  "Gas Cylinders",
  "Internet",
  "Cleaning Supplies",
  "Maintenance & Repairs",
  "Security",
  "Laundry",
  "Transportation",
  "Furniture & Equipment",
  "Licenses & Government",
  "Marketing",
  "Medical & Emergency",
  "Miscellaneous",
];

export type ExpenseFilters = {
  range?: string;
  /**
   * Inclusive start, YYYY-MM-DD. **`null` means "no lower bound"** — the
   * honest reading of the "All time" chip — and is NOT the same as omitting
   * the field, which falls through to `range`.
   */
  startDate?: string | null;
  /** Inclusive end, YYYY-MM-DD. */
  endDate?: string | null;
  hostelId?: string | undefined;
  /**
   * `'business'` narrows to portfolio-level (HQ) expenses via `expense_scope`.
   *
   * It is deliberately NOT a hostel id. The Money screen's `business` option
   * used to collapse to `null` on its way to the API, which reads as *every*
   * hostel — the exact opposite of what the owner picked (ADR-003).
   */
  scope?: "business";
  categories?: string[];
  status?: string;
  sort?: string;
  search?: string;
  /** Exact vendor name, as the filter sheet offers it. */
  vendor?: string;
  /** Exact payment method. */
  paymentMethod?: string;
  recurring?: boolean;
  amountMin?: number;
  amountMax?: number;
  limit?: number;
  offset?: number;
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const endExclusiveMonth = (date: Date) => addMonths(startOfMonth(date), 1);

function asDate(value: unknown, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

/**
 * The date window, as a half-open `[start, end)` interval.
 *
 * `start: null` means the query has no lower bound. `end` is never null: a
 * report cannot contain the future, and an "all time" export whose label says
 * "up to 21 Sep" must not quietly include a future-dated row.
 */
export function getRange(filters: ExpenseFilters): { start: Date | null; end: Date } {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // An empty string is an absent filter, not an explicit one — the screens send
  // '' for a cleared date input.
  const rawStart = filters.startDate === "" ? undefined : filters.startDate;
  const rawEnd = filters.endDate === "" ? undefined : filters.endDate;

  if (rawStart !== undefined || rawEnd !== undefined) {
    const start = rawStart === null ? null : asDate(rawStart, startOfMonth(now));
    const endBase = rawEnd == null ? now : asDate(rawEnd, now);
    const end = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate() + 1);
    return { start, end };
  }

  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);

  // No lower bound at all. Still ends at tomorrow-exclusive: "all time" means
  // everything up to today, not a window that reaches into the future.
  if (filters.range === "all_time") return { start: null, end: tomorrow };
  if (filters.range === "today") return { start: today, end: tomorrow };
  if (filters.range === "week") {
    // The rolling seven days ending today, matching the Expenses chip and the
    // export's `this_week`. This was a Sunday-start window ending seven days
    // later, so on a Tuesday it covered four days that had not happened yet —
    // and it disagreed with the file the owner exported from the same screen.
    const start = new Date(today);
    start.setDate(today.getDate() - 6);
    return { start, end: tomorrow };
  }

  return { start: startOfMonth(now), end: endExclusiveMonth(now) };
}

export function normalizeCategory(category: string) {
  if (!category) return "Miscellaneous";
  const lower = category.toLowerCase().trim();
  const aliases: Record<string, string> = {
    food: "Food & Groceries",
    grocery: "Food & Groceries",
    groceries: "Food & Groceries",
    kitchen: "Food & Groceries",
    salary: "Staff Salary",
    staff: "Staff Salary",
    gas: "Gas Cylinders",
    "gas cylinder": "Gas Cylinders",
    cylinder: "Gas Cylinders",
    cleaning: "Cleaning Supplies",
    repairs: "Maintenance & Repairs",
    repair: "Maintenance & Repairs",
    maintenance: "Maintenance & Repairs",
    asset: "Furniture & Equipment",
    assets: "Furniture & Equipment",
    "asset purchase": "Furniture & Equipment",
    furniture: "Furniture & Equipment",
  };
  if (aliases[lower]) return aliases[lower];
  const found = EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === lower);
  return found || category;
}

export function suggestedCategory(title: string) {
  const text = title.toLowerCase();
  if (/(electric|power|eb|current|bescom|bill)/.test(text)) return "Electricity";
  if (/(food|rice|milk|grocery|vegetable|kitchen|meal|dal|oil)/.test(text)) return "Food & Groceries";
  if (/(gas|cylinder|lpg)/.test(text)) return "Gas Cylinders";
  if (/(wifi|internet|broadband|router|airtel|jio)/.test(text)) return "Internet";
  if (/(repair|plumb|paint|fix|carpenter|maintenance)/.test(text)) return "Maintenance & Repairs";
  if (/(clean|housekeep|sanit|soap|phenyl)/.test(text)) return "Cleaning Supplies";
  if (/(salary|staff|warden|watchman)/.test(text)) return "Staff Salary";
  if (/(security|guard|cctv)/.test(text)) return "Security";
  if (/(laundry|washing|washer)/.test(text)) return "Laundry";
  if (/(transport|auto|fuel|petrol|diesel)/.test(text)) return "Transportation";
  if (/(bed|mattress|furniture|fridge|geyser|fan|machine|equipment)/.test(text)) return "Furniture & Equipment";
  if (/(license|licence|government|tax|permit)/.test(text)) return "Licenses & Government";
  if (/(marketing|banner|ad|advertis|poster)/.test(text)) return "Marketing";
  if (/(medical|emergency|first aid|doctor)/.test(text)) return "Medical & Emergency";
  if (/(water|tanker)/.test(text)) return "Water";
  return "Miscellaneous";
}

// Canonical category → operational-type mapping — the single source of truth for
// deriving `operational_type`. This is an internal classification for
// analytics/dashboards/reports/advanced filters only; owners never pick it directly.
// Keyed on the normalized (canonical) category, so it stays correct even as new
// categories are added — unmapped/custom categories fall back to "Operational".
export const CATEGORY_TO_OPERATIONAL_TYPE: Record<string, string> = {
  "Food & Groceries": "Operational",
  "Staff Salary": "Staff",
  Electricity: "Utility",
  Water: "Utility",
  "Gas Cylinders": "Utility",
  Internet: "Utility",
  "Cleaning Supplies": "Operational",
  "Maintenance & Repairs": "Maintenance",
  Security: "Staff",
  Laundry: "Operational",
  Transportation: "Operational",
  "Furniture & Equipment": "Operational",
  "Licenses & Government": "Operational",
  Marketing: "Operational",
  "Medical & Emergency": "Emergency",
  Miscellaneous: "Operational",
};

/** Derives `operational_type` from `category` alone — the only place this mapping lives. */
export function deriveOperationalType(category: string): string {
  const normalized = normalizeCategory(category);
  return CATEGORY_TO_OPERATIONAL_TYPE[normalized] || "Operational";
}

/**
 * The screen's status casing, as the column actually stores it.
 *
 * The filter sheet says `'Paid'`; the column holds `'paid'`. Passing the
 * screen's casing into an exact-match WHERE returned **zero rows with no
 * error** — an empty export that looks like "you have no expenses" rather than
 * like a bug. The list route and the export share this one normaliser so they
 * cannot disagree.
 */
export function normalizeExpenseStatus(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower === "all" || lower === "all status") return undefined;
  return lower.replace(/\s+/g, "_");
}

export function buildSearchWhere(search: string) {
  const terms = search.trim().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return {};

  // Each term must match at least one field (AND across terms)
  const termConditions = terms.map((term) => {
    const fieldMatches: any[] = [
      { title: { contains: term, mode: "insensitive" } },
      { notes: { contains: term, mode: "insensitive" } },
      { vendor_name: { contains: term, mode: "insensitive" } },
      { payment_method: { contains: term, mode: "insensitive" } },
      { category: { contains: term, mode: "insensitive" } },
    ];
    // If the term looks numeric, also match amount
    const numericValue = Number(term);
    if (Number.isFinite(numericValue) && numericValue > 0) {
      fieldMatches.push({ amount: { equals: numericValue } });
    }
    return { OR: fieldMatches };
  });

  return { AND: termConditions };
}

// Single source of truth for the expenses list WHERE clause — reused by getAllExpenses
// (paginated UI query) AND the owner export service, so exported data is guaranteed to
// match whatever the UI shows for the same filters. Do not reimplement this filtering
// logic anywhere else (ADR-009).
export function buildExpenseLedgerWhere(ownerId: string, filters: ExpenseFilters = {}) {
  const { start, end } = getRange(filters);
  return {
    where: {
      owner_id: ownerId,
      // The upper bound always applies. Even "all time" stops at today, because
      // that is what its label promises — a future-dated row appearing in a file
      // headed "up to 21 Sep" is the kind of quiet wrongness this module exists
      // to prevent.
      date: { ...(start ? { gte: start } : {}), lt: end },
      ...(filters.hostelId ? { hostel_id: filters.hostelId } : {}),
      ...(filters.scope === "business" ? { expense_scope: "BUSINESS" } : {}),
      ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
      ...(filters.categories?.length ? { category: { in: filters.categories.map(normalizeCategory) } } : {}),
      ...(filters.search ? buildSearchWhere(filters.search) : {}),
      ...(filters.vendor ? { vendor_name: filters.vendor } : {}),
      ...(filters.paymentMethod ? { payment_method: filters.paymentMethod } : {}),
      ...(typeof filters.recurring === "boolean" ? { is_recurring: filters.recurring } : {}),
      ...(filters.amountMin !== undefined || filters.amountMax !== undefined
        ? {
            amount: {
              ...(filters.amountMin !== undefined ? { gte: filters.amountMin } : {}),
              ...(filters.amountMax !== undefined ? { lte: filters.amountMax } : {}),
            },
          }
        : {}),
    } as any,
    range: { start, end },
  };
}

export function resolveExpenseSort(sort?: string) {
  const orderBy: any =
    sort === "highest"
      ? { amount: "desc" }
      : sort === "lowest"
        ? { amount: "asc" }
        : sort === "oldest"
          ? { date: "asc" }
          : sort === "category"
            ? { category: "asc" }
            : { date: "desc" };
  return orderBy;
}
