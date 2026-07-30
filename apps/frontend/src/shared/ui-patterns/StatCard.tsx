import type { ReactNode } from 'react';
import { cn } from '@shared/lib/cn';

interface StatCardProps {
  label: string;
  value: ReactNode;
  caption?: ReactNode;
  className?: string;
  /**
   * The mockup uses two visually distinct tile styles sharing the same card
   * shell: `snapshot` (default — bold uppercase tracked label, larger value,
   * used by Home's Snapshot/Money's overview tiles) and `action` (sentence-case
   * regular-weight label, smaller value, used by Home's Action Center row).
   * Per Stayo App.dc.html — do not add a second component for this, vary via prop.
   */
  variant?: 'snapshot' | 'action';
}

/**
 * Label / value / caption stat tile — the most frequently repeated pattern
 * across the StayO product app (Home snapshot, Money overview, Config
 * dashboard, Hostel overview). Values use tabular-nums so columns of digits
 * align.
 */
export function StatCard({ label, value, caption, className, variant = 'snapshot' }: StatCardProps) {
  if (variant === 'action') {
    return (
      <div
        className={cn(
          'rounded-2xl border border-border bg-card px-3 py-[13px] shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]',
          className,
        )}
      >
        <p className="text-[10.5px] font-medium text-foreground/80">{label}</p>
        <p className="mt-1 font-display text-[19px] font-extrabold tabular-nums text-foreground">{value}</p>
        {caption != null && <p className="mt-0.5 text-[10px] text-[#9C9186]">{caption}</p>}
      </div>
    );
  }
  return (
    <div
      className={cn(
        'rounded-2xl border border-border bg-card px-3 py-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]',
        className,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.04em] text-[#9C9186]">{label}</p>
      <p className="mt-1 font-display text-[21px] font-extrabold tabular-nums text-foreground">{value}</p>
      {caption != null && <p className="mt-0.5 text-[11px] text-muted-foreground">{caption}</p>}
    </div>
  );
}
