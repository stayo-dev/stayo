import { cn } from '@/app/components/ui/utils';

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  INVITED: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  MOVE_OUT_REQUESTED: 'bg-violet-500/15 text-violet-600 border-violet-500/30',
  LEFT: 'bg-muted text-muted-foreground border-border',
  EXPIRED: 'bg-muted text-muted-foreground border-border',
  CANCELLED: 'bg-muted text-muted-foreground border-border',
  FORMER_TENANT: 'bg-muted text-muted-foreground border-border',
  // Move-out request statuses
  REQUESTED: 'bg-blue-500/15 text-blue-600 border-blue-500/30',
  SETTLEMENT_PENDING: 'bg-amber-500/15 text-amber-600 border-amber-500/30',
  SETTLEMENT_APPROVED: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  PHYSICALLY_VACATED: 'bg-indigo-500/15 text-indigo-600 border-indigo-500/30',
  SETTLEMENT_PENDING_PAYMENT: 'bg-orange-500/15 text-orange-600 border-orange-500/30',
  APPROVED: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
  VACATED: 'bg-indigo-500/15 text-indigo-600 border-indigo-500/30',
  COMPLETED: 'bg-muted text-muted-foreground border-border',
  REJECTED: 'bg-rose-500/15 text-rose-600 border-rose-500/30',
};

const LABELS: Record<string, string> = {
  // A tenant is ACTIVE from the moment they join — their room is assigned then,
  // whether or not the deposit has been paid, so "Joined" is what owners see.
  ACTIVE: 'Joined',
  INVITED: 'Invited',
  MOVE_OUT_REQUESTED: 'Vacating',
  LEFT: 'Left',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  FORMER_TENANT: 'Former Tenant',
  // Move-out request statuses
  REQUESTED: 'Requested',
  SETTLEMENT_PENDING: 'Settlement Pending',
  SETTLEMENT_APPROVED: 'Settlement Approved',
  PHYSICALLY_VACATED: 'Physically Vacated',
  SETTLEMENT_PENDING_PAYMENT: 'Settlement Payment Pending',
  APPROVED: 'Approved',
  VACATED: 'Vacated',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
};

interface Props {
  status: string;
  className?: string;
  size?: 'sm' | 'md';
}

export function TenantStatusBadge({ status, className, size = 'sm' }: Props) {
  const key = String(status).toUpperCase();
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        STATUS_STYLES[key] ?? 'bg-secondary text-muted-foreground border-border',
        className
      )}
    >
      {LABELS[key] ?? status}
    </span>
  );
}
