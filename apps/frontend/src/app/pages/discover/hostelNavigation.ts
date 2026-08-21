/**
 * The Google Maps link, built from a Place ID at render time.
 *
 * Phase 1 uses **no Google Maps API** — no key, no billing, no quota. The
 * `/maps/dir/?api=1` endpoint is a plain URL contract Google documents for
 * exactly this: hand it a Place ID and it opens the Maps app (or the web app)
 * already navigating to that pin.
 *
 * The URL is deliberately **not stored**. It is derived here every time, from the
 * one field that is stored, so there is a single source of truth — a saved URL
 * and a saved Place ID that disagree is a bug nobody notices until a student is
 * standing on the wrong street.
 */

export interface HostelNavigation {
  placeId: string;
  landmark: string | null;
  entrancePhoto: string | null;
  distanceFromReference: string | null;
  referenceName: string;
}

const MAPS_DIR = 'https://www.google.com/maps/dir/?api=1';

/**
 * `destination` carries the hostel's name and `destination_place_id` carries the
 * pin. Both are required: Google uses the Place ID to resolve the location and
 * the name for what it *shows* the person, so omitting the name gives them a
 * screen of coordinates to confirm.
 *
 * `dir_action=navigate` starts turn-by-turn rather than opening a route preview,
 * which is the difference between one tap and three.
 */
export function directionsUrl(navigation: HostelNavigation | null | undefined, hostelName: string): string | null {
  const placeId = navigation?.placeId?.trim();
  if (!placeId) return null;

  const destination = hostelName.trim() || 'Hostel';
  return (
    `${MAPS_DIR}` +
    `&destination=${encodeURIComponent(destination)}` +
    `&destination_place_id=${encodeURIComponent(placeId)}` +
    `&dir_action=navigate`
  );
}

/**
 * "400m from SNIST", or null when the distance was never entered.
 *
 * Built here rather than in JSX so the sentence has one definition and the
 * reference campus stays a stored value — the first hostel Stayo lists near a
 * different college should not need a code change.
 */
export function distanceLine(navigation: HostelNavigation | null | undefined): string | null {
  const distance = navigation?.distanceFromReference?.trim();
  const reference = navigation?.referenceName?.trim();
  if (!distance || !reference) return null;
  return `${distance} from ${reference}`;
}

/**
 * Whether there is enough here to draw the block at all.
 *
 * A Place ID alone is enough — the button is the point, and the landmark and
 * photo are what make the last fifty metres easy. With no Place ID the section
 * renders nothing rather than a dead button.
 */
export function hasNavigation(navigation: HostelNavigation | null | undefined): boolean {
  return Boolean(navigation?.placeId?.trim());
}
