import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  Clock,
  MessageCircle,
  Phone,
  Search,
  Send,
  X,
} from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';
import {
  ageLabel,
  canApprove,
  canReject,
  isStale,
  partitionForBulkReject,
  sortForQueue,
  stepIndex,
  STATUS_LABEL,
  STATUS_TONE,
  type AdminLead,
} from '../leads/leadQueue';

const PAGE_SIZE = 50;

const FILTERS: { key: string; label: string }[] = [
  { key: 'ACTIONABLE', label: 'Needs you' },
  { key: 'ALL', label: 'All' },
  { key: 'NEW', label: 'New' },
  { key: 'UNDER_REVIEW', label: 'Under review' },
  { key: 'APPROVED', label: 'Send failed' },
  { key: 'INVITE_SENT', label: 'Invite sent' },
  { key: 'LIVE', label: 'Live' },
  { key: 'LOST', label: 'Not proceeding' },
];

const TONE_CHIP: Record<string, string> = {
  action: 'bg-primary/12 text-primary',
  progress: 'bg-info/12 text-info',
  done: 'bg-success/12 text-success',
  dead: 'bg-[#C0503A]/10 text-[#C0503A]',
};

const QUICK_REJECT_REASONS = [
  'Not a hostel owner.',
  'Outside the cities we currently serve.',
  'Duplicate enquiry.',
  'Could not reach you after repeated attempts.',
];

const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();

const waLink = (phone: string) => `https://wa.me/91${phone.replace(/\D/g, '').slice(-10)}`;

/**
 * Admin lead queue, sized for ~100 leads a day.
 *
 * Rebuilt from a grid of large cards plus a drawer. At this volume the screen
 * stops being something you browse and becomes something you work, which
 * drives every choice here: dense rows so a screenful is fifteen leads rather
 * than three, a detail pane beside the list instead of a drawer that covers
 * it, keyboard movement, and bulk reject — the alternative is opening and
 * closing a drawer a hundred times a day.
 *
 * It also fixes two real defects: the list was capped at `take: 200` with no
 * total and no next page (silently truncating after two days), and actions
 * were offered on leads whose status makes them impossible — Approve on an
 * `INVITE_SENT` lead throws `INVALID_TRANSITION` on the server.
 *
 * Ordering, actionability and bulk partitioning are pure and tested in
 * `../leads/leadQueue`.
 */
export function AdminLeadsPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ACTIONABLE');
  const [openId, setOpenId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState(1);
  const [rejectMode, setRejectMode] = useState<'single' | 'bulk' | null>(null);
  const [reason, setReason] = useState('');

  // "Needs you" is a view over statuses, not a status the server knows, so it
  // fetches unfiltered and narrows below.
  const statusParam = filter === 'ALL' || filter === 'ACTIONABLE' ? undefined : filter;

  const listQuery = useQuery({
    queryKey: ['admin', 'leads', search, statusParam, pages],
    queryFn: () =>
      platformAdminService.getLeads({
        search: search || undefined,
        status: statusParam,
        limit: PAGE_SIZE * pages,
        offset: 0,
      }),
    staleTime: 10_000,
  });

  const counts = listQuery.data?.counts ?? {};
  const actionableCount = (counts.NEW ?? 0) + (counts.UNDER_REVIEW ?? 0) + (counts.APPROVED ?? 0);

  const leads = useMemo(() => {
    const raw = (listQuery.data?.leads ?? []) as AdminLead[];
    const scoped = filter === 'ACTIONABLE' ? raw.filter((l) => canApprove(l.status)) : raw;
    return sortForQueue(scoped);
  }, [listQuery.data, filter]);

  const openIndex = Math.max(0, leads.findIndex((l) => l.id === openId));
  const open = leads.find((l) => l.id === openId) ?? null;

  const detailQuery = useQuery({
    queryKey: ['admin', 'lead-detail', openId],
    queryFn: () => platformAdminService.getLead(openId as string),
    enabled: Boolean(openId),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'leads'] });
    if (openId) queryClient.invalidateQueries({ queryKey: ['admin', 'lead-detail', openId] });
  };

  const approveMutation = useMutation({
    mutationFn: (id: string) => platformAdminService.approveLead(id),
    onSuccess: (result: any) => {
      invalidate();
      if (result.whatsapp_sent) stayoToast.success('Activation link sent on WhatsApp');
      else if (result.email_sent) stayoToast.success('Activation link sent by email');
      else stayoToast.error(result.email_error || result.whatsapp_error || 'Approved, but the link could not be sent');
    },
    onError: (e: any) => stayoToast.error(e?.response?.data?.error?.message || 'Could not approve'),
  });

  const rejectMutation = useMutation({
    mutationFn: ({ ids, why }: { ids: string[]; why: string }) =>
      Promise.all(ids.map((id) => platformAdminService.rejectLead(id, why))),
    onSuccess: (_r, variables) => {
      invalidate();
      stayoToast.success(
        variables.ids.length === 1 ? 'Rejected — the applicant is told why' : `${variables.ids.length} leads rejected`,
      );
      setRejectMode(null);
      setReason('');
      setSelected(new Set());
    },
    onError: (e: any) => stayoToast.error(e?.response?.data?.error?.message || 'Could not reject'),
  });

  // Keyboard movement. At a hundred a day, reaching for the mouse on every row
  // is most of the work.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && /input|textarea|select/i.test(el.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        setOpenId(leads[stepIndex(leads.length, openIndex, 1)]?.id ?? null);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        setOpenId(leads[stepIndex(leads.length, openIndex, -1)]?.id ?? null);
      } else if (e.key === 'a' && open && canApprove(open.status)) {
        e.preventDefault();
        approveMutation.mutate(open.id);
      } else if (e.key === 'r' && open && canReject(open.status)) {
        e.preventDefault();
        setRejectMode('single');
        setReason('');
      } else if (e.key === 'Escape') {
        setRejectMode(null);
        setSelected(new Set());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [leads, openIndex, open]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSelected = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Deep link from the dashboard's Reject button, which no longer decides
  // anything itself — it hands over to here, where a reason is captured.
  useEffect(() => {
    const rejectId = searchParams.get('reject');
    if (!rejectId) return;
    setFilter('ALL');
    setOpenId(rejectId);
    setRejectMode('single');
    setReason('');
    searchParams.delete('reject');
    setSearchParams(searchParams, { replace: true });
  }, [searchParams, setSearchParams]);

  const bulk = partitionForBulkReject(leads, selected);
  const timeline: Array<{ id: string; event_type: string; created_at: string }> = detailQuery.data?.timeline ?? [];

  return (
    <div className="mx-auto max-w-[1360px] px-4 py-5 sm:px-7">
      <div className="mb-3 flex flex-wrap items-center gap-2.5">
        <div className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-[11px] border border-[#E7DDD1] bg-white px-3 sm:max-w-[340px]">
          <Search className="h-4 w-4 flex-none text-[#9C9186]" />
          <input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPages(1);
            }}
            placeholder="Name, hostel, city or phone…"
            className="w-full min-w-0 bg-transparent text-[13px] text-foreground outline-none"
          />
          {search && (
            <button type="button" onClick={() => setSearch('')} aria-label="Clear search">
              <X className="h-3.5 w-3.5 text-[#9C9186]" />
            </button>
          )}
        </div>
        <span className="hidden text-[12px] text-[#9C9186] lg:inline">J / K to move · A approve · R reject</span>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {FILTERS.map((f) => {
          const count = f.key === 'ACTIONABLE' ? actionableCount : counts[f.key === 'ALL' ? 'ALL' : f.key];
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setFilter(f.key);
                setPages(1);
                setOpenId(null);
              }}
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-semibold transition-colors ${
                filter === f.key ? 'bg-foreground text-background' : 'border border-[#E7DDD1] bg-white text-[#8A7F75]'
              }`}
            >
              {f.label}
              {typeof count === 'number' && count > 0 && (
                <span
                  className={`rounded-full px-1.5 text-[10.5px] font-bold tabular-nums ${
                    filter === f.key ? 'bg-background/25' : 'bg-[#F2ECE5] text-[#8A7F75]'
                  }`}
                >
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {listQuery.isLoading ? (
        <div className="space-y-1.5">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="h-[58px] animate-pulse rounded-[11px] bg-muted" />
          ))}
        </div>
      ) : leads.length === 0 ? (
        <div className="rounded-[14px] border border-[#EFE6DA] bg-white py-16 text-center">
          <Check className="mx-auto mb-3 h-9 w-9 text-[#C9BDB1]" strokeWidth={1.6} />
          <p className="text-[14px] font-bold text-foreground">
            {filter === 'ACTIONABLE' ? 'Nothing needs you right now' : 'No leads match'}
          </p>
          <p className="mt-1 text-[12.5px] text-[#8A7F75]">
            {filter === 'ACTIONABLE' ? 'Every lead has been decided.' : 'Try a different filter or search.'}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className={open ? 'hidden xl:block' : ''}>
            <div className="overflow-hidden rounded-[14px] border border-[#EFE6DA] bg-white">
              {leads.map((lead) => {
                const active = lead.id === openId;
                const stale = isStale(lead);
                const tone = STATUS_TONE[lead.status] ?? 'progress';

                return (
                  <div
                    key={lead.id}
                    className={`flex items-center gap-2.5 border-b border-[#F2ECE5] px-3 py-2.5 last:border-b-0 ${
                      active ? 'bg-[#FBF6F1]' : 'hover:bg-[#FCFAF8]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(lead.id)}
                      onChange={() => toggleSelected(lead.id)}
                      aria-label={`Select ${lead.name}`}
                      className="h-3.5 w-3.5 flex-none accent-[#A45D44]"
                    />
                    <button
                      type="button"
                      onClick={() => setOpenId(lead.id)}
                      className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                    >
                      <span className="flex h-7 w-7 flex-none items-center justify-center rounded-lg bg-[#F2ECE5] text-[10.5px] font-bold text-[#8A7F75]">
                        {initials(lead.name)}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold text-foreground">{lead.name}</span>
                        <span className="block truncate text-[11.5px] text-[#8A7F75]">
                          {lead.hostel_name}
                          {lead.city ? ` · ${lead.city}` : ''}
                        </span>
                      </span>
                      <span
                        className={`hidden flex-none rounded-full px-2 py-0.5 text-[10.5px] font-bold sm:inline ${TONE_CHIP[tone]}`}
                      >
                        {STATUS_LABEL[lead.status] ?? lead.status}
                      </span>
                      <span
                        className={`flex w-[52px] flex-none items-center justify-end gap-1 text-[11px] font-semibold tabular-nums ${
                          stale ? 'text-[#C0503A]' : 'text-[#9C9186]'
                        }`}
                      >
                        {stale && <AlertCircle className="h-3 w-3" strokeWidth={2.8} />}
                        {ageLabel(lead.created_at)}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>

            <div className="mt-3 flex items-center justify-between gap-3">
              <span className="text-[12px] text-[#9C9186]">
                Showing {leads.length} of {listQuery.data?.total ?? leads.length}
              </span>
              {listQuery.data?.hasMore && (
                <button
                  type="button"
                  onClick={() => setPages((p) => p + 1)}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-[#E7DDD1] bg-white px-3.5 py-2 text-[12.5px] font-bold text-foreground hover:border-primary"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                  Load {PAGE_SIZE} more
                </button>
              )}
            </div>
          </div>

          {open && (
            <div className="rounded-[14px] border border-[#EFE6DA] bg-white xl:sticky xl:top-4 xl:max-h-[calc(100vh-140px)] xl:overflow-y-auto">
              <div className="flex items-start gap-2.5 border-b border-[#F2ECE5] p-4">
                <button
                  type="button"
                  onClick={() => setOpenId(null)}
                  aria-label="Back to list"
                  className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border border-[#E7DDD1] text-[#8A7F75] xl:hidden"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-display text-[17px] font-extrabold text-foreground">{open.name}</div>
                  <div className="truncate text-[12.5px] text-[#8A7F75]">{open.hostel_name}</div>
                  <span
                    className={`mt-1.5 inline-block rounded-full px-2 py-0.5 text-[10.5px] font-bold ${
                      TONE_CHIP[STATUS_TONE[open.status] ?? 'progress']
                    }`}
                  >
                    {STATUS_LABEL[open.status] ?? open.status}
                  </span>
                </div>
              </div>

              <div className="flex gap-2 border-b border-[#F2ECE5] p-4">
                <a
                  href={`tel:${open.phone}`}
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[#E7DDD1] text-[12.5px] font-bold text-[#8A7F75] hover:border-primary hover:text-primary"
                >
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
                <a
                  href={waLink(open.phone)}
                  target="_blank"
                  rel="noreferrer"
                  className="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[#E7DDD1] text-[12.5px] font-bold text-[#8A7F75] hover:border-success hover:text-success"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              </div>

              <dl className="space-y-2 border-b border-[#F2ECE5] p-4 text-[12.5px]">
                <div className="flex justify-between gap-3">
                  <dt className="text-[#8A7F75]">Phone</dt>
                  <dd className="font-bold tabular-nums text-foreground">{open.phone}</dd>
                </div>
                {open.city && (
                  <div className="flex justify-between gap-3">
                    <dt className="text-[#8A7F75]">City</dt>
                    <dd className="font-bold text-foreground">{open.city}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt className="text-[#8A7F75]">Waiting</dt>
                  <dd className="font-bold text-foreground">{ageLabel(open.created_at)}</dd>
                </div>
              </dl>

              {timeline.length > 0 && (
                <div className="border-b border-[#F2ECE5] p-4">
                  <div className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#9C9186]">Timeline</div>
                  <div className="space-y-2">
                    {timeline.slice(0, 6).map((e) => (
                      <div key={e.id} className="flex items-start gap-2">
                        <Clock className="mt-0.5 h-3 w-3 flex-none text-[#C9BDB1]" />
                        <div className="min-w-0">
                          <div className="truncate text-[12px] font-semibold capitalize text-foreground">
                            {e.event_type.replace(/_/g, ' ').toLowerCase()}
                          </div>
                          <div className="text-[10.5px] text-[#9C9186]">
                            {new Date(e.created_at).toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              hour: 'numeric',
                              minute: '2-digit',
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Only actions that can actually succeed are offered — the old
                  screen showed Approve on leads where the server refuses it. */}
              <div className="p-4">
                {rejectMode === 'single' ? (
                  <RejectForm
                    reason={reason}
                    setReason={setReason}
                    pending={rejectMutation.isPending}
                    onCancel={() => setRejectMode(null)}
                    onConfirm={() => rejectMutation.mutate({ ids: [open.id], why: reason.trim() })}
                  />
                ) : (
                  <div className="flex gap-2">
                    {canApprove(open.status) && (
                      <button
                        type="button"
                        disabled={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(open.id)}
                        className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] bg-success text-[13px] font-bold text-white disabled:opacity-60"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {open.status === 'APPROVED' ? 'Retry send' : 'Approve'}
                      </button>
                    )}
                    {canReject(open.status) && (
                      <button
                        type="button"
                        onClick={() => {
                          setRejectMode('single');
                          setReason('');
                        }}
                        className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[#EAD0C9] text-[13px] font-bold text-[#C0503A]"
                      >
                        <X className="h-3.5 w-3.5" /> Reject
                      </button>
                    )}
                    {!canApprove(open.status) && !canReject(open.status) && (
                      <p className="text-[12.5px] leading-relaxed text-[#8A7F75]">
                        This lead has moved past the point where an admin decides — it now progresses on its own.
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {selected.size > 0 && (
        <div className="fixed inset-x-3 bottom-[86px] z-40 mx-auto max-w-[560px] rounded-2xl border border-[#EFE6DA] bg-white p-3.5 shadow-[0_18px_44px_-16px_rgba(40,30,20,0.35)] min-[900px]:bottom-5">
          {rejectMode === 'bulk' ? (
            <RejectForm
              reason={reason}
              setReason={setReason}
              pending={rejectMutation.isPending}
              label={`Rejecting ${bulk.eligible.length} lead${bulk.eligible.length === 1 ? '' : 's'}`}
              onCancel={() => setRejectMode(null)}
              onConfirm={() => rejectMutation.mutate({ ids: bulk.eligible.map((l) => l.id), why: reason.trim() })}
            />
          ) : (
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-[13px] font-bold text-foreground">{selected.size} selected</span>
              {/* Say what will be skipped rather than silently dropping it. */}
              {bulk.skipped.length > 0 && (
                <span className="text-[11.5px] text-[#8A7F75]">
                  {bulk.skipped.length} can&apos;t be rejected — a link is already out
                </span>
              )}
              <div className="ml-auto flex gap-2">
                <button
                  type="button"
                  onClick={() => setSelected(new Set())}
                  className="rounded-[10px] px-3 py-2 text-[12.5px] font-bold text-[#8A7F75]"
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={bulk.eligible.length === 0}
                  onClick={() => {
                    setRejectMode('bulk');
                    setReason('');
                  }}
                  className="rounded-[10px] bg-[#C0503A] px-3.5 py-2 text-[12.5px] font-bold text-white disabled:opacity-40"
                >
                  Reject {bulk.eligible.length}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RejectForm({
  reason,
  setReason,
  pending,
  onCancel,
  onConfirm,
  label,
}: {
  reason: string;
  setReason: (v: string) => void;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  label?: string;
}) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[#9C9186]">
        {label ?? 'Why are they not proceeding?'}
      </div>
      <p className="mb-2 text-[11.5px] text-[#8A7F75]">The applicant is shown this, so write it for them.</p>
      <div className="mb-2 flex flex-wrap gap-1.5">
        {QUICK_REJECT_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setReason(r)}
            className="rounded-full border border-[#E7DDD1] px-2.5 py-1 text-[11.5px] font-semibold text-[#8A7F75] hover:border-primary hover:text-primary"
          >
            {r.replace(/\.$/, '')}
          </button>
        ))}
      </div>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        rows={2}
        autoFocus
        placeholder="Add or edit the reason…"
        className="w-full resize-none rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-3 py-2 text-[12.5px] outline-none focus:border-primary"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          disabled={!reason.trim() || pending}
          onClick={onConfirm}
          className="h-9 flex-1 rounded-[10px] bg-[#C0503A] text-[12.5px] font-bold text-white disabled:opacity-50"
        >
          {pending ? 'Rejecting…' : 'Confirm rejection'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="h-9 flex-1 rounded-[10px] border border-[#E7DDD1] text-[12.5px] font-bold text-[#8A7F75]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
