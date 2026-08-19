import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';

import { photoIndexFromScroll } from '../galleryScroll';

export interface LightboxItem {
  url: string;
  kind: 'image' | 'video';
  thumbnail_url?: string | null;
}

/**
 * Every photo of a hostel, full screen.
 *
 * The desktop grid shows five frames; this is where the other six live. Same
 * scroll-snap mechanism as the phone gallery — one track, arrow keys and
 * arrows on top — rather than a second carousel implementation that would
 * drift from it.
 */
export function MediaLightbox({
  media,
  startIndex,
  hostelName,
  onClose,
}: {
  media: LightboxItem[];
  startIndex: number;
  hostelName: string;
  onClose: () => void;
}) {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [index, setIndex] = useState(startIndex);

  const scrollTo = (next: number) => {
    const track = trackRef.current;
    if (!track || next < 0 || next >= media.length) return;
    track.scrollTo({ left: next * track.clientWidth, behavior: 'smooth' });
  };

  /**
   * Jump to the clicked frame — **once, on open**.
   *
   * This and the key handler below were one effect with no dependency array,
   * so it re-ran after every render: pressing → scrolled the track, the scroll
   * updated `index`, the re-render ran the effect again and set `scrollLeft`
   * straight back to where the viewer opened. Arrow keys and the on-screen
   * arrows both looked dead because every move was immediately undone.
   */
  useEffect(() => {
    const track = trackRef.current;
    if (track) track.scrollLeft = startIndex * track.clientWidth;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [startIndex]);

  // Escape closes — a full-screen overlay with no keyboard exit is a trap —
  // and the arrows step through. Re-bound as `index` moves so the handler is
  // never one photo behind.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowRight') scrollTo(index + 1);
      if (event.key === 'ArrowLeft') scrollTo(index - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, media.length, onClose]);

  return (
    <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: 'rgba(14,10,8,.96)' }}>
      <div className="flex flex-none items-center justify-between px-5 py-4">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close photos"
          className="flex h-10 w-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/10"
        >
          <X className="h-5 w-5" strokeWidth={2} />
        </button>
        <span className="text-[13px] font-semibold text-white/80">
          {index + 1} / {media.length}
        </span>
      </div>

      <div
        ref={trackRef}
        onScroll={() => {
          const track = trackRef.current;
          if (track) setIndex(photoIndexFromScroll(track.scrollLeft, track.clientWidth, media.length));
        }}
        className="flex flex-1 snap-x snap-mandatory overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {media.map((item, position) => (
          <div key={item.url} className="flex h-full w-full flex-none snap-center items-center justify-center p-4">
            {item.kind === 'video' ? (
              <video src={item.url} poster={item.thumbnail_url ?? undefined} controls playsInline
                className="max-h-full max-w-full" />
            ) : (
              <img
                src={item.url}
                alt={`${hostelName} — photo ${position + 1} of ${media.length}`}
                className="max-h-full max-w-full object-contain"
              />
            )}
          </div>
        ))}
      </div>

      {index > 0 && (
        <button
          type="button"
          aria-label="Previous photo"
          onClick={() => scrollTo(index - 1)}
          className="absolute left-5 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 md:flex"
        >
          <ChevronLeft className="h-5 w-5" style={{ color: '#3A342E' }} />
        </button>
      )}
      {index < media.length - 1 && (
        <button
          type="button"
          aria-label="Next photo"
          onClick={() => scrollTo(index + 1)}
          className="absolute right-5 top-1/2 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full bg-white/95 md:flex"
        >
          <ChevronRight className="h-5 w-5" style={{ color: '#3A342E' }} />
        </button>
      )}
    </div>
  );
}
