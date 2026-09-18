/**
 * A listing photograph at the width it will actually be drawn.
 *
 * Mirrors `@shared/lib/photoThumbnail`'s safety rules — only ImageKit URLs are
 * rewritten and never one that already carries a transform — but asks for a
 * width rather than a face-centred square: these are buildings and rooms, and
 * `fo-face` would crop them to whatever face ImageKit thinks it found.
 */
export function listingPhotoUrl(url: string | null | undefined, widthPx: number): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.hostname.endsWith('imagekit.io')) return url;
  if (parsed.pathname.includes('/tr:') || parsed.searchParams.has('tr')) return url;
  parsed.searchParams.set('tr', `w-${Math.round(widthPx * 2)},q-75,f-auto`);
  return parsed.toString();
}
