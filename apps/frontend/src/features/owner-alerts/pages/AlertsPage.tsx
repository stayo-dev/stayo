import { Inbox, Loader2 } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { useAlerts, DynamicAlertCategory } from '../hooks/useAlerts';

const CATEGORIES: DynamicAlertCategory[] = ['admin', 'renewals', 'requests'];

const ALERT_CATEGORY_LABELS: Record<DynamicAlertCategory, string> = {
  admin: 'Messages',
  renewals: 'Renewals',
  requests: 'Requests',
};

const rowCard = 'flex flex-col gap-2.5 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const actionBtn = 'flex-1 rounded-[10px] bg-foreground py-2.5 text-center font-display text-[12.5px] font-bold text-background';
const sideBtn = 'w-[70px] rounded-[10px] border border-border bg-card py-2.5 text-center text-[12.5px] font-semibold text-foreground';

const initials = (name: string) =>
  name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

const soon = () => stayoToast.info('Coming soon');

/** Alerts tab — Admin/Renewals/Requests, per Stayo App.dc.html. Reached via Home's bell icon, not the bottom nav (design has no Alerts nav icon). */
export function AlertsPage() {
  const alerts = useAlerts();

  return (
    <div className="flex flex-col gap-3 px-4 pb-8 pt-6 sm:px-6">
      <div>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Alerts</h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Messages, renewals and tenant requests in one place</p>
      </div>

      <div className="flex gap-1.5 overflow-x-auto pb-0.5">
        {CATEGORIES.map((c) => {
          const active = alerts.category === c;
          return (
            <button
              key={c}
              type="button"
              onClick={() => alerts.setCategory(c)}
              className={`flex-none whitespace-nowrap rounded-full px-3.5 py-1.5 font-display text-xs font-semibold ${
                active ? 'bg-foreground text-background' : 'border border-border bg-card text-muted-foreground'
              }`}
            >
              {ALERT_CATEGORY_LABELS[c]} {alerts.counts[c]}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        {alerts.loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {alerts.category === 'admin' &&
              (alerts.adminMessages.length === 0 ? (
                <EmptyState icon={<Inbox className="h-5 w-5" />} title="No messages" />
              ) : (
                alerts.adminMessages.map((a) => (
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
              ))}

            {alerts.category === 'renewals' &&
              (alerts.renewals.length === 0 ? (
                <EmptyState icon={<Inbox className="h-5 w-5" />} title="No renewals due" />
              ) : (
                alerts.renewals.map((r) => (
                  <div key={r.id} className={rowCard} onClick={() => alerts.markRead('renewals', r.id)}>
                    <div className="flex items-center gap-3">
                      {!r.read && <span className="h-2 w-2 flex-none rounded-full bg-warning" />}
                      <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-warning/10 font-display text-[13px] font-bold text-warning">
                        {initials(r.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="text-[13.5px] font-semibold text-foreground">{r.name}</div>
                        <div className="text-[11.5px] text-muted-foreground">{r.detail}</div>
                      </div>
                      <span className="flex-none rounded-md bg-warning/10 px-2 py-0.5 text-[10.5px] font-semibold text-warning">{r.days}d left</span>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={soon} className={actionBtn}>Renew</button>
                      <button type="button" onClick={soon} className={sideBtn}>Call</button>
                      <button type="button" onClick={soon} className={`${sideBtn} text-success`}>Chat</button>
                    </div>
                  </div>
                ))
              ))}

            {alerts.category === 'requests' &&
              (alerts.requests.length === 0 ? (
                <EmptyState icon={<Inbox className="h-5 w-5" />} title="No requests" />
              ) : (
                alerts.requests.map((q) => (
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
                      <span className="flex-none rounded-md bg-muted px-2 py-0.5 text-[10.5px] font-semibold text-muted-foreground">{q.type}</span>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={soon} className={actionBtn}>Review</button>
                      <button type="button" onClick={soon} className={`${sideBtn} text-success`}>Chat</button>
                    </div>
                  </div>
                ))
              ))}
          </>
        )}
      </div>
    </div>
  );
}
