import type { MockTenant } from '@shared/mocks/tenants';
import { TenantDueRow } from '../collections/TenantDueRow';

interface ActionQueueCardProps {
  overdueTenants: MockTenant[];
  onViewAll: () => void;
  onCollect: (tenant: MockTenant) => void;
}

/** "Action queue" — top overdue tenants, per Stayo App.dc.html. Reuses the same row as Collections. */
export function ActionQueueCard({ overdueTenants, onViewAll, onCollect }: ActionQueueCardProps) {
  const overdue = [...overdueTenants].sort((a, b) => b.outstanding - a.outstanding);
  const top = overdue.slice(0, 3);

  return (
    <div className="rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]">
      <div className="flex items-baseline justify-between px-4 pb-2.5 pt-3.5">
        <span className="font-display text-[13.5px] font-bold text-foreground">Action queue</span>
        <button type="button" onClick={onViewAll} className="font-display text-[12.5px] font-semibold text-primary">
          View all {overdue.length} →
        </button>
      </div>
      <div className="px-4 pb-1">
        {top.map((t) => (
          <TenantDueRow key={t.id} tenant={t} onCollect={() => onCollect(t)} />
        ))}
      </div>
    </div>
  );
}
