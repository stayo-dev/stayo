import { AlertTriangle, Check } from 'lucide-react';
import type { PublishCheck } from '../../publishChecks';

interface PublishChecklistProps {
  checks: PublishCheck[];
  tenantCount: number | null;
}

/** Pre-flight readout above Publish. Informs; never blocks — no check disables the button. */
export function PublishChecklist({ checks, tenantCount }: PublishChecklistProps) {
  return (
    <div className="flex flex-col gap-2 rounded-[18px] border border-border bg-card p-4">
      <span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Ready to publish</span>
      {checks.map((c) => (
        <div key={c.id} className="flex items-start gap-2">
          {c.status === 'PASS' ? (
            <Check className="mt-0.5 h-3.5 w-3.5 flex-none text-success" strokeWidth={2.5} />
          ) : (
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 flex-none text-warning" strokeWidth={2.2} />
          )}
          <span className={`text-[12.5px] leading-snug ${c.status === 'PASS' ? 'text-muted-foreground' : 'text-foreground'}`}>
            {c.label}
          </span>
        </div>
      ))}
      {tenantCount !== null && tenantCount > 0 && (
        <span className="mt-1 text-[11.5px] text-muted-foreground">
          {tenantCount} {tenantCount === 1 ? 'tenant' : 'tenants'} will be notified.
        </span>
      )}
    </div>
  );
}
