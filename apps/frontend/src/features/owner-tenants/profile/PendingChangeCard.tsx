import { Clock, X } from 'lucide-react';
import { useTenantChangeRequests, useCancelChangeRequest } from '@features/change-management';

/**
 * Change requests this tenant hasn't answered yet.
 *
 * `useTenantChangeRequests`, `PendingBanner` and `ChangeTimeline` have all
 * existed and had no live caller, so an owner who submitted a contractual
 * amendment got no confirmation it was still outstanding, no view of what they
 * had asked for, and no way to withdraw it. This is the Stayo-styled
 * replacement for that banner, showing the diff rather than just a count.
 */

const FIELD_LABELS: Record<string, string> = {
  monthly_rent: 'Monthly rent',
  security_deposit: 'Security deposit',
  maintenance_charge: 'Maintenance charge',
  maintenance_type: 'Maintenance type',
  agreement_duration_months: 'Agreement duration',
  agreement_start_date: 'Agreement start',
  payment_frequency: 'Billing frequency',
};

function label(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/_/g, ' ');
}

function display(value: unknown): string {
  if (value == null || value === '') return '—';
  if (typeof value === 'number') return value.toLocaleString('en-IN');
  return String(value);
}

export function PendingChangeCard({ tenantId }: { tenantId: string }) {
  const { requests } = useTenantChangeRequests(tenantId);
  const cancel = useCancelChangeRequest();

  const pending = requests.filter((request) => request.status === 'PENDING');
  if (pending.length === 0) return null;

  return (
    <section className="flex flex-col gap-2.5">
      {pending.map((request) => {
        const fields = Object.keys(request.diff ?? {});
        return (
          <div
            key={request.id}
            className="flex flex-col gap-2.5 rounded-[18px] border border-warning/25 bg-warning/8 p-3.5"
          >
            <div className="flex items-start gap-2.5">
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-[11px] bg-warning/15">
                <Clock className="h-4.5 w-4.5 text-warning" strokeWidth={1.9} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-display text-[13px] font-extrabold text-foreground">
                  Waiting on the tenant
                </div>
                <div className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {request.reason || 'Change awaiting approval'}
                </div>
              </div>
              <button
                type="button"
                onClick={() => cancel.mutate({ id: request.id })}
                disabled={cancel.isPending}
                aria-label="Withdraw this request"
                title="Withdraw this request"
                className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" strokeWidth={2.2} />
              </button>
            </div>

            {fields.length > 0 && (
              <ul className="flex flex-col gap-1 rounded-[11px] bg-card/70 p-2.5">
                {fields.map((field) => (
                  <li key={field} className="flex items-baseline gap-2 text-[11.5px]">
                    <span className="min-w-0 flex-1 truncate text-muted-foreground">{label(field)}</span>
                    <span className="flex-none text-muted-foreground line-through">
                      {display(request.before?.[field])}
                    </span>
                    <span className="flex-none font-bold text-foreground">
                      {display(request.diff?.[field])}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
