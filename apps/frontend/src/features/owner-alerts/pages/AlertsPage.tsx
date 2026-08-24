import { useMemo, useState } from 'react';
import { Inbox, Loader2, ChevronRight, ChevronDown, UserCog, MessageCircle, Search, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { EmptyState } from '@shared/ui-patterns/EmptyState';
import { openWhatsAppShare } from '@lib/share';
import { useAlerts, DynamicAlertCategory } from '../hooks/useAlerts';
import { useOwnerProfileRequests } from '@features/owner-profile-requests/hooks/useOwnerProfileRequests';
import { LeadDetailSheet } from '../components/LeadDetailSheet';
import { LEAD_SOURCE_LABEL, leadStatusLabel, leadStatusToneClass } from '../leadConstants';
import { matchesElsewhere, searchAlerts } from '../alertsSearch';
import {
  groupLeads,
  isGroupOpen,
  primaryActionFor,
  PRIMARY_ACTION_LABEL,
  type LeadGroupId,
  type LeadPrimaryAction,
} from '../leadInbox';
import type { DynamicLead } from '../hooks/useAlerts';

const CATEGORIES: DynamicAlertCategory[] = ['leads', 'admin', 'renewals', 'requests'];

/** The two groups holding settled leads — the paged half of the lead fetch. */
const SETTLED_GROUPS: LeadGroupId[] = ['converted', 'closed'];

const ALERT_CATEGORY_LABELS: Record<DynamicAlertCategory, string> = {
  leads: 'Leads',
  admin: 'Messages',
  renewals: 'Renewals',
  requests: 'Requests',
};

const rowCard = 'flex flex-col gap-2.5 rounded-[18px] border border-border bg-card p-3.5 shadow-[0_1px_2px_rgba(40,30,20,0.04),0_6px_16px_rgba(40,30,20,0.05)]';
const actionBtn = 'flex-1 rounded-[10px] bg-foreground py-2.5 text-center font-display text-[12.5px] font-bold text-background';
const sideBtn = 'w-[70px] rounded-[10px] border border-border bg-card py-2.5 text-center text-[12.5px] font-semibold text-foreground';
/**
 * The lead card's secondary pair. Content-sized rather than a fixed 70px,
 * because "Chat" carries an icon and three buttons now share the row; and
 * `min-h` so shrinking them does not shrink the tap target.
 */
const leadSideBtn =
  'inline-flex min-h-[40px] flex-none items-center justify-center gap-1.5 rounded-[10px] border border-border bg-card px-3.5 text-[12.5px] font-semibold text-foreground';

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
  const [query, setQuery] = useState('');

  /**
   * Searched across all four lists, not just the open one — see
   * `alertsSearch.ts`. The chip counts follow the query, so the tabs
   * themselves become the result summary rather than needing one.
   */
  const found = useMemo(
    () =>
      searchAlerts(query, {
        leads: alerts.leads,
        adminMessages: alerts.adminMessages,
        renewals: alerts.renewals,
        requests: alerts.requests,
      }),
    [query, alerts.leads, alerts.adminMessages, alerts.renewals, alerts.requests],
  );
  const elsewhere = matchesElsewhere(found, alerts.category);

  /**
   * Leads are grouped by what is still owed on each one, rather than shown as
   * one flat arrival-ordered list — see `leadInbox.ts`. Settled groups start
   * collapsed, and `openGroups` records only what the owner has toggled, so a
   * group they never touched still follows the default (and still opens by
   * itself while a search is running).
   */
  const leadGroups = useMemo(() => groupLeads(found.leads), [found.leads]);
  const [openGroups, setOpenGroups] = useState<Partial<Record<LeadGroupId, boolean>>>({});

  return (
    <div className="flex flex-col gap-3 px-4 pb-8 pt-6 sm:px-6">
      <div>
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Alerts</h1>
        <p className="mt-0.5 text-[12.5px] text-muted-foreground">Leads, messages, renewals and tenant requests in one place</p>
      </div>

      {/* Above the chips, because it searches across them rather than within
          whichever one is open. */}
      <label className="flex items-center gap-2 rounded-[12px] border border-field-border bg-input-background px-3 py-2.5">
        <Search className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.8} />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a name, phone, hostel or status"
          enterKeyHint="search"
          autoComplete="off"
          aria-label="Search alerts"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-foreground placeholder:font-normal placeholder:text-muted-foreground/70 focus:outline-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="flex h-6 w-6 flex-none items-center justify-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-3.5 w-3.5" strokeWidth={2.2} />
          </button>
        )}
      </label>

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
              {ALERT_CATEGORY_LABELS[c]} {found.counts[c]}
            </button>
          );
        })}
      </div>

      {/* Standing on an empty Leads tab, "1 in Renewals" is the difference
          between finding someone and concluding they are not in Stayo. */}
      {elsewhere.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11.5px] text-muted-foreground">Also found in</span>
          {elsewhere.map(({ category, count }) => (
            <button
              key={category}
              type="button"
              onClick={() => alerts.setCategory(category)}
              className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-1 font-display text-[11.5px] font-bold text-primary"
            >
              {ALERT_CATEGORY_LABELS[category]} ({count})
            </button>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {alerts.category === 'leads' && alerts.leadsLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : alerts.category === 'leads' ? (
          found.leads.length === 0 ? (
            <EmptyState
              icon={<Inbox className="h-5 w-5" />}
              title={found.active ? `No leads match "${query.trim()}"` : 'No enquiries yet'}
            />
          ) : (
            <>
            {alerts.actionableTruncated && (
              <p className="rounded-[12px] border border-warning/30 bg-warning-bg/60 px-3 py-2.5 text-[12px] leading-relaxed text-foreground">
                You have more open enquiries than fit on one page. Search by name or phone to reach
                the rest.
              </p>
            )}
            {leadGroups.map((group) => {
              const open = isGroupOpen(group, openGroups, found.active);
              const action = primaryActionFor(group.id);
              return (
                <section key={group.id} className="flex flex-col gap-2">
                  <button
                    type="button"
                    onClick={() => setOpenGroups((prev) => ({ ...prev, [group.id]: !open }))}
                    aria-expanded={open}
                    className="flex items-center gap-2 px-0.5 py-1 text-left"
                  >
                    <ChevronDown
                      className={`h-4 w-4 flex-none text-muted-foreground transition-transform ${open ? '' : '-rotate-90'}`}
                      strokeWidth={2}
                    />
                    <span className="font-display text-[13px] font-bold text-foreground">{group.label}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-bold text-muted-foreground">
                      {group.leads.length}
                    </span>
                  </button>

                  {open && (
                    <>
                      <p className="-mt-1 px-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
                        {group.hint}
                      </p>
                      {group.leads.map((l) => (
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
                      ))}

                      {/* Settled leads are paged, so the two collapsed groups
                          that hold them can run out before the account does.
                          Said plainly rather than just stopping. */}
                      {SETTLED_GROUPS.includes(group.id) &&
                        alerts.settledNotLoaded > 0 &&
                        alerts.canLoadMoreSettled && (
                          <button
                            type="button"
                            onClick={() => alerts.loadMoreSettled()}
                            disabled={alerts.isLoadingMoreSettled}
                            className="mx-auto rounded-[10px] border border-border bg-card px-4 py-2 font-display text-[12.5px] font-bold text-foreground disabled:opacity-60"
                          >
                            {alerts.isLoadingMoreSettled
                              ? 'Loading…'
                              : `Show older (${alerts.settledNotLoaded} more)`}
                          </button>
                        )}
                    </>
                  )}
                </section>
              );
            })}
            </>
          )
        ) : alerts.loading ? (
          <div className="flex h-40 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {alerts.category === 'admin' &&
              (found.adminMessages.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-5 w-5" />}
                  title={found.active ? `No messages match "${query.trim()}"` : 'No messages'}
                />
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
              ))}

            {alerts.category === 'renewals' &&
              (found.renewals.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-5 w-5" />}
                  title={found.active ? `No renewals match "${query.trim()}"` : 'No renewals due'}
                />
              ) : (
                found.renewals.map((r) => (
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

            {alerts.category === 'requests' && !found.active && profileRequests.requests.length > 0 && (
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
              (found.requests.length === 0 && profileRequests.requests.length === 0 ? (
                <EmptyState
                  icon={<Inbox className="h-5 w-5" />}
                  title={found.active ? `No requests match "${query.trim()}"` : 'No requests'}
                />
              ) : (
                found.requests.map((q) => (
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

/**
 * One enquiry.
 *
 * The dark primary button is whatever that lead's **next step** actually is —
 * "Accept & invite" while it is undecided, "Send invitation" once it has been
 * accepted but nobody has been invited, "Review" while it is on hold. A lead
 * with nothing outstanding gets no primary button at all.
 *
 * That is the change from the old card, which put WhatsApp in the dark
 * position on every lead including settled ones, so the most prominent thing
 * on a finished enquiry was a conversation there was no longer any reason to
 * start. Call and WhatsApp stay, as the quieter pair they are.
 */
function LeadCard({
  lead,
  action,
  onOpen,
  onPrimary,
}: {
  lead: DynamicLead;
  action: LeadPrimaryAction;
  onOpen: () => void;
  onPrimary: () => void;
}) {
  const phone = lead.student_phone;
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') onOpen();
      }}
      className={`${rowCard} cursor-pointer`}
    >
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-secondary font-display text-xs font-bold text-primary">
          {initials(lead.student_name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13.5px] font-semibold text-foreground">{lead.student_name}</div>
          <div className="text-[11.5px] text-muted-foreground">
            Enquired via {LEAD_SOURCE_LABEL[lead.source] ?? lead.source}
            {lead.hostel?.name ? ` · ${lead.hostel.name}` : ''}
          </div>
        </div>
        <span className={`flex-none rounded-md px-2 py-0.5 text-[10.5px] font-semibold ${leadStatusToneClass(lead.status)}`}>
          {leadStatusLabel(lead.status)}
        </span>
      </div>

      <div className={`flex items-center gap-2 ${action ? '' : '[&>*]:flex-1'}`}>
        {phone ? (
          <a href={`tel:${phone}`} onClick={stop} className={leadSideBtn}>
            Call
          </a>
        ) : (
          <button type="button" onClick={(e) => { stop(e); soon(); }} className={leadSideBtn}>
            Call
          </button>
        )}

        {phone ? (
          <button
            type="button"
            onClick={(e) => {
              stop(e);
              openWhatsAppShare(
                `Hi ${lead.student_name}, this is regarding your enquiry at ${lead.hostel?.name ?? 'our hostel'}.`,
                phone ?? undefined,
              );
            }}
            aria-label={`WhatsApp ${lead.student_name}`}
            className={leadSideBtn}
          >
            <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
            Chat
          </button>
        ) : (
          <button type="button" onClick={(e) => { stop(e); soon(); }} className={leadSideBtn}>
            Chat
          </button>
        )}

        {action && (
          <button
            type="button"
            onClick={(e) => { stop(e); onPrimary(); }}
            className={actionBtn}
          >
            {PRIMARY_ACTION_LABEL[action]}
          </button>
        )}
      </div>
    </div>
  );
}
