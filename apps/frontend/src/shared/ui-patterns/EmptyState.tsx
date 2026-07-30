import type { ReactNode } from 'react';
import { cn } from '@shared/lib/cn';

interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}

/**
 * Centered icon-in-tinted-square + headline + explainer + single terracotta
 * CTA — the identical structure confirmed for every empty state in the
 * design source (Food's "No menu yet"/"Nothing here yet", Tenants' "No
 * tenants yet", Discover's "No saved hostels").
 */
export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center gap-3 px-6 py-12 text-center', className)}>
      {icon && (
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          {icon}
        </div>
      )}
      <p className="font-display text-base font-bold text-foreground">{title}</p>
      {description && <p className="max-w-xs text-sm text-muted-foreground">{description}</p>}
      {action}
    </div>
  );
}
