import { useMemo, useState } from 'react';
import { ChevronLeft, Play } from 'lucide-react';

import { C, FONT, PAGE_SHELL, PHOTO_FALLBACK } from '../discoverTheme';
import { categoryLabel } from '@features/hostel-drilldown/marketing/photoCategories';
import { MediaLightbox, type LightboxItem } from './MediaLightbox';

export interface TourMedia extends LightboxItem {
  label?: string | null;
  category?: string;
}

/**
 * Every photo of a hostel, grouped by the part of the building it shows.
 *
 * Airbnb's "photo tour", in Stayo's vocabulary: a strip of section thumbnails
 * to jump with, then each section in full — rooms first, because that is what
 * a person is deciding about, then bathrooms, mess, common areas. A grid of
 * forty undifferentiated photos makes someone hunt for the bathroom; this
 * answers "show me the bathrooms" in one tap.
 *
 * The order and the grouping rules live in the backend's `photo-tour.ts` and
 * are mirrored here for the client-side payload — see `groupTour` below, which
 * is deliberately the same shape so the two cannot disagree about what an
 * uncategorised photo does (it lands in "More photos"; it is never dropped).
 */
const SECTION_ORDER = ['rooms', 'bathrooms', 'mess', 'common', 'study', 'outside', 'other'];

function groupTour(media: TourMedia[]) {
  return SECTION_ORDER.map((key) => ({
    key,
    label: categoryLabel(key),
    items: media.filter((item) => (item.category ?? 'other') === key),
  })).filter((section) => section.items.length > 0);
}

export function PhotoTour({
  media,
  hostelName,
  onClose,
}: {
  media: TourMedia[];
  hostelName: string;
  onClose: () => void;
}) {
  const sections = useMemo(() => groupTour(media), [media]);
  // The viewer steps through the tour's own order, so "next" from the last
  // room photo lands on the first bathroom photo rather than jumping.
  const flat = useMemo(() => sections.flatMap((section) => section.items), [sections]);
  const [lightbox, setLightbox] = useState<number | null>(null);

  const openAt = (item: TourMedia) => setLightbox(flat.findIndex((entry) => entry.url === item.url));

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto" style={{ background: C.paper }}>
      <header
        className="sticky top-0 z-10 border-b backdrop-blur-md"
        style={{ background: 'rgba(247,243,239,.9)', borderColor: C.line }}
      >
        <div className={`${PAGE_SHELL} flex items-center gap-3 py-3.5`}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close photos"
            className="flex h-9 w-9 flex-none items-center justify-center rounded-full transition-colors hover:bg-white"
          >
            <ChevronLeft className="h-5 w-5" style={{ color: C.text }} />
          </button>
          <span className="text-[14px] font-bold" style={{ fontFamily: FONT.display, color: C.text }}>
            Photo tour
          </span>
          <span className="ml-auto text-[12px]" style={{ color: C.textMuted }}>
            {flat.length} {flat.length === 1 ? 'photo' : 'photos'}
          </span>
        </div>
      </header>

      <div className={`${PAGE_SHELL} pb-16 pt-6`}>
        <h1
          className="text-[22px] font-extrabold tracking-[-0.02em] lg:text-[26px]"
          style={{ fontFamily: FONT.display, color: C.text }}
        >
          {hostelName}
        </h1>

        {/* The jump strip: one thumbnail per part of the hostel. */}
        {sections.length > 1 && (
          <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {sections.map((section) => {
              const cover = section.items.find((item) => item.kind === 'image') ?? section.items[0];
              return (
                <a
                  key={section.key}
                  href={`#tour-${section.key}`}
                  className="group text-left"
                  onClick={(event) => {
                    event.preventDefault();
                    document.getElementById(`tour-${section.key}`)?.scrollIntoView({ behavior: 'smooth' });
                  }}
                >
                  <span className="block aspect-[4/3] overflow-hidden rounded-[12px]" style={PHOTO_FALLBACK}>
                    {cover?.kind === 'image' && (
                      <img
                        src={cover.url}
                        alt={section.label}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                      />
                    )}
                    {cover?.kind === 'video' && (
                      <video
                        src={cover.url}
                        poster={cover.thumbnail_url ?? undefined}
                        muted
                        playsInline
                        preload="metadata"
                        className="h-full w-full bg-black object-cover"
                      />
                    )}
                  </span>
                  <span className="mt-1.5 block text-[12px] font-semibold" style={{ color: C.textBody }}>
                    {section.label}
                  </span>
                  <span className="block text-[11px]" style={{ color: C.textGhost }}>
                    {section.items.length}
                  </span>
                </a>
              );
            })}
          </div>
        )}

        {/* Each section in full. First photo large, the rest two-up — the shape
            that lets a room read at a glance and its details sit beneath. */}
        {sections.map((section) => (
          <section key={section.key} id={`tour-${section.key}`} className="mt-10 scroll-mt-20 lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
            <h2
              className="text-[17px] font-extrabold tracking-[-0.01em] lg:sticky lg:top-24 lg:self-start"
              style={{ fontFamily: FONT.display, color: C.text }}
            >
              {section.label}
            </h2>

            <div className="mt-3 flex flex-col gap-3 lg:mt-0">
              {section.items.map((item, index) => (
                <button
                  key={item.url}
                  type="button"
                  onClick={() => openAt(item)}
                  className={`group block overflow-hidden rounded-[14px] ${
                    index === 0 ? '' : 'sm:inline-block sm:w-[calc(50%-6px)]'
                  }`}
                  style={PHOTO_FALLBACK}
                >
                  {item.kind === 'video' ? (
                    <span className="relative block">
                      <video
                        src={item.url}
                        poster={item.thumbnail_url ?? undefined}
                        muted
                        playsInline
                        preload="metadata"
                        className="block w-full bg-black object-cover"
                      />
                      <span className="pointer-events-none absolute inset-0 flex items-center justify-center">
                        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55">
                          <Play className="h-5 w-5 text-white" fill="currentColor" strokeWidth={0} />
                        </span>
                      </span>
                    </span>
                  ) : (
                    <img
                      src={item.url}
                      alt={item.label ?? `${hostelName} — ${section.label}`}
                      loading="lazy"
                      className="block w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  )}
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>

      {lightbox !== null && lightbox >= 0 && (
        <MediaLightbox
          media={flat}
          startIndex={lightbox}
          hostelName={hostelName}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}
