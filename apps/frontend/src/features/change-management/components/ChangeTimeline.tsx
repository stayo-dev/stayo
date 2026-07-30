import { formatDistanceToNow } from 'date-fns';
import { ChangeStatusBadge } from './ChangeStatusBadge';
import { getChangeTypeLabel } from '../constants/statuses';
import { ChevronRight } from 'lucide-react';
import type { ChangeRequestSummary } from '../api';

interface ChangeTimelineProps {
  changes: ChangeRequestSummary[];
  onViewAll?: () => void;
  onViewDetail?: (id: string) => void;
  className?: string;
}

/**
 * Recent Changes timeline shown at the bottom of the tenant profile.
 * Shows the last 5 change events with status badges.
 */
export function ChangeTimeline({
  changes,
  onViewAll,
  onViewDetail,
  className = '',
}: ChangeTimelineProps) {
  if (changes.length === 0) {
    return (
      <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>
        <p className="text-xs font-bold text-foreground mb-3">Recent Changes</p>
        <p className="text-xs text-muted-foreground text-center py-4">
          No changes have been made yet.
        </p>
      </div>
    );
  }

  return (
    <div className={`rounded-xl border border-border bg-card p-4 ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-bold text-foreground">Recent Changes</p>
        {onViewAll && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-[10px] font-bold text-accent hover:text-accent/80 flex items-center gap-0.5 transition-colors"
          >
            View full history
            <ChevronRight className="w-3 h-3" />
          </button>
        )}
      </div>

      <div className="space-y-0">
        {changes.map((change, index) => {
          const timeAgo = formatDistanceToNow(new Date(change.requested_at), { addSuffix: true });
          const isLast = index === changes.length - 1;

          return (
            <div
              key={change.id}
              className="flex items-start gap-3 relative cursor-pointer hover:bg-secondary/30 rounded-lg p-2 -mx-2 transition-colors"
              onClick={() => onViewDetail?.(change.id)}
            >
              {/* Timeline dot and line */}
              <div className="flex flex-col items-center shrink-0 pt-0.5">
                <div className={`w-2 h-2 rounded-full shrink-0 ${
                  change.status === 'PENDING'
                    ? 'bg-amber-500'
                    : change.status === 'APPLIED'
                    ? 'bg-emerald-500'
                    : change.status === 'REJECTED'
                    ? 'bg-rose-500'
                    : 'bg-zinc-300 dark:bg-zinc-600'
                }`} />
                {!isLast && (
                  <div className="w-px h-full bg-border min-h-[24px] mt-1" />
                )}
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pb-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-foreground truncate">
                    {getChangeTypeLabel(change.change_type)}
                  </p>
                  <ChangeStatusBadge status={change.status} size="sm" />
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
