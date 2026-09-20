/**
 * The "Choose your bed" options on a listing, and the one honest vacancy count.
 *
 * Pure so the rules are tested rather than remembered: a listing may advertise
 * several tiers of the SAME sharing size (say a 4-bed at ₹8,200 and another at
 * ₹8,500), and every one of them draws from one pool of real rooms. Reading
 * that pool once per tier showed "104 beds left" twice and "208 beds available"
 * in the header for a hostel with about 127 beds in it.
 */

/** One selectable option per room size, aggregated from the real room rows. */
export interface BedOption {
  capacity: number;
  label: string;
  price: number | null;
  /** `null` = open, but no live count to quote (owner-asserted, no real rooms). */
  availableBeds: number | null;
  roomType: string | null;
}

export function toBedOptions(rooms: any[]): BedOption[] {
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

export interface BedTier {
  name?: string | null;
  sharing: number;
  price: number;
  inclusions?: string | null;
  availability?: string | null;
  space?: unknown;
}

const isFull = (tier: BedTier) => tier.availability === 'FULL';

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
export function buildBedOptions(rooms: any[], tiers: BedTier[]): BedOption[] {
  const fromRooms = toBedOptions(rooms);
  if (tiers.length === 0) return fromRooms;

  return tiers.map((tier) => {
    const realTier = fromRooms.find((option) => option.capacity === tier.sharing);
    // Two tiers of one size share one pool, so the pool's size is not any one
    // tier's count. Say "open" without a number rather than repeat the pool.
    const sharesPool = tiers.filter((other) => other.sharing === tier.sharing).length > 1;

    let availableBeds: number | null;
    if (isFull(tier)) {
      // A tier the owner marked FULL is full regardless of what rooms say.
      availableBeds = 0;
    } else if (realTier) {
      // Otherwise the live count wins over any claim.
      availableBeds = sharesPool ? (realTier.availableBeds > 0 ? null : 0) : realTier.availableBeds;
    } else {
      // Only where no real room of this size exists at all (a platform-listed
      // hostel) does an owner's AVAILABLE stand in — with no count, rather
      // than a made-up one.
      availableBeds = tier.availability === 'AVAILABLE' ? null : 0;
    }

    return {
      capacity: tier.sharing,
      label: tier.name || (tier.sharing === 1 ? 'Single room' : `${tier.sharing}-bed sharing`),
      price: tier.price > 0 ? tier.price : (realTier?.price ?? null),
      availableBeds,
      roomType: tier.inclusions ?? realTier?.roomType ?? null,
      // What the real rooms of this size are like to live in — measured by
      // the owner, summarised by the server (`room-space.ts`).
      space: (tier.space as any) ?? null,
    } as BedOption;
  });
}

/**
 * Free beds across what is on offer, each pool of rooms counted once.
 * Summing per tier double-counts whenever two tiers share a sharing size.
 */
export function countVacantBeds(rooms: any[], tiers: BedTier[]): number {
  const fromRooms = toBedOptions(rooms);
  if (tiers.length === 0) return fromRooms.reduce((sum, option) => sum + (option.availableBeds ?? 0), 0);

  const offered = new Set(tiers.filter((tier) => !isFull(tier)).map((tier) => tier.sharing));
  return fromRooms
    .filter((option) => offered.has(option.capacity))
    .reduce((sum, option) => sum + (option.availableBeds ?? 0), 0);
}
