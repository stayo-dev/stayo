import type { ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@shared/lib/cn';

interface ListRowProps {
  leading?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  trailing?: ReactNode;
  showChevron?: boolean;
  onClick?: () => void;
  className?: string;
}

/**
 * Avatar/icon + 2-line title/meta + trailing status/amount/chevron — the
 * single most-repeated row shape across the design (tenants, expenses,
 * leads, settings rows, agreement templates, team members).
 */
export function ListRow({ leading, title, meta, trailing, showChevron, onClick, className }: ListRowProps) {
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-3 border-b border-border py-3 text-left last:border-b-0',
        onClick && 'cursor-pointer',
        className,
      )}
    >
      {leading && <div className="shrink-0">{leading}</div>}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-foreground">{title}</p>
        {meta != null && <p className="truncate text-xs text-muted-foreground">{meta}</p>}
      </div>
      {trailing != null && <div className="shrink-0 text-sm font-semibold text-foreground">{trailing}</div>}
      {showChevron && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </Comp>
  );
}
