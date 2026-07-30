import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { ownerServiceRequestsService } from '@features/hostel-content/api/serviceRequests';
import { MoreScreenHeader } from '../components/MoreScreenHeader';

const card = 'overflow-hidden rounded-[20px] border border-border bg-card shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const sectionLabel = 'pl-0.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground';

const STATUS_FLOW: Record<string, string | null> = {
  RAISED: 'ASSIGNED',
  ASSIGNED: 'IN_PROGRESS',
  IN_PROGRESS: 'RESOLVED',
  RESOLVED: null,
  REJECTED: null,
};
const NEXT_ACTION_LABEL: Record<string, string> = {
  ASSIGNED: 'Mark assigned',
  IN_PROGRESS: 'Mark in progress',
  RESOLVED: 'Mark resolved',
};

/** More → Settings → Service Requests. Owner queue for tenant Room-tab requests (maintenance, room change, cleaning, lost key, visitor pass, extra mattress). */
export function MoreServiceRequestsPage() {
  const session = useOwnerSession();
  const hostelId = session.primaryHostelId;
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'all'>('open');

  const requestsQuery = useQuery({
    queryKey: ['owner', 'service-requests', hostelId],
    queryFn: () => ownerServiceRequestsService.list(hostelId!),
    enabled: Boolean(hostelId),
  });

  const advanceMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ownerServiceRequestsService.updateStatus(id, { status }),
    onSuccess: () => {
      stayoToast.success('Updated');
      queryClient.invalidateQueries({ queryKey: ['owner', 'service-requests', hostelId] });
    },
    onError: () => stayoToast.error('Could not update request'),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => ownerServiceRequestsService.updateStatus(id, { status: 'REJECTED' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['owner', 'service-requests', hostelId] });
    },
    onError: () => stayoToast.error('Could not reject request'),
  });

  const requests = (requestsQuery.data ?? []).filter((r) =>
    filter === 'open' ? r.status !== 'RESOLVED' && r.status !== 'REJECTED' : true,
  );

  return (
    <div className="flex flex-col gap-5 px-4 pb-10 pt-6 sm:px-6">
      <MoreScreenHeader backTo="/owner/more/settings" backLabel="Settings" title="Service Requests" />

      <div className="flex gap-1.5">
        {(['open', 'all'] as const).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            className={`rounded-full px-3.5 py-1.5 font-display text-xs font-semibold ${
              filter === f ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'
            }`}
          >
            {f === 'open' ? 'Open' : 'All'}
          </button>
        ))}
      </div>

      <div className={card}>
        {requests.length === 0 ? (
          <div className="p-6 text-center text-[12.5px] text-muted-foreground">No requests</div>
        ) : (
          requests.map((r) => {
            const next = STATUS_FLOW[r.status];
            return (
              <div key={r.id} className="flex flex-col gap-2 border-t border-border p-4 first:border-t-0">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[13.5px] font-semibold text-foreground">
                      {r.tenants?.profiles?.name ?? 'Tenant'} · {r.type.replace('_', ' ')}
                    </div>
                    <div className="mt-0.5 text-[11.5px] text-muted-foreground">{r.category ?? r.description ?? '—'}</div>
                  </div>
                  <span className="flex-none rounded-full bg-secondary/60 px-2.5 py-1 text-[10.5px] font-bold text-foreground">
                    {r.status.replace('_', ' ')}
                  </span>
                </div>
                {(next || r.status === 'RAISED') && (
                  <div className="flex gap-2">
                    {next && (
                      <button
                        type="button"
                        onClick={() => advanceMutation.mutate({ id: r.id, status: next })}
                        disabled={advanceMutation.isPending}
                        className="flex-1 rounded-[10px] bg-foreground py-2 text-center text-[12px] font-bold text-background disabled:opacity-50"
                      >
                        {NEXT_ACTION_LABEL[next]}
                      </button>
                    )}
                    {r.status === 'RAISED' && (
                      <button
                        type="button"
                        onClick={() => rejectMutation.mutate(r.id)}
                        disabled={rejectMutation.isPending}
                        className="rounded-[10px] border border-border bg-card px-3 py-2 text-[12px] font-semibold text-destructive"
                      >
                        Reject
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
