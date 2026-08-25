/**
 * Turns what an admin actually pastes into a pin.
 *
 * They will not type two numbers into two boxes. They will search the hostel,
 * copy `17.4542678, 78.6628497` out of the result or out of Google Maps, and
 * paste the whole thing — so that is the input this accepts.
 *
 * Kept as **text in the form** and parsed only on save, because a numeric input
 * coerces a half-typed value: someone mid-way through `17.` has a field
 * containing `17`, and an autosave would pin the hostel a hundred kilometres
 * away without anyone touching anything.
 */

export type ParsedCoordinates = { lat: number | null; lng: number | null };

const EMPTY: ParsedCoordinates = { lat: null, lng: null };

/**
 * Returns nulls for anything not clearly a coordinate pair, rather than
 * guessing. A wrong pin is worse than no pin: no pin shows the landmark block
 * and the person asks; a wrong pin sends them confidently to the wrong street.
 */
export function parseCoordinates(input: string): ParsedCoordinates {
  const raw = String(input ?? '').trim();
  if (!raw) return EMPTY;

  // Tolerate the decorations a copy-paste picks up — degree signs, parentheses,
  // stray whitespace — without trying to interpret N/S/E/W, which would mean
  // guessing at sign conventions nobody typed.
  const cleaned = raw.replace(/[()°\s]/g, '');
  if (/[NSEW]/i.test(cleaned)) return EMPTY;

  const parts = cleaned.split(',');
  if (parts.length !== 2) return EMPTY;

  const lat = Number(parts[0]);
  const lng = Number(parts[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return EMPTY;
  if (lat < -90 || lat > 90) return EMPTY;
  if (lng < -180 || lng > 180) return EMPTY;

  // Real coordinate, in the Gulf of Guinea, and the value an empty pair of
  // fields produces. Treat it as "not entered".
  if (lat === 0 && lng === 0) return EMPTY;

  return { lat, lng };
}

/** What to tell the admin, or null when there is nothing to say. */
export function coordinatesHint(input: string): string | null {
  const raw = String(input ?? '').trim();
  if (!raw) return null;
  const parsed = parseCoordinates(raw);
  if (parsed.lat === null) return 'That does not look like "latitude, longitude" — paste both numbers, comma separated.';
  return `Pin set to ${parsed.lat}, ${parsed.lng}`;
}

/**
 * What to tell the admin about a pasted embed URL.
 *
 * Mirrors the allowlist the listing and the server both enforce, so a URL that
 * would be silently ignored is called out here instead — the failure mode
 * otherwise is a saved value that simply never appears, with nothing to explain
 * why.
 */
export function embedUrlHint(input: string): string | null {
  const raw = extractEmbedSrc(input);
  if (!raw) return null;
  try {
    const url = new URL(raw);
    const hostOk = url.hostname === 'www.google.com' || url.hostname === 'maps.google.com';
    const pathOk = url.pathname === '/maps/embed' || url.pathname.startsWith('/maps/embed/');
    if (url.protocol === 'https:' && hostOk && pathOk) return 'Looks good — this will show the place card.';
  } catch {
    /* falls through to the message below */
  }
  return 'That is not a Google “Embed a map” URL. Use Maps → Share → Embed a map and copy the src.';
}

/**
 * Pull the map URL out of whatever Google put on the clipboard.
 *
 * Google Maps' "Embed a map" dialog has one button, and it copies the **entire
 * `<iframe …>` tag** — not the URL. So "paste the embed URL" is an instruction
 * nobody can follow without hand-editing HTML, and the honest fix is to accept
 * the tag.
 *
 * Returns the `src` when given an iframe, the input unchanged when given a bare
 * URL, so both work. Validation still happens afterwards on the extracted value
 * — this only decides *what* to validate, never whether it is safe.
 */
export function extractEmbedSrc(input: string): string {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  if (!/<iframe/i.test(raw)) return raw;

  // Accept either quote style; Google uses double, hand-edits often use single.
  const match = /\bsrc\s*=\s*("([^"]*)"|'([^']*)')/i.exec(raw);
  const src = match?.[2] ?? match?.[3];
  return src ? src.trim() : raw;
}
