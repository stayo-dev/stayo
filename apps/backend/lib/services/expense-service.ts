import { randomUUID } from "crypto";
import { prisma } from "../db";
import { buildMemoryEntry, sortMemory, type MemoryFacts, type MemoryEntry } from "./expenses/expense-memory";
import { eventSystem } from "../events";

const EXPENSE_CATEGORIES = [
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
  startDate?: string;
  endDate?: string;
  hostelId?: string | undefined;
  categories?: string[];
  status?: string;
  sort?: string;
  search?: string;
  recurring?: boolean;
  amountMin?: number;
  amountMax?: number;
  limit?: number;
  offset?: number;
};

const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const addMonths = (date: Date, months: number) => new Date(date.getFullYear(), date.getMonth() + months, 1);
const endExclusiveMonth = (date: Date) => addMonths(startOfMonth(date), 1);
const round = (n: number) => Math.round(n * 100) / 100;

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function asDate(value: unknown, fallback: Date) {
  if (!value) return fallback;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? fallback : parsed;
}

function getRange(filters: ExpenseFilters) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (filters.startDate || filters.endDate) {
    const start = asDate(filters.startDate, startOfMonth(now));
    const endBase = asDate(filters.endDate, now);
    const end = new Date(endBase.getFullYear(), endBase.getMonth(), endBase.getDate() + 1);
    return { start, end };
  }

  if (filters.range === "today") return { start: today, end: new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1) };
  if (filters.range === "week") {
    const start = new Date(today);
    start.setDate(today.getDate() - today.getDay());
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start, end };
  }

  return { start: startOfMonth(now), end: endExclusiveMonth(now) };
}

function pctChange(current: number, previous: number) {
  if (previous <= 0 && current <= 0) return 0;
  if (previous <= 0) return 100;
  return round(((current - previous) / previous) * 100);
}

function normalizeCategory(category: string) {
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

function suggestedCategory(title: string) {
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

function businessPaymentWhere(ownerId: string, start: Date, end: Date, hostelId?: string) {
  return {
    payment_date: { gte: start, lt: end },
    OR: [{ owner_id: ownerId }, { hostels: { owner_id: ownerId } }],
    ...(hostelId ? { hostel_id: hostelId } : {}),
  } as any;
}

// ── Shared financial calculations ──────────────────────────────────────────
// Single source of truth for revenue-vs-expense math, used by BOTH the dashboard
// (getAllExpenses, below — fixed "this month" window) and expense-export-service.ts
// (the export's own filtered period). Same query shape, same formulas — only the
// date window and expense total passed in differ per caller. Do not reimplement
// this arithmetic anywhere else (see docs/obsidian/Decisions.md ADR-001 for why).

/** Revenue collected in [start, end) for an owner (optionally scoped to one hostel). */
export async function getBusinessRevenue(ownerId: string, start: Date, end: Date, hostelId?: string): Promise<number> {
  const agg = await prisma.payments.aggregate({
    where: businessPaymentWhere(ownerId, start, end, hostelId),
    _sum: { amount_paid: true },
  });
  return Number(agg._sum.amount_paid || 0);
}

export function computeNetProfit(revenue: number, expenses: number): number {
  return round(revenue - expenses);
}

export function computeProfitMargin(netProfit: number, revenue: number): number {
  return revenue > 0 ? round((netProfit / revenue) * 100) : 0;
}

export function computeExpenseRatio(expenses: number, revenue: number): number {
  return revenue > 0 ? round((expenses / revenue) * 100) : 0;
}

/** Attaches a `percentage` (of `total`) to each row — same rounding rule everywhere this is shown. */
export function withCategoryPercentages<T extends { amount: number }>(rows: T[], total: number): (T & { percentage: number })[] {
  return rows.map((r) => ({ ...r, percentage: total > 0 ? round((r.amount / total) * 100) : 0 }));
}

function buildSearchWhere(search: string) {
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
// (paginated UI query) AND expense-export-service.ts (CSV/XLSX/PDF export), so exported
// data is guaranteed to match whatever the UI shows for the same filters. Do not
// reimplement this filtering logic anywhere else.
export function buildExpenseLedgerWhere(ownerId: string, filters: ExpenseFilters = {}) {
  const { start, end } = getRange(filters);
  return {
    where: {
      owner_id: ownerId,
      date: { gte: start, lt: end },
      ...(filters.hostelId ? { hostel_id: filters.hostelId } : {}),
      ...(filters.status && filters.status !== "all" ? { status: filters.status } : {}),
      ...(filters.categories?.length ? { category: { in: filters.categories.map(normalizeCategory) } } : {}),
      ...(filters.search ? buildSearchWhere(filters.search) : {}),
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
      : sort === "oldest"
        ? { date: "asc" }
        : sort === "category"
          ? { category: "asc" }
          : { date: "desc" };
  return orderBy;
}

export class ExpenseService {
  async getAllExpenses(ownerId: string, filters: ExpenseFilters = {}) {
    const now = new Date();
    const currentMonthStart = startOfMonth(now);
    const nextMonthStart = endExclusiveMonth(now);
    const previousMonthStart = addMonths(currentMonthStart, -1);
    const sixMonthStart = addMonths(currentMonthStart, -5);

    const { where: ledgerWhere, range: { start, end } } = buildExpenseLedgerWhere(ownerId, filters);
    const orderBy = resolveExpenseSort(filters.sort);

    const businessCurrentWhere = { owner_id: ownerId, date: { gte: currentMonthStart, lt: nextMonthStart } };
    const businessPreviousWhere = { owner_id: ownerId, date: { gte: previousMonthStart, lt: currentMonthStart } };

    const [
      ledger,
      totalCount,
      currentAgg,
      previousAgg,
      currentRevenue,
      previousRevenue,
      categoryCurrent,
      categoryPrevious,
      vendorCurrent,
      monthlyExpenses,
      monthlyPayments,
      duplicateCandidates,
      frequentRaw,
    ] = await Promise.all([
      prisma.expenses.findMany({
        where: ledgerWhere,
        orderBy,
        take: Math.min(Number(filters.limit || 30), 100),
        skip: Number(filters.offset || 0),
        include: { hostels: { select: { id: true, name: true } }, profiles: { select: { id: true, name: true, email: true } } },
      }),
      prisma.expenses.count({ where: ledgerWhere }),
      prisma.expenses.aggregate({
        where: businessCurrentWhere,
        _sum: { amount: true },
      }),
      prisma.expenses.aggregate({
        where: businessPreviousWhere,
        _sum: { amount: true },
      }),
      getBusinessRevenue(ownerId, currentMonthStart, nextMonthStart),
      getBusinessRevenue(ownerId, previousMonthStart, currentMonthStart),
      prisma.expenses.groupBy({
        by: ["category"],
        where: businessCurrentWhere,
        _sum: { amount: true },
      }),
      prisma.expenses.groupBy({
        by: ["category"],
        where: businessPreviousWhere,
        _sum: { amount: true },
      }),
      prisma.expenses.groupBy({
        by: ["vendor_name"],
        where: { ...businessCurrentWhere, vendor_name: { not: null } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.expenses.groupBy({
        by: ["date"],
        where: { owner_id: ownerId, date: { gte: sixMonthStart, lt: nextMonthStart } },
        _sum: { amount: true },
      }),
      prisma.payments.groupBy({
        by: ["payment_date"],
        where: businessPaymentWhere(ownerId, sixMonthStart, nextMonthStart),
        _sum: { amount_paid: true },
      }),
      prisma.expenses.findMany({
        where: businessCurrentWhere,
        select: { id: true, title: true, amount: true, date: true, category: true },
        orderBy: { created_at: "desc" },
        take: 200,
      }),
      // Frequent expenses for smart suggestions
      prisma.$queryRaw`
        SELECT
          LOWER(TRIM(title)) AS normalized_title,
          title,
          category,
          vendor_name,
          payment_method,
          COUNT(*)::int AS occurrence_count,
          MAX(amount)::float AS last_amount,
          MAX(date) AS last_date
        FROM expenses
        WHERE owner_id = ${ownerId}::uuid
        GROUP BY LOWER(TRIM(title)), title, category, vendor_name, payment_method
        HAVING COUNT(*) >= 2
        ORDER BY COUNT(*) DESC, MAX(date) DESC
        LIMIT 8
      ` as Promise<any[]>,
    ]);

    const frequentExpenses = (Array.isArray(frequentRaw) ? frequentRaw : []).map((r: any) => ({
      title: r.title,
      category: r.category,
      vendor_name: r.vendor_name,
      payment_method: r.payment_method,
      occurrence_count: Number(r.occurrence_count || 0),
      last_amount: Number(r.last_amount || 0),
      last_date: r.last_date,
    }));

    const currentExpenses = Number(currentAgg._sum.amount || 0);
    const previousExpenses = Number(previousAgg._sum.amount || 0);
    const collectedRevenue = currentRevenue;
    const previousCollected = previousRevenue;
    const netProfit = computeNetProfit(collectedRevenue, currentExpenses);
    const margin = computeProfitMargin(netProfit, collectedRevenue);
    const expenseRevenueRatio = computeExpenseRatio(currentExpenses, collectedRevenue);

    const previousByCategory = new Map<string, number>(
      (categoryPrevious as any[]).map((row: any) => [normalizeCategory(row.category), Number(row._sum.amount || 0)])
    );
    const categoryBreakdown = (categoryCurrent as any[])
      .map((row: any) => {
        const category = normalizeCategory(row.category);
        const amount = Number(row._sum.amount || 0);
        const previous = previousByCategory.get(category) || 0;
        const trend = pctChange(amount, previous);
        return {
          category,
          amount,
          percentage: currentExpenses > 0 ? round((amount / currentExpenses) * 100) : 0,
          trend,
          anomaly: previous > 0 && trend >= 35 ? `${category} up ${trend}% compared to last month` : null,
        };
      })
      .sort((a: any, b: any) => b.amount - a.amount);

    const vendorBreakdown = (vendorCurrent as any[])
      .filter((row: any) => row.vendor_name && String(row.vendor_name).trim())
      .map((row: any) => ({
        vendor: row.vendor_name,
        amount: Number(row._sum.amount || 0),
        count: Number(row._count?._all || 0),
      }))
      .sort((a: any, b: any) => b.amount - a.amount);

    const months = Array.from({ length: 6 }, (_, i) => addMonths(sixMonthStart, i));
    const expensesByMonth = new Map<string, number>();
    for (const row of monthlyExpenses) {
      const key = monthKey(new Date(row.date));
      expensesByMonth.set(key, (expensesByMonth.get(key) || 0) + Number(row._sum.amount || 0));
    }
    const revenueByMonth = new Map<string, number>();
    for (const row of monthlyPayments) {
      const key = monthKey(new Date(row.payment_date));
      revenueByMonth.set(key, (revenueByMonth.get(key) || 0) + Number(row._sum.amount_paid || 0));
    }
    const monthlyTrend = months.map((date) => {
      const key = monthKey(date);
      const revenue = revenueByMonth.get(key) || 0;
      const expenses = expensesByMonth.get(key) || 0;
      return { month: key, revenue, expenses, profit: round(revenue - expenses) };
    });

    const duplicateKeys = new Map<string, number>();
    for (const item of duplicateCandidates) {
      const key = `${String(item.title).toLowerCase()}|${Number(item.amount)}|${new Date(item.date).toISOString().slice(0, 10)}`;
      duplicateKeys.set(key, (duplicateKeys.get(key) || 0) + 1);
    }
    const duplicateCount = Array.from(duplicateKeys.values()).filter((count) => count > 1).length;
    const fastestGrowingCategory = [...categoryBreakdown].sort((a, b) => b.trend - a.trend)[0] || null;

    const insights = this.buildInsights({
      currentExpenses,
      previousExpenses,
      collectedRevenue,
      margin,
      expenseRevenueRatio,
      fastestGrowingCategory,
      categoryBreakdown,
      duplicateCount,
    });

    return {
      expenses: ledger.map((e: any) => ({
        ...e,
        amount: Number(e.amount || 0),
        hostel: e.hostels?.name || null,
        hostel_id: e.hostel_id || null,
        added_by: e.profiles?.name || e.profiles?.email || null,
        suggested_category: suggestedCategory(e.title || ""),
      })),
      total: totalCount,
      kpis: {
        this_month_expenses: currentExpenses,
        last_month_expenses: previousExpenses,
        expense_growth_rate: pctChange(currentExpenses, previousExpenses),
        collected_revenue: collectedRevenue,
        previous_collected_revenue: previousCollected,
        net_profit: netProfit,
        profit_margin: margin,
        health: margin >= 25 ? "healthy" : margin >= 12 ? "warning" : "dangerous",
        expense_revenue_ratio: expenseRevenueRatio,
        fastest_growing_category: fastestGrowingCategory,
      },
      category_breakdown: categoryBreakdown,
      vendor_breakdown: vendorBreakdown,
      insights,
      monthly_trend: monthlyTrend,
      frequent_expenses: frequentExpenses,
      meta: {
        range: { start, end },
        categories: EXPENSE_CATEGORIES,
        hostel_filter: filters.hostelId || null,
        accounting_scope: "business",
      },
    };
  }

  private buildInsights(data: any) {
    const insights: Array<{ type: string; severity: string; title: string; detail: string }> = [];
    const food = data.categoryBreakdown.find((c: any) => c.category === "Food & Groceries");
    const electricity = data.categoryBreakdown.find((c: any) => c.category === "Electricity");
    const salary = data.categoryBreakdown.find((c: any) => c.category === "Staff Salary");

    if (food && data.currentExpenses > 0) {
      insights.push({
        type: "category",
        severity: food.percentage > 45 ? "warning" : "healthy",
        title: `Food & Groceries consumed ${food.percentage}% of expenses this month`,
        detail: food.percentage > 45 ? "Review kitchen purchase quantity, vendor rates, and wastage." : "Kitchen spending is within the tracked business range.",
      });
    }

    if (salary?.trend > 0) {
      insights.push({
        type: "salary",
        severity: salary.trend > 20 ? "warning" : "healthy",
        title: `Staff salary increased ${salary.trend}% compared to last month`,
        detail: "Check one-time payments before treating this as a recurring increase.",
      });
    }

    if (electricity?.trend > 25) {
      insights.push({
        type: "anomaly",
        severity: "warning",
        title: "Electricity spending is trending upward",
        detail: `Electricity increased ${electricity.trend}% month over month.`,
      });
    }

    if (data.expenseRevenueRatio > 0) {
      insights.push({
        type: "profit",
        severity: data.expenseRevenueRatio > 60 ? "dangerous" : data.expenseRevenueRatio > 40 ? "warning" : "healthy",
        title: `${data.expenseRevenueRatio}% of revenue went to business expenses`,
        detail: data.expenseRevenueRatio > 60 ? "Profit is tight this month. Review top categories first." : "Expense ratio is inside a manageable business range.",
      });
    }

    if (data.duplicateCount > 0) {
      insights.push({
        type: "leakage",
        severity: "warning",
        title: `${data.duplicateCount} possible duplicate expense entr${data.duplicateCount === 1 ? "y" : "ies"}`,
        detail: "Review same-title and same-amount entries from this month.",
      });
    }

    if (data.fastestGrowingCategory?.trend > 25) {
      insights.push({
        type: "growth",
        severity: "warning",
        title: `${data.fastestGrowingCategory.category} is the fastest growing cost`,
        detail: `It increased ${data.fastestGrowingCategory.trend}% month over month.`,
      });
    }

    if (insights.length === 0) {
      insights.push({
        type: "healthy",
        severity: "healthy",
        title: "Business expenses look controlled this month",
        detail: "Keep logging daily costs to improve trend accuracy.",
      });
    }

    return insights.slice(0, 6);
  }

  async createExpense(data: {
    owner_id: string;
    title: string;
    amount: number;
    date: Date | string;
    category: string;
    status?: string;
    hostel_id?: string | null;
    notes?: string;
    vendor_name?: string;
    payment_method?: string;
    receipt_url?: string;
    is_recurring?: boolean;
    recurring_frequency?: string;
    created_by?: string;
    approved_by?: string;
    expense_type?: string;
    expense_scope?: "BUSINESS" | "HOSTEL" | null;
    tags?: string[];
    metadata?: any;
  }) {
    if (!data.title?.trim()) throw new Error("VALIDATION: Title is required");
    if (!Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0) {
      throw new Error("VALIDATION: Amount must be greater than zero");
    }

    const parsedDate = data.date instanceof Date ? data.date : new Date(data.date);
    if (Number.isNaN(parsedDate.getTime())) throw new Error("VALIDATION: Invalid date provided");

    const expense_scope = data.expense_scope || "BUSINESS";

    if (expense_scope === "BUSINESS" && data.hostel_id) {
      throw new Error("VALIDATION: Business expenses must not have a hostel ID");
    }
    if (expense_scope === "HOSTEL" && !data.hostel_id) {
      throw new Error("VALIDATION: Hostel expenses must have a valid hostel ID");
    }

    const category = normalizeCategory(data.category || suggestedCategory(data.title));
    // operational_type is never owner-supplied — always derived from the canonical
    // category mapping (analytics/dashboards-only classification, not an entry field).
    const operationalType = deriveOperationalType(category);
    const expense = await prisma.expenses.create({
      data: {
        id: randomUUID(),
        owner_id: data.owner_id,
        title: data.title.trim(),
        amount: Number(data.amount),
        date: parsedDate,
        category,
        status: data.status || "paid",
        hostel_id: data.hostel_id || null,
        notes: data.notes || null,
        vendor_name: data.vendor_name || null,
        payment_method: data.payment_method || null,
        receipt_url: data.receipt_url || null,
        receipt_uploaded_at: data.receipt_url ? new Date() : null,
        is_recurring: Boolean(data.is_recurring),
        recurring_frequency: data.is_recurring ? data.recurring_frequency || "monthly" : null,
        created_by: data.created_by || data.owner_id,
        approved_by: data.approved_by || null,
        expense_type: data.expense_type || "BUSINESS",
        expense_scope,
        operational_type: operationalType,
        tags: data.tags || [],
        metadata: {
          ...(data.metadata || {}),
          accounting_scope: "business",
          hostel_reference_only: Boolean(data.hostel_id),
          suggested_category: suggestedCategory(data.title),
        },
      },
    });

    await eventSystem.trigger("expense_created", {
      expense_id: expense.id,
      owner_id: data.owner_id,
      hostel_id: data.hostel_id || undefined,
      title: data.title,
      amount: data.amount,
    });

    return expense;
  }

  async updateExpense(expenseId: string, ownerId: string, data: any) {
    const existing = await prisma.expenses.findFirst({ where: { id: expenseId, owner_id: ownerId } });
    if (!existing) throw new Error("NOT_FOUND: Expense not found");

    const updateData: any = {};
    if (data.title !== undefined) {
      if (!String(data.title).trim()) throw new Error("VALIDATION: Title is required");
      updateData.title = String(data.title).trim();
    }
    if (data.amount !== undefined) {
      if (!Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0) {
        throw new Error("VALIDATION: Amount must be greater than zero");
      }
      updateData.amount = Number(data.amount);
    }
    if (data.category !== undefined) {
      updateData.category = normalizeCategory(data.category);
      // Recompute the derived classification whenever category changes — operational_type
      // is never owner-supplied, so there is no client value to prefer here.
      updateData.operational_type = deriveOperationalType(updateData.category);
    }
    if (data.status !== undefined) updateData.status = data.status;
    if (data.hostel_id !== undefined || data.hostelId !== undefined) updateData.hostel_id = data.hostel_id ?? data.hostelId ?? null;
    if (data.notes !== undefined) updateData.notes = data.notes || null;
    if (data.vendor_name !== undefined) updateData.vendor_name = data.vendor_name || null;
    if (data.payment_method !== undefined) updateData.payment_method = data.payment_method || null;
    if (data.receipt_url !== undefined) {
      updateData.receipt_url = data.receipt_url || null;
      updateData.receipt_uploaded_at = data.receipt_url ? new Date() : null;
    }
    if (data.is_recurring !== undefined) updateData.is_recurring = Boolean(data.is_recurring);
    if (data.recurring_frequency !== undefined) updateData.recurring_frequency = data.recurring_frequency || null;
    if (data.expense_type !== undefined) updateData.expense_type = data.expense_type;
    if (data.expense_scope !== undefined || data.expenseScope !== undefined) {
      updateData.expense_scope = data.expense_scope ?? data.expenseScope ?? null;
    }
    if (data.tags !== undefined) updateData.tags = Array.isArray(data.tags) ? data.tags : [];
    if (data.metadata !== undefined) updateData.metadata = data.metadata;
    if (data.date !== undefined) {
      const d = new Date(data.date);
      if (!Number.isNaN(d.getTime())) updateData.date = d;
    }

    const scopeToValidate = updateData.expense_scope ?? existing.expense_scope;
    const hostelIdToValidate = updateData.hostel_id !== undefined ? updateData.hostel_id : existing.hostel_id;

    if (scopeToValidate === "BUSINESS" && hostelIdToValidate) {
      throw new Error("VALIDATION: Business expenses must not have a hostel ID");
    }
    if (scopeToValidate === "HOSTEL" && !hostelIdToValidate) {
      throw new Error("VALIDATION: Hostel expenses must have a valid hostel ID");
    }

    const expense = await prisma.expenses.update({ where: { id: expenseId }, data: updateData });
    await eventSystem.trigger("expense_updated", {
      expense_id: expense.id,
      owner_id: ownerId,
      hostel_id: expense.hostel_id || existing.hostel_id || undefined,
      title: expense.title,
      amount: Number(expense.amount || 0),
    });
    return expense;
  }

  async deleteExpense(expenseId: string, ownerId: string) {
    const existing = await prisma.expenses.findFirst({ where: { id: expenseId, owner_id: ownerId } });
    if (!existing) throw new Error("NOT_FOUND: Expense not found");
    const expense = await prisma.expenses.delete({ where: { id: expenseId } });
    await eventSystem.trigger("expense_deleted", {
      expense_id: expense.id,
      owner_id: ownerId,
      hostel_id: expense.hostel_id || undefined,
      title: expense.title,
      amount: Number(expense.amount || 0),
    });
    return expense;
  }


  /**
   * Expense memory (ADR-047) — an owner's own history, shaped into the
   * defaults for their next entry.
   *
   * Extends the existing `getFrequentExpenses` idea rather than adding a
   * parallel service: same table, same grouping instinct, more of the fields
   * the entry form actually needs (average, notes, recurrence, receipt
   * pattern, day-of-month history), plus a **vendor-keyed** view so typing a
   * supplier name works as well as typing what was bought.
   *
   * Two aggregate queries total, whatever the history size. All ranking,
   * pattern-detection and phrasing lives in the pure `expense-memory` module.
   *
   * `HAVING COUNT(*) >= 1` for search, `>= 2` when browsing: a one-off is
   * worth surfacing when the owner has typed something matching it, and is
   * noise in a "recent things you buy" list.
   */
  async getExpenseMemory(
    ownerId: string,
    options: { search?: string; limit?: number; today?: Date } = {},
  ): Promise<{ entries: MemoryEntry[]; dueNow: MemoryEntry[] }> {
    const search = (options.search ?? "").trim();
    const limit = Math.min(Math.max(options.limit ?? 8, 1), 25);
    const today = options.today ?? new Date();
    const like = `%${search}%`;
    const minOccurrences = search ? 1 : 2;

    // Grouped by normalised title. `array_agg(... ORDER BY date DESC)[1]`
    // takes the most recent non-null value — the owner's latest intent for
    // that field, which is what they'd expect to be reused.
    const titleRows: any[] = search
      ? await prisma.$queryRaw`
          SELECT LOWER(TRIM(title)) AS group_key,
                 (array_agg(title ORDER BY date DESC))[1] AS label,
                 COUNT(*)::int AS occurrences,
                 SUM(amount)::float AS total_spent,
                 AVG(amount)::float AS average_amount,
                 MAX(amount)::float AS highest_amount,
                 (array_agg(amount ORDER BY date DESC))[1]::float AS last_amount,
                 MAX(date) AS last_date,
                 array_agg(EXTRACT(DAY FROM date)::int) AS days_of_month,
                 (array_agg(category ORDER BY date DESC) FILTER (WHERE category IS NOT NULL))[1] AS category,
                 (array_agg(vendor_name ORDER BY date DESC) FILTER (WHERE vendor_name IS NOT NULL))[1] AS vendor_name,
                 (array_agg(payment_method ORDER BY date DESC) FILTER (WHERE payment_method IS NOT NULL))[1] AS payment_method,
                 (array_agg(notes ORDER BY date DESC) FILTER (WHERE notes IS NOT NULL AND notes <> ''))[1] AS notes,
                 bool_or(is_recurring) AS is_recurring,
                 (array_agg(recurring_frequency ORDER BY date DESC) FILTER (WHERE recurring_frequency IS NOT NULL))[1] AS recurring_frequency,
                 COUNT(receipt_url)::int AS receipt_count,
                 COUNT(DISTINCT hostel_id)::int AS hostel_count
          FROM expenses
          WHERE owner_id = ${ownerId}::uuid
            AND (title ILIKE ${like} OR vendor_name ILIKE ${like})
          GROUP BY LOWER(TRIM(title))
          HAVING COUNT(*) >= ${minOccurrences}
          ORDER BY COUNT(*) DESC, MAX(date) DESC
          LIMIT ${limit}
        `
      : await prisma.$queryRaw`
          SELECT LOWER(TRIM(title)) AS group_key,
                 (array_agg(title ORDER BY date DESC))[1] AS label,
                 COUNT(*)::int AS occurrences,
                 SUM(amount)::float AS total_spent,
                 AVG(amount)::float AS average_amount,
                 MAX(amount)::float AS highest_amount,
                 (array_agg(amount ORDER BY date DESC))[1]::float AS last_amount,
                 MAX(date) AS last_date,
                 array_agg(EXTRACT(DAY FROM date)::int) AS days_of_month,
                 (array_agg(category ORDER BY date DESC) FILTER (WHERE category IS NOT NULL))[1] AS category,
                 (array_agg(vendor_name ORDER BY date DESC) FILTER (WHERE vendor_name IS NOT NULL))[1] AS vendor_name,
                 (array_agg(payment_method ORDER BY date DESC) FILTER (WHERE payment_method IS NOT NULL))[1] AS payment_method,
                 (array_agg(notes ORDER BY date DESC) FILTER (WHERE notes IS NOT NULL AND notes <> ''))[1] AS notes,
                 bool_or(is_recurring) AS is_recurring,
                 (array_agg(recurring_frequency ORDER BY date DESC) FILTER (WHERE recurring_frequency IS NOT NULL))[1] AS recurring_frequency,
                 COUNT(receipt_url)::int AS receipt_count,
                 COUNT(DISTINCT hostel_id)::int AS hostel_count
          FROM expenses
          WHERE owner_id = ${ownerId}::uuid
          GROUP BY LOWER(TRIM(title))
          HAVING COUNT(*) >= ${minOccurrences}
          ORDER BY COUNT(*) DESC, MAX(date) DESC
          LIMIT ${limit}
        `;

    const vendorRows: any[] = search
      ? await prisma.$queryRaw`
          SELECT LOWER(TRIM(vendor_name)) AS group_key,
                 (array_agg(vendor_name ORDER BY date DESC))[1] AS label,
                 COUNT(*)::int AS occurrences,
                 SUM(amount)::float AS total_spent,
                 AVG(amount)::float AS average_amount,
                 MAX(amount)::float AS highest_amount,
                 (array_agg(amount ORDER BY date DESC))[1]::float AS last_amount,
                 MAX(date) AS last_date,
                 array_agg(EXTRACT(DAY FROM date)::int) AS days_of_month,
                 (array_agg(category ORDER BY date DESC) FILTER (WHERE category IS NOT NULL))[1] AS category,
                 (array_agg(title ORDER BY date DESC))[1] AS last_title,
                 (array_agg(payment_method ORDER BY date DESC) FILTER (WHERE payment_method IS NOT NULL))[1] AS payment_method,
                 (array_agg(notes ORDER BY date DESC) FILTER (WHERE notes IS NOT NULL AND notes <> ''))[1] AS notes,
                 bool_or(is_recurring) AS is_recurring,
                 (array_agg(recurring_frequency ORDER BY date DESC) FILTER (WHERE recurring_frequency IS NOT NULL))[1] AS recurring_frequency,
                 COUNT(receipt_url)::int AS receipt_count,
                 COUNT(DISTINCT hostel_id)::int AS hostel_count
          FROM expenses
          WHERE owner_id = ${ownerId}::uuid
            AND vendor_name IS NOT NULL AND vendor_name <> ''
            AND vendor_name ILIKE ${like}
          GROUP BY LOWER(TRIM(vendor_name))
          HAVING COUNT(*) >= ${minOccurrences}
          ORDER BY COUNT(*) DESC, MAX(date) DESC
          LIMIT ${limit}
        `
      : await prisma.$queryRaw`
          SELECT LOWER(TRIM(vendor_name)) AS group_key,
                 (array_agg(vendor_name ORDER BY date DESC))[1] AS label,
                 COUNT(*)::int AS occurrences,
                 SUM(amount)::float AS total_spent,
                 AVG(amount)::float AS average_amount,
                 MAX(amount)::float AS highest_amount,
                 (array_agg(amount ORDER BY date DESC))[1]::float AS last_amount,
                 MAX(date) AS last_date,
                 array_agg(EXTRACT(DAY FROM date)::int) AS days_of_month,
                 (array_agg(category ORDER BY date DESC) FILTER (WHERE category IS NOT NULL))[1] AS category,
                 (array_agg(title ORDER BY date DESC))[1] AS last_title,
                 (array_agg(payment_method ORDER BY date DESC) FILTER (WHERE payment_method IS NOT NULL))[1] AS payment_method,
                 (array_agg(notes ORDER BY date DESC) FILTER (WHERE notes IS NOT NULL AND notes <> ''))[1] AS notes,
                 bool_or(is_recurring) AS is_recurring,
                 (array_agg(recurring_frequency ORDER BY date DESC) FILTER (WHERE recurring_frequency IS NOT NULL))[1] AS recurring_frequency,
                 COUNT(receipt_url)::int AS receipt_count,
                 COUNT(DISTINCT hostel_id)::int AS hostel_count
          FROM expenses
          WHERE owner_id = ${ownerId}::uuid
            AND vendor_name IS NOT NULL AND vendor_name <> ''
          GROUP BY LOWER(TRIM(vendor_name))
          HAVING COUNT(*) >= ${minOccurrences}
          ORDER BY COUNT(*) DESC, MAX(date) DESC
          LIMIT ${limit}
        `;

    const toFacts = (r: any, kind: "TITLE" | "VENDOR"): MemoryFacts => ({
      kind,
      key: r.label ?? r.group_key ?? "",
      occurrences: Number(r.occurrences ?? 0),
      totalSpent: round(Number(r.total_spent ?? 0)),
      lastAmount: round(Number(r.last_amount ?? 0)),
      averageAmount: round(Number(r.average_amount ?? 0)),
      highestAmount: round(Number(r.highest_amount ?? 0)),
      lastDate: r.last_date ? new Date(r.last_date).toISOString() : new Date(0).toISOString(),
      daysOfMonth: Array.isArray(r.days_of_month) ? r.days_of_month.map((d: any) => Number(d)) : [],
      category: r.category ?? null,
      vendorName: kind === "VENDOR" ? (r.label ?? null) : (r.vendor_name ?? null),
      paymentMethod: r.payment_method ?? null,
      notes: r.notes ?? null,
      isRecurring: Boolean(r.is_recurring),
      recurringFrequency: r.recurring_frequency ?? null,
      receiptCount: Number(r.receipt_count ?? 0),
      hostelCount: Number(r.hostel_count ?? 0),
    });

    const entries = sortMemory([
      ...titleRows.map((r) => buildMemoryEntry(toFacts(r, "TITLE"), today)),
      ...vendorRows.map((r) => buildMemoryEntry(toFacts(r, "VENDOR"), today)),
    ]);

    return { entries, dueNow: entries.filter((e) => e.dueAroundNow) };
  }

  async getExpenseTitleSummary(
    ownerId: string,
    titleSearch: string,
    options: { from?: Date; to?: Date } = {},
  ) {
    const normalized = titleSearch.trim().toLowerCase();
    if (!normalized) throw new Error("VALIDATION: Title search term is required");

    const range = options.from && options.to ? { gte: options.from, lte: options.to } : undefined;

    const expenses = await prisma.expenses.findMany({
      where: {
        owner_id: ownerId,
        title: { contains: titleSearch.trim(), mode: "insensitive" },
        ...(range ? { date: range } : {}),
      },
      orderBy: { date: "desc" },
      select: {
        id: true,
        title: true,
        amount: true,
        date: true,
        category: true,
        vendor_name: true,
        payment_method: true,
        notes: true,
        status: true,
      },
      take: 50,
    });

    if (expenses.length === 0) {
      return { title: titleSearch, transactions: [], summary: null };
    }

    // Same-length window immediately before the selected one, so "trend" means
    // like-for-like. Skipped entirely when the owner hasn't chosen a range —
    // comparing all-time against nothing would be meaningless.
    let previousTotal: number | null = null;
    if (options.from && options.to) {
      const span = options.to.getTime() - options.from.getTime();
      const prevTo = new Date(options.from.getTime() - 1);
      const prevFrom = new Date(prevTo.getTime() - span);
      const prev = await prisma.expenses.aggregate({
        where: {
          owner_id: ownerId,
          title: { contains: titleSearch.trim(), mode: "insensitive" },
          date: { gte: prevFrom, lte: prevTo },
        },
        _sum: { amount: true },
      });
      previousTotal = round(Number(prev._sum.amount ?? 0));
    }

    // Who supplies this, by number of purchases — from the rows already
    // fetched, so no extra query.
    const vendorCounts = new Map<string, { count: number; total: number }>();
    for (const e of expenses as any[]) {
      const name = (e.vendor_name || "").trim();
      if (!name) continue;
      const cur = vendorCounts.get(name) ?? { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(e.amount || 0);
      vendorCounts.set(name, cur);
    }
    // Array.from rather than spread — this tsconfig targets below es2015 for
    // downlevelIteration, so `[...map.entries()]` doesn't compile.
    const topVendorEntry = Array.from(vendorCounts.entries()).sort((a, b) => b[1].count - a[1].count)[0];
    const topVendor = topVendorEntry
      ? { name: topVendorEntry[0], purchases: topVendorEntry[1].count, total: round(topVendorEntry[1].total) }
      : null;

    const amounts = expenses.map((e: any) => Number(e.amount || 0));
    const totalSpent = round(amounts.reduce((s: number, a: number) => s + a, 0));
    const highest = Math.max(...amounts);
    const lowest = Math.min(...amounts);

    // Compute monthly average based on distinct months spanned
    const monthSet = new Set(expenses.map((e: any) => monthKey(new Date(e.date))));
    const avgMonthly = monthSet.size > 0 ? round(totalSpent / monthSet.size) : totalSpent;

    return {
      title: titleSearch,
      transactions: expenses.map((e: any) => ({
        ...e,
        amount: Number(e.amount || 0),
      })),
      summary: {
        total_transactions: expenses.length,
        total_spent: totalSpent,
        average_monthly: avgMonthly,
        // Average *per purchase*, which is what an owner means by "average" —
        // average_monthly answers a different question and both are useful.
        average_purchase: round(totalSpent / expenses.length),
        highest,
        lowest,
        months_tracked: monthSet.size,
        last_purchase_date: expenses[0]?.date ?? null,
        last_purchase_amount: Number(expenses[0]?.amount ?? 0),
        top_vendor: topVendor,
        previous_period_total: previousTotal,
        // Null when there is no comparable previous window, or when the
        // previous window was zero — a percentage against zero is not a trend.
        change_percent:
          previousTotal && previousTotal > 0
            ? round(((totalSpent - previousTotal) / previousTotal) * 100)
            : null,
      },
    };
  }
}

export const expenseService = new ExpenseService();
