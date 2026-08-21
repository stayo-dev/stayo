import type { DiscoverCard } from '@features/discover/api';
import { AUDIENCE_LABEL, priceLabel, sharingLabels } from './discoverTheme';

/**
 * What a hostel card says, decided in one place.
 *
 * The card used to make these calls inline while rendering, and the result was
 * a text block whose height depended on the data: a hostel with one room type
 * drew one lonely chip and a hostel with five wrapped to a second row, so a
 * grid of cards was never the same shape twice. Deciding here — with a fixed
 * number of chips and a label that always exists — is what lets the card lay
 * out on a fixed rhythm and stay symmetric across a row.
 *
 * It is also the testable half. The component below it is a renderer.
 */

/** How many sharing chips fit on the card's single chip line at tile width. */
export const MAX_SHARING_CHIPS = 3;

/** Below this, the count itself is the message ("2 beds left"). */
export const SCARCITY_THRESHOLD = 5;

export type AvailabilityTone = 'open' | 'scarce' | 'full';

export interface AvailabilityFact {
  label: string;
  tone: AvailabilityTone;
}

export interface HostelCardFacts {
  /** "₹8,000", or null when no room has a rent set. */
  price: string | null;
  /** "Boys" / "Co-ed" — the hard filter, so it stays on the photo. */
  audience: string | null;
  /** At most `MAX_SHARING_CHIPS` labels, ascending. */
  sharing: string[];
  /**
   * The room types as one short phrase — "4-bed", or "2-bed +2".
   *
   * The square card has one meta line and no chip row, so the sharing options
   * have to survive as text. The smallest room leads because it is the one that
   * sets the advertised price; the count says there is more to see without
   * spending the width to list it.
   */
  sharingSummary: string | null;
  meals: boolean;
  availability: AvailabilityFact;
  photo: string | null;
  /** "Ameerpet, Hyderabad" — deduped, because address often repeats the city. */
  location: string;
}

/**
 * Vacancy as a person reads it.
 *
 * "157 beds free" is a number nobody acts on — past a handful of beds the only
 * question is whether there is room at all. Under that, the exact count is the
 * whole point, because it is the reason to enquire today.
 */
export function availabilityFact(vacantBeds: number): AvailabilityFact {
  const beds = Number.isFinite(vacantBeds) ? Math.max(0, Math.trunc(vacantBeds)) : 0;
  if (beds === 0) return { label: 'Fully booked', tone: 'full' };
  if (beds < SCARCITY_THRESHOLD) {
    return { label: `${beds} ${beds === 1 ? 'bed' : 'beds'} left`, tone: 'scarce' };
  }
  return { label: 'Beds available', tone: 'open' };
}

/**
 * "Hyderabad, Hyderabad" is what the old card drew whenever an owner typed the
 * city into the address line, which is most of them. One name, once.
 */
export function locationLabel(address: string | null, city: string | null): string {
  const parts = [address, city]
    .map((part) => (part ?? '').trim())
    .filter((part) => part.length > 0);
  const seen = new Set<string>();
  return parts
    .filter((part) => {
      const key = part.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(', ');
}

/** "4-bed" · "2-bed +2" · null when the hostel has no rooms priced yet. */
export function sharingSummary(labels: string[]): string | null {
  if (labels.length === 0) return null;
  if (labels.length === 1) return labels[0];
  return `${labels[0]} +${labels.length - 1}`;
}

export function hostelCardFacts(hostel: DiscoverCard): HostelCardFacts {
  const labels = sharingLabels(hostel.sharing ?? []);
  return {
    price: priceLabel(hostel.starting_price),
    audience: hostel.hostel_type ? AUDIENCE_LABEL[hostel.hostel_type] ?? null : null,
    sharing: labels.slice(0, MAX_SHARING_CHIPS),
    sharingSummary: sharingSummary(labels),
    meals: Boolean(hostel.food_included),
    availability: availabilityFact(hostel.vacant_beds),
    photo: hostel.photos?.[0] ?? null,
    location: locationLabel(hostel.address, hostel.city),
  };
}
