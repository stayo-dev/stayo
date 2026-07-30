import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { PAYMENT_METHOD_OPTIONS } from '@shared/mocks/expenses';
import type { AddExpenseData } from '../../types';

interface FinancialStepProps {
  data: AddExpenseData;
  setD: (patch: Partial<AddExpenseData>) => void;
}

const labelStyle = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';

/** Step 2/3 of Add Expense — amount, date, collapsible Financial Details, per Stayo App.dc.html. */
export function FinancialStep({ data, setD }: FinancialStepProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <div className="flex flex-col gap-5">
      <label className="block">
        <span className={labelStyle}>Amount</span>
        <div className="flex items-center rounded-2xl border-[1.5px] border-border bg-card px-4 py-4">
          <span className="text-xl font-bold text-muted-foreground">₹</span>
          <input
            value={data.amount}
            onChange={(e) => setD({ amount: e.target.value.replace(/[^0-9]/g, '') })}
            placeholder="Amount"
            inputMode="numeric"
            className="min-w-0 flex-1 bg-transparent px-2 font-display text-xl font-extrabold text-foreground focus:outline-none"
          />
        </div>
      </label>

      <label className="block">
        <span className={labelStyle}>Date</span>
        <input
          type="date"
          value={data.date}
          onChange={(e) => setD({ date: e.target.value })}
          className="w-full rounded-2xl border-[1.5px] border-border bg-card px-4 py-4 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
        />
      </label>

      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        <button type="button" onClick={() => setDetailsOpen((v) => !v)} className="flex w-full items-center justify-between px-4 py-3.5">
          <span className="font-display text-[13.5px] font-bold text-foreground">Financial Details</span>
          <span className="flex items-center gap-1 text-[11.5px] text-muted-foreground">
            {data.status}
            {detailsOpen ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </span>
        </button>
        {detailsOpen && (
          <div className="flex flex-col gap-3.5 border-t border-border p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className={labelStyle}>Status</span>
                <select
                  value={data.status}
                  onChange={(e) => setD({ status: e.target.value as AddExpenseData['status'] })}
                  className="w-full rounded-xl border border-border bg-card px-3 py-3 text-[13px] font-semibold text-foreground focus:outline-none"
                >
                  <option value="Paid">Paid</option>
                  <option value="Pending">Pending</option>
                  <option value="Partially Paid">Partially Paid</option>
                </select>
              </label>
              <label className="block">
                <span className={labelStyle}>Vendor</span>
                <input
                  value={data.vendor}
                  onChange={(e) => setD({ vendor: e.target.value })}
                  placeholder="e.g. milk supplier"
                  className="w-full rounded-xl border border-border bg-card px-3 py-3 text-[13px] font-medium text-foreground focus:outline-none"
                />
              </label>
            </div>
            <div>
              <span className={labelStyle}>
                Payment method <span className="font-medium normal-case text-muted-foreground/70">(optional)</span>
              </span>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {PAYMENT_METHOD_OPTIONS.map((m) => {
                  const active = data.paymentMethod === m;
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setD({ paymentMethod: active ? '' : m })}
                      className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${active ? 'bg-primary text-primary-foreground' : 'border border-border bg-card text-muted-foreground'}`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
