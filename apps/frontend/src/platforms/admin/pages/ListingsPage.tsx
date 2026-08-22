import { useState } from 'react';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { PenLine, Search } from 'lucide-react';
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
import { StayoListedPanel } from '../listings/StayoListedPanel';
import { NavigationBlock } from '../listings/NavigationBlock';
import { AddressBlock } from '../listings/AddressBlock';
import { LiveListingControls } from '../listings/LiveListingControls';
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
  const navigate = useNavigate();

  const detail = parseDetailParam(params.get('detail'));
  const [flags, setFlags] = useState<SectionFlagDraft[]>([]);
  const [sendBackNote, setSendBackNote] = useState('');
  const [sendingBack, setSendingBack] = useState(false);
  const [search, setSearch] = useState('');

  /**
   * A card is a hostel; the review is of a revision. The pending queue is the
   * mapping between them, and it is already loaded for the chips.
   */
  const pendingRevisionFor = (hostelId: string) =>
    (marketingQueue.data ?? []).find((r: any) => r.hostel?.id === hostelId) ?? null;

  const openHostel = (hostelId: string) => {
    const next = new URLSearchParams(params);
    next.set('detail', serializeDetail({ kind: 'listing', id: hostelId }));
    setParams(next);
    setFlags([]);
    setSendBackNote('');
    setSendingBack(false);
  };

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
    queryKey: ['admin', 'hostels', filter, search],
    queryFn: () => platformAdminService.getHostels({ ...(filter ?? {}), search: search || undefined }),
    enabled: filter !== null,
    staleTime: 30_000,
  });

  const pendingCount = useQuery({
    queryKey: ['admin', 'hostels', { verification: 'PENDING' }],
    queryFn: () => platformAdminService.getHostels({ verification: 'PENDING' }),
    staleTime: 30_000,
  });

  const marketingQueue = useMarketingQueue();
  const platformListings = useQuery({
    queryKey: ['admin', 'platform-listings'],
    queryFn: () => platformAdminService.getPlatformListings(),
    staleTime: 60_000,
  });
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
      <div className="flex flex-wrap items-center gap-3">
        <FilterChips chips={chips} active={tab} onChange={setTab} />
        {tab !== 'content' && tab !== 'stayo' && (
          <div className="flex min-w-[240px] flex-1 items-center gap-2 rounded-xl border border-[#EAE1D8] bg-white px-3.5 py-2 sm:max-w-[320px]">
            <Search className="h-3.5 w-3.5 flex-none text-[#988D82]" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by hostel or city…"
              className="w-full min-w-0 border-none bg-transparent text-[12.5px] text-[#2A2521] outline-none"
            />
          </div>
        )}
      </div>

      {tab === 'stayo' ? (
        <StayoListedPanel />
      ) : tab === 'content' ? (
        <ContentReviewQueue
          items={marketingQueue.data}
          isLoading={marketingQueue.isLoading}
          onOpen={(hostelId) => {
            const next = new URLSearchParams(params);
            next.set('detail', serializeDetail({ kind: 'listing', id: hostelId }));
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
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {(hostels.data ?? []).map((h: any) => {
            const pill = STATUS_PILL[String(h.verification_status)] ?? {
              bg: '#F2ECE5', color: '#8A7F75', label: String(h.verification_status),
            };
            const pending = String(h.verification_status) === 'PENDING';
            return (
              <div
                key={h.id}
                role="button"
                tabIndex={0}
                onClick={() => openHostel(h.id)}
                onKeyDown={(e) => { if (e.key === 'Enter') openHostel(h.id); }}
                className="flex cursor-pointer flex-col overflow-hidden rounded-[16px] border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,.04),0_6px_16px_rgba(40,30,20,.05)] transition hover:border-[#DCC9BE] hover:shadow-[0_2px_4px_rgba(40,30,20,.06),0_10px_24px_rgba(40,30,20,.09)]"
              >
                {/* Cover as a short banner rather than a tall side column: at
                    four-up the card is ~330px, and a side column ate half of it. */}
                <div
                  className="relative h-[68px] flex-none"
                  style={{ background: `linear-gradient(135deg, ${tintForId(h.id)}, #201C18)` }}
                >
                  <span
                    className="absolute right-2 top-2 rounded-full px-2 py-[3px] text-[9.5px] font-semibold"
                    style={{ background: pill.bg, color: pill.color }}
                  >
                    {pill.label}
                  </span>
                </div>

                <div className="flex flex-1 flex-col gap-2.5 p-3.5">
                  <div className="min-w-0">
                    <div className="truncate font-admin text-[14px] font-bold tracking-[-0.01em] text-[#221E1A]">
                      {h.name}
                    </div>
                    <div className="truncate text-[11px] text-[#8A7F75]">
                      {[h.owner, h.city].filter(Boolean).join(' · ')}
                    </div>
                  </div>

                  {/* One line instead of a three-column block — the numbers are
                      scanned, not compared. */}
                  <div className="flex items-center gap-1.5 text-[11px] text-[#8A7F75]">
                    <b className="font-admin text-[12.5px] text-[#221E1A]">{h.capacity ?? 0}</b> beds
                    <span className="text-[#DCD1C4]">·</span>
                    <b className="font-admin text-[12.5px] text-[#221E1A]">{h.active_tenants ?? 0}</b> tenants
                    {(h.owner_hostel_count ?? 1) > 1 && (
                      <>
                        <span className="text-[#DCD1C4]">·</span>
                        <span>{h.owner_hostel_count} owned</span>
                      </>
                    )}
                  </div>

                  {/* Footer pinned to the bottom so cards in a row align even
                      when names wrap to two lines. */}
                  <div className="mt-auto flex items-center gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); navigate(`/admin/listings/${h.id}/edit`); }}
                      title="Write or edit this hostel's marketing page"
                      className="flex items-center gap-1.5 rounded-[9px] border border-[#E9DFD3] bg-white px-2.5 py-1.5 text-[11.5px] font-semibold text-[#5A5147] hover:border-[#B46A55] hover:text-[#B46A55]"
                    >
                      <PenLine className="h-3 w-3" strokeWidth={2} />
                      Page
                    </button>
                    <div className="flex-1" />
                    {pending && (
                      <>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); reject(h.id, h.name); }}
                          className="rounded-[9px] border border-[#E6C7BF] bg-[#FBEFE9] px-2.5 py-1.5 font-admin text-[11.5px] font-bold text-[#B3402F]"
                        >
                          Reject
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); approve(h.id, h.name); }}
                          className="rounded-[9px] bg-[#B46A55] px-3 py-1.5 font-admin text-[11.5px] font-bold text-white"
                        >
                          Publish
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {detail?.kind === 'listing' && (
        <AdminDrawer
          title={(hostels.data ?? []).find((r: any) => r.id === detail.id)?.name ?? 'Listing'}
          subtitle={pendingRevisionFor(detail.id) ? 'Submitted for review' : 'No submission waiting'}
          initials="MR"
          onClose={closeReview}
          footer={
            !pendingRevisionFor(detail.id) ? null : sendingBack ? (
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
                          revisionId: pendingRevisionFor(detail.id)!.id,
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
                      await reviewDecision.mutateAsync({ revisionId: pendingRevisionFor(detail.id)!.id, verdict: 'approve' });
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
          {/*
            All three of these are hostel-level, not revision-level, so they sit
            above the review branch. Every hostel on Stayo the day navigation
            shipped was already live with nothing pending; inside the "submitted
            for review" branch they would have been unreachable.
          */}
          <ListingHostelControls hostelId={detail.id} onDone={closeReview} />

          {pendingRevisionFor(detail.id) ? (
            <>
              {/* Parity with the owner: anything they can edit on their
                  marketing page, an admin can edit here — including a
                  submission that is currently in review, where a reviewer
                  fixing one wrong price themselves beats sending the whole
                  listing back for it. */}
              <button
                type="button"
                onClick={() => navigate(`/admin/listings/${detail.id}/edit`)}
                className="mb-3 w-full rounded-xl border border-[#E6DCD1] bg-white py-2.5 font-admin text-[12.5px] font-bold text-[#221E1A]"
              >
                Edit this listing yourself
              </button>
              <MarketingReviewBody
                revisionId={pendingRevisionFor(detail.id)!.id}
                flags={flags}
                onToggleFlag={toggleFlag}
                onFlagNote={setFlagNote}
              />
            </>
          ) : (
            <NoSubmission hostelId={detail.id} onWrite={() => navigate(`/admin/listings/${detail.id}/edit`)} />
          )}
        </AdminDrawer>
      )}
    </div>
  );
}

/**
 * The hostel-level half of the drawer: what is live, and where the building is.
 *
 * Address and navigation are one "Location" heading because they describe the
 * same building from two angles — the address is what the listing *prints*, the
 * Place ID is what Maps *navigates to* — and an admin correcting one almost
 * always wants to check the other.
 */
function ListingHostelControls({ hostelId, onDone }: { hostelId: string; onDone: () => void }) {
  const hostel = useQuery({
    queryKey: ['admin', 'hostel', hostelId],
    queryFn: () => platformAdminService.getHostel(hostelId),
  });

  const review = hostel.data?.listing_review;

  return (
    <>
      <LiveListingControls
        hostelId={hostelId}
        hostelName={hostel.data?.name ?? 'this hostel'}
        hasLiveListing={Boolean(review?.has_live_listing)}
        openStatus={review?.open_status ?? null}
        listingStatus={String(hostel.data?.listing_status ?? '')}
        onDone={onDone}
      />

      <div className="mb-3">
        <div className="mb-2 px-1 font-admin text-[11px] font-bold uppercase tracking-[0.08em] text-[#B0A597]">
          Location
        </div>
        <div className="space-y-3">
          <AddressBlock hostelId={hostelId} />
          <NavigationBlock hostelId={hostelId} />
        </div>
      </div>
    </>
  );
}

function NoSubmission({ hostelId, onWrite }: { hostelId: string; onWrite: () => void }) {
  return (
    <div className="rounded-2xl border border-[#EFE6DA] bg-white px-5 py-10 text-center">
      <div className="font-admin text-[15px] font-bold text-[#221E1A]">Nothing submitted for review</div>
      <div className="mx-auto mt-1.5 max-w-[360px] text-[12.5px] leading-relaxed text-[#8A7F75]">
        This hostel has no marketing page waiting on you. You can write or edit its listing page
        yourself — Stayo authors these too.
      </div>
      <button
        type="button"
        onClick={onWrite}
        className="mt-4 rounded-xl bg-[#B46A55] px-5 py-2.5 font-admin text-[12.5px] font-bold text-white"
      >
        Write listing page
      </button>
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
          onClick={() => onOpen(item.hostel?.id ?? item.id)}
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
