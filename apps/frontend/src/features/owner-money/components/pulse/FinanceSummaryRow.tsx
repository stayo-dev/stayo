import { Download } from 'lucide-react';

/**
 * The Overview tab's export.
 *
 * Overview is the combined picture — money in, money out — so the export that
 * belongs here is the combined one. It sits at the bottom of the stack because
 * it is the thing an owner does after reading the cards, not before.
 */
export function FinanceSummaryRow({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-2xl border border-border bg-card px-3.5 py-3 text-left shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]"
    >
      <span className="flex h-9 w-9 flex-none items-center justify-center rounded-xl bg-secondary/60">
        <Download className="h-4 w-4 text-primary" strokeWidth={1.8} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[13.5px] font-bold text-foreground">Finance summary</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">
          Rent received, expenses and what's left — month by month
        </span>
      </span>
    </button>
  );
}
