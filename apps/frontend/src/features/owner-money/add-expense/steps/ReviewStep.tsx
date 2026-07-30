import { useState } from 'react';
import { ChevronDown, ChevronUp, Image as ImageIcon } from 'lucide-react';
import type { AddExpenseData } from '../../types';

interface ReviewStepProps {
  data: AddExpenseData;
  setD: (patch: Partial<AddExpenseData>) => void;
}

/** Step 3/3 of Add Expense — review card, collapsible Receipt + Advanced options, per Stayo App.dc.html. */
export function ReviewStep({ data, setD }: ReviewStepProps) {
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-card p-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">
            {data.category || 'No category'} · {data.date}
          </span>
          <span className="font-display text-base font-bold text-foreground">{data.title || 'Untitled expense'}</span>
          <span className="font-display text-xl font-extrabold tabular-nums text-primary">₹{data.amount || '0'}</span>
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-border pt-2.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">Status</span>
            <span className="text-[12.5px] font-bold text-foreground">{data.status}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">Vendor</span>
            <span className="text-[12.5px] font-bold text-foreground">{data.vendor || '—'}</span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] text-muted-foreground">Payment method</span>
            <span className="text-[12.5px] font-bold text-foreground">{data.paymentMethod || '—'}</span>
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <button type="button" onClick={() => setReceiptOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3.5">
          <span className="font-display text-[13.5px] font-bold text-foreground">Receipt</span>
          <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
            None attached
            {receiptOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>
        {receiptOpen && (
          <div className="border-t border-border p-4">
            <button type="button" className="flex w-full items-center gap-3 rounded-xl border-[1.5px] border-dashed border-border bg-muted/50 p-4 text-left">
              <span className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-lg bg-secondary text-primary">
                <ImageIcon className="h-4 w-4" strokeWidth={1.9} />
              </span>
              <span className="flex flex-col gap-0.5">
                <span className="text-[12.5px] font-semibold text-foreground">Attach receipt image</span>
                <span className="text-[10.5px] text-muted-foreground">Optional · JPG, PNG or WEBP under 4MB</span>
              </span>
            </button>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <button type="button" onClick={() => setAdvancedOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3.5">
          <span className="font-display text-[13.5px] font-bold text-foreground">Advanced options</span>
          <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
            Optional
            {advancedOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>
        {advancedOpen && (
          <div className="flex flex-col gap-3.5 border-t border-border p-4">
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Notes</span>
              <textarea
                value={data.notes}
                onChange={(e) => setD({ notes: e.target.value })}
                placeholder="e.g. Monthly grocery stock purchase, no receipt available"
                className="min-h-[64px] w-full resize-none rounded-xl border border-border bg-card px-3.5 py-3 text-[13px] text-foreground focus:outline-none"
              />
            </label>
            <button type="button" onClick={() => setD({ recurring: !data.recurring })} className="flex items-center justify-between">
              <span className="text-[13px] font-semibold text-foreground">Recurring expense</span>
              <span className={`relative h-6 w-10.5 flex-none rounded-full transition-colors ${data.recurring ? 'bg-primary' : 'bg-muted'}`}>
                <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${data.recurring ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
