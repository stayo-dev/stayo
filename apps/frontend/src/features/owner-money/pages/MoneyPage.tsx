import { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { QuickCollectModal } from '@features/owner-tenants/quick-collect/QuickCollectModal';
import type { QuickCollectTenant } from '@features/owner-tenants/types';
import type { MockExpense } from '@shared/mocks/expenses';
import type { MockTenant } from '@shared/mocks/tenants';
import { useMoneyPage } from '../hooks/useMoneyPage';
import { useRealMoney } from '../hooks/useRealMoney';
import { EMPTY_EXPENSE_FILTERS, type AddExpenseData } from '../types';
import { StatusBanner } from '../components/pulse/StatusBanner';
import { MoneyStatTiles } from '../components/pulse/MoneyStatTiles';
import { CollectionRateCard } from '../components/pulse/CollectionRateCard';
import { ActionQueueCard } from '../components/pulse/ActionQueueCard';
import { CashflowForecastCard } from '../components/pulse/CashflowForecastCard';
import { CollectionsFilters, type CollectionsSort } from '../components/collections/CollectionsFilters';
import { TenantDueRow } from '../components/collections/TenantDueRow';
import { BusinessHealthStrip } from '../components/expenses/BusinessHealthStrip';
import { InsightTilesGrid } from '../components/expenses/InsightTilesGrid';
import { MonthlyTrendCard } from '../components/expenses/MonthlyTrendCard';
import { ExpenseSearchBar } from '../components/expenses/ExpenseSearchBar';
import { CategoryChipsRow } from '../components/expenses/CategoryChipsRow';
import { ExpenseRow } from '../components/expenses/ExpenseRow';
import { ExpenseBreakdownCard } from '../components/expenses/ExpenseBreakdownCard';
import { TopVendorsCard } from '../components/expenses/TopVendorsCard';
import { AddExpenseModal } from '../add-expense/AddExpenseModal';
import { ExpenseFiltersModal } from '../filters/ExpenseFiltersModal';
import { ExportExpensesModal } from '../export/ExportExpensesModal';
import { ExpenseDetailModal } from '../expense-detail/ExpenseDetailModal';

function toQuickCollectTenant(t: MockTenant): QuickCollectTenant {
  return {
    id: t.id,
    name: t.name,
    initials: t.initials,
    phone: t.phone,
    hostelId: t.hostelId,
    hostelName: t.hostelName,
    room: t.room,
    outstanding: t.outstanding,
    deposit: t.stay.deposit,
  };
}

function toAddExpenseData(e: MockExpense): AddExpenseData {
  return {
    title: e.title,
    category: e.category,
    amount: String(e.amount),
    date: e.date,
    status: e.status,
    vendor: e.vendor,
    paymentMethod: e.paymentMethod,
    notes: e.notes ?? '',
    recurring: Boolean(e.recurring),
    // Duplicating an expense keeps its property attribution; the receipt is
    // deliberately not carried over, since it belongs to the original.
    hostelId: (e as { hostelId?: string }).hostelId ?? '',
    receiptFile: null,
  };
}

const TABS = [
  { id: 'pulse', label: 'Overview' },
  { id: 'collections', label: 'Collections' },
  { id: 'expenses', label: 'Expenses' },
] as const;

function MoneyLoadingSkeleton() {
  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="h-8 w-32 animate-pulse rounded-lg bg-muted" />
      <div className="h-10 animate-pulse rounded-[11px] bg-muted" />
      <div className="h-16 animate-pulse rounded-2xl bg-muted" />
      <div className="grid grid-cols-3 gap-2">
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
        <div className="h-20 animate-pulse rounded-xl bg-muted" />
      </div>
      <div className="h-24 animate-pulse rounded-2xl bg-muted" />
    </div>
  );
}

/** Money tab — Overview/Collections/Expenses, per Stayo App.dc.html. Thin orchestrator: each sub-view's real work lives in `useRealMoney` and its own presentational components. */
export function MoneyPage() {
  const money = useMoneyPage();
  const real = useRealMoney();
  const location = useLocation();
  const [expenseSearch, setExpenseSearch] = useState('');
  const [expenseFilters, setExpenseFilters] = useState(EMPTY_EXPENSE_FILTERS);
  const [hostelFilter, setHostelFilter] = useState('all');
  const [collectionsSort, setCollectionsSort] = useState<CollectionsSort>('Most overdue');

  // Home's Quick Actions -> "Add Expense" navigates here with router state
  // instead of duplicating the wizard's flow — open it once on arrival.
  useEffect(() => {
    if ((location.state as { openAddExpense?: boolean } | null)?.openAddExpense) {
      money.setTab('expenses');
      money.openAddExpense();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const overdueTenants = useMemo(() => {
    let list = real.overdueTenants;
    if (hostelFilter !== 'all') list = list.filter((t) => t.hostelId === hostelFilter);
    if (collectionsSort === 'Most overdue') list = [...list].sort((a, b) => b.overdueMonths - a.overdueMonths);
    if (collectionsSort === 'Highest amount') list = [...list].sort((a, b) => b.outstanding - a.outstanding);
    if (collectionsSort === 'Name') list = [...list].sort((a, b) => a.name.localeCompare(b.name));
    return list;
  }, [real.overdueTenants, hostelFilter, collectionsSort]);

  const filteredExpenses = useMemo(() => {
    let list: MockExpense[] = real.expenses;
    if (expenseFilters.status !== 'All Status') list = list.filter((e) => e.status === expenseFilters.status);
    if (expenseFilters.paymentMethod) list = list.filter((e) => e.paymentMethod === expenseFilters.paymentMethod);
    if (expenseFilters.recurring === 'recurring') list = list.filter((e) => e.recurring);
    if (expenseFilters.recurring === 'one-time') list = list.filter((e) => !e.recurring);
    const min = Number(expenseFilters.amountMin) || 0;
    const max = Number(expenseFilters.amountMax) || Infinity;
    list = list.filter((e) => e.amount >= min && e.amount <= max);
    const q = expenseSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (e) =>
          e.title.toLowerCase().includes(q) ||
          e.vendor.toLowerCase().includes(q) ||
          e.category.toLowerCase().includes(q) ||
          String(e.amount).includes(q),
      );
    }
    const sorted = [...list];
    if (expenseFilters.sort === 'Recent') sorted.sort((a, b) => b.date.localeCompare(a.date));
    if (expenseFilters.sort === 'Oldest') sorted.sort((a, b) => a.date.localeCompare(b.date));
    if (expenseFilters.sort === 'Amount: High to low') sorted.sort((a, b) => b.amount - a.amount);
    if (expenseFilters.sort === 'Amount: Low to high') sorted.sort((a, b) => a.amount - b.amount);
    return sorted;
  }, [real.expenses, expenseSearch, expenseFilters]);

  if (real.isLoading) return <MoneyLoadingSkeleton />;

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Money</h1>
          <button type="button" className="mt-0.5 flex items-center gap-1 text-[12.5px] text-muted-foreground">
            All hostels · {real.overview.month}
            <ChevronDown className="h-3 w-3" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => (money.tab === 'expenses' ? money.openAddExpense() : money.openModal(null))}
          className="rounded-xl bg-primary px-4 py-2.5 font-display text-[13px] font-bold text-primary-foreground"
        >
          {money.tab === 'expenses' ? '+ Add expense' : 'Collect rent'}
        </button>
      </div>

      <div className="flex rounded-[11px] bg-[#EDE6DE] p-[3px]">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => money.setTab(t.id)}
            className={`flex-1 rounded-[9px] py-2 text-center font-display text-[12.5px] font-bold ${
              money.tab === t.id ? 'bg-card text-foreground shadow-[0_1px_3px_rgba(40,30,20,0.08)]' : 'text-[#8A7F75]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {money.tab === 'pulse' && (
        <div className="flex flex-col gap-3">
          <StatusBanner
            collectionRatePercent={real.overview.collectionRatePercent}
            netCashFlow={real.overview.netCashFlow}
            perTenant={real.overview.perTenant}
          />
          <MoneyStatTiles
            tiles={[
              { key: 'collected', label: 'Collected', value: real.overview.collected, valueClassName: 'text-success', info: 'Payments received this month, across all hostels.' },
              { key: 'due', label: 'Due', value: real.overview.due, valueClassName: 'text-destructive', info: 'Rent not yet collected for the current billing cycle.' },
              { key: 'expenses', label: 'Expenses', value: `₹${real.totalExpenses.toLocaleString('en-IN')}`, info: 'Total business spend recorded so far this month.' },
            ]}
          />
          <CollectionRateCard collectionRatePercent={real.overview.collectionRatePercent} due={real.overview.due} />
          <ActionQueueCard
            overdueTenants={real.overdueTenants}
            onViewAll={() => money.setTab('collections')}
            onCollect={(t) => money.openCollect(toQuickCollectTenant(t))}
          />
          <CashflowForecastCard forecast={real.forecast} />
          <div className={`rounded-2xl px-3.5 py-2.5 text-xs font-semibold ${real.overview.overdueCount > 0 ? 'border border-warning/25 bg-warning/10 text-warning' : 'border border-success/25 bg-success/10 text-success'}`}>
            {real.overview.overdueCount > 0 ? `${real.overview.overdueCount} tenant${real.overview.overdueCount === 1 ? '' : 's'} overdue` : 'No tenants overdue right now'}
          </div>
        </div>
      )}

      {money.tab === 'collections' && (
        <div className="flex flex-col gap-3">
          <CollectionsFilters hostels={real.hostelOptions} hostelFilter={hostelFilter} onHostelFilterChange={setHostelFilter} sort={collectionsSort} onSortChange={setCollectionsSort} />
          <div className="flex flex-col gap-2">
            {overdueTenants.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing overdue here — nice work.</p>
            ) : (
              overdueTenants.map((t) => (
                <div key={t.id} className="rounded-2xl border border-border bg-card px-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
                  <TenantDueRow tenant={t} onCollect={() => money.openCollect(toQuickCollectTenant(t))} />
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {money.tab === 'expenses' && (
        <div className="flex flex-col gap-3">
          <BusinessHealthStrip netProfit={real.netProfit} revenue={real.revenue} />
          <MoneyStatTiles
            tiles={[
              { key: 'revenue', label: 'Revenue', value: `₹${(real.revenue / 100000).toFixed(2)}L`, info: 'Rent collected across all hostels this month.' },
              { key: 'expenses', label: 'Expenses', value: `₹${real.totalExpenses.toLocaleString('en-IN')}`, valueClassName: 'text-destructive', info: 'Everything logged in the Expenses tab this month.' },
              { key: 'net', label: 'Net profit', value: `₹${(real.netProfit / 100000).toFixed(2)}L`, valueClassName: 'text-success', info: 'Revenue minus expenses this month.' },
            ]}
          />
          <InsightTilesGrid
            topCategory={real.categoryBreakdown[0]}
            topVendor={real.vendorTotals[0]}
            largestExpense={real.largestExpense}
            anomaly={real.anomalyCategory}
          />
          <MonthlyTrendCard trend={real.monthlyTrend} />
          <ExpenseSearchBar
            search={expenseSearch}
            onSearchChange={setExpenseSearch}
            onOpenFilters={() => money.openModal('filters')}
            onOpenExport={() => money.openModal('export')}
          />
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {['Today', 'This week', 'This month', 'Custom'].map((r) => (
              <span key={r} className={`flex-none rounded-full px-3.5 py-1.5 text-xs font-semibold ${r === 'This month' ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'}`}>
                {r}
              </span>
            ))}
          </div>
          <CategoryChipsRow categoryBreakdown={real.categoryBreakdown} />
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Recent expenses · {filteredExpenses.length}</span>
            {filteredExpenses.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">No expenses logged this month yet.</p>
            ) : (
              filteredExpenses.map((e) => <ExpenseRow key={e.id} expense={e} onOpenDetail={() => money.openExpenseDetail(e)} />)
            )}
          </div>
          <ExpenseBreakdownCard categoryBreakdown={real.categoryBreakdown} totalExpenses={real.totalExpenses} />
          <TopVendorsCard vendorTotals={real.vendorTotals} />
        </div>
      )}

      <AddExpenseModal
        open={money.modal === 'add-expense'}
        onClose={money.closeModal}
        seed={money.addExpenseDraft.seed}
        editingId={money.addExpenseDraft.editingId}
      />
      <ExpenseFiltersModal
        open={money.modal === 'filters'}
        filters={expenseFilters}
        onChange={(patch) => setExpenseFilters((f) => ({ ...f, ...patch }))}
        onApply={money.closeModal}
        onClose={money.closeModal}
      />
      <ExportExpensesModal open={money.modal === 'export'} onClose={money.closeModal} filters={expenseFilters} search={expenseSearch} />
      <ExpenseDetailModal
        open={money.expenseDetail != null}
        expense={money.expenseDetail}
        onClose={money.closeExpenseDetail}
        onEdit={(e) => {
          money.closeExpenseDetail();
          money.openAddExpense({ seed: toAddExpenseData(e), editingId: e.id });
        }}
        onDuplicate={(e) => {
          money.closeExpenseDetail();
          money.openAddExpense({ seed: toAddExpenseData(e) });
        }}
      />
      <QuickCollectModal open={money.collectTenant != null} onClose={money.closeCollect} initialTenant={money.collectTenant ?? undefined} />
    </div>
  );
}
