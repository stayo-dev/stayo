import { EXPENSE_CATEGORIES } from '@shared/mocks/expenses';
import type { AddExpenseData } from '../../types';

interface DetailsStepProps {
  data: AddExpenseData;
  setD: (patch: Partial<AddExpenseData>) => void;
}

/** Step 1/3 of Add Expense — title + category grid, per Stayo App.dc.html. */
export function DetailsStep({ data, setD }: DetailsStepProps) {
  return (
    <div className="flex flex-col gap-5">
      <label className="block">
        <span className="mb-2 block text-[11px] font-bold uppercase tracking-wide text-muted-foreground">What&apos;s this expense?</span>
        <input
          value={data.title}
          onChange={(e) => setD({ title: e.target.value })}
          placeholder="e.g. Rice purchase, Electricity bill, Staff salary"
          className="w-full rounded-2xl border-[1.5px] border-border bg-card px-4 py-4 text-[15px] font-semibold text-foreground focus:border-primary focus:outline-none"
        />
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">Suggestions come from your past entries.</p>
      </label>

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
