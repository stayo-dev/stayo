import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Mail, MessageCircle, Check, X } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { DrawerSection, KeyValueRows } from './AdminDrawer';
import { LOST_REASON_LABEL } from '../leads/leadPipeline';
import { useToast } from '../layout/toastContext';

const OUTCOME_LABEL: Record<string, string> = {
  CONNECTED: 'Connected',
  NO_ANSWER: 'No answer',
  BUSY: 'Busy',
  WRONG_NUMBER: 'Wrong number',
  SENT: 'Sent',
  REPLIED: 'Replied',
  NO_REPLY: 'No reply',
};

const TYPE_ICON: Record<string, typeof Phone> = {
  CALL: Phone,
  EMAIL: Mail,
  WHATSAPP: MessageCircle,
  MEETING: Check,
};

const QUAL_FIELDS = [
  { key: 'qual_beds', label: 'Beds', suffix: '', placeholder: '72' },
  { key: 'qual_rooms', label: 'Rooms', suffix: '', placeholder: '44' },
  { key: 'qual_occupancy_pct', label: 'Occupancy', suffix: '%', placeholder: '86' },
  { key: 'qual_monthly_revenue', label: 'Monthly revenue', suffix: '₹', placeholder: '980000' },
  { key: 'qual_branches', label: 'Branches', suffix: '', placeholder: '2 · Delhi, Gurgaon' },
  { key: 'current_tooling', label: 'Currently uses', suffix: '', placeholder: 'Excel + WhatsApp' },
];

const DISCOVERY_FIELDS = [
  { key: 'discovery_problem', label: "What's broken today?", placeholder: 'Manual rent tracking, missing dues every month…' },
  { key: 'discovery_why', label: 'Why Stayo?', placeholder: 'Wants automated reminders and one dashboard…' },
  { key: 'discovery_expect', label: 'What do they expect?', placeholder: 'Faster payouts, live occupancy analytics…' },
];

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

/**
 * The lead detail drawer.
 *
 * This is the screen the whole Leads section exists for: everything an admin
 * learned on the last call, so the next one starts from there rather than
 * from the beginning. Outreach log, qualification, discovery answers and
 * notes all persist (migration 067).
 */
export function LeadDrawerBody({ leadId }: { leadId: string }) {
  const queryClient = useQueryClient();
  const fireToast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [noteDraft, setNoteDraft] = useState('');

  const lead = useQuery({
    queryKey: ['admin', 'lead', leadId],
    queryFn: () => platformAdminService.getLead(leadId),
  });
  const activities = useQuery({
    queryKey: ['admin', 'lead', leadId, 'activities'],
    queryFn: () => platformAdminService.getLeadActivities(leadId),
  });
  const notes = useQuery({
    queryKey: ['admin', 'lead', leadId, 'notes'],
    queryFn: () => platformAdminService.getLeadNotes(leadId),
  });

  // Seed the editable fields once the lead arrives. Keyed on leadId so
  // switching leads in the drawer doesn't carry the previous one's answers.
  useEffect(() => {
    if (!lead.data) return;
    const d: Record<string, string> = {};
    for (const f of [...QUAL_FIELDS, ...DISCOVERY_FIELDS]) {
      const v = (lead.data as any)[f.key];
      d[f.key] = v == null ? '' : String(v);
    }
    setDraft(d);
  }, [lead.data, leadId]);

  const saveQualification = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      platformAdminService.saveLeadQualification(leadId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead', leadId] });
      fireToast('Saved');
    },
    onError: () => fireToast('Could not save those answers', 'no'),
  });

  const logActivity = useMutation({
    mutationFn: (data: { type: string; outcome: string }) =>
      platformAdminService.logLeadActivity(leadId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead', leadId, 'activities'] });
      fireToast('Outreach logged');
    },
    onError: () => fireToast('Could not log that', 'no'),
  });

  const addNote = useMutation({
    mutationFn: (body: string) => platformAdminService.addLeadNote(leadId, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin', 'lead', leadId, 'notes'] });
      setNoteDraft('');
      fireToast('Note added');
    },
    onError: () => fireToast('Could not add that note', 'no'),
  });

  if (lead.isLoading) {
    return <div className="py-12 text-center text-[13px] text-[#8A7F75]">Loading lead…</div>;
  }
  if (lead.isError || !lead.data) {
    return <div className="py-12 text-center text-[13px] text-[#B3402F]">Couldn't load this lead.</div>;
  }

  const l = lead.data as any;
  const blurField = (key: string) => {
    const original = l[key] == null ? '' : String(l[key]);
    if ((draft[key] ?? '') === original) return; // nothing changed, don't write
    saveQualification.mutate({ [key]: draft[key] ?? '' });
  };

  return (
    <div className="flex flex-col gap-4">
      {/* ── captured at sign-up ───────────────────────────────── */}
      <DrawerSection
        title="Captured at sign-up"
        action={<span className="text-[10.5px] text-[#9A8F84]">{timeAgo(l.created_at)}</span>}
      >
        <KeyValueRows
          rows={[
            {
              k: 'Phone',
              v: (
                <span className="inline-flex items-center gap-1.5">
                  {l.phone}
                  {l.phone_verified && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#EAF3EE] px-1.5 py-0.5 text-[9px] font-bold text-[#1F7A52]">
                      <Check className="h-2.5 w-2.5" strokeWidth={3} /> Verified
                    </span>
                  )}
                </span>
              ),
            },
            { k: 'Email', v: l.google_email || '—' },
            { k: 'Hostel', v: l.hostel_name || '—' },
            { k: 'City', v: l.city || '—' },
            { k: 'Beds at sign-up', v: l.bed_count ?? '—' },
          ]}
        />
        <div className="flex gap-2.5 border-t border-[#F2ECE5] px-[18px] py-3.5">
          <a
            href={`tel:${l.phone}`}
            className="flex flex-[1.3] items-center justify-center gap-1.5 rounded-[11px] bg-[#1F7A52] py-2.5 font-admin text-[12.5px] font-bold text-white shadow-[0_3px_10px_rgba(31,122,82,.25)]"
          >
            <Phone className="h-3.5 w-3.5" strokeWidth={2} />
            Call {l.phone}
          </a>
          {l.google_email && (
            <a
              href={`mailto:${l.google_email}`}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[11px] border border-[#E9DFD3] bg-white py-2.5 font-admin text-[12.5px] font-bold text-[#5A5147]"
            >
              <Mail className="h-3.5 w-3.5" strokeWidth={2} />
              Email
            </a>
          )}
        </div>
      </DrawerSection>

      {/* ── outreach ──────────────────────────────────────────── */}
      <DrawerSection title="Outreach">
        {(activities.data ?? []).length === 0 ? (
          <div className="px-[18px] py-4 text-[12px] text-[#A2978B]">
            No attempts yet — start with a call.
          </div>
        ) : (
          (activities.data ?? []).map((a, i) => {
            const Icon = TYPE_ICON[a.type] ?? Phone;
            const good = ['CONNECTED', 'REPLIED', 'SENT'].includes(a.outcome);
            return (
              <div
                key={a.id}
                className={`flex items-center gap-3 px-[18px] py-2.5 ${i > 0 ? 'border-t border-[#F2ECE5]' : ''}`}
              >
                <span
                  className={`flex h-7 w-7 flex-none items-center justify-center rounded-lg ${
                    good ? 'bg-[#EAF3EE] text-[#1F7A52]' : 'bg-[#FBF1DE] text-[#B8792B]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-semibold text-[#2A2521]">
                    {OUTCOME_LABEL[a.outcome] ?? a.outcome}
                  </div>
                  <div className="text-[10.5px] text-[#9A8F84]">
                    {a.type.toLowerCase()} · {timeAgo(a.created_at)}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div className="flex flex-wrap gap-2 border-t border-[#F2ECE5] px-[18px] py-3.5">
          <button
            type="button"
            onClick={() => logActivity.mutate({ type: 'CALL', outcome: 'CONNECTED' })}
            className="rounded-[9px] border border-[#CDE6D8] bg-[#EAF3EE] px-3 py-2 text-[11.5px] font-semibold text-[#1F7A52]"
          >
            ✓ Call connected
          </button>
          <button
            type="button"
            onClick={() => logActivity.mutate({ type: 'CALL', outcome: 'NO_ANSWER' })}
            className="rounded-[9px] border border-[#F0DFC4] bg-[#FBF1DE] px-3 py-2 text-[11.5px] font-semibold text-[#B8792B]"
          >
            No answer
          </button>
          <button
            type="button"
            onClick={() => logActivity.mutate({ type: 'EMAIL', outcome: 'SENT' })}
            className="rounded-[9px] border border-[#D6E0F0] bg-[#EAF0FB] px-3 py-2 text-[11.5px] font-semibold text-[#3B5B9E]"
          >
            Email sent
          </button>
        </div>
      </DrawerSection>

      {/* ── qualify the hostel ────────────────────────────────── */}
      <div className="rounded-2xl border border-[#EFE6DA] bg-white px-[18px] py-4">
        <div className="text-[11px] font-bold uppercase tracking-[.06em] text-[#A2978B]">
          Qualify the hostel
        </div>
        <div className="mb-3.5 mt-0.5 text-[10.5px] text-[#B0A597]">
          Fill these in while on the call — they save as you go
        </div>
        <div className="grid grid-cols-2 gap-3">
          {QUAL_FIELDS.map((f) => (
            <div key={f.key}>
              <div className="mb-1.5 text-[11px] font-semibold text-[#8A7F75]">{f.label}</div>
              <div className="flex items-center rounded-[10px] border border-[#E7DDD1] bg-[#FCFAF7] px-2.5">
                {f.suffix === '₹' && <span className="text-[12px] font-semibold text-[#B0A597]">₹</span>}
                <input
                  value={draft[f.key] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  onBlur={() => blurField(f.key)}
                  placeholder={f.placeholder}
                  className="w-full min-w-0 border-none bg-transparent px-1 py-2 text-[12.5px] font-semibold text-[#2A2521] outline-none"
                />
                {f.suffix && f.suffix !== '₹' && (
                  <span className="text-[11px] font-semibold text-[#B0A597]">{f.suffix}</span>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── discovery ─────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#F0E9E0] bg-[#FAF6F1] px-[18px] py-4">
        <div className="text-[11px] font-bold uppercase tracking-[.06em] text-[#A2978B]">
          Why Stayo? · discovery
        </div>
        <div className="mb-3.5 mt-0.5 text-[10.5px] text-[#B0A597]">
          Capture their words — this feeds product &amp; sales
        </div>
        <div className="flex flex-col gap-3">
          {DISCOVERY_FIELDS.map((f) => (
            <div key={f.key}>
              <div className="mb-1.5 text-[11.5px] font-semibold text-[#5A5147]">{f.label}</div>
              <textarea
                value={draft[f.key] ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                onBlur={() => blurField(f.key)}
                placeholder={f.placeholder}
                className="min-h-[58px] w-full resize-y rounded-[10px] border border-[#E7DDD1] bg-white px-3 py-2.5 text-[12.5px] leading-relaxed text-[#2A2521] outline-none"
              />
            </div>
          ))}
        </div>
      </div>

      {/* ── notes ─────────────────────────────────────────────── */}
      <div className="rounded-2xl border border-[#EFE6DA] bg-white px-[18px] py-4">
        <div className="mb-3 text-[11px] font-bold uppercase tracking-[.06em] text-[#A2978B]">Notes</div>
        <div className="mb-3.5 flex gap-2.5">
          <input
            value={noteDraft}
            onChange={(e) => setNoteDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && noteDraft.trim()) addNote.mutate(noteDraft.trim());
            }}
            placeholder="Add a note about this owner…"
            className="min-w-0 flex-1 rounded-[10px] border border-[#E7DDD1] px-3 py-2.5 text-[12.5px] text-[#2A2521] outline-none"
          />
          <button
            type="button"
            disabled={!noteDraft.trim() || addNote.isPending}
            onClick={() => addNote.mutate(noteDraft.trim())}
            className="rounded-[10px] bg-[#221E1A] px-4 font-admin text-[12.5px] font-bold text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
        {(notes.data ?? []).length === 0 ? (
          <div className="text-[12px] text-[#A2978B]">No notes yet.</div>
        ) : (
          (notes.data ?? []).map((n, i) => (
            <div key={n.id} className={`flex gap-2.5 py-2.5 ${i > 0 ? 'border-t border-[#F2ECE5]' : ''}`}>
              <span className="mt-0.5 flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-[#B46A55] font-admin text-[9.5px] font-bold text-white">
                {(n.author_name || '?').slice(0, 2).toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12.5px] leading-relaxed text-[#2A2521]">{n.body}</div>
                <div className="mt-0.5 text-[10.5px] text-[#9A8F84]">
                  {n.author_name} · {timeAgo(n.created_at)}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* ── lost reason, when recorded ────────────────────────── */}
      {l.status === 'LOST' && l.lost_reason && (
        <div className="rounded-2xl border border-[#EFD6CE] bg-[#FBEFE9] px-[18px] py-4">
          <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.06em] text-[#B3402F]">
            <X className="h-3 w-3" strokeWidth={3} /> Marked lost
          </div>
          <div className="mt-1.5 font-admin text-[13.5px] font-bold text-[#8A3E2A]">
            {LOST_REASON_LABEL[l.lost_reason] ?? l.lost_reason}
          </div>
          {l.lost_note && (
            <div className="mt-1 text-[12px] leading-relaxed text-[#6E5B4E]">{l.lost_note}</div>
          )}
        </div>
      )}
    </div>
  );
}
