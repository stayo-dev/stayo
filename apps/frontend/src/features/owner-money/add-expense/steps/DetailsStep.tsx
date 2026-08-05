import { CalendarClock, History, Store, Repeat2 } from 'lucide-react';
import { EXPENSE_CATEGORIES } from '@shared/mocks/expenses';
import { cn } from '@shared/lib/cn';
import type { AddExpenseData } from '../../types';
import { useExpenseMemory, applyMemory, type MemoryEntry } from '../useExpenseMemory';

interface DetailsStepProps {
  data: AddExpenseData;
  setD: (patch: Partial<AddExpenseData>) => void;
  /** Jump straight to the amount once a remembered expense is reused. */
  onReused?: () => void;
}

function MemoryRow({ entry, onUse }: { entry: MemoryEntry; onUse: () => void }) {
  const Icon = entry.kind === 'VENDOR' ? Store : History;
  return (
    <button
      type="button"
      onClick={onUse}
      className={cn(
        'flex w-full items-center gap-3 rounded-2xl border p-3 text-left transition-colors active:bg-muted',
        entry.dueAroundNow ? 'border-primary/40 bg-secondary/40' : 'border-border bg-card',
      )}
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-secondary">
        <Icon className="h-4 w-4 text-primary" strokeWidth={2} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-display text-[13.5px] font-bold text-foreground">{entry.key}</span>
          {entry.dueAroundNow && (
            <span className="flex flex-none items-center gap-1 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9.5px] font-bold text-primary">
              <CalendarClock className="h-2.5 w-2.5" strokeWidth={2.5} />
              Usually now
            </span>
          )}
        </span>
        <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{entry.summaryLine}</span>
        {(entry.vendorName || entry.category) && (
          <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">
            {[entry.vendorName, entry.category, entry.paymentMethod].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      <span className="flex flex-none items-center gap-1 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-bold text-primary-foreground">
        <Repeat2 className="h-3 w-3" strokeWidth={2.5} />
        Reuse
      </span>
    </button>
  );
}

/**
 * Step 1/3 of Add Expense — now backed by expense memory (ADR-047).
 *
 * The wizard itself is unchanged; what changed is that this step no longer
 * starts from an empty form. The owner's most-recorded expenses appear before
 * they type anything, narrow as they type (matching both what was bought and
 * who supplied it), and one tap reuses everything they supplied last time —
 * leaving only the amount to check.
 *
 * The previous copy already promised "Suggestions come from your past
 * entries" and nothing delivered it: `getFrequentExpenses`/`getExpenseTitleSummary`
 * existed end-to-end on the backend *and* had frontend wrappers, with no
 * caller anywhere in the app.
 */
export function DetailsStep({ data, setD, onReused }: DetailsStepProps) {
  const { entries, isLoading } = useExpenseMemory(data.title);

  const use = (entry: MemoryEntry) => {
    setD(applyMemory(entry));
    onReused?.();
  };

  const heading = data.title.trim() ? 'From your history' : 'You record these often';

  return (
    <div className="flex flex-col gap-5">
      <label className="block">
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
          What&apos;s this expense?
        </span>
        <input
          value={data.title}
          onChange={(e) => setD({ title: e.target.value })}
          placeholder="e.g. Rice purchase, Electricity bill, Staff salary"
          className="w-full rounded-2xl border-[1.5px] border-border bg-card px-4 py-4 text-[15px] font-semibold text-foreground focus:border-primary focus:outline-none"
        />
      </label>

      {(entries.length > 0 || isLoading) && (
        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{heading}</span>
          {isLoading && entries.length === 0 ? (
            <div className="flex flex-col gap-2">
              {[0, 1].map((i) => (
                <div key={i} className="h-[70px] animate-pulse rounded-2xl bg-muted" />
              ))}
            </div>
          ) : (
            entries.map((entry) => (
              <MemoryRow key={`${entry.kind}-${entry.key}`} entry={entry} onUse={() => use(entry)} />
            ))
          )}
        </div>
      )}

      <div>
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">Category</span>
        <div className="grid grid-cols-3 gap-2.5">
          {EXPENSE_CATEGORIES.map((c) => {
            const active = data.category === c.name;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => setD({ category: c.name })}
                className={`flex flex-col items-center gap-1.5 rounded-2xl border-[1.5px] p-3 text-center ${
                  active ? 'border-primary bg-secondary/50' : 'border-border bg-card'
                }`}
              >
                <span className="text-xl">{c.icon}</span>
                <span className="text-[11px] font-semibold leading-tight text-foreground">{c.name}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
