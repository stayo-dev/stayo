import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bug, CreditCard, User, HelpCircle, Check } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { EmptyState, FilterChips, StatCard } from '../ui';
import { ADMIN_CARD, tintForId } from '../theme/palette';
import { useToast } from '../layout/toastContext';

type TicketStatus = 'OPEN' | 'RESOLVED';

const CATEGORY: Record<string, { label: string; icon: typeof Bug; tint: string; ink: string }> = {
  APP_BUG: { label: 'App or website bug', icon: Bug, tint: '#FBEFE9', ink: '#B3402F' },
  ACCOUNT_ISSUE: { label: 'Account issue', icon: User, tint: '#EAF0FB', ink: '#3B5B9E' },
  PAYMENT_ISSUE: { label: 'Payment issue', icon: CreditCard, tint: '#FBF1DE', ink: '#B8792B' },
  OTHER: { label: 'Something else', icon: HelpCircle, tint: '#F2ECE5', ink: '#8A7F75' },
};

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

/**
 * Reports & Bugs — the design's Support section, backed by the Profile →
 * "Raise a Ticket" queue (see Decisions.md, the support-ticket ADR).
 *
 * These are problems with Stayo itself reported by any signed-in account —
 * deliberately not hostel complaints, which belong to the owner, not to us.
 * This screen shipped as a `NotWiredYet` placeholder during the console
 * rebuild because no backend existed; the support-ticket work supplied one,
 * so it is now real.
 */
export function ReportsPage() {
  const [tab, setTab] = useState<TicketStatus>('OPEN');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const queryClient = useQueryClient();
  const fireToast = useToast();

  const tickets = useQuery({
    queryKey: ['admin', 'support-tickets', tab],
    queryFn: () => platformAdminService.getSupportTickets(tab),
    staleTime: 15_000,
  });
  const openTickets = useQuery({
    queryKey: ['admin', 'support-tickets', 'OPEN'],
    queryFn: () => platformAdminService.getSupportTickets('OPEN'),
    staleTime: 15_000,
  });

  const resolve = useMutation({
    mutationFn: ({ id, adminNote }: { id: string; adminNote?: string }) =>
      platformAdminService.resolveSupportTicket(id, adminNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'support-tickets'] });
      setSelectedId(null);
      setNote('');
      fireToast('Ticket resolved — the reporter is notified');
    },
    onError: () => fireToast('Could not resolve that ticket', 'no'),
  });

  const rows = tickets.data ?? [];
  const open = openTickets.data ?? [];
  const byCategory = (key: string) => open.filter((t) => t.category === key).length;

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-[18px]">
      <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
        <StatCard label="Open tickets" value={String(open.length)} sub="awaiting a reply" valueTone={open.length ? 'red' : 'ink'} />
        <StatCard label="App & website bugs" value={String(byCategory('APP_BUG'))} sub="reported as broken" />
        <StatCard label="Payment issues" value={String(byCategory('PAYMENT_ISSUE'))} sub="money-related" valueTone="amber" />
        <StatCard label="Account issues" value={String(byCategory('ACCOUNT_ISSUE'))} sub="sign-in & profile" />
      </div>

      <FilterChips
        chips={[
          { key: 'OPEN', label: 'Open', count: open.length },
          { key: 'RESOLVED', label: 'Resolved' },
        ]}
        active={tab}
        onChange={(k) => { setTab(k as TicketStatus); setSelectedId(null); }}
      />

      {tickets.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading tickets…</div>
      ) : rows.length === 0 ? (
        <EmptyState
          title={tab === 'OPEN' ? 'Nothing reported 🎉' : 'Nothing resolved yet'}
          message={
            tab === 'OPEN'
              ? 'Problems raised through Profile → Raise a ticket appear here.'
              : 'Resolved tickets are kept here as a record.'
          }
        />
      ) : (
        <div className={`${ADMIN_CARD} overflow-hidden`}>
          {rows.map((t, index) => {
            const meta = CATEGORY[t.category] ?? CATEGORY.OTHER;
            const Icon = meta.icon;
            const isOpen = selectedId === t.id;
            return (
              <div key={t.id} className={index > 0 ? 'border-t border-[#F2ECE5]' : ''}>
                <button
                  type="button"
                  onClick={() => setSelectedId(isOpen ? null : t.id)}
                  className="flex w-full items-center gap-3.5 px-5 py-[15px] text-left hover:bg-[#FCFAF7]"
                >
                  <span
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-[10px]"
                    style={{ background: meta.tint }}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.8} style={{ color: meta.ink }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-[#2A2521]">{t.subject}</span>
                      <span
                        className="flex-none rounded px-1.5 py-0.5 text-[10px] font-semibold"
                        style={{ background: meta.tint, color: meta.ink }}
                      >
                        {meta.label}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-[11.5px] text-[#9A8F84]">
                      {t.profile?.name ?? 'Unknown'} · {t.profile?.phone || t.profile?.email || 'no contact'}
                    </span>
                  </span>
                  <span className="flex-none text-[11.5px] text-[#B0A597]">{timeAgo(t.created_at)}</span>
                  <span
                    className={`flex-none rounded-full px-2.5 py-1 text-[11px] font-semibold ${
                      t.status === 'OPEN' ? 'bg-[#FBF1DE] text-[#B8792B]' : 'bg-[#EAF3EE] text-[#1F7A52]'
                    }`}
                  >
                    {t.status === 'OPEN' ? 'Open' : 'Resolved'}
                  </span>
                </button>

                {isOpen && (
                  <div className="border-t border-[#F2ECE5] bg-[#FAF6F1] px-5 py-4">
                    <div className="flex items-start gap-3">
                      <span
                        className="flex h-8 w-8 flex-none items-center justify-center rounded-full font-admin text-[11px] font-bold text-white"
                        style={{ background: tintForId(t.profile?.id ?? t.id) }}
                      >
                        {(t.profile?.name ?? '?').slice(0, 2).toUpperCase()}
                      </span>
                      <p className="min-w-0 flex-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-[#4A433C]">
                        {t.description}
                      </p>
                    </div>

                    {t.status === 'OPEN' ? (
                      <div className="mt-4 flex flex-wrap items-center gap-2.5">
                        <input
                          value={note}
                          onChange={(e) => setNote(e.target.value)}
                          placeholder="What did you do about it? (optional, shown to the reporter)"
                          className="min-w-[220px] flex-1 rounded-[10px] border border-[#E7DDD1] bg-white px-3 py-2.5 text-[12.5px] text-[#2A2521] outline-none"
                        />
                        <button
                          type="button"
                          disabled={resolve.isPending}
                          onClick={() => resolve.mutate({ id: t.id, adminNote: note.trim() || undefined })}
                          className="flex items-center gap-1.5 rounded-[11px] bg-[#1F7A52] px-[18px] py-2.5 font-admin text-[12.5px] font-bold text-white shadow-[0_4px_12px_rgba(31,122,82,.28)] disabled:opacity-50"
                        >
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                          Mark resolved
                        </button>
                      </div>
                    ) : (
                      <div className="mt-3 rounded-[10px] border border-[#CDE6D8] bg-[#EAF3EE] px-3.5 py-2.5">
                        <div className="text-[11px] font-bold uppercase tracking-[.06em] text-[#1F7A52]">
                          Resolved {t.resolved_at ? timeAgo(t.resolved_at) : ''}
                        </div>
                        {t.admin_note && (
                          <div className="mt-1 text-[12px] text-[#4A433C]">{t.admin_note}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
