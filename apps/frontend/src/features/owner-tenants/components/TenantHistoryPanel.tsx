import { useQuery } from '@tanstack/react-query';
import { Building2, Check, Clock, Lock } from 'lucide-react';

import { queryKeys } from '@lib/queryKeys';

import { tenantHistoryService, type DisclosedHistory } from '../api/tenantHistory';

/**
 * Where a tenant has stayed before, as this owner is permitted to see it.
 *
 * Renders three genuinely different states rather than collapsing them, because
 * they mean different things to the owner: a real history, "they haven't shared
 * this with you", and "nothing to show". Notably it does **not** distinguish
 * "no history" from "not disclosed" in a way that leaks the former — the server
 * returns an empty list either way.
 */
export function TenantHistoryPanel({ tenantId }: { tenantId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.owner.tenantHistory(tenantId),
    queryFn: () => tenantHistoryService.byTenant(tenantId),
    enabled: Boolean(tenantId),
  });

  if (isLoading) {
    return <div className="h-24 animate-pulse rounded-2xl bg-muted" />;
  }
  if (!data) return null;

  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex items-baseline justify-between px-4 pb-1 pt-3.5">
        <h3 className="font-display text-[15px] font-bold text-foreground">Previous stays</h3>
        {data.allowed && data.total_stays > 0 && (
          <span className="text-[11.5px] text-muted-foreground">
            {data.total_stays} stay{data.total_stays === 1 ? '' : 's'} · {data.total_months} months
          </span>
        )}
      </header>

      {!data.allowed ? (
        <NotDisclosed reason={data.reason} />
      ) : data.stays.length === 0 ? (
        <p className="px-4 pb-4 pt-1 text-[12.5px] text-muted-foreground">
          No previous stays on Stayo.
        </p>
      ) : (
        <ul className="px-4 pb-4 pt-1">
          {data.stays.map((stay) => (
            <li key={stay.id} className="flex gap-3 border-t border-border/60 py-3 first:border-t-0">
              <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-muted">
                <Building2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13.5px] font-semibold text-foreground">
                  {stay.hostel.name ?? 'A hostel on Stayo'}
                </p>
                <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                  {[
                    stay.hostel.city,
                    stay.duration_months ? `${stay.duration_months} months` : null,
                    stay.room_no ? `Room ${stay.room_no}` : null,
                    stay.sharing ? `${stay.sharing}-bed` : null,
                    stay.monthly_rent ? `₹${stay.monthly_rent.toLocaleString('en-IN')}/mo` : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>
              {stay.is_current ? (
                <span className="flex-none self-start rounded-full bg-muted px-2 py-1 text-[10.5px] font-bold text-muted-foreground">
                  Current
                </span>
              ) : stay.settled ? (
                <span className="flex flex-none items-center gap-1 self-start rounded-full bg-emerald-50 px-2 py-1 text-[10.5px] font-bold text-emerald-700">
                  <Check className="h-3 w-3" strokeWidth={3} />
                  Settled
                </span>
              ) : (
                <span className="flex-none self-start rounded-full bg-amber-50 px-2 py-1 text-[10.5px] font-bold text-amber-700">
                  Unsettled
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function NotDisclosed({ reason }: { reason: DisclosedHistory['reason'] }) {
  const copy =
    reason === 'AWAITING_TENANT'
      ? { Icon: Clock, text: "You've asked to see this. It'll appear here if they share it." }
      : reason === 'TENANT_DECLINED'
        ? { Icon: Lock, text: 'This tenant has chosen not to share their stay history.' }
        : { Icon: Lock, text: "Stay history is shared by the tenant. This one hasn't shared it with you." };

  return (
    <div className="flex items-start gap-2.5 px-4 pb-4 pt-1">
      <copy.Icon className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.8} />
      <p className="text-[12.5px] leading-[1.5] text-muted-foreground">{copy.text}</p>
    </div>
  );
}
