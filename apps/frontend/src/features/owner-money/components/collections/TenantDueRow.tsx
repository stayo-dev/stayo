import { useNavigate } from 'react-router-dom';
import type { MockTenant } from '@shared/mocks/tenants';

interface TenantDueRowProps {
  tenant: MockTenant;
  onCollect: () => void;
}

/** Overdue-tenant row shared by the Pulse "Action queue" and the Collections list, per Stayo App.dc.html. */
export function TenantDueRow({ tenant, onCollect }: TenantDueRowProps) {
  const navigate = useNavigate();
  const daysOverdue = tenant.overdueMonths * 30;

  return (
    <div
      onClick={() => navigate(`/owner/tenants/${tenant.id}`)}
      className="flex cursor-pointer items-center gap-3 border-t border-border/60 py-3 first:border-t-0"
    >
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">{tenant.name}</div>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className="text-[11.5px] text-muted-foreground">{tenant.hostelName}</span>
          <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold text-destructive">{daysOverdue}d overdue</span>
        </div>
      </div>
      <div className="flex-none font-display text-[13.5px] font-bold tabular-nums text-destructive">₹{tenant.outstanding.toLocaleString('en-IN')}</div>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onCollect();
        }}
        className="flex-none rounded-lg bg-foreground px-3.5 py-2 font-display text-xs font-bold text-background"
      >
        Collect
      </button>
    </div>
  );
}
