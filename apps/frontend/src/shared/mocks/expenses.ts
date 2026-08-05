/**
 * Centralized expense mock data — shared/mocks/, not per-feature. Matches
 * the shape and tone of Stayo App.dc.html's Money → Expenses tab. Category
 * breakdown, top vendor, and largest-expense insights are meant to be
 * *derived* from this array (see `getExpenseInsights`), not hardcoded
 * separately — so if the mock records here don't add up to exactly the
 * design's own illustrative percentages, that's expected: the design's
 * example numbers aren't fully internally consistent either (a rice
 * purchase + one dairy payment already exceeds its stated category total).
 * This dataset is self-consistent instead.
 */

export type ExpenseStatus = 'Paid' | 'Pending' | 'Partially Paid';

export interface MockExpense {
  id: string;
  title: string;
  category: string;
  amount: number;
  date: string; // ISO yyyy-mm-dd
  status: ExpenseStatus;
  vendor: string;
  paymentMethod: string;
  notes?: string;
  recurring?: boolean;
}

/**
 * Plain data only — the icon for each category lives in
 * `features/owner-money/components/expenses/categoryIcons.ts`, keyed by `id`.
 * The emoji that shipped with the mockup were removed: they render
 * differently on every platform, can't inherit colour or stroke weight, and
 * never align in a grid. Keeping the icon out of here also keeps `shared/`
 * free of a React dependency.
 */
export const EXPENSE_CATEGORIES = [
  { id: 'food', name: 'Food & Groceries', chip: 'FG' },
  { id: 'staff', name: 'Staff Salary', chip: 'SS' },
  { id: 'electricity', name: 'Electricity', chip: 'EL' },
  { id: 'gas', name: 'Gas Cylinders', chip: 'GC' },
  { id: 'furniture', name: 'Furniture & Equipment', chip: 'FE' },
  { id: 'water', name: 'Water', chip: 'WT' },
  { id: 'maintenance', name: 'Maintenance', chip: 'MT' },
  { id: 'internet', name: 'Internet', chip: 'IN' },
  { id: 'other', name: 'Other', chip: 'OT' },
] as const;

export const PAYMENT_METHOD_OPTIONS = ['Cash', 'UPI', 'Bank Transfer', 'Card', 'Cheque', 'Other'] as const;

export const mockExpenses: MockExpense[] = [
  {
    id: 'exp-1',
    title: 'Rice 60 bags',
    category: 'Food & Groceries',
    amount: 91400,
    date: '2026-07-15',
    status: 'Paid',
    vendor: 'Sri Lakshmi Rice Traders',
    paymentMethod: 'Bank Transfer',
  },
  {
    id: 'exp-2',
    title: 'Milk supply — July',
    category: 'Food & Groceries',
    amount: 6000,
    date: '2026-07-10',
    status: 'Paid',
    vendor: 'Dodla Dairy',
    paymentMethod: 'UPI',
    recurring: true,
  },
  {
    id: 'exp-3',
    title: 'Vegetables restock',
    category: 'Food & Groceries',
    amount: 2600,
    date: '2026-07-18',
    status: 'Paid',
    vendor: 'Local Market',
    paymentMethod: 'Cash',
  },
  {
    id: 'exp-4',
    title: 'Cooking oil & spices',
    category: 'Food & Groceries',
    amount: 1330,
    date: '2026-07-19',
    status: 'Paid',
    vendor: 'Local Market',
    paymentMethod: 'Cash',
  },
  {
    id: 'exp-5',
    title: 'Gas cylinder refill — Hostel 1',
    category: 'Gas Cylinders',
    amount: 9900,
    date: '2026-07-12',
    status: 'Paid',
    vendor: 'Hyderabad Gas Agency',
    paymentMethod: 'UPI',
  },
  {
    id: 'exp-6',
    title: 'Gas cylinder refill — Hostel 2',
    category: 'Gas Cylinders',
    amount: 9900,
    date: '2026-07-14',
    status: 'Paid',
    vendor: 'Hyderabad Gas Agency',
    paymentMethod: 'UPI',
  },
  {
    id: 'exp-7',
    title: 'Common-room furniture repair',
    category: 'Furniture & Equipment',
    amount: 6000,
    date: '2026-07-20',
    status: 'Pending',
    vendor: 'Sri Furniture Works',
    paymentMethod: 'Cash',
    notes: 'Two chairs and a study table — awaiting invoice before payment.',
  },
];

/**
 * "Full portfolio" figures independent of the small mock tenant/expense
 * sample sets above — same precedent as `shared/mocks/dashboard.ts`'s
 * Home-tab Outstanding figure, which is likewise a standalone mock number
 * representing the whole business, not a sum of the handful of sample
 * records elsewhere. `netProfit` is the one figure actually derived, from
 * `revenue` minus the real logged-expense total.
 */
export const moneyOverviewMock = {
  month: 'July',
  collected: '₹1.8L',
  due: '₹12.5L',
  collectionRatePercent: 26,
  netCashFlow: '+₹1.8L',
  perTenant: '₹2.9K',
  forecast: [
    { label: 'Mon', value: '₹12K' },
    { label: 'Tue', value: '₹8K' },
    { label: 'Wed', value: '₹22K' },
    { label: 'Thu', value: '₹6K' },
    { label: 'Fri', value: '₹31K' },
    { label: 'Sat', value: '₹18K' },
    { label: 'Sun', value: '₹4K' },
  ],
  urgentCount: 3,
  infoCount: 12,
};

export const moneyRevenueMock = 426000;

export const monthlyExpenseTrend = [
  { monthShort: 'Feb', total: 98000 },
  { monthShort: 'Mar', total: 112000 },
  { monthShort: 'Apr', total: 87000 },
  { monthShort: 'May', total: 134000 },
  { monthShort: 'Jun', total: 121000 },
  { monthShort: 'Jul', total: mockExpenses.reduce((s, e) => s + e.amount, 0) },
];

export const unusualSpendingMock = {
  label: 'Gas Cylinders',
  sub: '+38% vs last month',
  basis: 'Two refills logged this month across your hostels versus one typical refill — likely both properties due in the same cycle.',
};

export interface CategoryBreakdownRow {
  category: string;
  amount: number;
  percent: number;
}

export interface ExpenseInsights {
  totalExpenses: number;
  netProfit: number;
  categoryBreakdown: CategoryBreakdownRow[];
  topCategory: CategoryBreakdownRow | undefined;
  vendorTotals: { vendor: string; amount: number; payments: number }[];
  topVendor: { vendor: string; amount: number; payments: number } | undefined;
  largestExpense: MockExpense | undefined;
}

/** Derives category breakdown, top vendor, largest expense, and net profit from `mockExpenses` — nothing here is hardcoded separately. */
export function getExpenseInsights(expenses: MockExpense[] = mockExpenses): ExpenseInsights {
  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);

  const byCategory = new Map<string, number>();
  for (const e of expenses) byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + e.amount);
  const categoryBreakdown: CategoryBreakdownRow[] = Array.from(byCategory.entries())
    .map(([category, amount]) => ({ category, amount, percent: totalExpenses ? Math.round((amount / totalExpenses) * 100) : 0 }))
    .sort((a, b) => b.amount - a.amount);

  const byVendor = new Map<string, { amount: number; payments: number }>();
  for (const e of expenses) {
    const cur = byVendor.get(e.vendor) ?? { amount: 0, payments: 0 };
    byVendor.set(e.vendor, { amount: cur.amount + e.amount, payments: cur.payments + 1 });
  }
  const vendorTotals = Array.from(byVendor.entries())
    .map(([vendor, v]) => ({ vendor, ...v }))
    .sort((a, b) => b.amount - a.amount);

  const largestExpense = [...expenses].sort((a, b) => b.amount - a.amount)[0];

  return {
    totalExpenses,
    netProfit: moneyRevenueMock - totalExpenses,
    categoryBreakdown,
    topCategory: categoryBreakdown[0],
    vendorTotals,
    topVendor: vendorTotals[0],
    largestExpense,
  };
}
