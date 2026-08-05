import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { PAYMENT_METHOD_OPTIONS } from '@shared/mocks/expenses';
import type { AddExpenseData } from '../../types';
import { Check } from 'lucide-react';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';

interface FinancialStepProps {
  data: AddExpenseData;
  setD: (patch: Partial<AddExpenseData>) => void;
}

const labelStyle = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';

/** Step 2/3 of Add Expense — amount, date, collapsible Financial Details, per Stayo App.dc.html. */
export function FinancialStep({ data, setD }: FinancialStepProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const session = useOwnerSession();
  const hostels = session.hostels ?? [];

  return (
    <div className="flex flex-col gap-5">
      {/* Which property this cost belongs to. The client used to discard
          this and force every expense to business-wide scope, so
          multi-property owners could not compare properties — see
          docs/audits/expenses-module-audit.md. Only shown when there is an
          actual choice to make. */}
      {hostels.length > 1 && (
        <div>
          <span className={labelStyle}>Which property?</span>
          <div className="mt-2 flex flex-col gap-2">
            {hostels.map((h: { id: string; name: string }) => {
              const active = data.hostelId === h.id;
              return (
                <button
                  key={h.id}
                  type="button"
                  onClick={() => setD({ hostelId: h.id })}
                  className={`flex items-center justify-between rounded-xl border-[1.5px] px-4 py-3 text-left text-[13.5px] font-semibold ${
                    active ? 'border-primary bg-secondary/50 text-foreground' : 'border-border bg-card text-foreground/80'
                  }`}
                >
                  {h.name}
                  {active && <Check className="h-4 w-4 flex-none text-primary" strokeWidth={2.5} />}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setD({ hostelId: '' })}
              className={`flex items-center justify-between rounded-xl border-[1.5px] px-4 py-3 text-left text-[13.5px] font-semibold ${
                data.hostelId === ''
                  ? 'border-primary bg-secondary/50 text-foreground'
                  : 'border-border bg-card text-foreground/80'
              }`}
            >
              <span className="flex flex-col">
                Whole business
                <span className="text-[10.5px] font-normal text-muted-foreground">
                  Shared cost, not tied to one property
                </span>
              </span>
              {data.hostelId === '' && <Check className="h-4 w-4 flex-none text-primary" strokeWidth={2.5} />}
            </button>
          </div>
        </div>
      )}

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
