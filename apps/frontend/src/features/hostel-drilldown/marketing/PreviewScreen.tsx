import { createPortal } from 'react-dom';
import { ChevronLeft, MapPin, ShieldCheck, Star } from 'lucide-react';

import type { MarketingContent } from '@features/hostel-marketing/api';

import { MEAL_ICON } from './MessMenuSheet';
import { placeIcon } from './PlaceSheet';
import { amenityIcon } from './amenityIcons';
import { M, MESS_DAY_LABELS, SOFT_SHADOW } from './marketingTheme';

function formatRupees(value: number) {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

/**
 * `MODAL: MARKETING PREVIEW` of `Stayo App.dc.html` — the listing as a tenant
 * will see it, rendered from the draft in the editor rather than from what is
 * published, so an owner can check a change before sending it for review.
 *
 * The design fills its review block with "★ 4.8 · 126 resident reviews". Stayo
 * collects no reviews yet, so the block keeps its exact place and shape and
 * says so — an owner previewing their own listing must not be shown a rating
 * they have not earned.
 */
export function PreviewScreen({
  open,
  content,
  hostelName,
  location,
  onClose,
}: {
  open: boolean;
  content: MarketingContent;
  hostelName: string;
  location: string | null;
  onClose: () => void;
}) {
  if (!open) return null;

  const cover = content.photos.find((photo) => photo.is_cover) ?? content.photos[0] ?? null;
  const amenities = content.amenities.filter((amenity) => amenity.enabled);
  const prices = content.beds.map((bed) => bed.price).filter((price) => price > 0);
  const startingPrice = prices.length > 0 ? Math.min(...prices) : null;
  const messMeals = content.mess.provided ? content.mess.meals.filter((meal) => meal.enabled) : [];

  return createPortal(
    <div className="fixed inset-0 z-[60] flex flex-col bg-background">
      <header
        className="flex flex-none items-center justify-between px-4 pb-3.5 pt-[max(0.875rem,env(safe-area-inset-top))]"
        style={{ background: M.ink }}
      >
        <button type="button" onClick={onClose} className="flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] items-center justify-center rounded-full bg-white/[0.12] text-white">
            <ChevronLeft className="h-4 w-4" strokeWidth={2} />
          </span>
          <span className="font-display text-[13px] font-bold text-white">Back to editor</span>
        </button>
        <span className="flex items-center gap-[7px] rounded-full bg-white/[0.12] px-[11px] py-[5px]">
          <span className="h-1.5 w-1.5 rounded-full" style={{ background: '#7FCBA1' }} />
          <span className="text-[10.5px] font-semibold tracking-[0.04em]" style={{ color: '#EDE7E0' }}>
            Tenant preview
          </span>
        </span>
      </header>

      <div className="flex-1 overflow-auto">
        <div className="relative h-[220px] bg-muted">
          {cover ? (
            <img src={cover.url} alt="" className="h-full w-full object-cover" />
          ) : (
            <div
              className="flex h-full w-full items-center justify-center text-[12px]"
              style={{ background: '#E7D9CC', color: M.lockedText }}
            >
              No photos added yet
            </div>
          )}
          {content.photos.length > 0 && (
            <span className="absolute bottom-3 right-3.5 rounded-lg bg-[rgba(20,16,12,.55)] px-[9px] py-[3px] text-[10.5px] font-semibold text-white">
              {content.photos.length} photo{content.photos.length === 1 ? '' : 's'}
            </span>
          )}
        </div>

        <div className="relative -mt-[22px] rounded-t-[24px] bg-background px-5 pb-8 pt-5">
          <div className="mb-2.5 flex items-center gap-[7px]">
            <span
              className="flex items-center gap-[5px] rounded-full px-2.5 py-1 font-display text-[10.5px] font-bold text-white"
              style={{ background: '#221E1A' }}
            >
              <ShieldCheck className="h-3 w-3" strokeWidth={2.2} /> Verified hostel
            </span>
          </div>

          <h1 className="font-display text-[23px] font-extrabold leading-[1.2] tracking-[-0.02em] text-foreground">
            {hostelName}
          </h1>

          {content.basics.tagline && (
            <p className="mt-1.5 text-[12.5px] text-muted-foreground">{content.basics.tagline}</p>
          )}

          {location && (
            <div className="mt-1.5 flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.8} />
              <span className="text-[12.5px] text-muted-foreground">{location}</span>
            </div>
          )}

          {content.basics.about && (
            <p className="mt-4 text-[13px] leading-[1.6]" style={{ color: M.outlineText }}>
              {content.basics.about}
            </p>
          )}

          {content.places.length > 0 && (
            <section className="mt-[22px]">
              <h2 className="font-display text-[16px] font-extrabold tracking-[-0.01em] text-foreground">
                Getting around
              </h2>
              <div
                className="mt-[11px] flex flex-col overflow-hidden rounded-2xl bg-card"
                style={{ border: '1px solid var(--border)', boxShadow: SOFT_SHADOW }}
              >
                {content.places.map((place, index) => {
                  const Icon = placeIcon(place.category);
                  return (
                    <div
                      key={`${place.name}-${index}`}
                      className="flex items-center gap-3 px-[15px] py-[13px]"
                      style={{ borderTop: index === 0 ? 'none' : `1px solid ${M.rowLine}` }}
                    >
                      <span
                        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px]"
                        style={{ background: M.iconTile, color: 'var(--primary)' }}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                      <span className="flex-1 text-[13px] font-medium text-foreground">{place.name}</span>
                      <span className="font-display text-[12.5px] font-bold tabular-nums" style={{ color: M.chipText }}>
                        {place.distance}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {content.beds.length > 0 && (
            <section className="mt-[26px]">
              <h2 className="font-display text-[16px] font-extrabold tracking-[-0.01em] text-foreground">
                Choose your bed
              </h2>
              <p className="mt-[3px] text-[12px] text-muted-foreground">
                All beds monthly · deposit is one month's rent
              </p>
              <div className="mt-3 flex flex-col gap-2.5">
                {content.beds.map((bed, index) => (
                  <div
                    key={`${bed.name}-${index}`}
                    className="flex items-center gap-3 rounded-[15px] bg-card px-[15px] py-[13px]"
                    style={{ border: '1px solid var(--border)', boxShadow: SOFT_SHADOW }}
                  >
                    <span
                      className="h-5 w-5 flex-none rounded-full"
                      style={{ border: '1.5px solid #D8CCBE' }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-[7px]">
                        <span className="font-display text-[13.5px] font-bold text-foreground">
                          {bed.name || `${bed.sharing}-bed sharing`}
                        </span>
                        <BedTag availability={bed.availability} />
                      </div>
                      {bed.inclusions && (
                        <p className="mt-[3px] text-[11px] text-muted-foreground">{bed.inclusions}</p>
                      )}
                    </div>
                    <div className="flex-none text-right">
                      <p className="font-display text-[15px] font-extrabold tabular-nums text-foreground">
                        ₹{formatRupees(bed.price)}
                      </p>
                      <p className="text-[10px]" style={{ color: M.faint }}>
                        /month
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {amenities.length > 0 && (
            <section className="mt-[26px]">
              <h2 className="font-display text-[16px] font-extrabold tracking-[-0.01em] text-foreground">
                What this hostel offers
              </h2>
              <div className="mt-3.5 grid grid-cols-2 gap-x-3 gap-y-[13px]">
                {amenities.map((amenity, index) => {
                  const Icon = amenityIcon(amenity.label);
                  return (
                    <div key={`${amenity.label}-${index}`} className="flex items-center gap-2.5">
                      <span
                        className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px]"
                        style={{ background: M.iconTile, color: 'var(--primary)' }}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.8} />
                      </span>
                      <span className="text-[13px] font-medium" style={{ color: M.outlineText }}>
                        {amenity.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {messMeals.length > 0 && (
            <section className="mt-[26px]">
              <h2 className="font-display text-[16px] font-extrabold tracking-[-0.01em] text-foreground">
                Food &amp; mess
              </h2>
              <p className="mt-[3px] text-[12px] text-muted-foreground">
                {MESS_DAY_LABELS[0]}'s menu · tenants can browse the whole week
              </p>
              <div
                className="mt-3 overflow-hidden rounded-2xl bg-card"
                style={{ border: '1px solid var(--border)', boxShadow: SOFT_SHADOW }}
              >
                {messMeals.map((meal, index) => {
                  const Icon = MEAL_ICON[meal.key];
                  const dishes = content.mess.week[0]?.[meal.key]?.trim();
                  return (
                    <div
                      key={meal.key}
                      className="flex gap-3 px-[15px] py-3.5"
                      style={{ borderTop: index === 0 ? 'none' : `1px solid ${M.rowLine}` }}
                    >
                      <span
                        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[10px]"
                        style={{ background: M.iconTile, color: 'var(--primary)' }}
                      >
                        <Icon className="h-[17px] w-[17px]" strokeWidth={1.7} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-baseline gap-2">
                          <span className="font-display text-[13px] font-bold text-foreground">{meal.label}</span>
                          <span className="text-[11px]" style={{ color: M.ghost }}>
                            {meal.time}
                          </span>
                        </div>
                        <p
                          className="mt-[3px] text-[12.5px] font-medium leading-[1.5]"
                          style={{ color: dishes ? '#5A5147' : M.ghost }}
                        >
                          {dishes || 'Not written yet'}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <section className="mt-[26px]">
            <h2 className="font-display text-[16px] font-extrabold tracking-[-0.01em] text-foreground">
              Resident reviews
            </h2>
            <div
              className="mt-3 flex items-center gap-2.5 rounded-[15px] bg-card px-[15px] py-3.5"
              style={{ border: '1px solid var(--border)', boxShadow: SOFT_SHADOW }}
            >
              <Star className="h-4 w-4 flex-none text-muted-foreground" strokeWidth={1.8} />
              <p className="text-[12.5px] leading-[1.5] text-muted-foreground">
                No reviews yet. Residents review your hostel through Stayo once they've moved in.
              </p>
            </div>
          </section>
        </div>
      </div>

      <div
        className="flex flex-none items-center justify-between px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3"
        style={{ background: '#FFFDFB', borderTop: '1px solid var(--border)' }}
      >
        <div>
          <p className="text-[10.5px] text-muted-foreground">Starting from</p>
          <p className="font-display text-[18px] font-extrabold tabular-nums text-foreground">
            {startingPrice == null ? (
              <span className="text-[14px] font-bold">Price on request</span>
            ) : (
              <>
                ₹{formatRupees(startingPrice)}{' '}
                <span className="text-[11px] font-normal" style={{ color: M.faint }}>
                  /mo
                </span>
              </>
            )}
          </p>
        </div>
        <span
          className="rounded-xl px-[22px] py-[13px] font-display text-[13.5px] font-bold text-white"
          style={{ background: '#221E1A' }}
        >
          Choose a bed
        </span>
      </div>
    </div>,
    document.body,
  );
}

function BedTag({ availability }: { availability: 'BEDS_LEFT' | 'AVAILABLE' | 'FULL' }) {
  const meta = {
    BEDS_LEFT: { label: 'Beds left', bg: M.greenBg, color: M.greenText },
    AVAILABLE: { label: 'Available', bg: M.greenBg, color: M.greenText },
    FULL: { label: 'Full', bg: '#F4EEE7', color: M.lockedText },
  }[availability];

  return (
    <span
      className="rounded-[5px] px-[7px] py-0.5 text-[9.5px] font-bold"
      style={{ background: meta.bg, color: meta.color }}
    >
      {meta.label}
    </span>
  );
}
