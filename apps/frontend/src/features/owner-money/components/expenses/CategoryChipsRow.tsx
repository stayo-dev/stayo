import { EXPENSE_CATEGORIES } from '@shared/mocks/expenses';

interface CategoryChipsRowProps {
  categoryBreakdown: { category: string; amount: number; percent: number }[];
}

/** Horizontally-scrolling per-category spend chips, per Stayo App.dc.html. */
export function CategoryChipsRow({ categoryBreakdown }: CategoryChipsRowProps) {
  const byCategory = new Map(categoryBreakdown.map((c) => [c.category, c]));

  return (
    <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 sm:-mx-6 sm:px-6">
      {EXPENSE_CATEGORIES.map((cat) => {
        const row = byCategory.get(cat.name);
        return (
          <div key={cat.id} className="flex min-w-[104px] flex-none flex-col gap-0.5 rounded-2xl border border-border bg-card p-2.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
            <span className="font-display text-[10px] font-bold text-primary">{cat.chip}</span>
            <span className="font-display text-[11.5px] font-bold text-foreground">{cat.name}</span>
            <span className="text-[10px] font-medium text-muted-foreground">{row ? `₹${row.amount.toLocaleString('en-IN')} · ${row.percent}%` : 'No spend'}</span>
          </div>
        );
      })}
    </div>
  );
}
