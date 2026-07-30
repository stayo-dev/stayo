import { getStatusConfig, type ChangeStatus } from '../constants/statuses';

interface ChangeStatusBadgeProps {
  status: string;
  variant?: 'owner' | 'tenant';
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Universal change request status badge.
 * Shows human-readable labels — owners and tenants see different text
 * for the same status (e.g. PENDING → "Waiting for Approval" vs "Review Required").
 */
export function ChangeStatusBadge({
  status,
  variant = 'owner',
  size = 'sm',
  className = '',
}: ChangeStatusBadgeProps) {
  const config = getStatusConfig(status);
  const Icon = config.icon;
  const label = variant === 'tenant' ? config.tenantLabel : config.ownerLabel;

  const sizeClasses = size === 'sm'
    ? 'text-[10px] px-2 py-0.5 gap-1'
    : 'text-xs px-2.5 py-1 gap-1.5';

  return (
    <span
      className={`inline-flex items-center rounded-full border font-bold uppercase tracking-wider ${config.bgClass} ${config.textClass} ${config.borderClass} ${sizeClasses} ${className}`}
      aria-label={`Status: ${label}`}
    >
      <Icon className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      {label}
    </span>
  );
}
