import { useState } from 'react';
import { Inbox, Loader2, ChevronRight, UserCog, MessageCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { openWhatsAppShare } from '@lib/share';
import { useAlerts, DynamicAlertCategory } from '../hooks/useAlerts';
import { useOwnerProfileRequests } from '@features/owner-profile-requests/hooks/useOwnerProfileRequests';
import { LeadDetailSheet } from '../components/LeadDetailSheet';
import { LEAD_SOURCE_LABEL, leadStatusLabel, leadStatusToneClass } from '../leadConstants';

const CATEGORIES: DynamicAlertCategory[] = ['leads', 'admin', 'renewals', 'requests'];

const ALERT_CATEGORY_LABELS: Record<DynamicAlertCategory, string> = {
  leads: 'Leads',
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

/**
 * Alerts tab — Leads/Admin/Renewals/Requests, per Stayo App.dc.html. Reached
 * via Home's bell icon, not the bottom nav (design has no Alerts nav icon).
 * Leads was speced in the design source but never implemented until now —
 * see docs/obsidian/Decisions.md for the ADR on returning-tenant awareness,
 * which is what its detail sheet (`LeadDetailSheet`) surfaces.
 */
export function AlertsPage() {
  const navigate = useNavigate();
  const alerts = useAlerts();
  const profileRequests = useOwnerProfileRequests();
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-3 px-4 pb-8 pt-6 sm:px-6">
      <div>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Alerts</h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Leads, messages, renewals and tenant requests in one place</p>
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
        {alerts.category === 'leads' && alerts.leadsLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : alerts.category === 'leads' ? (
          alerts.leads.length === 0 ? (
            <EmptyState icon={<Inbox className="h-5 w-5" />} title="No enquiries yet" />
          ) : (
            alerts.leads.map((l) => (
              <div
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedLeadId(l.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') setSelectedLeadId(l.id);
                }}
                className={`${rowCard} cursor-pointer`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-secondary font-display text-xs font-bold text-primary">
                    {initials(l.student_name)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[13.5px] font-semibold text-foreground">{l.student_name}</div>
                    <div className="text-[11.5px] text-muted-foreground">
                      Enquired via {LEAD_SOURCE_LABEL[l.source] ?? l.source} · {l.hostel?.name ?? ''}
                    </div>
                  </div>
                  <span className={`flex-none rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${leadStatusToneClass(l.status)}`}>
                    {leadStatusLabel(l.status)}
                  </span>
                </div>
                <div className="flex gap-2">
                  {l.student_phone ? (
                    <a href={`tel:${l.student_phone}`} onClick={(e) => e.stopPropagation()} className={sideBtn}>
                      Call
                    </a>
                  ) : (
                    <button type="button" onClick={(e) => { e.stopPropagation(); soon(); }} className={sideBtn}>
                      Call
                    </button>
                  )}
                  {l.student_phone ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        openWhatsAppShare(`Hi ${l.student_name}, this is regarding your enquiry at ${l.hostel?.name ?? 'our hostel'}.`, l.student_phone ?? undefined);
                      }}
                      className={`${actionBtn} flex items-center justify-center gap-1.5`}
                    >
                      <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
                      WhatsApp
                    </button>
                  ) : (
                    <button type="button" onClick={(e) => { e.stopPropagation(); soon(); }} className={`${actionBtn} text-success`}>
                      WhatsApp
                    </button>
                  )}
                </div>
              </div>
            ))
          )
        ) : alerts.loading ? (
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

            {alerts.category === 'requests' && profileRequests.requests.length > 0 && (
              <button type="button" onClick={() => navigate('/owner/profile-requests')} className={`${rowCard} flex-row items-center gap-3`}>
                <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-warning/10 text-warning">
                  <UserCog className="h-4.5 w-4.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="font-display text-[13px] font-bold text-foreground">Profile change requests</div>
                  <div className="text-xs text-muted-foreground">{profileRequests.requests.length} tenant{profileRequests.requests.length === 1 ? '' : 's'} awaiting your approval</div>
                </div>
                <ChevronRight className="h-4 w-4 flex-none text-muted-foreground" />
              </button>
            )}

            {alerts.category === 'requests' &&
              (alerts.requests.length === 0 && profileRequests.requests.length === 0 ? (
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

      <LeadDetailSheet leadId={selectedLeadId} onClose={() => setSelectedLeadId(null)} />
    </div>
  );
}
