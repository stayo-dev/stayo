import { Heart, MapPin, Share2, UtensilsCrossed } from 'lucide-react';

import type { DiscoverCard } from '@features/discover/api';
import { C, FONT, PHOTO_FALLBACK } from '../discoverTheme';
import { hostelCardFacts, type AvailabilityTone } from '../hostelCardFacts';

interface HostelCardProps {
  hostel: DiscoverCard;
  saved: boolean;
  onOpen: (slug: string) => void;
  onToggleSave: (hostel: DiscoverCard) => void;
  /** Sends this hostel's `/h/<slug>` link to the OS share sheet. */
  onShare?: (hostel: DiscoverCard) => void;
  /** `compact` is the horizontal row used on Saved; default is the full card. */
  variant?: 'full' | 'compact';
}

/** Availability reads as colour before it reads as words. */
const AVAILABILITY_COLOR: Record<AvailabilityTone, string> = {
  open: C.green,
  scarce: C.amber,
  full: C.textFaint,
};

/**
 * The one hostel card. Deliberately a single component with a `variant` rather
 * than two near-identical ones — the prototype drew three shapes of card and
 * they had already drifted apart in spacing and price formatting.
 *
 * Two things govern the full card's layout:
 *
 * 1. **Every card is the same height, by construction.** The text block is a
 *    fixed rhythm — one title line, one location line, one chip line, one
 *    price line — and `hostelCardFacts` guarantees each of those has content
 *    and fits. The old card let the data decide: a hostel with one room type
 *    drew a lonely chip and left a hole above the price, which is what made a
 *    row of cards look lopsided at desk width.
 * 2. **Nothing on it is true of every hostel.** A "Verified" badge on a
 *    surface where every hostel is verified is decoration that costs a corner
 *    of the photo; verification is stated once, in the section heading. What
 *    stays on the photo is the one thing that disqualifies a hostel outright —
 *    who it is for.
 *
 * There is no rating and no amenity row because that data does not exist yet
 * (phases C/D); the layout leaves room for them rather than filling the gap
 * with a plausible number.
 */
export function HostelCard({ hostel, saved, onOpen, onToggleSave, onShare, variant = 'full' }: HostelCardProps) {
  const facts = hostelCardFacts(hostel);
  const compact = variant === 'compact';

  const open = () => {
    if (hostel.slug) onOpen(hostel.slug);
  };

  const saveButton = (
    <button
      type="button"
      aria-label={saved ? `Remove ${hostel.name} from saved` : `Save ${hostel.name}`}
      aria-pressed={saved}
      onClick={(event) => {
        // The heart sits inside the card's own click target.
        event.stopPropagation();
        onToggleSave(hostel);
      }}
      className={
        compact
          ? 'flex flex-none items-center justify-center rounded-full transition-transform active:scale-90'
          : // Hidden until hover on a pointer device, always present on touch —
            // and always present once saved, since it is then a state readout
            // and not just a control.
            `flex flex-none items-center justify-center rounded-full transition-[opacity,transform,background-color] duration-200 ease-out hover:bg-white active:scale-90 ${
              saved
                ? 'opacity-100'
                : 'lg:-translate-y-1 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100 lg:group-focus-within:translate-y-0 lg:group-focus-within:opacity-100'
            }`
      }
      style={{
        width: compact ? 30 : 34,
        height: compact ? 30 : 34,
        background: compact ? '#FBEFE9' : 'rgba(255,255,255,.92)',
        boxShadow: compact ? 'none' : '0 2px 6px rgba(0,0,0,.15)',
      }}
    >
      <Heart
        className="h-4 w-4"
        strokeWidth={1.8}
        style={{
          color: saved ? C.clayLight : C.textMuted,
          fill: saved ? C.clayLight : 'transparent',
        }}
      />
    </button>
  );

  /**
   * Share sits beside Save rather than in the card's text, because the two are
   * the same kind of thing — something you do *to* this hostel — and a person
   * looks for them together. Two small pucks on a thumbnail is the convention;
   * the reason they were wrong on the listing page is that there the photo is
   * the thing you are studying, and here it is a 4:3 preview.
   */
  const shareButton = onShare ? (
    <button
      type="button"
      aria-label={`Share ${hostel.name}`}
      onClick={(event) => {
        event.stopPropagation();
        onShare(hostel);
      }}
      className="flex flex-none items-center justify-center rounded-full transition-[opacity,transform,background-color] duration-200 ease-out hover:bg-white active:scale-90 lg:-translate-y-1 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100 lg:group-focus-within:translate-y-0 lg:group-focus-within:opacity-100"
      style={{
        width: 34,
        height: 34,
        background: 'rgba(255,255,255,.92)',
        boxShadow: '0 2px 6px rgba(0,0,0,.15)',
      }}
    >
      <Share2 className="h-4 w-4" strokeWidth={1.8} style={{ color: C.textMuted }} />
    </button>
  ) : null;

  if (compact) {
    return (
      <article
        onClick={open}
        className="flex cursor-pointer gap-3 rounded-[18px] border bg-white p-[11px] transition-shadow hover:shadow-md"
        style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04),0 6px 16px rgba(40,30,20,.05)' }}
      >
        <div
          className="h-24 w-24 flex-none rounded-[13px] bg-cover bg-center"
          style={facts.photo ? { backgroundImage: `url(${facts.photo})` } : PHOTO_FALLBACK}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-2">
            <h3
              className="min-w-0 flex-1 truncate text-[14px] font-bold tracking-[-0.01em]"
              style={{ fontFamily: FONT.display, color: C.text }}
            >
              {hostel.name}
            </h3>
            {saveButton}
          </div>
          <p className="mt-1 flex items-center gap-1.5 text-[11.5px]" style={{ color: C.textMuted }}>
            <MapPin className="h-3 w-3 flex-none" strokeWidth={1.8} style={{ color: C.textGhost }} />
            <span className="truncate">{facts.location}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {facts.sharing.map((label) => (
              <span
                key={label}
                className="rounded-[7px] px-2 py-1 text-[10.5px] font-semibold"
                style={{ background: C.chipBg, color: '#6E6459' }}
              >
                {label}
              </span>
            ))}
          </div>
          <div className="mt-auto pt-2">
            {facts.price ? (
              <span className="flex items-baseline gap-1">
                <span className="text-[10.5px]" style={{ color: C.textMuted }}>from</span>
                <span className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                  {facts.price}
                </span>
                <span className="text-[10.5px]" style={{ color: C.textMuted }}>/mo</span>
              </span>
            ) : (
              <span className="text-[11px] font-semibold" style={{ color: C.textMuted }}>Price on request</span>
            )}
          </div>
        </div>
      </article>
    );
  }

  return (
    <article className="group relative flex aspect-square flex-col overflow-hidden rounded-[20px] border border-[#EFE6DA] bg-white shadow-[0_1px_2px_rgba(40,30,20,.04),0_8px_20px_rgba(40,30,20,.06)] transition-[transform,box-shadow,border-color] duration-300 ease-out hover:-translate-y-1 hover:border-[#E6D5C7] hover:shadow-[0_4px_10px_rgba(40,30,20,.05),0_22px_44px_rgba(40,30,20,.13)] focus-within:ring-2 focus-within:ring-[#D9906F] motion-reduce:transition-none motion-reduce:hover:translate-y-0">
      {/*
        No aspect ratio of its own any more: the card is the square, and the
        photo takes every pixel the text block does not. That is what keeps the
        footprint exactly 1:1 at any column width instead of only at the one
        width the ratios happened to agree on.
      */}
      <div className="relative min-h-0 flex-1 overflow-hidden">
        {/*
          The photo is its own layer so it can drift on hover without dragging
          the chips and the pucks with it.
        */}
        <div
          className="absolute inset-0 bg-cover bg-center transition-transform duration-[600ms] ease-out group-hover:scale-[1.05] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          style={facts.photo ? { backgroundImage: `url(${facts.photo})` } : PHOTO_FALLBACK}
        />
        {/* Keeps the audience chip legible over a bright photo, and deepens on
            hover so the whole tile reads as lit. */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-24 opacity-60 transition-opacity duration-300 group-hover:opacity-100"
          style={{ background: 'linear-gradient(to top,rgba(34,30,26,.34),rgba(34,30,26,0))' }}
        />

        <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
          {shareButton}
          {saveButton}
        </div>

        {facts.audience && (
          <span
            className="absolute bottom-3 left-3 rounded-full px-2.5 py-1 text-[11px] font-bold"
            style={{ background: 'rgba(255,255,255,.94)', color: C.textBody }}
          >
            {facts.audience}
          </span>
        )}
      </div>

      {/*
        `flex-none`, and deliberately shorter than the rectangular card's block:
        every row here is a row the photo does not get. The chip line is gone —
        its two facts moved into the meta line as text — which buys the photo
        back about 40px on a 290px card.
      */}
      <div className="flex flex-none flex-col px-4 pb-4 pt-3.5">
        <h3
          className="truncate text-[15.5px] font-bold leading-[1.3] tracking-[-0.01em] text-[#221E1A] transition-colors duration-200 group-hover:text-[#A45D44]"
          style={{ fontFamily: FONT.display }}
        >
          {/*
            The title is the card's real control: a button gives keyboard and
            screen-reader users the same target the mouse gets, and its
            stretched ::after is what makes the whole card clickable without
            nesting the save and share buttons inside another button.
          */}
          <button
            type="button"
            onClick={open}
            className="block w-full cursor-pointer truncate text-left after:absolute after:inset-0 after:content-[''] focus:outline-none"
          >
            {hostel.name}
          </button>
        </h3>

        {/*
          One meta line carrying what used to be a location line plus a chip
          row. The location truncates and the two facts after it never do — a
          long address must not be what pushes "Meals" off the card, because
          the address is the part you can already read off the photo.
        */}
        <p className="mt-1 flex min-w-0 items-center gap-1.5 text-[12px]" style={{ color: C.textMuted }}>
          <MapPin className="h-3 w-3 flex-none" strokeWidth={1.8} style={{ color: C.textGhost }} />
          <span className="truncate">{facts.location}</span>
          {facts.sharingSummary && (
            <>
              <span className="flex-none" style={{ color: C.textGhost }}>·</span>
              <span className="flex-none font-medium">{facts.sharingSummary}</span>
            </>
          )}
          {facts.meals && (
            <>
              <span className="flex-none" style={{ color: C.textGhost }}>·</span>
              <span className="flex flex-none items-center gap-1 font-semibold" style={{ color: C.green }}>
                <UtensilsCrossed className="h-3 w-3 flex-none" strokeWidth={2} />
                Meals
              </span>
            </>
          )}
        </p>

        {/* Price and availability are the two facts a person compares across
            cards, so they sit on one baseline at the same height on every
            card, under a hairline that ends the block instead of trailing off
            into white space. */}
        <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-[#F4EEE7] pt-3">
          {facts.price ? (
            <span className="flex items-baseline gap-1">
              <span className="text-[11.5px]" style={{ color: C.textMuted }}>from</span>
              <span className="text-[19px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                {facts.price}
              </span>
              <span className="text-[11.5px]" style={{ color: C.textMuted }}>/mo</span>
            </span>
          ) : (
            <span className="text-[12.5px] font-semibold" style={{ color: C.textMuted }}>Price on request</span>
          )}
          <span
            className="flex flex-none items-center gap-1.5 text-[11.5px] font-semibold"
            style={{ color: AVAILABILITY_COLOR[facts.availability.tone] }}
          >
            <span
              className="h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: AVAILABILITY_COLOR[facts.availability.tone] }}
            />
            {facts.availability.label}
          </span>
        </div>
      </div>
    </article>
  );
}
