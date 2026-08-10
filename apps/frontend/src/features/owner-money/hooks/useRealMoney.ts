import { useMemo } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useRealTenantList } from '@features/owner-tenants/hooks/useRealTenantList';
import { portfolioService, dashboardService } from '@features/dashboard/api';
import { expenseService } from '@features/expenses/api';
import { queryKeys } from '@lib/queryKeys';
import type { MockExpense } from '@shared/mocks/expenses';

function formatINR(value: number) {
  return `₹${Math.round(value).toLocaleString('en-IN')}`;
}

interface PortfolioAggregate {
  active_tenants: number;
  rent_collected_this_month: number;
  pending_dues: number;
  collection_rate: number;
  overdue_count: number;
}

interface PortfolioSummaryResponse {
  aggregate: PortfolioAggregate;
  hostels: { hostel_id: string }[];
}

interface CashflowResult {
  data: { daily_collection: { date: string; amount: number }[] };
}

interface RealCategoryRow {
  category: string;
  amount: number;
  percent: number;
  anomaly: string | null;
}

interface RealVendorRow {
  vendor: string;
  amount: number;
  payments: number;
}

interface RealMonthTrend {
  monthShort: string;
  total: number;
}

interface ExpensesResponse {
  expenses: Array<{
    id: string;
    title: string;
    category: string;
    amount: number;
    date: string;
    status: string;
    vendor_name: string | null;
    payment_method: string | null;
    notes: string | null;
    is_recurring: boolean | null;
    added_by: string | null;
  }>;
  kpis: { this_month_expenses: number; collected_revenue: number; net_profit: number };
  category_breakdown: Array<{ category: string; amount: number; percentage: number; anomaly: string | null }>;
  vendor_breakdown: Array<{ vendor: string; amount: number; count: number }>;
  monthly_trend: Array<{ month: string; expenses: number }>;
}

const STATUS_MAP: Record<string, MockExpense['status']> = {
  paid: 'Paid',
  pending: 'Pending',
  partially_paid: 'Partially Paid',
  partial: 'Partially Paid',
};

function toStatus(raw: string): MockExpense['status'] {
  return STATUS_MAP[raw?.toLowerCase()] ?? 'Pending';
}

export interface RealExpense extends MockExpense {
  addedBy: string | null;
}

function toMockExpense(e: ExpensesResponse['expenses'][number]): RealExpense {
  return {
    id: e.id,
    title: e.title,
    category: e.category,
    amount: Number(e.amount || 0),
    date: (e.date || '').slice(0, 10),
    status: toStatus(e.status),
    vendor: e.vendor_name || 'Unknown vendor',
    paymentMethod: e.payment_method || '—',
    notes: e.notes || undefined,
    recurring: Boolean(e.is_recurring),
    addedBy: e.added_by,
    receiptUrl: (e as { receipt_url?: string | null }).receipt_url ?? null,
    hostelId: (e as { hostel_id?: string | null }).hostel_id ?? null,
  };
}

const MONTH_SHORT: Record<string, string> = {
  '01': 'Jan', '02': 'Feb', '03': 'Mar', '04': 'Apr', '05': 'May', '06': 'Jun',
  '07': 'Jul', '08': 'Aug', '09': 'Sep', '10': 'Oct', '11': 'Nov', '12': 'Dec',
};

/** Generate last N days as YYYY-MM-DD strings, oldest first. */
function lastNDays(n: number) {
  const days: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Real data for the Money tab (Pulse/Collections/Expenses reads) — composes
 * `portfolioService.getSummary()` (already shared with the Home dashboard's
 * query key, so this is often a cache hit), a per-hostel `dashboardService
 * .getCashflow()` fan-out for the 7-day forecast (the endpoint requires a
 * single hostelId, so "all hostels" sums the real daily amounts across every
 * real hostel — never assumes "first hostel"), `useRealTenantList()` reused
 * for the overdue-tenant list, and `expenseService.getAll()` (portfolio-level,
 * no hostelId) for the Expenses tab. No field here is invented — where the
 * backend has no real equivalent (e.g. "urgent vs informational" alert
 * counts), the real derived number is used instead and the UI is labeled
 * accordingly, same discipline as `useOwnerDashboard`.
 */
export function useRealMoney() {
  const session = useOwnerSession();
  const tenantList = useRealTenantList();

  const portfolioQuery = useQuery({
    queryKey: queryKeys.portfolio.summary(),
    queryFn: () => portfolioService.getSummary() as Promise<PortfolioSummaryResponse>,
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });

  const days = useMemo(() => lastNDays(28), []);
  const from = days[0];
  const to = days[days.length - 1];

  const cashflowQueries = useQueries({
    queries: session.hostels.map((h) => ({
      queryKey: [...queryKeys.owner.cashflow([h.id], from, to)],
      queryFn: () => dashboardService.getCashflow(h.id, from, to) as Promise<CashflowResult>,
      enabled: session.isAuthenticated,
      staleTime: 60_000,
    })),
  });

  const expensesQuery = useQuery({
    queryKey: queryKeys.owner.expenses({ limit: 100 }),
    queryFn: () => expenseService.getAll(undefined, { limit: 100 }) as Promise<ExpensesResponse>,
    enabled: session.isAuthenticated,
    staleTime: 60_000,
  });

  const aggregate = portfolioQuery.data?.aggregate;

  const forecast = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const day of days) byDate.set(day, 0);
    for (const q of cashflowQueries) {
      const daily = q.data?.data?.daily_collection ?? [];
      for (const row of daily) {
        const key = row.date.slice(0, 10);
        if (byDate.has(key)) byDate.set(key, (byDate.get(key) ?? 0) + Number(row.amount || 0));
      }
    }
    return days.map((day) => {
      const amount = byDate.get(day) ?? 0;
      const [, m, d] = day.split('-');
      return { label: `${d} ${MONTH_SHORT[m]}`, value: formatINR(amount), amount };
    });
  }, [cashflowQueries, days]);

  const expenses = expensesQuery.data;
  const mappedExpenses = useMemo(() => (expenses?.expenses ?? []).map(toMockExpense), [expenses]);

  const categoryBreakdown: RealCategoryRow[] = useMemo(
    () => (expenses?.category_breakdown ?? []).map((c) => ({ category: c.category, amount: c.amount, percent: c.percentage, anomaly: c.anomaly })),
    [expenses],
  );
  const vendorTotals: RealVendorRow[] = useMemo(
    () => (expenses?.vendor_breakdown ?? []).map((v) => ({ vendor: v.vendor, amount: v.amount, payments: v.count })),
    [expenses],
  );
  const monthlyTrend: RealMonthTrend[] = useMemo(
    () => (expenses?.monthly_trend ?? []).map((m) => ({ monthShort: MONTH_SHORT[m.month.split('-')[1]] ?? m.month, total: m.expenses })),
    [expenses],
  );
  const largestExpense = useMemo(
    () => (mappedExpenses.length ? [...mappedExpenses].sort((a, b) => b.amount - a.amount)[0] : undefined),
    [mappedExpenses],
  );
  const anomalyCategory = categoryBreakdown.find((c) => c.anomaly) ?? null;

  const totalExpenses = expenses?.kpis.this_month_expenses ?? 0;
  const revenue = expenses?.kpis.collected_revenue ?? 0;
  const netProfit = expenses?.kpis.net_profit ?? 0;

  const collected = aggregate?.rent_collected_this_month ?? 0;
  const due = aggregate?.pending_dues ?? 0;
  const activeTenants = aggregate?.active_tenants ?? 0;

  const overview = {
    month: new Date().toLocaleDateString('en-US', { month: 'long' }),
    collected: formatINR(collected),
    due: formatINR(due),
    collectionRatePercent: Math.round(aggregate?.collection_rate ?? 0),
    // Real derived figures (collected minus this-month expenses; collected /
    // active tenants) — not fabricated, but not a backend field either, same
    // as useOwnerDashboard's honestly-labeled approximations.
    netCashFlow: formatINR(collected - totalExpenses),
    perTenant: activeTenants > 0 ? formatINR(collected / activeTenants) : formatINR(0),
    overdueCount: aggregate?.overdue_count ?? 0,
  };

  return {
    isLoading: session.isLoading || portfolioQuery.isLoading || tenantList.isLoading || expensesQuery.isLoading,
    hostelOptions: tenantList.hostelOptions,
    overview,
    forecast,
    overdueTenants: tenantList.tenants.filter((t) => t.status === 'overdue'),
    expenses: mappedExpenses,
    totalExpenses,
    revenue,
    netProfit,
    categoryBreakdown,
    vendorTotals,
    monthlyTrend,
    largestExpense,
    anomalyCategory,
  };
}
