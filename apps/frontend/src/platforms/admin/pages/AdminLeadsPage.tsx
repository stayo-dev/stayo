import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Search, X, Phone, MessageCircle, ChevronRight } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { platformAdminService } from '@features/platform-admin/api';

const STATUS_CHIP: Record<string, { chip: string; dot: string }> = {
  NEW: { chip: 'bg-info/10 text-info', dot: 'bg-info' },
  UNDER_REVIEW: { chip: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  APPROVED: { chip: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  INVITE_SENT: { chip: 'bg-warning/10 text-warning', dot: 'bg-warning' },
  OWNER_ACTIVATED: { chip: 'bg-success/10 text-success', dot: 'bg-success' },
  HOSTEL_CREATED: { chip: 'bg-success/10 text-success', dot: 'bg-success' },
  LIVE: { chip: 'bg-success/10 text-success', dot: 'bg-success' },
  LOST: { chip: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
};
// All 8 — used for the filter row (any status is a useful filter).
const STATUSES = ['NEW', 'UNDER_REVIEW', 'APPROVED', 'INVITE_SENT', 'OWNER_ACTIVATED', 'HOSTEL_CREATED', 'LIVE', 'LOST'];
// Only these are manually editable from the drawer's dropdown — APPROVED
// onward is system-managed by the real approve/signup/hostel-creation flow
// (see PATCH /api/platform-admin/leads/[id], which rejects anything else).
const MANUALLY_SETTABLE_STATUSES = ['NEW', 'UNDER_REVIEW', 'LOST'];
// APPROVED means "approved, but the link failed to send" (see
// lead-invitation-service.ts) — the button stays available so the admin
// can retry, rather than the lead getting silently stuck.
const APPROVABLE_STATUSES = ['NEW', 'UNDER_REVIEW', 'APPROVED'];

const TIMELINE_LABEL: Record<string, string> = {
  LEAD_CREATED: 'Lead created',
  LEAD_APPROVED: 'Approved',
  LEAD_INVITE_SENT: 'Invitation sent',
  LEAD_INVITE_OPENED: 'Invitation opened',
  LEAD_OWNER_ACTIVATED: 'Owner activated',
  LEAD_HOSTEL_CREATED: 'Hostel created',
  LEAD_LIVE: 'Live',
};

const AVATAR_PALETTE = [
  { bg: 'bg-primary/10', fg: 'text-primary' },
  { bg: 'bg-success/10', fg: 'text-success' },
  { bg: 'bg-warning/10', fg: 'text-warning' },
  { bg: 'bg-info/10', fg: 'text-info' },
  { bg: 'bg-destructive/10', fg: 'text-destructive' },
  { bg: 'bg-secondary', fg: 'text-foreground' },
];

const initials = (name: string) => name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
const avatarStyle = (name: string) => {
  const hash = name.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0);
  return AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
};
const fmtSubmitted = (iso: string) =>
  `${new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} · ${new Date(iso).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}`;

function StatusChip({ status }: { status: string }) {
  const s = STATUS_CHIP[status] ?? STATUS_CHIP.NEW;
  return (
    <span className={`flex flex-none items-center gap-1.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${s.chip}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {status.replace('_', ' ')}
    </span>
  );
}

/**
 * Shown when a lead's number was never OTP-verified — WhatsApp was
 * unavailable when the lead came in, so signup accepted the number as-is.
 * Deliberately compares against `false`: leads captured before the column
 * existed arrive as `undefined` and should carry no marker rather than a
 * false accusation.
 */
function UnverifiedPhoneChip() {
  return (
    <span
      title="This number was never OTP-verified — WhatsApp was unavailable when the lead came in."
      className="flex-none rounded-full border border-[#E7DDD1] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#8A7F75]"
    >
      Unverified
    </span>
  );
}

export function AdminLeadsPage() {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [openId, setOpenId] = useState<string | null>(null);

  const listQuery = useQuery({
    queryKey: ['admin', 'leads', search, statusFilter],
    queryFn: () => platformAdminService.getLeads({ search: search || undefined, status: statusFilter }),
    staleTime: 15_000,
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => platformAdminService.updateLeadStatus(id, status),
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'leads'] });
      // The list query above is a *different* React Query key from the
      // drawer's own detail query ('lead-detail', not 'leads') — without
      // this, the open drawer kept showing the pre-mutation status/Approve
      // button until manually reopened, letting a second click hit the
      // now-stale button and 409 with "already approved/updated".
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead-detail', variables.id] });
    },
    onError: () => stayoToast.error('Could not update lead'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => platformAdminService.approveLead(id),
    onSuccess: (result, id) => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'leads'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead-detail', id] });
      if (result.whatsapp_sent) stayoToast.success('Activation link sent via WhatsApp');
      else if (result.email_sent) stayoToast.success('Activation link sent via email');
      else stayoToast.error(result.email_error || result.whatsapp_error || 'Approved, but the activation link could not be sent');
    },
    onError: (error: any) => stayoToast.error(error?.response?.data?.error?.message || 'Could not approve lead'),
  });

  const leadDetailQuery = useQuery({
    queryKey: ['admin', 'lead-detail', openId],
    queryFn: () => platformAdminService.getLead(openId as string),
    enabled: Boolean(openId),
  });

  const openLead = leadDetailQuery.data ?? listQuery.data?.find((l) => l.id === openId);
  const timeline: Array<{ id: string; event_type: string; created_at: string }> = leadDetailQuery.data?.timeline ?? [];
  const waLink = (phone: string) => `https://wa.me/91${phone.replace(/\D/g, '').slice(-10)}`;

  return (
    <div className="mx-auto max-w-[1360px] px-7 py-6">
      <div className="mb-[18px] flex flex-wrap items-center gap-3">
        <div className="flex h-10 w-[300px] items-center gap-2 rounded-[11px] border border-[#E7DDD1] bg-white px-3">
          <Search className="h-4 w-4 text-[#9C9186]" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search owners, hostels, cities…" className="w-full bg-transparent text-[13px] text-foreground outline-none" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter(undefined)}
            className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${!statusFilter ? 'bg-foreground text-background' : 'border border-[#E7DDD1] bg-white text-[#8A7F75]'}`}
          >
            All
          </button>
          {STATUSES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatusFilter(s)}
              className={`rounded-full px-3 py-1.5 text-[12px] font-semibold ${statusFilter === s ? 'bg-foreground text-background' : 'border border-[#E7DDD1] bg-white text-[#8A7F75]'}`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {listQuery.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {[0, 1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-2xl bg-muted" />)}
        </div>
      ) : listQuery.data && listQuery.data.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {listQuery.data.map((l) => {
            const av = avatarStyle(l.name);
            return (
              <div
                key={l.id}
                role="button"
                tabIndex={0}
                onClick={() => setOpenId(l.id)}
                onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && setOpenId(l.id)}
                className="cursor-pointer rounded-[14px] border border-[#EFE6DA] bg-white p-4 text-left shadow-[0_1px_2px_rgba(40,30,20,0.03),0_12px_30px_-22px_rgba(40,30,20,0.14)]"
              >
                <div className="flex items-center gap-2.5">
                  <span className={`flex h-9 w-9 flex-none items-center justify-center rounded-[10px] text-[13px] font-bold ${av.bg} ${av.fg}`}>{initials(l.name)}</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[14px] font-bold text-foreground">{l.name}</div>
                    <div className="truncate text-[12.5px] text-[#8A7F75]">{l.hostel_name}</div>
                  </div>
                  <StatusChip status={l.status} />
                </div>
                <div className="mt-3 flex items-center gap-1.5 border-t border-[#F2ECE5] pt-3">
                  <span className="text-[12.5px] font-semibold tabular-nums text-[#8A7F75]">{l.phone}</span>
                  {l.phone_verified === false && <UnverifiedPhoneChip />}
                </div>
                <div className="mt-3 flex items-center justify-between">
                  {l.created_at ? <span className="text-[11.5px] text-[#9C9186]">{fmtSubmitted(l.created_at)}</span> : <span />}
                  <div className="flex gap-2">
                    <a
                      href={`tel:${l.phone}`}
                      onClick={(e) => e.stopPropagation()}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[#E7DDD1] bg-white text-[#8A7F75]"
                    >
                      <Phone className="h-3.5 w-3.5" />
                    </a>
                    <a
                      href={waLink(l.phone)}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[#E7DDD1] bg-white text-[#8A7F75]"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                    </a>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenId(l.id);
                      }}
                      className="flex h-[30px] w-[30px] items-center justify-center rounded-lg border border-[#E7DDD1] bg-white text-[#8A7F75]"
                    >
                      <ChevronRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="py-16 text-center text-[13.5px] text-[#9C9186]">No leads match your search.</div>
      )}

      {openLead && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div className="absolute inset-0 bg-[rgba(40,30,20,0.32)]" onClick={() => setOpenId(null)} />
          <div className="relative z-10 flex h-full w-[440px] max-w-[92vw] flex-col bg-white shadow-[-24px_0_60px_-24px_rgba(40,30,20,0.28)]">
            <div className="flex flex-none items-center justify-between border-b border-[#EFE6DA] px-[22px] py-[18px]">
              <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9C9186]">Lead Details</span>
              <button
                type="button"
                onClick={() => setOpenId(null)}
                className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-[#E7DDD1] bg-white text-[#8A7F75] hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-[22px]">
              <div className="flex items-center gap-3.5">
                {(() => {
                  const av = avatarStyle(openLead.name);
                  return (
                    <span className={`flex h-13 w-13 flex-none items-center justify-center rounded-[14px] text-[17px] font-bold ${av.bg} ${av.fg}`}>
                      {initials(openLead.name)}
                    </span>
                  );
                })()}
                <div className="min-w-0">
                  <div className="font-display text-[18px] font-extrabold text-foreground">{openLead.name}</div>
                  <div className="mt-1.5"><StatusChip status={openLead.status} /></div>
                </div>
              </div>

              <div className="mt-4">
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-[0.05em] text-[#9C9186]">Status</label>
                {MANUALLY_SETTABLE_STATUSES.includes(openLead.status) ? (
                  <select
                    value={openLead.status}
                    onChange={(e) => statusMutation.mutate({ id: openLead.id, status: e.target.value })}
                    className="h-10 w-full rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-3.5 text-[13px] font-semibold text-foreground"
                  >
                    {MANUALLY_SETTABLE_STATUSES.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                ) : (
                  <div className="flex h-10 w-full items-center rounded-[10px] border border-[#E7DDD1] bg-[#F7F3EF] px-3.5 text-[13px] font-semibold text-[#8A7F75]">
                    {openLead.status.replace('_', ' ')} — advances automatically
                  </div>
                )}
              </div>

              <div className="mt-4.5 flex gap-2.5">
                <a href={`tel:${openLead.phone}`} className="flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[#E7DDD1] bg-white text-[12.5px] font-bold text-[#8A7F75] hover:border-primary hover:text-primary">
                  <Phone className="h-3.5 w-3.5" /> Call
                </a>
                <a href={waLink(openLead.phone)} target="_blank" rel="noreferrer" className="flex h-[38px] flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-[#E7DDD1] bg-white text-[12.5px] font-bold text-[#8A7F75] hover:border-success hover:text-success">
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
                </a>
              </div>

              <div className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-[0.05em] text-[#9C9186]">Details</div>
              <div className="flex flex-col gap-3.5 rounded-[13px] border border-[#EFE6DA] bg-[#F7F3EF] p-4">
                <div className="flex justify-between"><span className="text-[12.5px] text-[#8A7F75]">Owner Name</span><span className="text-[12.5px] font-bold text-foreground">{openLead.name}</span></div>
                <div className="flex justify-between"><span className="text-[12.5px] text-[#8A7F75]">Hostel Name</span><span className="text-[12.5px] font-bold text-foreground">{openLead.hostel_name}</span></div>
                <div className="flex justify-between">
                  <span className="text-[12.5px] text-[#8A7F75]">Phone Number</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[12.5px] font-bold tabular-nums text-foreground">{openLead.phone}</span>
                    {openLead.phone_verified === false && <UnverifiedPhoneChip />}
                  </span>
                </div>
                {openLead.google_email && <div className="flex justify-between"><span className="text-[12.5px] text-[#8A7F75]">Email</span><span className="text-[12.5px] font-bold text-foreground">{openLead.google_email}</span></div>}
                {openLead.city && <div className="flex justify-between"><span className="text-[12.5px] text-[#8A7F75]">City</span><span className="text-[12.5px] font-bold text-foreground">{openLead.city}</span></div>}
                {openLead.notes && <div className="flex justify-between gap-3"><span className="flex-none text-[12.5px] text-[#8A7F75]">Notes</span><span className="text-right text-[12.5px] text-foreground">{openLead.notes}</span></div>}
              </div>

              <div className="mb-3 mt-6 text-[11px] font-bold uppercase tracking-[0.05em] text-[#9C9186]">Timeline</div>
              {timeline.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {timeline.map((event) => (
                    <div key={event.id} className="flex items-start gap-2.5">
                      <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-primary" />
                      <div className="min-w-0 flex-1">
                        <div className="text-[12.5px] font-semibold text-foreground">{TIMELINE_LABEL[event.event_type] || event.event_type}</div>
                        <div className="text-[11px] text-[#9C9186]">{fmtSubmitted(event.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[12.5px] text-[#9C9186]">No activity yet.</div>
              )}
            </div>

            {APPROVABLE_STATUSES.includes(openLead.status) && (
              <div className="flex-none border-t border-[#EFE6DA] bg-white px-[22px] py-4">
                <div className="flex gap-2.5">
                  <button
                    type="button"
                    disabled={approveMutation.isPending}
                    onClick={() => approveMutation.mutate(openLead.id)}
                    className="h-10 flex-1 rounded-[10px] bg-success text-[12.5px] font-bold text-white disabled:opacity-60"
                  >
                    {approveMutation.isPending ? 'Sending…' : openLead.status === 'APPROVED' ? 'Retry Send' : 'Approve Lead'}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      statusMutation.mutate({ id: openLead.id, status: 'LOST' });
                      setOpenId(null);
                    }}
                    className="h-10 flex-1 rounded-[10px] border border-[#EAD0C9] bg-white text-[12.5px] font-bold text-[#C0503A]"
                  >
                    Reject
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
