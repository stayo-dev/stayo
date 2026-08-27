import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { marketingPreviewService } from '@features/hostel-marketing/api';
import {
  ChevronLeft,
  ChevronRight,
  Coffee,
  Heart,
  Info,
  LayoutGrid,
  MapPin,
  Moon,
  Navigation,
  Share2,
  Sparkles,
  ShieldCheck,
  Sun,
  Utensils,
} from 'lucide-react';

import {
  useDiscoverListing,
  useIsSeeker,
  useSavedHostels,
  useToggleSaved,
} from '@features/discover/hooks/useDiscover';

import { useDiscoverAuth } from './DiscoverAuthContext';
import { DiscoverEmpty, PrimaryButton } from './components/DiscoverShell';
import { describeAvailability } from '@shared/lib/amenityAvailability';
import { AUDIENCE_LABEL, C, FONT, PAGE_SHELL, PHOTO_FALLBACK, formatRupees } from './discoverTheme';
import { photoIndexFromScroll } from './galleryScroll';
import { directionsUrl, distanceLine, hasNavigation, mapEmbedUrl, whereYoullBe } from './hostelNavigation';
import { ReviewsSection } from './components/ReviewsSection';
import { MediaLightbox } from './components/MediaLightbox';
import { PhotoTour } from './components/PhotoTour';
import { useShareHostel } from '@shared/hooks/useShareHostel';
import ShareSheet from '@shared/ui-patterns/ShareSheet';
import { buildShareSummary, buildShareUrl } from '@shared/lib/shareListing';
import { copyToClipboard } from '@lib/share';

const MESS_DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const MESS_TYPE_LABEL: Record<string, string> = {
  VEG: 'Veg only',
  NON_VEG: 'Non-veg',
  BOTH: 'Veg + Non-veg',
};

const MEAL_ICON: Record<string, typeof Coffee> = {
  b: Coffee,
  l: Utensils,
  s: Sun,
  dn: Moon,
};

/** One selectable option per room size, aggregated from the real room rows. */
interface BedOption {
  capacity: number;
  label: string;
  price: number | null;
  availableBeds: number;
  roomType: string | null;
}

function toBedOptions(rooms: any[]): BedOption[] {
  const byCapacity = new Map<number, BedOption>();

  for (const room of rooms) {
    const capacity = Number(room.capacity || 0);
    if (!capacity) continue;

    const price = Number(room.pricing?.monthly_rent || 0) || null;
    const available = Number(room.available_beds || 0);
    const existing = byCapacity.get(capacity);

    if (!existing) {
      byCapacity.set(capacity, {
        capacity,
        label: capacity === 1 ? 'Single room' : `${capacity}-bed sharing`,
        price,
        availableBeds: available,
        roomType: room.room_type ?? null,
      });
      continue;
    }

    existing.availableBeds += available;
    // Show the cheapest real price in the tier; an unpriced room must not
    // drag the tier down to nothing.
    if (price != null && (existing.price == null || price < existing.price)) existing.price = price;
  }

  return Array.from(byCapacity.values()).sort((a, b) => a.capacity - b.capacity);
}

/**
 * The public Discovery listing.
 *
 * `previewRevisionId` renders an unapproved marketing revision through this
 * exact component, for the admin review screen. Deliberately the same
 * renderer: a separate preview would drift, and the admin would end up
 * approving something other than what ships.
 */
export function ListingPage({ previewRevisionId }: { previewRevisionId?: string } = {}) {
  const { slug } = useParams<{ slug: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { isSeeker } = useIsSeeker();
  const { openSignIn } = useDiscoverAuth();

  const live = useDiscoverListing(previewRevisionId ? undefined : slug);
  const preview = useQuery({
    queryKey: ['admin', 'marketing-preview', previewRevisionId],
    queryFn: () => marketingPreviewService.get(previewRevisionId as string),
    enabled: Boolean(previewRevisionId),
  });
  const source = previewRevisionId ? preview : live;
  const data = previewRevisionId ? (preview.data as any)?.listing : live.data;
  const { isLoading, isError } = source;
  const { data: saved } = useSavedHostels();
  const toggleSaved = useToggleSaved();
  const { share } = useShareHostel();
  const [shareOpen, setShareOpen] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);

  const [selected, setSelected] = useState<number | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);
  const galleryRef = useRef<HTMLDivElement | null>(null);
  /** Which photo the full-screen viewer opens on; null when closed. */
  const [lightbox, setLightbox] = useState<number | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  /** The grouped photo tour, opened by "Show all photos". */
  const [tourOpen, setTourOpen] = useState(false);
  const [messDay, setMessDay] = useState(0);

  const hostel = data?.hostel;
  const amenities = data?.amenities ?? [];
  const places = data?.places ?? [];
  /**
   * Admin-entered, never owner-entered — see migration 074. Null for a hostel
   * nobody has located yet, which renders as no directions block rather than a
   * button that opens the wrong building.
   */
  const navigation = data?.navigation ?? null;
  const mess = data?.mess ?? null;

  /**
   * The advertised offer, carrying real availability.
   *
   * Where the owner has published approved bed tiers, those decide the tier's
   * name, price and inclusions — that is the offer, and an admin has checked
   * it. Availability still comes from real rooms matched on sharing size: a
   * marketing tier says what is on sale, it does not get to say what is free.
   *
   * With no published tiers, this falls back to deriving everything from rooms
   * exactly as it did before marketing pages existed.
   */
  const bedOptions = useMemo(() => {
    const fromRooms = toBedOptions(data?.rooms ?? []);
    const tiers = data?.bed_tiers ?? [];
    if (tiers.length === 0) return fromRooms;

    return tiers.map((tier) => {
      const realTier = fromRooms.find((option) => option.capacity === tier.sharing);
      return {
        capacity: tier.sharing,
        label: tier.name || (tier.sharing === 1 ? 'Single room' : `${tier.sharing}-bed sharing`),
        price: tier.price > 0 ? tier.price : (realTier?.price ?? null),
        // A tier the owner marked FULL is full regardless of what rooms say;
        // otherwise the live count wins over any claim.
        availableBeds: tier.availability === 'FULL' ? 0 : (realTier?.availableBeds ?? 0),
        roomType: tier.inclusions ?? realTier?.roomType ?? null,
        // What the real rooms of this size are like to live in — measured by
        // the owner, summarised by the server (`room-space.ts`).
        space: (tier as any).space ?? null,
      };
    });
  }, [data?.rooms, data?.bed_tiers]);
  const savedIds = useMemo(() => new Set((saved ?? []).map((item) => item.id)), [saved]);
  const isSaved = hostel ? savedIds.has(hostel.id) : false;

  const totalVacant = useMemo(
    () => bedOptions.reduce((sum, option) => sum + option.availableBeds, 0),
    [bedOptions],
  );

  useEffect(() => {
    if (hostel?.name) document.title = `${hostel.name} — Stayo`;
  }, [hostel?.name]);

  if (isLoading) {
    return (
      <div className="min-h-[100dvh]">
        <div className="h-[290px] animate-pulse" style={{ background: '#EDE4DA' }} />
        <div className="space-y-3 p-5">
          <div className="h-6 w-2/3 animate-pulse rounded" style={{ background: '#EDE4DA' }} />
          <div className="h-4 w-1/2 animate-pulse rounded" style={{ background: '#F2ECE5' }} />
          <div className="h-24 animate-pulse rounded-2xl" style={{ background: '#F2ECE5' }} />
        </div>
      </div>
    );
  }

  if (isError || !hostel) {
    return (
      <div className="min-h-[100dvh] pt-24">
        <DiscoverEmpty
          icon={Info}
          title="This hostel isn't listed"
          body="It may have been unlisted, or the link is out of date. Plenty of other verified hostels are ready."
          action={<PrimaryButton onClick={() => navigate('/discover')}>Browse hostels</PrimaryButton>}
        />
      </div>
    );
  }

  /**
   * The gallery, with videos kept as videos. `media` arrives from the
   * projection; `photos` is the older URL-only field, still the fallback for
   * anything served before `media` existed.
   */
  const media: { url: string; kind: 'image' | 'video'; thumbnail_url?: string | null }[] =
    hostel.media?.length
      ? hostel.media
      : (hostel.photos ?? []).map((url: string) => ({ url, kind: 'image' as const }));
  const photos: string[] = media.map((item) => item.url);
  const audience = hostel.hostel_type ? AUDIENCE_LABEL[hostel.hostel_type] : null;
  /**
   * Selection is by array position, not `capacity` — an owner can publish two
   * marketing tiers of the same bed count at different prices (e.g. "4
   * Sharing" vs "Ground floor 4-bed"), and keying/looking up by capacity alone
   * made them indistinguishable: both buttons lit up together and `.find()`
   * always resolved to whichever tier came first.
   */
  const selectedOption = selected != null ? (bedOptions[selected] ?? null) : null;
  /**
   * "Starting from" tracks the cheapest bed actually on offer in "Choose your
   * bed" below, rather than the separate `starting_price` field, which can
   * drift out of sync with the real tiers. Prefer a tier with open beds; only
   * price a full tier if nothing is open.
   */
  const pricedOptions = bedOptions.filter((option) => option.price != null);
  const openOptions = pricedOptions.filter((option) => option.availableBeds > 0);
  const cheapestPool = openOptions.length > 0 ? openOptions : pricedOptions;
  const minBedPrice =
    cheapestPool.length > 0 ? Math.min(...cheapestPool.map((option) => option.price as number)) : null;
  const displayPrice = selectedOption?.price ?? minBedPrice ?? hostel.starting_price ?? null;

  const handleSave = () => {
    if (!isSeeker) {
      openSignIn({ onDone: () => toggleSaved.mutate({ hostelId: hostel.id, saved: false }) });
      return;
    }
    toggleSaved.mutate({ hostelId: hostel.id, saved: isSaved });
  };

  /**
   * Back, for someone who did not arrive from Discovery.
   *
   * `navigate(-1)` is fine when this page was pushed onto a history stack —
   * but a shared `/h/<slug>` link opens it as the first entry in the session,
   * where "back" has nowhere to go and the button silently does nothing. Every
   * listing link we hand out is that case. React Router marks the first entry
   * with `key === 'default'`, so that is the one that falls back to the list.
   */
  const goBack = () => {
    if (location.key === 'default') navigate('/discover');
    else navigate(-1);
  };

  /** Dots and arrows drive the same scroll the finger does — one source. */
  const scrollToPhoto = (index: number) => {
    const track = galleryRef.current;
    if (!track) return;
    track.scrollTo({ left: index * track.clientWidth, behavior: 'smooth' });
  };

  const handleGalleryScroll = () => {
    const track = galleryRef.current;
    if (!track) return;
    setPhotoIndex(photoIndexFromScroll(track.scrollLeft, track.clientWidth, photos.length));
  };

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <div className="flex-1">
        {/*
          ── Desktop header ───────────────────────────────────────────────
          Airbnb's order, and it is the right one: the name of the place comes
          before its photographs, so a laptop visitor knows what they are
          looking at while the images load. Share and Save sit on the same
          line, off the photograph entirely. A phone keeps the immersive
          full-bleed gallery — there is no room for a title above it.
        */}
        <div className={`hidden lg:block ${PAGE_SHELL} pt-7`}>
          {/* The only Back button used to live over the phone gallery, which
              is hidden at this width — so a laptop visitor who opened a shared
              link had no way back to the list at all. */}
          <button
            type="button"
            onClick={goBack}
            className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold transition-colors hover:underline"
            style={{ color: C.textMuted }}
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
            All hostels
          </button>

          <div className="flex items-end justify-between gap-4">
            <h1
              className="min-w-0 text-[26px] font-extrabold leading-[1.2] tracking-[-0.02em]"
              style={{ fontFamily: FONT.display, color: C.text }}
            >
              {hostel.name}
            </h1>
            <div className="flex flex-none items-center gap-1.5">
              <button
                type="button"
                onClick={() => { setShareCopied(false); setShareOpen(true); }}
                className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold underline-offset-4 transition-colors hover:bg-white hover:underline"
                style={{ color: C.textBody }}
              >
                <Share2 className="h-[15px] w-[15px]" strokeWidth={1.8} />
                Share
              </button>
              <button
                type="button"
                aria-pressed={isSaved}
                onClick={handleSave}
                className="flex h-9 items-center gap-1.5 rounded-full px-3 text-[12.5px] font-semibold underline-offset-4 transition-colors hover:bg-white hover:underline"
                style={{ color: C.textBody }}
              >
                <Heart
                  className="h-[15px] w-[15px]"
                  strokeWidth={1.8}
                  style={{ color: isSaved ? C.clayLight : C.textBody, fill: isSaved ? C.clayLight : 'transparent' }}
                />
                {isSaved ? 'Saved' : 'Save'}
              </button>
            </div>
          </div>

          {/*
            The photo grid: one large frame and four small ones, which is the
            shape that lets someone judge a place in a single glance instead of
            swiping five times. Falls back gracefully — with fewer than five
            images the big frame simply takes the width it needs.
          */}
          <div className="relative mt-4 grid h-[400px] grid-cols-2 gap-2 overflow-hidden rounded-[18px]">
            <button
              type="button"
              onClick={() => setLightbox(0)}
              className="group relative h-full w-full overflow-hidden"
            >
              {media[0]?.kind === 'video' ? (
                <video src={media[0].url} poster={media[0].thumbnail_url ?? undefined} muted playsInline
                  preload="metadata" className="h-full w-full bg-black object-cover" />
              ) : media[0] ? (
                <img src={media[0].url} alt={`${hostel.name} — main photo`} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
              ) : (
                <div className="h-full w-full" style={PHOTO_FALLBACK} />
              )}
            </button>

            <div className="grid grid-cols-2 grid-rows-2 gap-2">
              {[1, 2, 3, 4].map((index) => (
                <button
                  key={index}
                  type="button"
                  onClick={() => setLightbox(index)}
                  disabled={!media[index]}
                  className="group relative h-full w-full overflow-hidden"
                >
                  {media[index]?.kind === 'video' ? (
                    <video src={media[index].url} poster={media[index].thumbnail_url ?? undefined} muted playsInline
                      preload="metadata" className="h-full w-full bg-black object-cover" />
                  ) : media[index] ? (
                    <img src={media[index].url} alt={`${hostel.name} — photo ${index + 1}`}
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]" />
                  ) : (
                    <div className="h-full w-full" style={PHOTO_FALLBACK} />
                  )}
                </button>
              ))}
            </div>

            {/*
              Inside the grid's corner, the way Airbnb does it — it used to sit
              below the grid, where the body sheet's -mt-6 pulled straight over
              it and nobody could see it at all.
            */}
            {media.length > 1 && (
              <button
                type="button"
                onClick={() => setTourOpen(true)}
                className="absolute bottom-4 right-4 flex items-center gap-2 rounded-[10px] border px-3.5 py-2 text-[12.5px] font-bold shadow-[0_2px_8px_rgba(0,0,0,.18)] transition-transform hover:scale-[1.02]"
                style={{ borderColor: C.line, background: '#fff', color: C.text }}
              >
                <LayoutGrid className="h-3.5 w-3.5" strokeWidth={2} />
                Show all {media.length} photos
              </button>
            )}
          </div>


        </div>

        {/* ── Gallery (phone) ──────────────────────────────────────────── */}
        {/*
          A real swipe track, not a single background image.

          It used to render `photos[photoIndex]` as one `background-image` with
          three 3px indicator bars as the only way to change photo: nothing to
          swipe on a phone, nothing to click on a laptop, and a tap target
          three pixels tall. A hostel's photos are the whole reason this page
          exists, and all but the first were effectively unreachable.

          Native scroll-snap does the work — real momentum swipe on touch,
          trackpad swipe on a laptop, no gesture library — with the index
          derived from scroll position so the counter, the dots and the arrows
          all read the same source.
        */}
        <div className="relative h-[290px] lg:hidden">
          <div
            ref={galleryRef}
            onScroll={handleGalleryScroll}
            className="flex h-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain scroll-smooth [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          >
            {(media.length > 0 ? media : [null]).map((item, index) => (
              <div key={item?.url ?? 'placeholder'} className="h-full w-full flex-none snap-center">
                {!item ? (
                  <div className="h-full w-full" style={PHOTO_FALLBACK} />
                ) : item.kind === 'video' ? (
                  // Controls, not autoplay: a listing that starts making noise
                  // when someone opens it is a listing they close.
                  <video
                    src={item.url}
                    poster={item.thumbnail_url ?? undefined}
                    controls
                    playsInline
                    preload="metadata"
                    className="h-full w-full bg-black object-contain"
                  />
                ) : (
                  <img
                    src={item.url}
                    alt={`${hostel.name} — photo ${index + 1} of ${media.length}`}
                    // The first photo is the one every visitor sees; the rest
                    // load as they swipe rather than on arrival.
                    loading={index === 0 ? 'eager' : 'lazy'}
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
            ))}
          </div>

          {/*
            Only Back stays over the photo, and only because you need a way out
            before you have scrolled anywhere. Share and Save moved down beside
            the hostel's name: they were three opaque pucks sitting on the
            middle of the subject of every cover photo, which is the one thing
            this screen exists to show. A gradient behind this one keeps a dark
            chevron legible on a bright sky without a white disc over the
            building.
          */}
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-24"
            style={{ background: 'linear-gradient(to bottom,rgba(20,14,10,.38),transparent)' }}
          />
          <button
            type="button"
            aria-label="Back"
            onClick={goBack}
            className="absolute left-4 top-[max(3.25rem,env(safe-area-inset-top))] flex h-[38px] w-[38px] items-center justify-center rounded-full backdrop-blur-sm transition-colors hover:bg-white/95"
            style={{ background: 'rgba(255,255,255,.82)' }}
          >
            <ChevronLeft className="h-5 w-5" style={{ color: '#3A342E' }} />
          </button>

          {photos.length > 1 && (
            <>
              {/* Indicators are white, and a photo of a bright room is white
                  too. The scrim is what makes "2 / 5" readable on both — the
                  old bars were invisible over half the galleries. */}
              <div
                className="pointer-events-none absolute inset-x-0 bottom-0 h-28"
                style={{ background: 'linear-gradient(to top,rgba(20,14,10,.5),transparent)' }}
              />
              <span
                className="pointer-events-none absolute bottom-9 right-4 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
                style={{ background: 'rgba(34,30,26,.72)' }}
              >
                {photoIndex + 1} / {photos.length}
              </span>

              {/* On a phone the only way through the photos was swiping one at
                  a time. The tour is where they are grouped — rooms, mess,
                  bathrooms — so there is a door to it here too. */}
              <button
                type="button"
                onClick={() => setTourOpen(true)}
                className="absolute bottom-9 left-1/2 -translate-x-1/2 rounded-full px-3 py-1.5 text-[11px] font-bold text-white lg:hidden"
                style={{ background: 'rgba(34,30,26,.72)' }}
              >
                All {media.length} photos
              </button>

              {/* The bars stay 3px tall; the button around them is 24px, so
                  the tap target is a thumb's width rather than a hairline. */}
              {/* Clear of the body sheet, which is pulled 24px up over the
                  gallery — the indicators used to sit *under* it, which is
                  the other half of why photo 2 was unreachable. */}
              <div className="absolute bottom-8 left-3 flex">
                {photos.map((photo, index) => (
                  <button
                    key={photo}
                    type="button"
                    aria-label={`Photo ${index + 1}`}
                    aria-current={index === photoIndex}
                    onClick={() => scrollToPhoto(index)}
                    className="flex h-6 items-center px-1"
                  >
                    <span
                      className="block h-[3px] rounded-sm transition-all"
                      style={{
                        width: index === photoIndex ? 20 : 6,
                        background: index === photoIndex ? '#fff' : 'rgba(255,255,255,.5)',
                      }}
                    />
                  </button>
                ))}
              </div>

              {/* Pointer users have no swipe gesture worth the name, so they
                  get arrows. Hidden on touch widths, where the swipe is the
                  affordance and an arrow would just cover a photo. */}
              {photoIndex > 0 && (
                <button
                  type="button"
                  aria-label="Previous photo"
                  onClick={() => scrollToPhoto(photoIndex - 1)}
                  className="absolute left-4 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full md:flex"
                  style={{ background: 'rgba(255,255,255,.95)', boxShadow: '0 2px 8px rgba(0,0,0,.18)' }}
                >
                  <ChevronLeft className="h-5 w-5" style={{ color: '#3A342E' }} />
                </button>
              )}
              {photoIndex < photos.length - 1 && (
                <button
                  type="button"
                  aria-label="Next photo"
                  onClick={() => scrollToPhoto(photoIndex + 1)}
                  className="absolute right-4 top-1/2 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full md:flex"
                  style={{ background: 'rgba(255,255,255,.95)', boxShadow: '0 2px 8px rgba(0,0,0,.18)' }}
                >
                  <ChevronRight className="h-5 w-5" style={{ color: '#3A342E' }} />
                </button>
              )}
            </>
          )}
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        {/*
          One reading column on a phone; two at desk width — the listing on the
          left, the money on the right. The price and the enquire button ride
          along as a sticky card rather than a bar pinned to the bottom of a
          900px-tall window: on a laptop, the thing you are deciding about
          should stay beside what you are reading, not below the fold of it.
          Capped at 1180px like the rest of Discover — a 1280px line of body
          copy is unreadable.
        */}
        {/*
          `-mt-6` lifts the sheet over the phone's full-bleed gallery like a
          card. On desktop there is nothing to lift over — the photo grid is a
          contained block that ends — so the negative margin only cut the
          bottom off the photographs and half-covered "Show all photos".
        */}
        <div className="relative mx-auto -mt-6 w-full max-w-[860px] lg:mt-8 lg:grid lg:max-w-[1180px] lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-7 lg:px-8">
        <div
          className="rounded-[24px] px-5 pb-8 pt-5 lg:px-8"
          style={{ background: C.paper }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="flex items-center gap-1.5 rounded-full px-2.5 py-1"
              style={{ background: C.ink }}
            >
              <ShieldCheck className="h-[11px] w-[11px]" strokeWidth={2} style={{ color: C.clayLight }} />
              <span className="text-[9.5px] font-bold tracking-[0.03em] text-white">Verified hostel</span>
            </span>
            {audience && (
              <span
                className="rounded-full px-2.5 py-1.5 text-[11px] font-bold"
                style={{ background: '#EDE5DB', color: '#6E6459' }}
              >
                {audience}
              </span>
            )}
            {hostel.food_included && (
              <span
                className="flex items-center gap-1.5 rounded-full px-2.5 py-1.5"
                style={{ background: C.greenPale }}
              >
                <Utensils className="h-3 w-3" strokeWidth={2} style={{ color: C.green }} />
                <span className="text-[11px] font-bold" style={{ color: C.green }}>Meals included</span>
              </span>
            )}
          </div>

          {/* The phone's title row. Desktop shows the name and these actions
              above the photo grid instead — rendering both put the hostel's
              name on screen twice. */}
          <div className="mt-2.5 flex items-start justify-between gap-3 lg:hidden">
          <h1
            className="min-w-0 flex-1 text-[23px] font-extrabold leading-[1.2] tracking-[-0.02em]"
            style={{ fontFamily: FONT.display, color: C.text }}
          >
            {hostel.name}
          </h1>

            <div className="flex flex-none items-center gap-1.5">
              <button
                type="button"
                aria-label={`Share ${hostel.name}`}
                onClick={() => { setShareCopied(false); setShareOpen(true); }}
                className="flex h-9 items-center gap-1.5 rounded-full border px-3 transition-colors hover:bg-white"
                style={{ borderColor: C.line, background: C.cardWarm }}
              >
                <Share2 className="h-[15px] w-[15px]" strokeWidth={1.8} style={{ color: C.textBody }} />
                <span className="hidden text-[12px] font-semibold sm:inline" style={{ color: C.textBody }}>
                  Share
                </span>
              </button>
              <button
                type="button"
                aria-label={isSaved ? 'Remove from saved' : 'Save this hostel'}
                aria-pressed={isSaved}
                onClick={handleSave}
                className="flex h-9 items-center gap-1.5 rounded-full border px-3 transition-colors hover:bg-white"
                style={{ borderColor: C.line, background: C.cardWarm }}
              >
                <Heart
                  className="h-[15px] w-[15px]"
                  strokeWidth={1.8}
                  style={{ color: isSaved ? C.clayLight : C.textBody, fill: isSaved ? C.clayLight : 'transparent' }}
                />
                <span className="hidden text-[12px] font-semibold sm:inline" style={{ color: C.textBody }}>
                  {isSaved ? 'Saved' : 'Save'}
                </span>
              </button>
            </div>
          </div>

          <p className="mt-2 flex items-center gap-1.5 text-[12.5px]" style={{ color: C.textMuted }}>
            <MapPin className="h-3.5 w-3.5 flex-none" strokeWidth={1.7} style={{ color: C.textGhost }} />
            {[hostel.address, hostel.city, hostel.state].filter(Boolean).join(', ')}
          </p>

          {totalVacant > 0 && (
            <p className="mt-2 text-[12.5px] font-semibold" style={{ color: C.green }}>
              {totalVacant} {totalVacant === 1 ? 'bed' : 'beds'} available right now
            </p>
          )}

          {/* ── Who runs it ────────────────────────────────────────────── */}
          {/*
            A listing with nobody attached is a database row. Airbnb puts the
            host on the page for the same reason: somebody is answerable for
            this place. Name and start date only — a public listing is not
            where an owner's phone number goes, and the hostel's own business
            number is already above.
          */}
          {(data?.host?.name || data?.host?.listed_since) && (
            <div
              className="mt-5 flex items-center gap-3 border-t pt-5"
              style={{ borderColor: C.line }}
            >
              <span
                className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-[15px] font-extrabold"
                style={{ fontFamily: FONT.display, background: C.clayPaleBg, color: C.clayDeep }}
              >
                {(data.host.name ?? 'S').trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
                  {data.host.platform_listed
                    ? 'Listed by Stayo'
                    : data.host.name
                      ? `Managed by ${data.host.name}`
                      : 'Managed by the owner'}
                </p>
                <p className="mt-0.5 text-[11.5px]" style={{ color: C.textMuted }}>
                  {data.host.listed_since
                    ? `On Stayo since ${new Date(data.host.listed_since).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`
                    : 'On Stayo'}
                </p>
              </div>
            </div>
          )}

          {/* ── Highlights ─────────────────────────────────────────────── */}
          {/* The owner's own three things worth knowing, reviewed like the
              rest of the listing. They were collected and never displayed. */}
          {(hostel.highlights?.length ?? 0) > 0 && (
            <section className="mt-5 border-t pt-5" style={{ borderColor: C.line }}>
              <div className="flex flex-col gap-3">
                {hostel.highlights.slice(0, 6).map((highlight: string) => (
                  <div key={highlight} className="flex items-start gap-3">
                    <Sparkles className="mt-0.5 h-4 w-4 flex-none" strokeWidth={1.8} style={{ color: C.clay }} />
                    <p className="text-[12.5px] leading-[1.5]" style={{ color: C.textBody }}>{highlight}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── About ──────────────────────────────────────────────────── */}
          {hostel.about && (
            <section className="mt-5 border-t pt-5" style={{ borderColor: C.line }}>
              <h2 className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                About this hostel
              </h2>
              <p
                className={`mt-2 whitespace-pre-line text-[12.5px] leading-[1.7] ${aboutOpen ? '' : 'line-clamp-4'}`}
                style={{ color: C.textBody }}
              >
                {hostel.about}
              </p>
              {hostel.about.length > 240 && (
                <button
                  type="button"
                  onClick={() => setAboutOpen((open) => !open)}
                  className="mt-2 text-[12.5px] font-bold underline underline-offset-4"
                  style={{ color: C.text }}
                >
                  {aboutOpen ? 'Show less' : 'Show more'}
                </button>
              )}
            </section>
          )}

          {/* ── Beds ───────────────────────────────────────────────────── */}
          <section className="mt-7 border-t pt-5" style={{ borderColor: C.line }}>
            <h2 className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
              Choose your bed
            </h2>
            <p className="mt-0.5 text-[12px]" style={{ color: C.textMuted }}>
              Monthly rent per bed, as listed by the owner
            </p>

            {bedOptions.length === 0 ? (
              <p
                className="mt-3 rounded-2xl border p-4 text-[12.5px]"
                style={{ background: '#fff', borderColor: C.line, color: C.textMuted }}
              >
                The owner hasn't published room details yet. Send an enquiry and they'll get back to you.
              </p>
            ) : (
              <div className="mt-3 flex flex-col gap-2.5">
                {bedOptions.map((option, index) => {
                  const active = selected === index;
                  const soldOut = option.availableBeds === 0;
                  return (
                    <button
                      key={`${option.capacity}-${index}`}
                      type="button"
                      disabled={soldOut}
                      onClick={() => setSelected(index)}
                      aria-pressed={active}
                      className="flex items-center gap-3.5 rounded-2xl bg-white p-4 text-left transition-colors disabled:opacity-55"
                      style={{
                        border: active ? `2px solid ${C.clay}` : `1px solid ${C.line}`,
                        boxShadow: '0 1px 2px rgba(40,30,20,.04)',
                      }}
                    >
                      <span
                        className="flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full"
                        style={{ border: `2px solid ${active ? C.clay : '#D9CFC3'}` }}
                      >
                        <span
                          className="h-[11px] w-[11px] rounded-full"
                          style={{ background: active ? C.clay : 'transparent' }}
                        />
                      </span>

                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="text-[14px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
                            {option.label}
                          </span>
                          <span
                            className="rounded-md px-1.5 py-0.5 text-[10px] font-semibold"
                            style={
                              soldOut
                                ? { background: '#EFE6DA', color: C.textMuted }
                                : option.availableBeds <= 2
                                  ? { background: C.amberPale, color: C.amber }
                                  : { background: C.greenPale, color: C.green }
                            }
                          >
                            {soldOut
                              ? 'Full'
                              : `${option.availableBeds} ${option.availableBeds === 1 ? 'bed' : 'beds'} left`}
                          </span>
                        </span>
                        {option.roomType && (
                          <span className="mt-0.5 block text-[11.5px]" style={{ color: C.textMuted }}>
                            {option.roomType}
                          </span>
                        )}

                        {/*
                          The size, in the only unit that compares across
                          hostels: floor per person. A 140 sq ft room is 35 sq
                          ft each at 4-sharing and 23 at 6 — the same photo,
                          a different life. Absent entirely for rooms the
                          owner has not measured.
                        */}
                        {(option as any).space?.perBedArea != null && (
                          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span
                              className="rounded-md px-1.5 py-0.5 text-[10.5px] font-bold"
                              style={{ background: C.clayPaleBg, color: C.clayDeep }}
                            >
                              {(option as any).space.perBedArea} sq ft per bed
                            </span>
                            {(option as any).space.dimensions && !(option as any).space.varies && (
                              <span className="text-[11px]" style={{ color: C.textMuted }}>
                                {(option as any).space.dimensions}
                              </span>
                            )}
                            {(option as any).space.anchor && (
                              <span className="text-[11px]" style={{ color: C.textMuted }}>
                                · {(option as any).space.anchor}
                              </span>
                            )}
                          </span>
                        )}

                        {((option as any).space?.storage?.length ?? 0) > 0 && (
                          <span className="mt-1 block text-[11px] leading-[1.55]" style={{ color: C.textMuted }}>
                            {(option as any).space.storage.join(' · ')}
                          </span>
                        )}
                      </span>

                      <span className="flex-none text-right">
                        {option.price != null ? (
                          <>
                            <span className="block text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                              ₹{formatRupees(option.price)}
                            </span>
                            <span className="block text-[10.5px]" style={{ color: C.textMuted }}>/month</span>
                          </>
                        ) : (
                          <span className="text-[11.5px] font-semibold" style={{ color: C.textMuted }}>On request</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── What this hostel offers ──────────────────────────────── */}
          {amenities.length > 0 && (
            <section className="mt-7 border-t pt-5" style={{ borderColor: C.line }}>
              <h2 className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                What this hostel offers
              </h2>
              {/*
                A chip carries a name; a seeker is choosing on the details.
                "Hot water" answers less than "Hot water · 6–10 AM · 6–10 PM",
                and both come from the same reviewed revision the tenant's Room
                tab reads — so the two surfaces cannot disagree. Amenities with
                nothing extra still render exactly as they did.
              */}
              <div className="mt-3 flex flex-wrap gap-2">
                {amenities.map((amenity: any) => (
                  <span
                    key={amenity.label}
                    className="rounded-[10px] px-3 py-2 text-[12.5px] font-semibold"
                    style={{ background: C.chipBg, color: '#6E6459' }}
                  >
                    {amenity.label}
                    {(() => {
                      const { pill, line } = describeAvailability(amenity);
                      const extra = pill ?? line;
                      return extra ? (
                        <span className="ml-1.5 font-medium" style={{ color: '#9A8F84' }}>
                          {extra}
                        </span>
                      ) : null;
                    })()}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ── Food & mess ──────────────────────────────────────────────
              Per the `Food & mess` block of `Stayo Discover.dc.html`. The
              menu is reviewed marketing content, not the operational food
              schedule — see ADR-077. */}
          {mess && mess.meals.length > 0 && (
            <section className="mt-7 border-t pt-5" style={{ borderColor: C.line }}>
              <div className="flex items-center justify-between">
                <h2 className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                  Food &amp; mess
                </h2>
                <span
                  className="flex items-center gap-[5px] rounded-full px-2.5 py-1"
                  style={{ background: '#ECF4EF' }}
                >
                  <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: C.green }} />
                  <span className="text-[11px] font-bold" style={{ color: C.green }}>
                    {MESS_TYPE_LABEL[mess.type] ?? mess.type}
                  </span>
                </span>
              </div>
              <p className="mt-0.5 text-[12px]" style={{ color: C.textMuted }}>
                Meals included in rent · served fresh in the mess hall
              </p>

              <div className="mt-[13px] flex gap-1.5 overflow-x-auto pb-0.5">
                {MESS_DAYS.map((day, index) => {
                  const active = index === messDay;
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setMessDay(index)}
                      className="flex-none rounded-[10px] px-3.5 py-2 text-[12.5px]"
                      style={{
                        fontFamily: FONT.display,
                        fontWeight: active ? 700 : 600,
                        background: active ? C.clay : '#F1EBE3',
                        color: active ? '#FFFFFF' : '#6E6459',
                      }}
                    >
                      {day}
                    </button>
                  );
                })}
              </div>

              <div
                className="mt-3 overflow-hidden rounded-2xl border bg-white"
                style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
              >
                {mess.meals.map((meal, index) => {
                  const Icon = MEAL_ICON[meal.key] ?? Utensils;
                  const dishes = mess.week[messDay]?.[meal.key]?.trim();
                  return (
                    <div
                      key={meal.key}
                      className="flex gap-3 px-[15px] py-[14px]"
                      style={{ borderTop: index === 0 ? 'none' : `1px solid ${C.lineSoft}` }}
                    >
                      <span
                        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]"
                        style={{ background: C.chipBg, color: C.clay }}
                      >
                        <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="text-[13px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
                            {meal.label}
                          </span>
                          <span className="text-[11px]" style={{ color: C.textGhost }}>
                            {meal.time}
                          </span>
                        </div>
                        {/* An unwritten day is said plainly rather than left
                            blank — a gap in a menu row reads as a bug. */}
                        <p
                          className="mt-[3px] text-[12.5px] font-medium leading-[1.5]"
                          style={{ color: dishes ? '#5A5147' : C.textGhost }}
                        >
                          {dishes || 'Menu not published for this day yet'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {/* ── Getting around ───────────────────────────────────────── */}
          {(hasNavigation(navigation) || places.length > 0) && (
            <section className="mt-7 border-t pt-5" style={{ borderColor: C.line }}>
              <h2 className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                Where you'll be
              </h2>

              {/*
                The area first, because that is the question being asked. Someone
                choosing between hostels is choosing between neighbourhoods, and
                the street address below the fold answers a later question.
              */}
              {whereYoullBe({ city: hostel.city, state: hostel.state }) && (
                <p className="mt-1.5 text-[13.5px]" style={{ color: C.textMuted }}>
                  {whereYoullBe({ city: hostel.city, state: hostel.state })}
                </p>
              )}

              {/*
                Keyless map. Google's `output=embed` iframe needs no API key,
                no SDK and no new dependency, and carries only Google's own small
                logo rather than the attribution bar OSM paints across the frame.
                Renders nothing at all until an admin has entered a pin, rather
                than showing an empty box. See mapEmbedUrl for the caveat.
              */}
              {mapEmbedUrl(navigation) && (
                <div
                  className="mt-3 overflow-hidden rounded-2xl"
                  style={{ border: `1px solid ${C.line}` }}
                >
                  <iframe
                    src={mapEmbedUrl(navigation) as string}
                    title={`Map showing ${hostel.name}`}
                    loading="lazy"
                    referrerPolicy="no-referrer-when-downgrade"
                    /*
                      Google decides whether to show the place card — name,
                      address, rating — or collapse to a bare "Open in Maps"
                      chip, and it decides from the iframe's size. At 240px it
                      collapses. Taller gives it room to show the card; the
                      card is Google's call, not ours, so this is the lever we
                      have rather than a guarantee.
                    */
                    className="block h-[320px] w-full sm:h-[380px]"
                    allowFullScreen
                    style={{ border: 0 }}
                  />
                </div>
              )}

              {/*
                Finding the door.

                In a cluster of hostels off one lane, an address resolves to the
                lane and a map pin dropped by hand resolves to the roof next
                door. This block exists because the last fifty metres is where
                people actually get lost: a Place ID Google itself resolves, the
                sentence a senior would say out loud, and a photograph of the
                gate you are looking for. Only rendered when an admin has
                located this hostel — see migration 074.
              */}
              {hasNavigation(navigation) && (
                <div
                  className="mt-3 overflow-hidden rounded-2xl border bg-white sm:flex"
                  style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
                >
                  {navigation?.entrancePhoto && (
                    <div className="relative h-[168px] flex-none bg-cover bg-center sm:h-auto sm:w-[210px]"
                      style={{ backgroundImage: `url(${navigation.entrancePhoto})` }}
                    >
                      <div
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-16"
                        style={{ background: 'linear-gradient(to top,rgba(34,30,26,.62),rgba(34,30,26,0))' }}
                      />
                      <span className="absolute bottom-2.5 left-3 right-3 text-[11.5px] font-bold text-white">
                        Look for this entrance
                      </span>
                    </div>
                  )}

                  <div className="flex flex-1 flex-col gap-2 p-4">
                    {distanceLine(navigation) && (
                      <p className="flex items-center gap-1.5 text-[13px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
                        <MapPin className="h-3.5 w-3.5 flex-none" strokeWidth={2} style={{ color: C.clay }} />
                        {distanceLine(navigation)}
                      </p>
                    )}
                    {navigation?.landmark && (
                      <p className="text-[12.5px] leading-[1.5]" style={{ color: C.textBody }}>
                        {navigation.landmark}
                      </p>
                    )}

                    {/*
                      A real link, not a button with an onClick: a student can
                      long-press it, and it still works if the JS handler never
                      runs. `dir_action=navigate` means one tap, not a route
                      preview they have to confirm.
                    */}
                    <a
                      href={directionsUrl(navigation, hostel?.name ?? '') ?? undefined}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 flex items-center justify-center gap-2 rounded-[13px] px-4 py-3 text-[13.5px] font-bold text-white transition-transform active:scale-[.98] sm:self-start sm:px-5"
                      style={{ fontFamily: FONT.display, background: C.clay }}
                    >
                      <Navigation className="h-4 w-4 flex-none" strokeWidth={2.2} />
                      Get Directions
                    </a>
                  </div>
                </div>
              )}

              {places.length > 0 && (
              <div
                className="mt-3 overflow-hidden rounded-2xl border bg-white"
                style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04)' }}
              >
                {places.map((place, index) => (
                  <div
                    key={`${place.name}-${index}`}
                    className="flex items-center gap-3 px-4 py-3"
                    style={{ borderTop: index === 0 ? 'none' : `1px solid ${C.lineSoft}` }}
                  >
                    <MapPin className="h-4 w-4 flex-none" strokeWidth={1.8} style={{ color: C.clay }} />
                    <span className="flex-1 text-[13px] font-medium" style={{ color: C.textBody }}>
                      {place.name}
                    </span>
                    <span className="flex-none text-[12.5px] font-bold tabular-nums" style={{ fontFamily: FONT.display, color: C.text }}>
                      {place.distance}
                    </span>
                  </div>
                ))}
              </div>
              )}
            </section>
          )}
        </div>

        {/* Desktop-only: the decision column. Mirrors the sticky bar a phone
            gets, which is hidden at this width so there is only ever one
            price and one Enquire button on screen. Deliberately paired only
            with the content above (through Map) — this grid ends there, so
            the sticky card stops following scroll once Reviews begins rather
            than tracking the whole rest of the page. */}
        <aside className="hidden lg:block lg:sticky lg:top-6">
          <div
            className="rounded-[20px] border p-5"
            style={{ background: C.cardWarm, borderColor: C.line, boxShadow: '0 8px 24px rgba(40,30,20,.07)' }}
          >
            <p className="text-[11px]" style={{ color: C.textMuted }}>
              {selectedOption ? `${selectedOption.label} selected` : 'Starting from'}
            </p>
            {displayPrice != null ? (
              <p className="mt-1 flex items-baseline gap-1">
                <span
                  className="text-[26px] font-extrabold tracking-[-0.02em]"
                  style={{ fontFamily: FONT.display, color: C.text }}
                >
                  ₹{formatRupees(displayPrice)}
                </span>
                <span className="text-[12px]" style={{ color: C.textMuted }}>/month</span>
              </p>
            ) : (
              <p className="mt-1 text-[18px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
                Price on request
              </p>
            )}

            {hostel.vacant_beds > 0 && (
              <p className="mt-1.5 text-[12px] font-semibold" style={{ color: C.green }}>
                {hostel.vacant_beds} {hostel.vacant_beds === 1 ? 'bed' : 'beds'} available right now
              </p>
            )}

            <div className="mt-4">
              <PrimaryButton
                full
                onClick={() =>
                  navigate(`/discover/h/${slug}/enquire`, {
                    state: { roomCapacity: selectedOption?.capacity, hostelName: hostel.name },
                  })
                }
              >
                Enquire
              </PrimaryButton>
            </div>

            <p className="mt-3 text-[11px] leading-[1.55]" style={{ color: C.textMuted }}>
              Enquiring is free and does not book anything — the hostel replies to you directly.
            </p>
          </div>
        </aside>
        </div>

        {/* ── Reviews ──────────────────────────────────────────────────────
            Deliberately outside the two-column grid above: it needs the
            full page width (not the narrower column shared with the sticky
            sidebar), and keeping it out of that grid is what lets the
            sticky price card stop following scroll once Map ends instead of
            tracking through this section too. */}
        <div className="mx-auto mt-4 w-full max-w-[860px] lg:mt-6 lg:max-w-[1180px] lg:px-8">
          <div className="rounded-[24px] px-5 py-6 lg:px-8" style={{ background: C.paper }}>
            <ReviewsSection slug={slug} hostelName={hostel.name} />
          </div>
        </div>
      </div>

      {tourOpen && (
        <PhotoTour media={media as any} hostelName={hostel.name} onClose={() => setTourOpen(false)} />
      )}

      {lightbox !== null && media.length > 0 && (
        <MediaLightbox
          media={media}
          startIndex={lightbox}
          hostelName={hostel.name}
          onClose={() => setLightbox(null)}
        />
      )}

      {/* ── Sticky enquire bar ───────────────────────────────────────────── */}
      <div
        className="sticky bottom-0 z-30 mx-auto flex w-full max-w-[860px] flex-none items-center gap-3.5 border-t px-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3 lg:hidden"
        style={{ background: C.cardWarm, borderColor: C.line, boxShadow: '0 -6px 18px rgba(40,30,20,.06)' }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px]" style={{ color: C.textMuted }}>
            {selectedOption ? `${selectedOption.label} selected` : 'Starting from'}
          </p>
          {displayPrice != null ? (
            <p className="flex items-baseline gap-1">
              <span className="text-[20px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                ₹{formatRupees(displayPrice)}
              </span>
              <span className="text-[11px]" style={{ color: C.textMuted }}>/mo</span>
            </p>
          ) : (
            <p className="text-[15px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
              Price on request
            </p>
          )}
        </div>

        <PrimaryButton
          onClick={() =>
            navigate(`/discover/h/${slug}/enquire`, {
              state: { roomCapacity: selectedOption?.capacity, hostelName: hostel.name },
            })
          }
        >
          Enquire
        </PrimaryButton>
      </div>

      <ShareSheet
        open={shareOpen}
        onClose={() => setShareOpen(false)}
        hostel={{ name: hostel.name, slug: slug as string, city: hostel.city }}
        url={buildShareUrl(slug as string, window.location.origin)}
        photoUrl={(hostel.photos ?? [])[0] ?? null}
        summary={buildShareSummary({
          city: hostel.city,
          hostelType: hostel.hostel_type,
          startingPrice: hostel.starting_price ?? null,
          rating: hostel.rating ?? null,
          reviewCount: hostel.review_count ?? null,
        })}
        copied={shareCopied}
        onCopy={async () => {
          const ok = await copyToClipboard(buildShareUrl(slug as string, window.location.origin));
          setShareCopied(ok);
        }}
        // Only offered where the OS sheet exists — it is the one route to
        // Instagram and to recent contacts, so it is kept, not replaced.
        onNativeShare={
          typeof navigator !== 'undefined' && typeof navigator.share === 'function'
            ? () => share({ name: hostel.name, slug: slug as string, city: hostel.city })
            : null
        }
      />
    </div>
  );
}
