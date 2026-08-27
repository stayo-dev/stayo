import { useMemo, useState } from 'react';
import { ArrowLeft, Inbox, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { ownerServiceRequestsService, STATUS_FLOW, NEXT_ACTION_LABEL, SERVICE_REQUEST_TYPE_LABEL } from '@features/hostel-content/api/serviceRequests';
import { useAlerts } from '../hooks/useAlerts';
import { searchAlerts } from '../alertsSearch';
import { AlertSearchBox } from '../components/AlertSearchBox';
import { rowCard, actionBtn, sideBtn, initials, soon } from '../alertsStyles';

/** Requests — dedicated Alerts category page. */
export function AlertsRequestsPage() {
  const navigate = useNavigate();
  const alerts = useAlerts();
  const [query, setQuery] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const found = useMemo(
    () => searchAlerts(query, { leads: [], adminMessages: [], renewals: [], requests: alerts.requests }),
    [query, alerts.requests],
  );

  const advanceMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => ownerServiceRequestsService.updateStatus(id, { status }),
    onSuccess: () => {
      stayoToast.success('Updated');
      setExpandedId(null);
      alerts.refetch();
    },
    onError: () => stayoToast.error('Could not update request'),
  });
  const rejectMutation = useMutation({
    mutationFn: (id: string) => ownerServiceRequestsService.updateStatus(id, { status: 'REJECTED' }),
    onSuccess: () => {
      setExpandedId(null);
      alerts.refetch();
    },
    onError: () => stayoToast.error('Could not reject request'),
  });

  return (
    <ThemeProvider theme="product">
      <div className="flex flex-col gap-3 pb-8">
        <div className="flex items-center gap-2.5 px-4 pb-1 pt-6 sm:px-6">
          <button
            type="button"
            onClick={() => navigate(-1)}
            aria-label="Back"
            className="flex h-8.5 w-8.5 flex-none items-center justify-center rounded-full border border-border bg-card"
          >
            <ArrowLeft className="h-4 w-4 text-muted-foreground" strokeWidth={1.9} />
          </button>
          <span className="text-[13.5px] font-semibold text-muted-foreground">Back to Alerts</span>
        </div>

        <div className="flex flex-col gap-3 px-4 sm:px-6">
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Requests</h1>
          <AlertSearchBox value={query} onChange={setQuery} placeholder="Search a name or request type" ariaLabel="Search requests" />
        </div>

        <div className="flex flex-col gap-2 px-4 sm:px-6">
          {alerts.loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : found.requests.length === 0 ? (
            <EmptyState icon={<Inbox className="h-5 w-5" />} title={found.active ? `No requests match "${query.trim()}"` : 'No requests'} />
          ) : (
            found.requests.map((q) => {
              const expanded = expandedId === q.id;
              const next = STATUS_FLOW[q.status];
              return (
                <div key={q.id} className={rowCard} onClick={() => alerts.markRead('requests', q.id)}>
                  <div className="flex items-center gap-3">
                    {!q.read && <span className="h-2 w-2 flex-none rounded-full bg-warning" />}
                    <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-warning/10 font-display text-[13px] font-bold text-warning">
                      {initials(q.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13.5px] font-semibold text-foreground">{q.name}</div>
                      <div className="text-[11.5px] text-muted-foreground">{q.detail}</div>
                    </div>
                    <span className="flex-none rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">
                      {SERVICE_REQUEST_TYPE_LABEL[q.type] ?? q.type}
                    </span>
                  </div>

                  {expanded && (
                    <div className="rounded-[14px] border border-border bg-muted/40 p-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Tenant's reason</div>
                      <p className="mt-1 text-[12.5px] leading-relaxed text-foreground">{q.detail}</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {expanded ? (
                      <>
                        {next && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              advanceMutation.mutate({ id: q.id, status: next });
                            }}
                            disabled={advanceMutation.isPending}
                            className={`${actionBtn} disabled:opacity-50`}
                          >
                            {NEXT_ACTION_LABEL[next]}
                          </button>
                        )}
                        {q.status === 'RAISED' && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              rejectMutation.mutate(q.id);
                            }}
                            disabled={rejectMutation.isPending}
                            className={`${sideBtn} text-destructive disabled:opacity-50`}
                          >
                            Reject
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setExpandedId(q.id);
                          }}
                          className={actionBtn}
                        >
                          Review
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            soon();
                          }}
                          className={`${sideBtn} text-success`}
                        >
                          Chat
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </ThemeProvider>
  );
}
