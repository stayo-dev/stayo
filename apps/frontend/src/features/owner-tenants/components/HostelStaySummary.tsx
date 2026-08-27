import { useQuery } from '@tanstack/react-query';
import { Building2, Check, Clock, Lock } from 'lucide-react';

import { queryKeys } from '@lib/queryKeys';

import { tenantHistoryService, type DisclosedHistory } from '../api/tenantHistory';
import { classifyHostelRelationship } from '../hostelRelationship';
import { HostelRelationshipBadge } from './HostelRelationshipBadge';

interface HostelStaySummaryProps {
  hostelId: string;
  profileId: string;
  /** Only rendered when provided — no destination to link to yet from any current caller. */
  onViewFullHistory?: () => void;
}

/**
 * The compact, hostel-scoped sibling of `TenantHistoryPanel` — shows only
 * the single most-relevant stay at THIS hostel (current if live, else most
 * recent past one), not the tenant's full cross-hostel history. Deliberately
 * a new component rather than a `hostelId` mode on `TenantHistoryPanel`
 * itself, so that component's existing tenant-detail-page call site can't
 * pick up unintended behaviour through shared conditional branches.
 *
 * Reuses `TenantHistoryPanel`'s row markup and its `NotDisclosed` copy
 * pattern rather than inventing new visual language or new copy.
 */
export function HostelStaySummary({ hostelId, profileId, onViewFullHistory }: HostelStaySummaryProps) {
  const { data, isLoading } = useQuery({
    queryKey: queryKeys.owner.tenantHistoryByProfile(hostelId, profileId),
    queryFn: () => tenantHistoryService.byProfile(hostelId, profileId),
    enabled: Boolean(hostelId && profileId),
  });

  if (isLoading) {
    return <div className="h-20 animate-pulse rounded-2xl bg-muted" />;
  }
  if (!data) return null;

  const { relationship, stay } = classifyHostelRelationship(data, hostelId);

  return (
    <section className="rounded-2xl border border-border bg-card">
      <header className="flex items-center justify-between px-4 pb-1 pt-3.5">
        <h3 className="font-display text-[15px] font-bold text-foreground">
          {relationship === 'ACTIVE_ELSEWHERE' ? 'Active elsewhere' : 'Previous stay'}
        </h3>
        <HostelRelationshipBadge relationship={relationship} reason={data.reason} />
      </header>

      {relationship === 'UNKNOWN' ? (
        <NotDisclosed reason={data.reason} />
      ) : !stay ? (
        <p className="px-4 pb-4 pt-1 text-[12.5px] text-muted-foreground">No previous stay at this hostel.</p>
      ) : (
        <div className="px-4 pb-4 pt-1">
          <div className="flex gap-3 py-1">
            <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-muted">
              <Building2 className="h-4 w-4 text-muted-foreground" strokeWidth={1.8} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] font-semibold text-foreground">
                {stay.room_no ? `Room ${stay.room_no}` : 'Room not on file'}
              </p>
              <p className="mt-0.5 text-[11.5px] text-muted-foreground">
                {[
                  stay.duration_months ? `${stay.duration_months} months` : null,
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
          </div>
          {(stay.joined_on || stay.exit_date) && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              {stay.joined_on ? new Date(stay.joined_on).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : '—'}
              {' – '}
              {stay.exit_date ? new Date(stay.exit_date).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }) : 'Present'}
            </p>
          )}
          {onViewFullHistory && (
            <button type="button" onClick={onViewFullHistory} className="mt-2.5 text-[12px] font-semibold text-primary">
              View Stay History
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function NotDisclosed({ reason }: { reason: DisclosedHistory['reason'] }) {
  const copy =
    reason === 'AWAITING_TENANT'
      ? { Icon: Clock, text: "You've asked to see this. It'll appear here if they share it." }
      : reason === 'TENANT_DECLINED'
        ? { Icon: Lock, text: 'This person has chosen not to share their stay history.' }
        : { Icon: Lock, text: "Stay history is shared by the tenant. This one hasn't shared it with you." };

  return (
    <div className="flex items-start gap-2.5 px-4 pb-4 pt-1">
      <copy.Icon className="mt-0.5 h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.8} />
      <p className="text-[12.5px] leading-[1.5] text-muted-foreground">{copy.text}</p>
    </div>
  );
}
