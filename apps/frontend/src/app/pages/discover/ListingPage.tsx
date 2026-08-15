import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronLeft, Heart, Info, MapPin, ShieldCheck, Utensils } from 'lucide-react';

import {
  useDiscoverListing,
  useIsSeeker,
  useSavedHostels,
  useToggleSaved,
} from '@features/discover/hooks/useDiscover';

import { useDiscoverAuth } from './DiscoverAuthContext';
import { DiscoverEmpty, PrimaryButton } from './components/DiscoverShell';
import { AUDIENCE_LABEL, C, FONT, PHOTO_FALLBACK, formatRupees } from './discoverTheme';

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

export function ListingPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const { isSeeker } = useIsSeeker();
  const { openSignIn } = useDiscoverAuth();

  const { data, isLoading, isError } = useDiscoverListing(slug);
  const { data: saved } = useSavedHostels();
  const toggleSaved = useToggleSaved();

  const [selected, setSelected] = useState<number | null>(null);
  const [photoIndex, setPhotoIndex] = useState(0);

  const hostel = data?.hostel;
  const amenities = data?.amenities ?? [];
  const places = data?.places ?? [];

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
      <div className="min-h-[100dvh]" style={{ background: C.paper }}>
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
      <div className="min-h-[100dvh] pt-24" style={{ background: C.paper }}>
        <DiscoverEmpty
          icon={Info}
          title="This hostel isn't listed"
          body="It may have been unlisted, or the link is out of date. Plenty of other verified hostels are ready."
          action={<PrimaryButton onClick={() => navigate('/discover')}>Browse hostels</PrimaryButton>}
        />
      </div>
    );
  }

  const photos: string[] = hostel.photos ?? [];
  const audience = hostel.hostel_type ? AUDIENCE_LABEL[hostel.hostel_type] : null;
  const selectedOption = bedOptions.find((option) => option.capacity === selected) ?? null;
  const displayPrice = selectedOption?.price ?? hostel.starting_price ?? null;

  const handleSave = () => {
    if (!isSeeker) {
      openSignIn({ onDone: () => toggleSaved.mutate({ hostelId: hostel.id, saved: false }) });
      return;
    }
    toggleSaved.mutate({ hostelId: hostel.id, saved: isSaved });
  };

  return (
    <div className="flex min-h-[100dvh] flex-col" style={{ background: C.paper }}>
      <div className="flex-1">
        {/* ── Gallery ──────────────────────────────────────────────────── */}
        <div
          className="relative h-[290px] bg-cover bg-center"
          style={photos[photoIndex] ? { backgroundImage: `url(${photos[photoIndex]})` } : PHOTO_FALLBACK}
        >
          <button
            type="button"
            aria-label="Back"
            onClick={() => navigate(-1)}
            className="absolute left-4 top-[max(3.25rem,env(safe-area-inset-top))] flex h-[38px] w-[38px] items-center justify-center rounded-full"
            style={{ background: 'rgba(255,255,255,.95)', boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}
          >
            <ChevronLeft className="h-5 w-5" style={{ color: '#3A342E' }} />
          </button>

          <button
            type="button"
            aria-label={isSaved ? 'Remove from saved' : 'Save this hostel'}
            aria-pressed={isSaved}
            onClick={handleSave}
            className="absolute right-4 top-[max(3.25rem,env(safe-area-inset-top))] flex h-[38px] w-[38px] items-center justify-center rounded-full"
            style={{ background: 'rgba(255,255,255,.95)', boxShadow: '0 2px 8px rgba(0,0,0,.15)' }}
          >
            <Heart
              className="h-[18px] w-[18px]"
              strokeWidth={1.8}
              style={{ color: isSaved ? C.clayLight : '#6E6459', fill: isSaved ? C.clayLight : 'transparent' }}
            />
          </button>

          {photos.length > 1 && (
            <>
              <span
                className="absolute bottom-4 right-4 rounded-full px-2.5 py-1 text-[11px] font-semibold text-white"
                style={{ background: 'rgba(34,30,26,.72)' }}
              >
                {photoIndex + 1} / {photos.length}
              </span>
              <div className="absolute bottom-4 left-4 flex gap-1.5">
                {photos.map((photo, index) => (
                  <button
                    key={photo}
                    type="button"
                    aria-label={`Photo ${index + 1}`}
                    onClick={() => setPhotoIndex(index)}
                    className="h-[3px] rounded-sm transition-all"
                    style={{
                      width: index === photoIndex ? 20 : 6,
                      background: index === photoIndex ? '#fff' : 'rgba(255,255,255,.5)',
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </div>

        {/* ── Body ─────────────────────────────────────────────────────── */}
        <div className="relative -mt-6 rounded-t-[24px] px-5 pb-8 pt-5" style={{ background: C.paper }}>
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

          <h1
            className="mt-2.5 text-[23px] font-extrabold leading-[1.2] tracking-[-0.02em]"
            style={{ fontFamily: FONT.display, color: C.text }}
          >
            {hostel.name}
          </h1>

          <p className="mt-2 flex items-center gap-1.5 text-[12.5px]" style={{ color: C.textMuted }}>
            <MapPin className="h-3.5 w-3.5 flex-none" strokeWidth={1.7} style={{ color: C.textGhost }} />
            {[hostel.address, hostel.city, hostel.state].filter(Boolean).join(', ')}
          </p>

          {totalVacant > 0 && (
            <p className="mt-2 text-[12.5px] font-semibold" style={{ color: C.green }}>
              {totalVacant} {totalVacant === 1 ? 'bed' : 'beds'} available right now
            </p>
          )}

          {/* ── Beds ───────────────────────────────────────────────────── */}
          <section className="mt-7">
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
                {bedOptions.map((option) => {
                  const active = selected === option.capacity;
                  const soldOut = option.availableBeds === 0;
                  return (
                    <button
                      key={option.capacity}
                      type="button"
                      disabled={soldOut}
                      onClick={() => setSelected(option.capacity)}
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
            <section className="mt-7">
              <h2 className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                What this hostel offers
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {amenities.map((amenity) => (
                  <span
                    key={amenity.label}
                    className="rounded-[10px] px-3 py-2 text-[12.5px] font-semibold"
                    style={{ background: C.chipBg, color: '#6E6459' }}
                  >
                    {amenity.label}
                  </span>
                ))}
              </div>
            </section>
          )}

          {/* ── Getting around ───────────────────────────────────────── */}
          {places.length > 0 && (
            <section className="mt-7">
              <h2 className="text-[16px] font-extrabold tracking-[-0.01em]" style={{ fontFamily: FONT.display, color: C.text }}>
                Getting around
              </h2>
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
            </section>
          )}

          {/* Still honest about what genuinely isn't here — but only about the
              things that are actually missing for *this* hostel. */}
          <section
            className="mt-6 flex gap-3 rounded-2xl border p-4"
            style={{ background: '#F6F0E8', borderColor: '#EADFCF' }}
          >
            <Info className="h-4 w-4 flex-none" strokeWidth={2} style={{ color: C.clay }} />
            <p className="text-[11.5px] leading-[1.55]" style={{ color: '#5A5147' }}>
              {data?.marketing_published
                ? 'This listing was written by the owner and checked by Stayo. Live availability comes from their real rooms. Resident reviews are coming.'
                : 'Photos, room types and live availability come straight from the owner. Amenity lists and distances appear once this hostel publishes its listing.'}
            </p>
          </section>
        </div>
      </div>

      {/* ── Sticky enquire bar ───────────────────────────────────────────── */}
      <div
        className="sticky bottom-0 z-30 flex flex-none items-center gap-3.5 border-t px-4 pb-[max(1.75rem,env(safe-area-inset-bottom))] pt-3"
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
    </div>
  );
}
