import { Check, RotateCcw } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { PAYMENT_METHOD_OPTIONS } from '@shared/mocks/expenses';
import { cn } from '@shared/lib/cn';
import type { ExpenseFilterState } from '../types';
import { EMPTY_EXPENSE_FILTERS } from '../types';

interface ExpenseFiltersModalProps {
  open: boolean;
  filters: ExpenseFilterState;
  onChange: (patch: Partial<ExpenseFilterState>) => void;
  onApply: () => void;
  onClose: () => void;
  /** The owner's real vendors, most-used first. */
  vendors?: string[];
  /** How many expenses the current selection matches, live. */
  resultCount?: number;
}

const sectionLabel = 'mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';

const STATUS_OPTIONS: ExpenseFilterState['status'][] = ['All Status', 'Paid', 'Pending', 'Partially Paid'];
const SORT_OPTIONS: { value: ExpenseFilterState['sort']; label: string }[] = [
  { value: 'Recent', label: 'Newest' },
  { value: 'Oldest', label: 'Oldest' },
  { value: 'Amount: High to low', label: 'Largest' },
  { value: 'Amount: Low to high', label: 'Smallest' },
];
const RECURRING_OPTIONS: { value: ExpenseFilterState['recurring']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'one-time', label: 'One-time' },
];

/** Count of filters actually narrowing the list — sort is not a filter. */
export function activeFilterCount(f: ExpenseFilterState): number {
  let n = 0;
  if (f.status !== 'All Status') n += 1;
  if (f.paymentMethod) n += 1;
  if (f.vendor) n += 1;
  if (f.recurring !== 'all') n += 1;
  if (f.amountMin || f.amountMax) n += 1;
  if (f.startDate || f.endDate) n += 1;
  return n;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // 38px min height keeps every option a comfortable thumb target.
      className={cn(
        'flex min-h-[38px] items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-colors',
        active
          ? 'bg-primary text-primary-foreground'
          : 'border border-border bg-card text-muted-foreground active:bg-muted',
      )}
    >
      {active && <Check className="h-3 w-3 flex-none" strokeWidth={3} />}
      {children}
    </button>
  );
}

/**
 * Expense filters.
 *
 * Refined after the module audit. Four things were wrong:
 *
 * 1. **Vendor was theatre** — non-interactive `<span>`s populated from mock
 *    fixtures, for a field that didn't exist in `ExpenseFilterState`. It
 *    listed suppliers the owner had never used and did nothing when tapped.
 *    Now real vendors, ordered by how much the owner actually spends with
 *    them, and it filters.
 * 2. **Two interaction models in one sheet** — native `<select>` for status
 *    and sort (which opens an OS picker) beside one-tap chips for everything
 *    else. All chips now.
 * 3. **No way to see or clear what's applied.** There is now a count in the
 *    header and a Clear all.
 * 4. **"Apply filters" was a lie** — filters apply as you tap them; the
 *    button only closed the sheet. It now says what it does and previews the
 *    result, so the owner knows what they're getting before committing.
 *
 * Sort is visually separated from the filters, because ordering a list and
 * narrowing it are different acts.
 */
export function ExpenseFiltersModal({
  open,
  filters,
  onChange,
  onApply,
  onClose,
  vendors = [],
  resultCount,
}: ExpenseFiltersModalProps) {
  const activeCount = activeFilterCount(filters);

  const clearAll = () =>
    onChange({
      status: EMPTY_EXPENSE_FILTERS.status,
      paymentMethod: null,
      vendor: null,
      recurring: 'all',
      amountMin: '',
      amountMax: '',
      startDate: '',
      endDate: '',
    });

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex items-center gap-2">
          Filters
          {activeCount > 0 && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-bold text-primary">
              {activeCount}
            </span>
          )}
        </span>
      }
      footer={
        <button
          type="button"
          onClick={onApply}
          className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground"
        >
          {typeof resultCount === 'number'
            ? `Show ${resultCount} expense${resultCount === 1 ? '' : 's'}`
            : 'Done'}
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        {activeCount > 0 && (
          <button
            type="button"
            onClick={clearAll}
            className="flex items-center gap-1.5 self-start text-[12px] font-semibold text-primary"
          >
            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2.2} />
            Clear all filters
          </button>
        )}

        <div>
          <span className={sectionLabel}>Status</span>
          <div className="flex flex-wrap gap-2">
            {STATUS_OPTIONS.map((s) => (
              <Chip key={s} active={filters.status === s} onClick={() => onChange({ status: s })}>
                {s === 'All Status' ? 'All' : s}
              </Chip>
            ))}
          </div>
        </div>

        {vendors.length > 0 && (
          <div>
            <span className={sectionLabel}>Vendor</span>
            <div className="flex flex-wrap gap-2">
              {vendors.map((v) => {
                const active = filters.vendor === v;
                return (
                  <Chip key={v} active={active} onClick={() => onChange({ vendor: active ? null : v })}>
                    {v}
                  </Chip>
                );
              })}
            </div>
          </div>
        )}

        <div>
          <span className={sectionLabel}>Payment method</span>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHOD_OPTIONS.map((m) => {
              const active = filters.paymentMethod === m;
              return (
                <Chip key={m} active={active} onClick={() => onChange({ paymentMethod: active ? null : m })}>
                  {m}
                </Chip>
              );
            })}
          </div>
        </div>

        <div>
          <span className={sectionLabel}>Recurring</span>
          <div className="flex flex-wrap gap-2">
            {RECURRING_OPTIONS.map((r) => (
              <Chip key={r.value} active={filters.recurring === r.value} onClick={() => onChange({ recurring: r.value })}>
                {r.label}
              </Chip>
            ))}
          </div>
        </div>

        <div>
          <span className={sectionLabel}>Amount range</span>
          <div className="flex items-center gap-2.5">
            <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-border bg-card px-3 py-3">
              <span className="flex-none text-[13px] font-semibold text-muted-foreground">₹</span>
              <input
                value={filters.amountMin}
                onChange={(e) => onChange({ amountMin: e.target.value.replace(/[^0-9]/g, '') })}
                placeholder="Min"
                inputMode="numeric"
                aria-label="Minimum amount"
                className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none"
              />
            </div>
            <span className="flex-none text-xs text-muted-foreground">to</span>
            <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl border border-border bg-card px-3 py-3">
              <span className="flex-none text-[13px] font-semibold text-muted-foreground">₹</span>
              <input
                value={filters.amountMax}
                onChange={(e) => onChange({ amountMax: e.target.value.replace(/[^0-9]/g, '') })}
                placeholder="Max"
                inputMode="numeric"
                aria-label="Maximum amount"
                className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none"
              />
            </div>
          </div>
        </div>

        <div>
          <span className={sectionLabel}>Date / Time Range</span>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">Start date & time</span>
              <input
                type="datetime-local"
                value={filters.startDate}
                onChange={(e) => onChange({ startDate: e.target.value })}
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <span className="text-[11px] font-medium text-muted-foreground">End date & time</span>
              <input
                type="datetime-local"
                value={filters.endDate}
                onChange={(e) => onChange({ endDate: e.target.value })}
                className="w-full rounded-xl border border-border bg-card px-3 py-2.5 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>
        </div>

        {/* Ordering a list and narrowing it are different acts, so sort sits
            below a divider rather than among the filters. */}
        <div className="border-t border-border/60 pt-5">
          <span className={sectionLabel}>Sort by</span>
          <div className="flex flex-wrap gap-2">
            {SORT_OPTIONS.map((s) => (
              <Chip key={s.value} active={filters.sort === s.value} onClick={() => onChange({ sort: s.value })}>
                {s.label}
              </Chip>
            ))}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
