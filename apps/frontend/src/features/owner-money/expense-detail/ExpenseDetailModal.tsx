import { useMutation, useQueryClient } from '@tanstack/react-query';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import type { MockExpense } from '@shared/mocks/expenses';
import { expenseService } from '@features/expenses/api';
import { queryKeys } from '@lib/queryKeys';

type ExpenseWithMeta = MockExpense & { addedBy?: string | null };

interface ExpenseDetailModalProps {
  open: boolean;
  expense: ExpenseWithMeta | null;
  onClose: () => void;
  onEdit: (expense: MockExpense) => void;
  onDuplicate: (expense: MockExpense) => void;
}

const row = 'flex justify-between border-b border-border/60 px-4 py-3 last:border-none';

/** Expense Detail bottom sheet, per Stayo App.dc.html. Edit/Duplicate open the real Add-Expense wizard (create or update); Mark Pending/Delete call the real `expenseService` directly. */
export function ExpenseDetailModal({ open, expense, onClose, onEdit, onDuplicate }: ExpenseDetailModalProps) {
  const queryClient = useQueryClient();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['owner', 'expenses'] });
    queryClient.invalidateQueries({ queryKey: queryKeys.portfolio.all() });
  };

  const markPendingMutation = useMutation({
    mutationFn: (id: string) => expenseService.update(id, { status: 'pending' }),
    onSuccess: () => {
      invalidate();
      stayoToast.success('Marked as pending');
      onClose();
    },
    onError: () => stayoToast.error('Could not update the expense'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => expenseService.delete(id),
    onSuccess: () => {
      invalidate();
      stayoToast.success('Expense deleted');
      onClose();
    },
    onError: () => stayoToast.error('Could not delete the expense'),
  });

  if (!expense) return null;

  const busy = markPendingMutation.isPending || deleteMutation.isPending;

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={
        <span className="flex flex-col gap-1">
          <span className="text-[10.5px] font-bold uppercase tracking-wide text-muted-foreground">Expense details</span>
          <span>{expense.title}</span>
          <span className="font-display text-lg font-extrabold tabular-nums text-primary">₹{expense.amount.toLocaleString('en-IN')}</span>
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="overflow-hidden rounded-2xl border border-border bg-card">
          <div className={row}>
            <span className="text-[12.5px] text-muted-foreground">Category</span>
            <span className="text-[12.5px] font-bold text-foreground">{expense.category}</span>
          </div>
          <div className={row}>
            <span className="text-[12.5px] text-muted-foreground">Status</span>
            <span className="text-[12.5px] font-bold uppercase text-success">{expense.status}</span>
          </div>
          <div className={row}>
            <span className="text-[12.5px] text-muted-foreground">Payment</span>
            <span className="text-[12.5px] font-bold text-foreground">{expense.paymentMethod}</span>
          </div>
          <div className={row}>
            <span className="text-[12.5px] text-muted-foreground">Date</span>
            <span className="text-[12.5px] font-bold text-foreground">{new Date(expense.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
          </div>
          <div className={row}>
            <span className="text-[12.5px] text-muted-foreground">Vendor</span>
            <span className="text-[12.5px] font-bold text-foreground">{expense.vendor}</span>
          </div>
          <div className={row}>
            <span className="text-[12.5px] text-muted-foreground">Recorded by</span>
            <span className="text-[12.5px] font-bold text-foreground">{expense.addedBy || 'Not recorded'}</span>
          </div>
        </div>
        {expense.notes && <p className="text-[12px] leading-relaxed text-muted-foreground">{expense.notes}</p>}
        <div className="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={() => onEdit(expense)}
            disabled={busy}
            className="rounded-xl bg-primary py-3 text-center font-display text-[13px] font-bold text-primary-foreground disabled:opacity-50"
          >
            Edit
          </button>
          <button
            type="button"
            onClick={() => onDuplicate(expense)}
            disabled={busy}
            className="rounded-xl bg-secondary py-3 text-center font-display text-[13px] font-bold text-primary disabled:opacity-50"
          >
            Duplicate
          </button>
          <button
            type="button"
            onClick={() => markPendingMutation.mutate(expense.id)}
            disabled={busy || expense.status === 'Pending'}
            className="rounded-xl bg-secondary py-3 text-center font-display text-[13px] font-bold text-primary disabled:opacity-50"
          >
            {markPendingMutation.isPending ? 'Updating…' : 'Mark Pending'}
          </button>
          <button
            type="button"
            onClick={() => {
              if (window.confirm(`Delete "${expense.title}"? This can't be undone.`)) deleteMutation.mutate(expense.id);
            }}
            disabled={busy}
            className="rounded-xl bg-destructive/10 py-3 text-center font-display text-[13px] font-bold text-destructive disabled:opacity-50"
          >
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
