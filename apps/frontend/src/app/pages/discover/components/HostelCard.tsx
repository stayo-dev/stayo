import { Heart, MapPin, ShieldCheck } from 'lucide-react';

import type { DiscoverCard } from '@features/discover/api';
import { AUDIENCE_LABEL, C, FONT, PHOTO_FALLBACK, priceLabel, sharingLabels } from '../discoverTheme';

interface HostelCardProps {
  hostel: DiscoverCard;
  saved: boolean;
  onOpen: (slug: string) => void;
  onToggleSave: (hostel: DiscoverCard) => void;
  /** `compact` is the horizontal row used on Saved; default is the full card. */
  variant?: 'full' | 'compact';
}

/**
 * The one hostel card. Deliberately a single component with a `variant` rather
 * than two near-identical ones — the prototype drew three shapes of card and
 * they had already drifted apart in spacing and price formatting.
 *
 * Everything it renders comes from a real column. There is no rating and no
 * amenity row because that data does not exist yet (phases C/D); the layout
 * leaves room for them instead of filling the gap with a plausible number.
 */
export function HostelCard({ hostel, saved, onOpen, onToggleSave, variant = 'full' }: HostelCardProps) {
  const price = priceLabel(hostel.starting_price);
  const audience = hostel.hostel_type ? AUDIENCE_LABEL[hostel.hostel_type] : null;
  const photo = hostel.photos[0];
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
      className="flex flex-none items-center justify-center rounded-full transition-transform active:scale-90"
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

  if (compact) {
    return (
      <article
        onClick={open}
        className="flex cursor-pointer gap-3 rounded-[18px] border bg-white p-[11px] transition-shadow hover:shadow-md"
        style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04),0 6px 16px rgba(40,30,20,.05)' }}
      >
        <div
          className="h-24 w-24 flex-none rounded-[13px] bg-cover bg-center"
          style={photo ? { backgroundImage: `url(${photo})` } : PHOTO_FALLBACK}
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
            <span className="truncate">{hostel.city ?? hostel.address}</span>
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sharingLabels(hostel.sharing).slice(0, 3).map((label) => (
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
            {price ? (
              <span className="flex items-baseline gap-1">
                <span className="text-[10.5px]" style={{ color: C.textMuted }}>from</span>
                <span className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                  {price}
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
    <article
      onClick={open}
      className="cursor-pointer overflow-hidden rounded-[20px] border bg-white transition-shadow hover:shadow-lg"
      style={{ borderColor: C.line, boxShadow: '0 1px 2px rgba(40,30,20,.04),0 8px 20px rgba(40,30,20,.06)' }}
    >
      <div
        className="relative h-[186px] bg-cover bg-center"
        style={photo ? { backgroundImage: `url(${photo})` } : PHOTO_FALLBACK}
      >
        {hostel.verified && (
          <span
            className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full px-2.5 py-1.5"
            style={{ background: 'rgba(34,30,26,.82)' }}
          >
            <ShieldCheck className="h-[11px] w-[11px]" strokeWidth={2} style={{ color: C.clayLight }} />
            <span className="text-[9.5px] font-bold tracking-[0.03em] text-white">Verified</span>
          </span>
        )}
        <div className="absolute right-3 top-3">{saveButton}</div>
        {audience && (
          <span
            className="absolute bottom-3 left-3 rounded-full px-2.5 py-1.5 text-[11px] font-bold"
            style={{ background: 'rgba(255,255,255,.94)', color: C.textBody }}
          >
            {audience}
          </span>
        )}
        {hostel.vacant_beds > 0 && (
          <span
            className="absolute bottom-3 right-3 rounded-full px-2.5 py-1.5 text-[10.5px] font-bold"
            style={{ background: C.greenPale, color: C.green }}
          >
            {hostel.vacant_beds} {hostel.vacant_beds === 1 ? 'bed' : 'beds'} free
          </span>
        )}
      </div>

      <div className="px-4 pb-4 pt-3.5">
        <h3 className="text-[16px] font-bold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
          {hostel.name}
        </h3>
        <p className="mt-1.5 flex items-center gap-1.5 text-[12px]" style={{ color: C.textMuted }}>
          <MapPin className="h-3 w-3 flex-none" strokeWidth={1.8} style={{ color: C.textGhost }} />
          <span className="truncate">{[hostel.address, hostel.city].filter(Boolean).join(', ')}</span>
        </p>

        <div className="mt-2.5 flex flex-wrap gap-1.5">
          {sharingLabels(hostel.sharing).map((label) => (
            <span
              key={label}
              className="rounded-lg px-2.5 py-1.5 text-[11px] font-semibold"
              style={{ background: C.chipBg, color: '#6E6459' }}
            >
              {label}
            </span>
          ))}
        </div>

        <div className="mt-3 flex items-baseline justify-between">
          {price ? (
            <span className="flex items-baseline gap-1">
              <span className="text-[11.5px]" style={{ color: C.textMuted }}>from</span>
              <span className="text-[19px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                {price}
              </span>
              <span className="text-[11.5px]" style={{ color: C.textMuted }}>/mo</span>
            </span>
          ) : (
            <span className="text-[12.5px] font-semibold" style={{ color: C.textMuted }}>Price on request</span>
          )}
          {hostel.food_included && (
            <span className="text-[11px] font-medium" style={{ color: C.green }}>Meals included</span>
          )}
        </div>
      </div>
    </article>
  );
}
