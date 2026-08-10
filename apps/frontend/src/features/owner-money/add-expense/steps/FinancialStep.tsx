import { Check, TrendingUp, TrendingDown, ChevronDown } from 'lucide-react';
import { PAYMENT_METHOD_OPTIONS } from '@shared/mocks/expenses';
import type { AddExpenseData } from '../../types';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useExpenseMemory } from '../useExpenseMemory';
import { priceChange } from '../priceChange';
import { cn } from '@shared/lib/cn';

interface FinancialStepProps {
  data: AddExpenseData;
  setD: (patch: Partial<AddExpenseData>) => void;
}

const labelStyle = 'mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground';

/**
 * Step 2/3 of Add Expense — "How much?"
 *
 * Redesigned:
 * - Context header shows what was selected in step 1 (title · vendor · category)
 * - Payment method surfaced as visible pill selector (pre-selected from memory)
 * - Compact visible status control (defaults Paid, always changeable)
 * - Hostel picker explicit for multi-hostel owners
 * - Vendor removed (already resolved in step 1)
 * - "Financial Details" collapsible removed — its contents are now individual controls
 */
export function FinancialStep({ data, setD }: FinancialStepProps) {
  const session = useOwnerSession();
  const hostels = session.hostels ?? [];

  // Compare what they're typing against what they've actually paid before for
  // this exact thing. Historical only — no prediction, no AI. Silent unless
  // there is real history and a real difference (ADR-047).
  const { entries } = useExpenseMemory(data.title);
  const match = entries.find(
    (e) => e.key.trim().toLowerCase() === data.title.trim().toLowerCase(),
  );
  const priceNote =
    match && Number(data.amount) > 0
      ? priceChange(Number(data.amount), match.occurrences, match.averageAmount)
      : null;

  return (
    <div className="flex flex-col gap-5">
      {/* Context header — confirms what was selected in step 1 */}
      {data.title && (
        <div className="flex flex-col gap-0.5 rounded-xl border border-border bg-secondary/30 px-3.5 py-2.5">
          <span className="font-display text-[13.5px] font-bold text-foreground">
            {data.title}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {[data.vendor, data.category].filter(Boolean).join(' · ')}
          </span>
        </div>
      )}

      {/* Which property this cost belongs to. Only shown when there is an
          actual choice to make — multi-hostel owners must never accidentally
          record against the wrong hostel. */}
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

      {/* Price comparison note */}
      {priceNote && (
        <div
          className={`flex items-start gap-2 rounded-xl border px-3.5 py-2.5 ${
            priceNote.direction === 'up'
              ? 'border-warning/30 bg-warning/10'
              : 'border-success/30 bg-success/10'
          }`}
        >
          {priceNote.direction === 'up' ? (
            <TrendingUp className="mt-0.5 h-3.5 w-3.5 flex-none text-warning" strokeWidth={2.2} />
          ) : (
            <TrendingDown className="mt-0.5 h-3.5 w-3.5 flex-none text-success" strokeWidth={2.2} />
          )}
          <span className="text-[11.5px] leading-relaxed text-foreground">{priceNote.message}</span>
        </div>
      )}

      {/* Amount */}
      <label className="block">
        <span className={labelStyle}>Amount</span>
        <div className="flex items-center rounded-2xl border-[1.5px] border-border bg-card px-4 py-4">
          <span className="text-xl font-bold text-muted-foreground">₹</span>
          <input
            value={data.amount}
            onChange={(e) => setD({ amount: e.target.value.replace(/[^0-9]/g, '') })}
            placeholder="Amount"
            inputMode="numeric"
            autoFocus
            className="min-w-0 flex-1 bg-transparent px-2 font-display text-xl font-extrabold text-foreground focus:outline-none"
          />
        </div>
      </label>

      {/* Date */}
      <label className="block">
        <span className={labelStyle}>Date</span>
        <input
          type="date"
          value={data.date}
          onChange={(e) => setD({ date: e.target.value })}
          className="w-full rounded-2xl border-[1.5px] border-border bg-card px-4 py-4 text-sm font-semibold text-foreground focus:border-primary focus:outline-none"
        />
      </label>

      {/* Payment method — surfaced as visible pill selector */}
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

      {/* Status — compact visible control, defaults to Paid */}
      <div className="flex items-center justify-between">
        <span className={labelStyle + ' mb-0'}>Status</span>
        <div className="relative">
          <select
            value={data.status}
            onChange={(e) => setD({ status: e.target.value as AddExpenseData['status'] })}
            className={cn(
              'appearance-none rounded-lg border border-border bg-card py-1.5 pl-3 pr-7 text-[12.5px] font-bold text-foreground focus:outline-none',
              data.status === 'Paid' && 'text-success',
              data.status === 'Pending' && 'text-warning',
            )}
          >
            <option value="Paid">Paid</option>
            <option value="Pending">Pending</option>
            <option value="Partially Paid">Partially Paid</option>
          </select>
          <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        </div>
      </div>
    </div>
  );
}
