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
import { ExpenseSearchBar } from '../components/expenses/ExpenseSearchBar';
import { ExpenseSearchSummary } from '../components/expenses/ExpenseSearchSummary';
import { WhereItWentSection } from '../components/expenses/WhereItWentSection';
import { CategoryChipsRow } from '../components/expenses/CategoryChipsRow';
import { ExpenseRow } from '../components/expenses/ExpenseRow';
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
  /**
   * Date range for the Expenses tab. These chips were static <span>s with
   * "This month" hardcoded active — they looked like a control and did
   * nothing (module audit, finding #5). "Custom" was replaced by "All time":
   * a custom range needs a date picker, and shipping a second dead chip to
   * stand in for it would repeat the original mistake.
   */
  const [dateRange, setDateRange] = useState<'today' | 'week' | 'month' | 'all'>('month');
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

  /**
   * The headline figure must describe what is actually on screen. The old
   * tiles read whole-portfolio totals while the list below them was filtered,
   * so searching "Rice" changed the rows and left the numbers untouched
   * (module audit, finding #4).
   */
  const rangeBounds = useMemo(() => {
    if (dateRange === 'all') return null;
    const now = new Date();
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    if (dateRange === 'today') {
      return { from: new Date(now.getFullYear(), now.getMonth(), now.getDate()), to: end };
    }
    if (dateRange === 'week') {
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
      return { from: start, to: end };
    }
    return { from: new Date(now.getFullYear(), now.getMonth(), 1), to: end };
  }, [dateRange]);

  const filteredExpenses = useMemo(() => {
    let list: MockExpense[] = real.expenses;
    if (rangeBounds) {
      list = list.filter((e) => {
        const d = new Date(e.date);
        return !Number.isNaN(d.getTime()) && d >= rangeBounds.from && d <= rangeBounds.to;
      });
    }
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

  /** Total of exactly the rows on screen — never the unfiltered portfolio. */
  const filteredTotal = useMemo(
    () => filteredExpenses.reduce((sum, e) => sum + (Number(e.amount) || 0), 0),
    [filteredExpenses],
  );

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
          {/* Ten blocks used to render before the expense list, four of them
              restating each other (net profit twice, top category twice, top
              vendor twice). Revenue and profit now live on Overview only;
              everything analytical moved into one collapsed section below the
              list. See docs/audits/expenses-module-audit.md §5. */}
          <ExpenseSearchBar
            search={expenseSearch}
            onSearchChange={setExpenseSearch}
            onOpenFilters={() => money.openModal('filters')}
            onOpenExport={() => money.openModal('export')}
          />
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {([
              { id: 'today', label: 'Today' },
              { id: 'week', label: 'This week' },
              { id: 'month', label: 'This month' },
              { id: 'all', label: 'All time' },
            ] as const).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setDateRange(r.id)}
                className={`flex-none rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                  dateRange === r.id
                    ? 'bg-foreground text-background'
                    : 'border border-border bg-card text-muted-foreground'
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          {/* Understand the story, then inspect the transactions. This
              searches the whole history, not just the month the list has
              loaded — see docs/audits/expenses-module-audit.md. */}
          <div className="flex items-baseline justify-between gap-3 px-0.5">
            <span className="font-display text-[15px] font-extrabold tabular-nums text-foreground">
              ₹{filteredTotal.toLocaleString('en-IN')}
            </span>
            <span className="text-[11.5px] text-muted-foreground">
              {filteredExpenses.length} expense{filteredExpenses.length === 1 ? '' : 's'}
              {dateRange === 'all' ? '' : dateRange === 'today' ? ' today' : dateRange === 'week' ? ' this week' : ' this month'}
            </span>
          </div>
          <ExpenseSearchSummary
            search={expenseSearch}
            from={rangeBounds?.from.toISOString().slice(0, 10)}
            to={rangeBounds?.to.toISOString().slice(0, 10)}
          />
          <CategoryChipsRow categoryBreakdown={real.categoryBreakdown} />
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {expenseSearch.trim() ? 'Matching' : 'Expenses'}
              {dateRange === 'all' ? '' : dateRange === 'today' ? ' today' : dateRange === 'week' ? ' this week' : ' this month'}
              {' · '}
              {filteredExpenses.length}
            </span>
            {filteredExpenses.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {expenseSearch.trim() || expenseFilters.status !== 'All Status' || expenseFilters.paymentMethod
                  ? 'No expenses in this range match the current search or filters.'
                  : 'No expenses logged in this range yet.'}
              </p>
            ) : (
              filteredExpenses.map((e) => <ExpenseRow key={e.id} expense={e} onOpenDetail={() => money.openExpenseDetail(e)} />)
            )}
          </div>
          <WhereItWentSection
            totalExpenses={real.totalExpenses}
            categoryBreakdown={real.categoryBreakdown}
            vendorTotals={real.vendorTotals}
            largestExpense={real.largestExpense}
            anomalyCategory={real.anomalyCategory}
            monthlyTrend={real.monthlyTrend}
          />
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
