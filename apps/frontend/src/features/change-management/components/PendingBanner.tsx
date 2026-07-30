import { Clock, ChevronRight } from 'lucide-react';

interface PendingBannerProps {
  pendingCount: number;
  onViewAll?: () => void;
  className?: string;
}

/**
 * "Awaiting Tenant Approval" banner for the tenant profile header.
 * Only renders when pendingCount > 0.
 * Communicates state, not action — the owner can't approve here.
 */
export function PendingBanner({
  pendingCount,
  onViewAll,
  className = '',
}: PendingBannerProps) {
  if (pendingCount <= 0) return null;

  return (
    <div
      className={`flex items-center justify-between gap-3 px-4 py-3 rounded-xl border border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-950/30 ${className}`}
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center shrink-0">
          <Clock className="w-4 h-4 text-amber-600 dark:text-amber-400" />
        </div>
        <div className="min-w-0">
          <p className="text-xs font-bold text-amber-900 dark:text-amber-200">
            Awaiting Tenant Approval
          </p>
          <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-0.5">
            {pendingCount} {pendingCount === 1 ? 'change request' : 'change requests'} pending
          </p>
        </div>
      </div>

      {onViewAll && (
        <button
          type="button"
          onClick={onViewAll}
          className="shrink-0 flex items-center gap-1 text-xs font-bold text-amber-700 dark:text-amber-300 hover:text-amber-900 dark:hover:text-amber-100 transition-colors"
        >
          View
          <ChevronRight className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
