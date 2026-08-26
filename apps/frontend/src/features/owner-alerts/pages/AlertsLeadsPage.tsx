import { useMemo, useState } from 'react';
import { ArrowLeft, Inbox, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { useAlerts } from '../hooks/useAlerts';
import { searchAlerts } from '../alertsSearch';
import { LeadDetailSheet } from '../components/LeadDetailSheet';
import { LeadCard } from '../components/LeadCard';
import { AlertSearchBox } from '../components/AlertSearchBox';
import {
  countLeadsByFilter,
  filterLeads,
  primaryActionForStatus,
  LEAD_FILTER_ORDER,
  LEAD_FILTER_LABEL,
  SETTLED_INCLUDING_FILTERS,
  type LeadFilter,
} from '../leadInbox';

/** Leads — dedicated Alerts category page. Owner Leads tab: returning-tenant awareness surfaces via `LeadDetailSheet`. */
export function AlertsLeadsPage() {
  const navigate = useNavigate();
  const alerts = useAlerts({ includeLeads: true });
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<LeadFilter>('all');

  const found = useMemo(
    () => searchAlerts(query, { leads: alerts.leads, adminMessages: [], renewals: [], requests: [] }),
    [query, alerts.leads],
  );

  const counts = useMemo(() => countLeadsByFilter(found.leads), [found.leads]);
  const visibleLeads = useMemo(() => filterLeads(found.leads, filter), [found.leads, filter]);

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
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Leads</h1>
          <AlertSearchBox value={query} onChange={setQuery} placeholder="Search a name, phone, hostel or status" ariaLabel="Search leads" />
          <div className="flex gap-1.5 overflow-x-auto pb-0.5">
            {LEAD_FILTER_ORDER.map((f) => {
              const active = filter === f;
              return (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-display text-xs font-semibold ${
                    active ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'
                  }`}
                >
                  {LEAD_FILTER_LABEL[f]} {counts[f]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2 px-4 sm:px-6">
          {alerts.actionableTruncated && (
            <p className="rounded-[12px] border border-warning/30 bg-warning-bg/60 px-3 py-2.5 text-[12px] leading-relaxed text-foreground">
              You have more open enquiries than fit on one page. Search by name or phone to reach
              the rest.
            </p>
          )}

          {alerts.leadsLoading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : visibleLeads.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-5 w-5" />}
              title={
                found.active
                  ? `No leads match "${query.trim()}"`
                  : filter === 'all'
                    ? 'No enquiries yet'
                    : `No ${LEAD_FILTER_LABEL[filter].toLowerCase()} leads`
              }
            />
          ) : (
            <>
              {visibleLeads.map((l) => {
                const action = primaryActionForStatus(l.status);
                return (
                  <LeadCard
                    key={l.id}
                    lead={l}
                    action={action}
                    onOpen={() => setSelectedLeadId(l.id)}
                    onPrimary={() =>
                      action === 'review'
                        ? setSelectedLeadId(l.id)
                        : navigate(`/owner/tenants?fromLead=${l.id}`)
                    }
                  />
                );
              })}

              {/* Settled leads are paged, so a tab that can hold them can run
                  out before the account does. Said plainly rather than just
                  stopping. */}
              {SETTLED_INCLUDING_FILTERS.includes(filter) &&
                alerts.settledNotLoaded > 0 &&
                alerts.canLoadMoreSettled && (
                  <button
                    type="button"
                    onClick={() => alerts.loadMoreSettled()}
                    disabled={alerts.isLoadingMoreSettled}
                    className="mx-auto rounded-[10px] border border-border bg-card px-4 py-2 font-display text-[12.5px] font-bold text-foreground disabled:opacity-60"
                  >
                    {alerts.isLoadingMoreSettled ? 'Loading…' : `Show older (${alerts.settledNotLoaded} more)`}
                  </button>
                )}
            </>
          )}
        </div>

        <LeadDetailSheet leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
      </div>
    </ThemeProvider>
  );
}
