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
  /** The pin, when an admin has entered one. Absent on most hostels. */
  lat?: number | null;
  lng?: number | null;
  /** A Google "Share → Embed a map" URL, which renders the place card. */
  embedUrl?: string | null;
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

/**
 * Whether there is a pin worth drawing a map around.
 *
 * `0, 0` is rejected deliberately: it is a real coordinate in the Gulf of Guinea
 * and the single most common value an empty numeric field produces, so treating
 * it as "no pin" costs nothing and prevents a listing confidently placing a
 * Hyderabad hostel in the Atlantic.
 */
export function hasCoordinates(navigation: HostelNavigation | null | undefined): boolean {
  const { lat, lng } = navigation ?? {};
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

/**
 * Whether a stored URL may be put inside an iframe.
 *
 * This is the one piece of navigation that is a **URL an admin pasted**, and it
 * goes straight into `iframe src` — so it is attacker-controllable input in the
 * most literal sense. An unvalidated value here embeds an arbitrary page inside
 * a Stayo listing, which is a phishing surface, not a map.
 *
 * So it is an allowlist, not a blocklist: exact host, exact path prefix, https
 * only. Anything else is refused and the listing falls back to the coordinate
 * map, which is derived and therefore cannot be spoofed.
 */
export function isGoogleMapsEmbedUrl(value: unknown): boolean {
  const raw = String(value ?? '').trim();
  if (!raw) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  if (url.protocol !== 'https:') return false;
  // Exact hosts. A `endsWith('google.com')` check would accept
  // `google.com.evil.tld`, which is the whole trick.
  if (url.hostname !== 'www.google.com' && url.hostname !== 'maps.google.com') return false;
  return url.pathname === '/maps/embed' || url.pathname.startsWith('/maps/embed/');
}

/**
 * Zoom that shows the road, the junction and the campus gate — the things
 * someone recognises — without zooming so far out that the pin means a suburb.
 */
const MAP_ZOOM = 16;

/**
 * A map of the hostel, embedded without an API key.
 *
 * Google's `maps?q=…&output=embed` endpoint returns a full Google map in an
 * iframe with **no key, no billing and no SDK**. It is what `sriadithyahostels.in`
 * already uses, and what loads `init_embed.js` / `map.js` / `places_impl.js` in
 * the network tab.
 *
 * ## Why this and not OpenStreetMap
 *
 * OSM is documented and equally keyless, but its embed paints an attribution bar
 * across the bottom of the frame — "© OpenStreetMap contributors · Make a
 * Donation" — which reads as someone else's watermark on a hostel's listing.
 * Google's embed carries only its own small logo, which is what people expect a
 * map to look like.
 *
 * ## The honest caveat
 *
 * `output=embed` is **undocumented**. Google has served it for well over a
 * decade and an enormous number of sites depend on it, but it carries no
 * compatibility promise the way the keyed Embed API does. The failure mode is
 * contained: the iframe stops rendering, the landmark, distance and Get
 * Directions button below it are untouched, and nothing else on the listing
 * depends on this URL.
 */
export function mapEmbedUrl(navigation: HostelNavigation | null | undefined): string | null {
  // A pasted "Share → Embed a map" URL wins, because it resolves the *place* and
  // so renders Google's card — name, address, rating — which coordinates alone
  // cannot produce. Only ever used after passing isGoogleMapsEmbedUrl.
  const pasted = navigation?.embedUrl;
  if (isGoogleMapsEmbedUrl(pasted)) return String(pasted).trim();

  if (!hasCoordinates(navigation)) return null;
  const lat = (navigation!.lat as number).toFixed(7);
  const lng = (navigation!.lng as number).toFixed(7);
  return `https://maps.google.com/maps?q=${lat},${lng}&z=${MAP_ZOOM}&output=embed`;
}

/**
 * "Baga, Goa, India" — the human answer to "where will I be".
 *
 * Area first, because that is what someone is actually deciding between. The
 * full street address is deliberately not used here: it is long, often
 * unreliable in a hostel cluster, and the block below it already carries the
 * landmark that finds the door.
 */
export function whereYoullBe(parts: {
  area?: string | null;
  city?: string | null;
  state?: string | null;
}): string {
  return [parts.area, parts.city, parts.state]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
    .filter((part, index, all) => all.indexOf(part) === index)
    .join(', ');
}
