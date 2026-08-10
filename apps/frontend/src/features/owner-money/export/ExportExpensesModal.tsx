import { useState } from 'react';
import { Check } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { expenseService } from '@features/expenses/api';
import type { ExpenseFilterState } from '../types';

const SCOPES = [
  { id: 'current', label: 'Current view', sub: 'Just what matches your filters now' },
  { id: 'month', label: 'This month', sub: 'Every expense logged this month' },
  { id: 'all', label: 'All time', sub: 'Every recorded expense' },
] as const;

interface ExportExpensesModalProps {
  open: boolean;
  onClose: () => void;
  filters: ExpenseFilterState;
  search: string;
}

/** Export Expenses bottom sheet — Excel only. Streams a real file from `GET /expenses/export` (`expenseService.export`) and triggers a browser download. */
export function ExportExpensesModal({ open, onClose, filters, search }: ExportExpensesModalProps) {
  const [scope, setScope] = useState<(typeof SCOPES)[number]['id']>('month');
  const [isExporting, setIsExporting] = useState(false);

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const params: Record<string, unknown> = { format: 'xlsx' };
      if (scope === 'current') {
        if (filters.status !== 'All Status') params.status = filters.status.toLowerCase().replace(' ', '_');
        if (filters.paymentMethod) params.payment_method = filters.paymentMethod;
        if (filters.recurring !== 'all') params.recurring = filters.recurring === 'recurring';
        if (filters.amountMin) params.amountMin = filters.amountMin;
        if (filters.amountMax) params.amountMax = filters.amountMax;
        if (filters.startDate) params.startDate = filters.startDate;
        if (filters.endDate) params.endDate = filters.endDate;
        if (search.trim()) params.search = search.trim();
      } else if (scope === 'all') {
        params.startDate = '2000-01-01';
        params.endDate = new Date().toISOString().slice(0, 10);
      }
      const { blob, filename } = await expenseService.export(params);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      stayoToast.success('Exported as Excel');
      onClose();
    } catch {
      stayoToast.error('Export failed. Please try again.');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title="Export expenses"
      footer={
        <button
          type="button"
          onClick={handleExport}
          disabled={isExporting}
          className="w-full rounded-xl bg-primary py-3.5 text-center font-display text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {isExporting ? 'Exporting…' : 'Export Excel'}
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        <div>
          <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Scope</span>
          <div className="flex flex-col gap-2">
            {SCOPES.map((s) => {
              const active = scope === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setScope(s.id)}
                  className={`flex items-center justify-between rounded-xl border-[1.5px] p-3.5 text-left ${active ? 'border-primary bg-secondary/40' : 'border-border bg-card'}`}
                >
                  <span className="flex flex-col gap-0.5">
                    <span className="font-display text-[13px] font-bold text-foreground">{s.label}</span>
                    <span className="text-[11px] text-muted-foreground">{s.sub}</span>
                  </span>
                  {active && <Check className="h-4 w-4 flex-none text-primary" strokeWidth={3} />}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </BottomSheet>
  );
}
