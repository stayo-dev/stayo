import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Inbox, Mail, MessageSquareWarning, Phone } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';

type TicketStatus = 'OPEN' | 'RESOLVED';

const TABS: { key: TicketStatus; label: string }[] = [
  { key: 'OPEN', label: 'Open' },
  { key: 'RESOLVED', label: 'Resolved' },
];

const CATEGORY_LABEL: Record<string, string> = {
  APP_BUG: 'App or website bug',
  ACCOUNT_ISSUE: 'Account issue',
  PAYMENT_ISSUE: 'Payment issue',
  OTHER: 'Something else',
};

function timeAgo(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

/**
 * Stayo Admin's queue for Profile → "Raise a Ticket" (ADR-079) — app/website
 * problems reported by any signed-in Stayo account, not hostel complaints.
 * Simpler than `AdminDocumentsPage` (flat list, no file viewer — tickets are
 * text, not uploads, and aren't naturally grouped by anything).
 */
export function AdminSupportTicketsPage() {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TicketStatus>('OPEN');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    document.title = 'Support tickets — Stayo Admin';
  }, []);

  const listQuery = useQuery({
    queryKey: ['admin', 'support-tickets', tab],
    queryFn: () => platformAdminService.getSupportTickets(tab),
    staleTime: 15_000,
  });

  const openCountQuery = useQuery({
    queryKey: ['admin', 'support-tickets', 'OPEN'],
    queryFn: () => platformAdminService.getSupportTickets('OPEN'),
    staleTime: 15_000,
  });

  const tickets = listQuery.data ?? [];
  const selected = tickets.find((t) => t.id === selectedId) ?? tickets[0] ?? null;

  useEffect(() => {
    if (tickets.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!tickets.some((t) => t.id === selectedId)) {
      setSelectedId(tickets[0].id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickets]);

  const resolveMutation = useMutation({
    mutationFn: ({ id, resolveNote }: { id: string; resolveNote: string }) =>
      platformAdminService.resolveSupportTicket(id, resolveNote),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'support-tickets'] });
      stayoToast.success('Marked resolved');
      setNote('');
    },
    onError: (error: any) =>
      stayoToast.error(error?.response?.data?.error?.message || 'Could not resolve that ticket'),
  });

  const openCount = openCountQuery.data?.length ?? 0;

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-5 sm:px-7">
      <div className="mb-4">
        <p className="text-[13.5px] text-[#8A7F75]">
          App/website problems reported through Profile → Raise a ticket — separate from hostel complaints.
        </p>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => {
              setTab(t.key);
              setSelectedId(null);
            }}
            className={`inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
              tab === t.key ? 'bg-foreground text-background' : 'border border-[#E7DDD1] bg-white text-[#8A7F75]'
            }`}
          >
            {t.label}
            {t.key === 'OPEN' && openCount > 0 && (
              <span
                className={`rounded-full px-1.5 text-[10.5px] font-bold tabular-nums ${
                  tab === t.key ? 'bg-background/25 text-background' : 'bg-primary/12 text-primary'
                }`}
              >
                {openCount}
              </span>
            )}
          </button>
        ))}
      </div>

      {listQuery.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-2.5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[74px] animate-pulse rounded-[14px] bg-muted" />
            ))}
          </div>
          <div className="hidden h-[360px] animate-pulse rounded-[14px] bg-muted lg:block" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-[14px] border border-[#EFE6DA] bg-white py-16 text-center">
          <Inbox className="mx-auto mb-3 h-9 w-9 text-[#C9BDB1]" strokeWidth={1.6} />
          <p className="text-[14px] font-bold text-foreground">
            {tab === 'OPEN' ? 'Nothing waiting for a response' : 'No resolved tickets'}
          </p>
          <p className="mt-1 text-[12.5px] text-[#8A7F75]">
            {tab === 'OPEN' ? 'New tickets from Profile → Raise a ticket appear here.' : 'Tickets you resolve will show up here.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          {/* QUEUE */}
          <div
            className={`space-y-2.5 lg:max-h-[calc(100vh-220px)] lg:overflow-y-auto lg:pr-1 ${
              selected ? 'hidden lg:block' : ''
            }`}
          >
            {tickets.map((t) => {
              const active = t.id === selected?.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full rounded-[14px] border bg-white p-3.5 text-left transition-colors ${
                    active ? 'border-primary shadow-[0_0_0_1px_rgba(164,93,68,0.35)]' : 'border-[#EFE6DA] hover:border-[#DCCDBE]'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-foreground">{t.subject}</span>
                  </div>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-md bg-[#F7F3EF] px-1.5 py-0.5 text-[10.5px] font-bold text-[#8A7F75]">
                      {CATEGORY_LABEL[t.category] ?? t.category}
                    </span>
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-[#9C9186]">{t.profile.name} · {timeAgo(t.created_at)}</div>
                </button>
              );
            })}
          </div>

          {/* DETAIL PANE */}
          {selected && (
            <div className="rounded-[14px] border border-[#EFE6DA] bg-white">
              <div className="flex items-start gap-3 border-b border-[#F2ECE5] p-4">
                <button
                  type="button"
                  onClick={() => setSelectedId(null)}
                  aria-label="Back to queue"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[#E7DDD1] text-[#8A7F75] lg:hidden"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[17px] font-extrabold text-foreground">{selected.subject}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12.5px] text-[#8A7F75]">
                    <span>{selected.profile.name}</span>
                    {selected.profile.phone && (
                      <a href={`tel:${selected.profile.phone}`} className="inline-flex items-center gap-1 tabular-nums hover:text-primary">
                        <Phone className="h-3 w-3" />
                        {selected.profile.phone}
                      </a>
                    )}
                    {selected.profile.email && (
                      <a href={`mailto:${selected.profile.email}`} className="inline-flex items-center gap-1 hover:text-primary">
                        <Mail className="h-3 w-3" />
                        {selected.profile.email}
                      </a>
                    )}
                    <span>{timeAgo(selected.created_at)}</span>
                  </div>
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] bg-primary/10 text-primary">
                    <MessageSquareWarning className="h-4 w-4" strokeWidth={2.2} />
                  </span>
                  <span className="rounded-md bg-[#F7F3EF] px-2 py-1 text-[11px] font-bold text-[#8A7F75]">
                    {CATEGORY_LABEL[selected.category] ?? selected.category}
                  </span>
                  {selected.status === 'RESOLVED' && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] font-bold text-success">
                      <CheckCircle2 className="h-3 w-3" strokeWidth={2.8} />
                      Resolved
                    </span>
                  )}
                </div>

                <p className="mt-3 whitespace-pre-wrap text-[13px] leading-[1.6] text-[#2A2521]">{selected.description}</p>

                {selected.admin_note && (
                  <p className="mt-3 rounded-lg bg-[#F7F3EF] px-3 py-2 text-[12px] text-[#6B5B52]">
                    <span className="font-bold">Your note:</span> {selected.admin_note}
                  </p>
                )}

                {selected.status === 'OPEN' && (
                  <div className="mt-4">
                    <label className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-[#9C9186]">
                      Resolution note (optional)
                    </label>
                    <textarea
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      rows={2}
                      placeholder="What was done, or shown back to the reporter…"
                      className="w-full resize-none rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-3 py-2 text-[12.5px] outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      disabled={resolveMutation.isPending}
                      onClick={() => resolveMutation.mutate({ id: selected.id, resolveNote: note.trim() })}
                      className="mt-2 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-[10px] bg-success text-[13px] font-bold text-white disabled:opacity-60"
                    >
                      <CheckCircle2 className="h-4 w-4" strokeWidth={2.5} />
                      {resolveMutation.isPending ? 'Resolving…' : 'Mark resolved'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
