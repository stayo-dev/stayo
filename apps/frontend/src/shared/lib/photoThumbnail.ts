/**
 * A small, face-centred version of a tenant photo.
 *
 * Photos are uploaded full-size to ImageKit, and the Rooms tab shows a whole
 * hostel of them at once — fifty full-size portraits to draw fifty 23px
 * squares is a lot of mobile data. ImageKit crops and resizes on the URL
 * (`fo-face` centres the crop on the face it finds), so the fix is a query
 * parameter. Twice the displayed size keeps it sharp on retina screens.
 *
 * Only ImageKit URLs are rewritten, and never one that already carries a
 * transform; anything else — another host, a data URL, junk — comes back as
 * it was, and `TenantAvatar` falls back to initials if it fails to load.
 */
export function photoThumbnail(url: string | null | undefined, px: number): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (!parsed.hostname.endsWith('imagekit.io')) return url;
  if (parsed.pathname.includes('/tr:') || parsed.searchParams.has('tr')) return url;
  const size = Math.round(px * 2);
  parsed.searchParams.set('tr', `w-${size},h-${size},fo-face`);
  return parsed.toString();
}
