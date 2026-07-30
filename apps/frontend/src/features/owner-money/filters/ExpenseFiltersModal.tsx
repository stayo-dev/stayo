import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { PAYMENT_METHOD_OPTIONS, getExpenseInsights } from '@shared/mocks/expenses';
import type { ExpenseFilterState } from '../types';

interface ExpenseFiltersModalProps {
  open: boolean;
  filters: ExpenseFilterState;
  onChange: (patch: Partial<ExpenseFilterState>) => void;
  onApply: () => void;
  onClose: () => void;
}

const labelStyle = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';
const RECURRING_OPTIONS: { value: ExpenseFilterState['recurring']; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'one-time', label: 'One-time' },
];

/** Expense Filters bottom sheet, per Stayo App.dc.html. */
export function ExpenseFiltersModal({ open, filters, onChange, onApply, onClose }: ExpenseFiltersModalProps) {
  const { vendorTotals } = getExpenseInsights();

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Filters"
      footer={
        <button type="button" onClick={onApply} className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground">
          Apply filters
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        <label className="block">
          <span className={labelStyle}>Status</span>
          <select
            value={filters.status}
            onChange={(e) => onChange({ status: e.target.value as ExpenseFilterState['status'] })}
            className="w-full rounded-xl border-[1.5px] border-primary bg-card px-3.5 py-3 text-[13px] font-semibold text-foreground focus:outline-none"
          >
            <option value="All Status">All Status</option>
            <option value="Paid">Paid</option>
            <option value="Pending">Pending</option>
            <option value="Partially Paid">Partially Paid</option>
          </select>
        </label>

        <label className="block">
          <span className={labelStyle}>Sort</span>
          <select
            value={filters.sort}
            onChange={(e) => onChange({ sort: e.target.value as ExpenseFilterState['sort'] })}
            className="w-full rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] font-semibold text-foreground focus:outline-none"
          >
            <option value="Recent">Recent</option>
            <option value="Oldest">Oldest</option>
            <option value="Amount: High to low">Amount: High to low</option>
            <option value="Amount: Low to high">Amount: Low to high</option>
          </select>
        </label>

        <div>
          <span className={labelStyle}>Vendor</span>
          <div className="flex flex-wrap gap-2">
            {vendorTotals.map((v) => (
              <span key={v.vendor} className="rounded-full bg-muted px-3.5 py-1.5 text-xs font-semibold text-foreground/80">
                {v.vendor}
              </span>
            ))}
          </div>
        </div>

        <div>
          <span className={labelStyle}>Payment method</span>
          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHOD_OPTIONS.map((m) => {
              const active = filters.paymentMethod === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChange({ paymentMethod: active ? null : m })}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${active ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'}`}
                >
                  {m}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className={labelStyle}>Recurring</span>
          <div className="flex gap-2">
            {RECURRING_OPTIONS.map((r) => {
              const active = filters.recurring === r.value;
              return (
                <button
                  key={r.value}
                  type="button"
                  onClick={() => onChange({ recurring: r.value })}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${active ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'}`}
                >
                  {r.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <span className={labelStyle}>Amount range</span>
          <div className="flex items-center gap-2.5">
            <input
              value={filters.amountMin}
              onChange={(e) => onChange({ amountMin: e.target.value.replace(/[^0-9]/g, '') })}
              placeholder="Min"
              className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] text-foreground focus:outline-none"
            />
            <span className="text-xs text-muted-foreground">to</span>
            <input
              value={filters.amountMax}
              onChange={(e) => onChange({ amountMax: e.target.value.replace(/[^0-9]/g, '') })}
              placeholder="Max"
              className="min-w-0 flex-1 rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] text-foreground focus:outline-none"
            />
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
