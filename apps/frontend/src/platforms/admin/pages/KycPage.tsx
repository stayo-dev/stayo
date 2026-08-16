import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, FileText } from 'lucide-react';
import { platformAdminService } from '@features/platform-admin/api';
import { EmptyState, NotWiredYet, StatCard } from '../ui';
import { groupDocumentsByOwner, type KycCard } from '../kyc/kycCards';
import { useToast } from '../layout/toastContext';

const DOC_LABEL: Record<string, string> = {
  PAN: 'PAN card',
  AADHAAR: 'Aadhaar',
  PHOTO: 'Owner photo',
};

function relativeDay(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? 'yesterday' : `${days}d ago`;
}

export function KycPage() {
  const queryClient = useQueryClient();
  const fireToast = useToast();

  const pending = useQuery({
    queryKey: ['admin', 'owner-documents', 'PENDING'],
    queryFn: () => platformAdminService.getOwnerDocuments('PENDING'),
    staleTime: 30_000,
  });
  const verified = useQuery({
    queryKey: ['admin', 'owner-documents', 'VERIFIED'],
    queryFn: () => platformAdminService.getOwnerDocuments('VERIFIED'),
    staleTime: 60_000,
  });

  const cards = groupDocumentsByOwner(pending.data ?? []);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['admin', 'owner-documents'] });

  const decideAll = async (card: KycCard, decision: 'VERIFIED' | 'REJECTED') => {
    let note: string | undefined;
    if (decision === 'REJECTED') {
      // review_note is shown to the owner. A rejection with no reason just
      // makes them re-upload the same file.
      note = window.prompt(`What does ${card.name} need to fix?`)?.trim();
      if (!note) {
        fireToast('A reason is required to reject documents', 'no');
        return;
      }
    }
    try {
      await Promise.all(
        card.docs.map((doc) => platformAdminService.reviewOwnerDocument(doc.id, decision, note)),
      );
      refresh();
      fireToast(
        decision === 'VERIFIED'
          ? `${card.name} verified — they can go live`
          : `${card.name} notified of what to fix`,
        decision === 'VERIFIED' ? 'ok' : 'no',
      );
    } catch {
      fireToast('Could not record that decision', 'no');
    }
  };

  const stats = [
    { label: 'Owners waiting', value: String(cards.length), sub: 'need a decision' },
    { label: 'Documents pending', value: String(pending.data?.length ?? 0), sub: 'across all owners' },
    { label: 'Verified', value: String(verified.data?.length ?? 0), sub: 'documents approved' },
    {
      label: 'Oldest in queue',
      value: cards.length ? relativeDay(new Date(Math.min(...cards.map((c) => c.latestUpload))).toISOString()) : '—',
      sub: cards.length ? 'waiting longest' : 'queue is clear',
    },
  ];

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-5">
      <div className="grid grid-cols-2 gap-[13px] lg:grid-cols-4">
        {stats.map((s) => (
          <StatCard key={s.label} label={s.label} value={s.value} sub={s.sub} />
        ))}
      </div>

      {pending.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading KYC queue…</div>
      ) : cards.length === 0 ? (
        <EmptyState title="Queue is clear 🎉" message="No owner KYC submissions are waiting for review." />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {cards.map((card) => (
            <div
              key={card.profileId}
              className="rounded-[18px] border border-[#EFE6DA] bg-white px-5 py-[18px] shadow-[0_1px_2px_rgba(40,30,20,.04),0_6px_16px_rgba(40,30,20,.05)]"
            >
              <div className="flex items-center gap-3">
                <span
                  className="flex h-11 w-11 flex-none items-center justify-center rounded-xl font-admin text-[15px] font-bold text-white"
                  style={{ background: card.tint }}
                >
                  {card.initials}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-admin text-[14.5px] font-bold tracking-[-0.01em] text-[#221E1A]">
                    {card.name}
                  </div>
                  <div className="truncate text-[11.5px] text-[#8A7F75]">{card.contact}</div>
                </div>
                <span className="flex-none text-[10.5px] text-[#B0A597]">
                  {relativeDay(new Date(card.latestUpload).toISOString())}
                </span>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {card.docs.map((doc) => (
                  <div
                    key={doc.id}
                    className="flex items-center gap-2 rounded-[10px] border border-[#F0E9E0] bg-[#FAF6F1] px-[11px] py-[9px]"
                  >
                    <FileText className="h-4 w-4 flex-none text-[#B46A55]" strokeWidth={1.6} />
                    <div className="min-w-0">
                      <div className="truncate text-[11.5px] font-semibold text-[#3A342E]">
                        {DOC_LABEL[doc.docType] ?? doc.docType}
                      </div>
                      <div className="text-[10px] text-[#B8792B]">Awaiting review</div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-4 flex items-center gap-2.5">
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={() => decideAll(card, 'REJECTED')}
                  className="rounded-[11px] border border-[#E6C7BF] bg-[#FBEFE9] px-4 py-[9px] font-admin text-[12.5px] font-bold text-[#B3402F]"
                >
                  Reject
                </button>
                <button
                  type="button"
                  onClick={() => decideAll(card, 'VERIFIED')}
                  className="flex items-center gap-1.5 rounded-[11px] bg-[#1F7A52] px-[18px] py-[9px] font-admin text-[12.5px] font-bold text-white shadow-[0_4px_12px_rgba(31,122,82,.28)]"
                >
                  <Check className="h-3.5 w-3.5" strokeWidth={3} />
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <NotWiredYet title="Business details and automated checks aren't collected yet" />
    </div>
  );
}
