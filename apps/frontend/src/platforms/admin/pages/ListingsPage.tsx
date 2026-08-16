import { useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { platformAdminService } from '@features/platform-admin/api';
import { useMarketingQueue, useReviewDecision } from '@features/hostel-marketing/hooks/useMarketing';
import { EmptyState, FilterChips } from '../ui';
import { LISTING_TABS, listingFilterFor, resolveListingTab } from '../listings/listingTabs';
import { useToast } from '../layout/toastContext';
import { AdminDrawer } from '../drawer/AdminDrawer';
import {
  MarketingReviewBody, SECTION_LABEL,
  type ReviewSection, type SectionFlagDraft,
} from '../drawer/MarketingReviewBody';
import { parseDetailParam, serializeDetail } from '../drawer/drawerParam';
import { tintForId } from '../theme/palette';

const STATUS_PILL: Record<string, { bg: string; color: string; label: string }> = {
  PENDING: { bg: '#FBF1DE', color: '#B8792B', label: 'Awaiting review' },
  VERIFIED: { bg: '#EAF3EE', color: '#1F7A52', label: 'Approved' },
  REJECTED: { bg: '#FBEFE9', color: '#B3402F', label: 'Rejected' },
};

export function ListingsPage() {
  const [params, setParams] = useSearchParams();
  const tab = resolveListingTab(params.get('tab'));
  const queryClient = useQueryClient();
  const fireToast = useToast();

  const detail = parseDetailParam(params.get('detail'));
  const [flags, setFlags] = useState<SectionFlagDraft[]>([]);
  const [sendBackNote, setSendBackNote] = useState('');
  const [sendingBack, setSendingBack] = useState(false);

  const toggleFlag = (section: ReviewSection) =>
    setFlags((f) =>
      f.some((x) => x.section === section)
        ? f.filter((x) => x.section !== section)
        : [...f, { section, note: '' }],
    );
  const setFlagNote = (section: ReviewSection, note: string) =>
    setFlags((f) => f.map((x) => (x.section === section ? { ...x, note } : x)));
  const closeReview = () => {
    const next = new URLSearchParams(params);
    next.delete('detail');
    setParams(next, { replace: true });
    setFlags([]);
    setSendBackNote('');
    setSendingBack(false);
  };

  const filter = listingFilterFor(tab);

  const hostels = useQuery({
    queryKey: ['admin', 'hostels', filter],
    queryFn: () => platformAdminService.getHostels(filter ?? {}),
    enabled: filter !== null,
    staleTime: 30_000,
  });

  const pendingCount = useQuery({
    queryKey: ['admin', 'hostels', { verification: 'PENDING' }],
    queryFn: () => platformAdminService.getHostels({ verification: 'PENDING' }),
    staleTime: 30_000,
  });

  const marketingQueue = useMarketingQueue();
  const reviewDecision = useReviewDecision();

  const setTab = (key: string) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next, { replace: true });
  };

  const refreshHostels = () => {
    queryClient.invalidateQueries({ queryKey: ['admin', 'hostels'] });
  };

  const approve = async (id: string, name: string) => {
    try {
      await platformAdminService.approveListing(id);
      refreshHostels();
      fireToast(`${name} published to Discovery`);
    } catch {
      fireToast('Could not publish that listing', 'no');
    }
  };

  const reject = async (id: string, name: string) => {
    // A reason is required server-side, and the owner sees it — sending an
    // empty string would leave them with nothing to fix.
    const reason = window.prompt(`Why is "${name}" being sent back?`)?.trim();
    if (!reason) {
      fireToast('A reason is required to reject a listing', 'no');
      return;
    }
    try {
      await platformAdminService.rejectListing(id, reason);
      refreshHostels();
      fireToast('Listing sent back to the owner');
    } catch {
      fireToast('Could not reject that listing', 'no');
    }
  };

  const chips = LISTING_TABS.map((t) => ({
    key: t.key,
    label: t.label,
    count:
      t.key === 'pending'
        ? pendingCount.data?.length
        : t.key === 'content'
          ? marketingQueue.data?.length
          : undefined,
  }));

  return (
    <div className="flex animate-[adFade_.25s_ease] flex-col gap-[18px]">
      <FilterChips chips={chips} active={tab} onChange={setTab} />

      {tab === 'content' ? (
        <ContentReviewQueue
          items={marketingQueue.data}
          isLoading={marketingQueue.isLoading}
          onOpen={(revisionId) => {
            const next = new URLSearchParams(params);
            next.set('detail', serializeDetail({ kind: 'listing', id: revisionId }));
            setParams(next);
            setFlags([]);
            setSendBackNote('');
            setSendingBack(false);
          }}
        />
      ) : hostels.isLoading ? (
        <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading listings…</div>
      ) : (hostels.data ?? []).length === 0 ? (
        <EmptyState
          title={tab === 'pending' ? 'Queue is clear 🎉' : 'Nothing here'}
          message={
            tab === 'pending'
              ? 'No hostel listings are waiting for review.'
              : 'No hostel listings match this filter.'
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {(hostels.data ?? []).map((h: any) => {
            const pill = STATUS_PILL[String(h.verification_status)] ?? {
              bg: '#F2ECE5', color: '#8A7F75', label: String(h.verification_status),
            };
            return (
              <div
                key={h.id}
                className="overflow-hidden rounded-[18px] border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,.04),0_6px_16px_rgba(40,30,20,.05)]"
              >
                <div className="flex">
                  <div
                    className="w-[130px] flex-none"
                    style={{ background: `linear-gradient(135deg, ${tintForId(h.id)}, #201C18)` }}
                  />
                  <div className="min-w-0 flex-1 px-[17px] py-[15px]">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate font-admin text-[14.5px] font-bold tracking-[-0.01em] text-[#221E1A]">
                          {h.name}
                        </div>
                        <div className="truncate text-[11.5px] text-[#8A7F75]">
                          {[h.owner, h.city].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                      <span
                        className="flex-none rounded-full px-2.5 py-1 text-[10px] font-semibold"
                        style={{ background: pill.bg, color: pill.color }}
                      >
                        {pill.label}
                      </span>
                    </div>
                    <div className="mt-3 flex gap-3.5">
                      <Metric value={h.capacity ?? 0} label="beds" />
                      <Metric value={h.active_tenants ?? 0} label="tenants" />
                      <Metric value={h.owner_hostel_count ?? 1} label="owner's hostels" />
                    </div>
                  </div>
                </div>
                {String(h.verification_status) === 'PENDING' && (
                  <div className="flex items-center gap-2.5 px-[17px] pb-[15px]">
                    <div className="flex-1" />
                    <button
                      type="button"
                      onClick={() => reject(h.id, h.name)}
                      className="rounded-[11px] border border-[#E6C7BF] bg-[#FBEFE9] px-[15px] py-[9px] font-admin text-[12px] font-bold text-[#B3402F]"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => approve(h.id, h.name)}
                      className="rounded-[11px] bg-[#B46A55] px-[15px] py-[9px] font-admin text-[12px] font-bold text-white shadow-[0_4px_12px_rgba(180,106,85,.28)]"
                    >
                      Publish
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {detail?.kind === 'listing' && (
        <AdminDrawer
          title="Listing content review"
          subtitle="Everything the owner submitted"
          initials="MR"
          onClose={closeReview}
          footer={
            sendingBack ? (
              <div>
                <input
                  value={sendBackNote}
                  onChange={(e) => setSendBackNote(e.target.value)}
                  placeholder="Covering note (optional if you flagged sections)"
                  className="mb-2.5 w-full rounded-[11px] border border-[#E7DDD1] px-3 py-2.5 text-[12.5px] text-[#2A2521] outline-none"
                />
                {flags.length > 0 && (
                  <div className="mb-2.5 text-[11.5px] text-[#8A7F75]">
                    Flagged: {flags.map((f) => SECTION_LABEL[f.section]).join(' · ')}
                  </div>
                )}
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setSendingBack(false)}
                    className="flex-1 rounded-xl border border-[#E9DFD3] bg-white py-3 font-admin text-[13px] font-bold text-[#5A5147]"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (flags.length === 0 && !sendBackNote.trim()) {
                        fireToast('Flag a section or write a note first', 'no');
                        return;
                      }
                      try {
                        await reviewDecision.mutateAsync({
                          revisionId: detail.id,
                          verdict: 'reject',
                          note: sendBackNote.trim(),
                          flags: flags.map((f) => ({ section: f.section, note: f.note || undefined })),
                        });
                        closeReview();
                        fireToast('Sent back to the owner with your notes');
                      } catch {
                        fireToast('Could not send that back', 'no');
                      }
                    }}
                    className="flex-[1.4] rounded-xl bg-[#B3402F] py-3 font-admin text-[13px] font-bold text-white"
                  >
                    Confirm send back
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setSendingBack(true)}
                  className="flex-1 rounded-xl border border-[#E6C7BF] bg-[#FBEFE9] py-3 font-admin text-[13.5px] font-bold text-[#B3402F]"
                >
                  Send back{flags.length > 0 ? ` (${flags.length})` : ''}
                </button>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await reviewDecision.mutateAsync({ revisionId: detail.id, verdict: 'approve' });
                      closeReview();
                      fireToast('Published — the listing is live on Discovery');
                    } catch {
                      fireToast('Could not publish that listing', 'no');
                    }
                  }}
                  className="flex-[1.4] rounded-xl bg-[#1F7A52] py-3 font-admin text-[13.5px] font-bold text-white shadow-[0_4px_14px_rgba(31,122,82,.3)]"
                >
                  Approve &amp; publish
                </button>
              </div>
            )
          }
        >
          <MarketingReviewBody
            revisionId={detail.id}
            flags={flags}
            onToggleFlag={toggleFlag}
            onFlagNote={setFlagNote}
          />
        </AdminDrawer>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: number | string; label: string }) {
  return (
    <div>
      <div className="font-admin text-[13px] font-bold text-[#221E1A]">{value}</div>
      <div className="text-[10px] text-[#A2978B]">{label}</div>
    </div>
  );
}

function ContentReviewQueue({
  items, isLoading, onOpen,
}: {
  items: any[] | undefined;
  isLoading: boolean;
  onOpen: (revisionId: string) => void;
}) {
  if (isLoading) {
    return <div className="py-16 text-center text-[13px] text-[#8A7F75]">Loading content queue…</div>;
  }
  if (!items || items.length === 0) {
    return (
      <EmptyState
        title="No copy waiting"
        message="Owner edits to listing content appear here before they go live on Discovery."
      />
    );
  }
  return (
    <div className="overflow-hidden rounded-[18px] border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,.04),0_6px_16px_rgba(40,30,20,.05)]">
      {items.map((item: any, index: number) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onOpen(item.id)}
          className={`flex w-full items-center gap-3.5 px-5 py-[15px] text-left hover:bg-[#FCFAF7] ${
            index > 0 ? 'border-t border-[#F2ECE5]' : ''
          }`}
        >
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold text-[#2A2521]">
              {item.hostel?.name ?? 'Listing copy'}
            </span>
            <span className="block truncate text-[11.5px] text-[#9A8F84]">
              {[item.hostel?.city, item.summary?.tagline].filter(Boolean).join(' · ') ||
                'Submitted for review'}
            </span>
          </span>
          {(item.flags ?? []).length > 0 && (
            <span className="flex-none rounded-full bg-[#FBF1DE] px-2.5 py-1 text-[11px] font-semibold text-[#B8792B]">
              {item.flags.length} to check
            </span>
          )}
          <span className="flex-none text-[12px] font-semibold text-[#B46A55]">Review ›</span>
        </button>
      ))}
    </div>
  );
}
