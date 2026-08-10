import { useState } from 'react';
import { Upload, ChevronDown, ChevronUp, X, AlertCircle } from 'lucide-react';
import type { AddExpenseData } from '../../types';
import { cn } from '@shared/lib/cn';

interface ReviewStepProps {
  data: AddExpenseData;
  setD: (patch: Partial<AddExpenseData>) => void;
}

const labelStyle = 'text-[11px] font-bold uppercase tracking-wide text-muted-foreground';

/**
 * Step 3/3 — "Confirm & attach"
 *
 * Compact summary of the expense being recorded, with progressive disclosure
 * for receipt attachment and advanced options (notes, recurring).
 *
 * Status and vendor are already confirmed in earlier steps and don't repeat
 * here as separate controls — they appear in the review summary card only.
 */
export function ReviewStep({ data, setD }: ReviewStepProps) {
  const [advancedOpen, setAdvancedOpen] = useState(Boolean(data.notes || data.recurring));
  const amount = Number(data.amount) || 0;

  return (
    <div className="flex flex-col gap-4">
      {/* Review card — compact summary */}
      <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="font-display text-[15px] font-bold text-foreground">{data.title || '—'}</span>
          <span className="font-display text-lg font-extrabold text-foreground">
            ₹{amount.toLocaleString('en-IN')}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-muted-foreground">
          {data.vendor && <span>{data.vendor}</span>}
          {data.category && <span>{data.category}</span>}
          <span>{data.date}</span>
          {data.paymentMethod && <span>{data.paymentMethod}</span>}
          <span
            className={cn(
              'font-semibold',
              data.status === 'Paid' && 'text-success',
              data.status === 'Pending' && 'text-warning',
            )}
          >
            {data.status}
          </span>
        </div>
        {data.hostelId && (
          <span className="text-[11px] text-muted-foreground">Property-attributed</span>
        )}
      </div>

      {/* Receipt attachment — progressive disclosure */}
      {data.receiptFile ? (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-4 py-3">
          <div className="h-10 w-10 flex-none overflow-hidden rounded-lg bg-muted">
            <img
              src={URL.createObjectURL(data.receiptFile)}
              alt="Receipt preview"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-semibold text-foreground">
              {data.receiptFile.name}
            </span>
            <span className="block text-[10.5px] text-muted-foreground">
              {(data.receiptFile.size / 1024).toFixed(0)} KB
            </span>
          </div>
          <button
            type="button"
            onClick={() => setD({ receiptFile: null })}
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-border text-muted-foreground"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border px-4 py-3.5 text-[12.5px] font-semibold text-muted-foreground transition-colors active:bg-muted">
          <Upload className="h-3.5 w-3.5" strokeWidth={2} />
          Attach receipt · Optional
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0] ?? null;
              setD({ receiptFile: file });
            }}
          />
        </label>
      )}

      {/* Advanced options — notes, recurring */}
      <div className="rounded-xl border border-border">
        <button
          type="button"
          onClick={() => setAdvancedOpen(!advancedOpen)}
          className="flex w-full items-center justify-between px-4 py-3 text-[12px] font-bold text-muted-foreground"
        >
          Advanced options
          {advancedOpen ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
        {advancedOpen && (
          <div className="flex flex-col gap-4 border-t border-border px-4 py-4">
            <label className="block">
              <span className={labelStyle}>Notes</span>
              <textarea
                value={data.notes}
                onChange={(e) => setD({ notes: e.target.value })}
                placeholder="Add a note about this expense..."
                rows={2}
                className="mt-1.5 w-full rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] text-foreground focus:border-primary focus:outline-none"
              />
            </label>
            <label className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold text-foreground">Recurring expense?</span>
              <button
                type="button"
                onClick={() => setD({ recurring: !data.recurring })}
                className={cn(
                  'relative h-6 w-11 rounded-full transition-colors',
                  data.recurring ? 'bg-primary' : 'bg-muted',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform',
                    data.recurring ? 'translate-x-5' : 'translate-x-0.5',
                  )}
                />
              </button>
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
