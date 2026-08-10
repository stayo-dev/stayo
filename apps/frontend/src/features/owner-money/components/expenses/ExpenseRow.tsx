import type { MockExpense } from '@shared/mocks/expenses';
import { Building2, Building } from 'lucide-react';

const STATUS_TONE: Record<MockExpense['status'], string> = {
  Paid: 'bg-success/10 text-success',
  Pending: 'bg-warning/10 text-warning',
  'Partially Paid': 'bg-warning/10 text-warning',
};

interface ExpenseRowProps {
  expense: MockExpense & { hostelName?: string; expenseScope?: string };
  onOpenDetail: () => void;
}

/** Recent-expenses list row, per Stayo App.dc.html. */
export function ExpenseRow({ expense, onOpenDetail }: ExpenseRowProps) {
  const isHostelScoped = Boolean(expense.hostelId) || expense.expenseScope === 'HOSTEL';
  const scopeLabel = isHostelScoped ? (expense.hostelName || 'Hostel') : 'Business Overall';

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="inline-block rounded-md bg-secondary px-1.5 py-0.5 text-[10px] font-bold text-primary">{expense.category}</span>
          <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${isHostelScoped ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground'}`}>
            {isHostelScoped ? <Building className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
            {scopeLabel}
          </span>
        </div>
        <div className="mt-1 text-[13.5px] font-semibold text-foreground">{expense.title}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">
          {expense.vendor ? `${expense.vendor} · ` : ''}{new Date(expense.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
        </div>
      </div>
      <div className="flex flex-none flex-col items-end gap-1">
        <span className="font-display text-sm font-bold tabular-nums text-foreground">₹{expense.amount.toLocaleString('en-IN')}</span>
        <span className={`rounded-md px-1.5 py-0.5 text-[9.5px] font-bold ${STATUS_TONE[expense.status]}`}>{expense.status}</span>
      </div>
      <button type="button" onClick={onOpenDetail} aria-label="More" className="flex-none px-1 text-lg text-muted-foreground">
        ⋯
      </button>
    </div>
  );
}
