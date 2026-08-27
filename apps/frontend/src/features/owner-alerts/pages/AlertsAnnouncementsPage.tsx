import { useMemo, useState } from 'react';
import { ArrowLeft, Inbox, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ThemeProvider } from '@/app/providers/ThemeProvider';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { useAlerts } from '../hooks/useAlerts';
import { searchAlerts } from '../alertsSearch';
import { AlertSearchBox } from '../components/AlertSearchBox';
import { rowCard } from '../alertsStyles';

/** Announcements — dedicated Alerts category page (internal key stays `admin`). */
export function AlertsAnnouncementsPage() {
  const navigate = useNavigate();
  const alerts = useAlerts();
  const [query, setQuery] = useState('');

  const found = useMemo(
    () => searchAlerts(query, { leads: [], adminMessages: alerts.adminMessages, renewals: [], requests: [] }),
    [query, alerts.adminMessages],
  );

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
          <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Announcements</h1>
          <AlertSearchBox value={query} onChange={setQuery} placeholder="Search a title or message" ariaLabel="Search announcements" />
        </div>

        <div className="flex flex-col gap-2 px-4 sm:px-6">
          {alerts.loading ? (
            <div className="flex h-40 items-center justify-center">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : found.adminMessages.length === 0 ? (
            <EmptyState icon={<Inbox className="h-5 w-5" />} title={found.active ? `No announcements match "${query.trim()}"` : 'No announcements'} />
          ) : (
            found.adminMessages.map((a) => (
              <div key={a.id} className={`${rowCard} flex-row items-start gap-3`} onClick={() => alerts.markRead('admin', a.id)}>
                {!a.read && <span className="mt-1.5 h-2 w-2 flex-none rounded-full bg-primary" />}
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-xl bg-secondary font-display text-xs font-bold text-primary">SO</span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-display text-[13px] font-bold text-foreground">{a.title}</span>
                    <span className="flex-none text-[10.5px] text-muted-foreground">
                      {new Date(a.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{a.body}</div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </ThemeProvider>
  );
}
