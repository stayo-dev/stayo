import type { ReactNode } from 'react';
import { cn } from '@shared/lib/cn';

export type StatusTone = 'success' | 'warning' | 'destructive' | 'info' | 'neutral';

const TONE_CLASSES: Record<StatusTone, string> = {
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  destructive: 'bg-destructive/10 text-destructive',
  info: 'bg-info/10 text-info',
  neutral: 'bg-muted text-muted-foreground',
};

interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
  /** Data pill (e.g. "Paid", "Overdue 3mo") vs. filter/segment pill — controls corner radius. */
  variant?: 'data' | 'filter';
  className?: string;
}

/**
 * Semantic status/filter pill — Paid/Overdue/Pending/Invited badges, filter
 * chips, module-status indicators. Confirmed recurring across every screen
 * in the design source, always from this same 5-tone semantic palette.
 */
export function StatusPill({ tone, children, variant = 'data', className }: StatusPillProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-1 text-xs font-bold',
        variant === 'data' ? 'rounded-md' : 'rounded-full',
        TONE_CLASSES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
