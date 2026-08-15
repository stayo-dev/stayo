import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowLeft, Building2, Check, IndianRupee, X } from 'lucide-react';

import { stayoToast } from '@shared/ui-patterns/Toast';
import {
  useMarketingQueue,
  useMarketingSubmission,
  useReviewDecision,
} from '@features/hostel-marketing/hooks/useMarketing';
import type { MarketingContent, ReviewFlag } from '@features/hostel-marketing/api';

/**
 * Platform Admin → Marketing reviews.
 *
 * Every hostel listing waits here before a tenant can see it. Approving is not
 * a rubber stamp — Stayo's name is on whatever goes through — so each
 * submission carries `flags`: the advertised price against the hostel's real
 * room rents, and bed tiers claiming sharing types the hostel has no rooms
 * for. Neither blocks approval; an owner may legitimately run an introductory
 * rate. They are the things a human cannot check by eye.
 *
 * Approving content here does **not** make a hostel discoverable on its own —
 * `listing_status` / `verification_status` are a separate gate on
 * `/admin/hostels` (ADR-040). A listing needs both.
 */
export function AdminMarketingReviewsPage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { data: queue, isLoading } = useMarketingQueue();

  useEffect(() => {
    document.title = 'Marketing reviews — Stayo Admin';
  }, []);

  if (selectedId) {
    return <SubmissionDetail revisionId={selectedId} onBack={() => setSelectedId(null)} />;
  }

  return (
    <div className="px-5 pb-10 pt-4">
      <header className="mb-4">
        <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Marketing reviews</h1>
        <p className="mt-1 text-[12.5px] text-muted-foreground">
          {isLoading ? 'Loading…' : `${queue?.length ?? 0} listing${queue?.length === 1 ? '' : 's'} waiting`}
        </p>
      </header>

      {isLoading && <div className="h-28 animate-pulse rounded-2xl bg-muted" />}

      {!isLoading && (queue?.length ?? 0) === 0 && (
        <div className="rounded-2xl border border-border bg-card p-8 text-center">
          <Check className="mx-auto h-8 w-8 text-emerald-600" strokeWidth={1.8} />
          <p className="mt-3 font-display text-[15px] font-bold text-foreground">Queue is clear</p>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            Nothing is waiting on you. Owners' listings appear here when they submit them.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {queue?.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setSelectedId(item.id)}
            className="rounded-2xl border border-border bg-card p-4 text-left transition-shadow hover:shadow-md"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-display text-[15px] font-bold text-foreground">{item.hostel.name}</p>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  {[item.hostel.city, `v${item.version}`].filter(Boolean).join(' · ')}
                </p>
              </div>
              {item.flags.length > 0 && (
                <span className="flex flex-none items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10.5px] font-bold text-amber-800">
                  <AlertTriangle className="h-3 w-3" strokeWidth={2.5} />
                  {item.flags.length}
                </span>
              )}
            </div>

            <p className="mt-2 text-[12.5px] italic text-muted-foreground">
              {item.summary.tagline ? `“${item.summary.tagline}”` : 'No tagline'}
            </p>

            <div className="mt-2.5 flex flex-wrap gap-3 text-[11.5px] text-muted-foreground">
              <span>{item.summary.photos} photos</span>
              <span>{item.summary.beds} bed types</span>
              <span>{item.summary.amenities} amenities</span>
              <span>{item.summary.places} places</span>
            </div>

            {/* The hostel may be approved here and still not discoverable —
                surfaced so an admin isn't surprised by their own approval. */}
            {(item.hostel.listing_status !== 'LIVE' || item.hostel.verification_status !== 'VERIFIED') && (
              <p className="mt-2.5 rounded-lg bg-muted px-2.5 py-1.5 text-[11px] text-muted-foreground">
                Hostel is {item.hostel.listing_status} / {item.hostel.verification_status} — approving this content
                won't list it until that's resolved too.
              </p>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function SubmissionDetail({ revisionId, onBack }: { revisionId: string; onBack: () => void }) {
  const { data, isLoading } = useMarketingSubmission(revisionId);
  const decide = useReviewDecision();
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);

  if (isLoading || !data) {
    return <div className="m-5 h-40 animate-pulse rounded-2xl bg-muted" />;
  }

  const act = (verdict: 'approve' | 'reject') => {
    if (verdict === 'reject' && !note.trim()) {
      stayoToast.info('Give the owner a reason — it is their only route forward');
      return;
    }
    decide.mutate(
      { revisionId, verdict, note: note.trim() || undefined },
      {
        onSuccess: () => {
          stayoToast.success(verdict === 'approve' ? 'Approved — the listing is live' : 'Sent back to the owner');
          onBack();
        },
        onError: (error: any) => stayoToast.error(error?.response?.data?.message ?? 'Could not save that decision'),
      },
    );
  };

  return (
    <div className="px-5 pb-32 pt-4">
      <button type="button" onClick={onBack} className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-muted-foreground">
        <ArrowLeft className="h-4 w-4" /> Back to queue
      </button>

      <header className="mb-4">
        <h1 className="font-display text-[20px] font-extrabold text-foreground">{data.hostel.name}</h1>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {[data.hostel.address, data.hostel.city].filter(Boolean).join(', ')} · v{data.version}
          {data.live ? ` (replacing v${data.live.version})` : ' (first listing)'}
        </p>
      </header>

      {data.flags.length > 0 && (
        <section className="mb-4 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="mb-2 flex items-center gap-2 text-[13px] font-bold text-amber-900">
            <AlertTriangle className="h-4 w-4" strokeWidth={2.2} />
            Worth checking before you approve
          </p>
          <ul className="space-y-2">
            {data.flags.map((flag, index) => (
              <FlagRow key={index} flag={flag} />
            ))}
          </ul>
        </section>
      )}

      <ContentPreview content={data.content} live={data.live?.content ?? null} />

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
        {rejecting && (
          <textarea
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="What does the owner need to change? They see this."
            className="mb-2.5 w-full resize-none rounded-xl border border-border bg-muted px-3 py-2 text-[13px] outline-none focus:border-primary"
          />
        )}
        <div className="flex gap-2.5">
          <button
            type="button"
            onClick={() => (rejecting ? act('reject') : setRejecting(true))}
            disabled={decide.isPending}
            className="flex flex-1 items-center justify-center gap-1.5 rounded-[13px] border-[1.5px] border-border py-3 font-display text-[13px] font-bold text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" strokeWidth={2.2} />
            {rejecting ? 'Send back' : 'Request changes'}
          </button>
          {!rejecting && (
            <button
              type="button"
              onClick={() => act('approve')}
              disabled={decide.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-[13px] bg-emerald-600 py-3 font-display text-[13px] font-bold text-white disabled:opacity-50"
            >
              <Check className="h-4 w-4" strokeWidth={2.5} />
              {decide.isPending ? 'Saving…' : 'Approve & publish'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function FlagRow({ flag }: { flag: ReviewFlag }) {
  const detail = flag.detail as { advertised?: number; actual?: number } | undefined;
  return (
    <li className="text-[12.5px] leading-[1.5] text-amber-900">
      {flag.message}
      {flag.code === 'PRICE_DRIFT' && detail?.advertised != null && detail?.actual != null && (
        <span className="mt-1 flex items-center gap-3 font-semibold">
          <span className="flex items-center gap-0.5">
            <IndianRupee className="h-3 w-3" />
            {detail.advertised.toLocaleString('en-IN')} advertised
          </span>
          <span className="flex items-center gap-0.5 text-amber-700">
            <IndianRupee className="h-3 w-3" />
            {detail.actual.toLocaleString('en-IN')} in rooms
          </span>
        </span>
      )}
    </li>
  );
}

/** What the tenant will see, with the live version alongside where it differs. */
function ContentPreview({ content, live }: { content: MarketingContent; live: MarketingContent | null }) {
  const changed = (a: unknown, b: unknown) => live !== null && JSON.stringify(a) !== JSON.stringify(b);

  return (
    <div className="space-y-3">
      <Block title="Tagline" changed={changed(content.basics.tagline, live?.basics.tagline)}>
        <p className="text-[13.5px] text-foreground">{content.basics.tagline ?? '—'}</p>
        {changed(content.basics.tagline, live?.basics.tagline) && live?.basics.tagline && (
          <p className="mt-1 text-[12px] text-muted-foreground line-through">{live.basics.tagline}</p>
        )}
      </Block>

      {content.basics.about && (
        <Block title="About" changed={changed(content.basics.about, live?.basics.about)}>
          <p className="whitespace-pre-line text-[13px] leading-[1.55] text-foreground">{content.basics.about}</p>
        </Block>
      )}

      <Block title={`Photos (${content.photos.length})`} changed={changed(content.photos, live?.photos)}>
        <div className="flex gap-2 overflow-x-auto">
          {content.photos.map((photo, index) => (
            <div key={index} className="relative h-[92px] w-[76px] flex-none overflow-hidden rounded-lg bg-muted">
              <img src={photo.url} alt="" className="h-full w-full object-cover" />
              {photo.is_cover && (
                <span className="absolute left-1 top-1 rounded bg-[#2A2521] px-1 py-0.5 text-[8px] font-bold text-white">
                  COVER
                </span>
              )}
            </div>
          ))}
          {content.photos.length === 0 && <p className="text-[12.5px] text-muted-foreground">No photos</p>}
        </div>
      </Block>

      <Block title={`Beds & pricing (${content.beds.length})`} changed={changed(content.beds, live?.beds)}>
        <ul className="space-y-1.5">
          {content.beds.map((bed, index) => (
            <li key={index} className="flex items-baseline justify-between gap-3 text-[13px]">
              <span className="min-w-0 text-foreground">
                <span className="font-semibold">{bed.name || `${bed.sharing}-bed`}</span>
                {bed.inclusions && <span className="block text-[11.5px] text-muted-foreground">{bed.inclusions}</span>}
              </span>
              <span className="flex-none font-display font-bold tabular-nums text-foreground">
                ₹{bed.price.toLocaleString('en-IN')}
              </span>
            </li>
          ))}
        </ul>
      </Block>

      <Block title="Amenities" changed={changed(content.amenities, live?.amenities)}>
        <div className="flex flex-wrap gap-1.5">
          {content.amenities.filter((a) => a.enabled).map((amenity, index) => (
            <span key={index} className="rounded-lg bg-muted px-2.5 py-1 text-[12px] text-foreground">
              {amenity.label}
            </span>
          ))}
        </div>
      </Block>

      <Block title="Getting around" changed={changed(content.places, live?.places)}>
        <ul className="space-y-1">
          {content.places.map((place, index) => (
            <li key={index} className="flex items-center justify-between text-[12.5px] text-foreground">
              <span className="flex items-center gap-1.5">
                <Building2 className="h-3.5 w-3.5 text-muted-foreground" strokeWidth={1.8} />
                {place.name}
              </span>
              <span className="font-semibold tabular-nums">{place.distance}</span>
            </li>
          ))}
        </ul>
      </Block>
    </div>
  );
}

function Block({ title, changed, children }: { title: string; changed: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border bg-card p-4 ${changed ? 'border-primary/50' : 'border-border'}`}>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="font-display text-[13px] font-bold text-foreground">{title}</h2>
        {changed && (
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
            changed
          </span>
        )}
      </div>
      {children}
    </section>
  );
}
