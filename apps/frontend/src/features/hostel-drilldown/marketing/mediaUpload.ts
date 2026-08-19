import type { MarketingPhoto } from '@features/hostel-marketing/api';

/**
 * The decisions behind the listing's photo/video manager, kept out of the
 * component so they can be tested (this app's test suite is node-only — no
 * jsdom, no rendering).
 */

export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
/** `quicktime` is what an iPhone hands over from the camera roll. */
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
/** The content schema's own ceiling on a listing's gallery. */
export const MAX_MEDIA = 24;

/**
 * How wide an uploaded photo is allowed to be before the browser downscales
 * it. A phone camera writes 4000px/6MB files; a listing renders at most a
 * few hundred CSS pixels, and the difference is entirely upload time on a
 * mobile connection.
 */
const MAX_DIMENSION = 2400;
const JPEG_QUALITY = 0.82;

export function isVideoFile(type: string): boolean {
  return VIDEO_TYPES.includes(type);
}

export interface ClassifiedFiles {
  accepted: File[];
  /** Not an image or a video we accept. */
  wrongType: File[];
  /** Over the per-file ceiling **for its own kind** — never a combined total. */
  tooBig: File[];
  /** Dropped because the listing has no room left. */
  overflow: File[];
}

/**
 * Sorts a picked selection into what will upload and what will not, per file.
 *
 * The size rule is **per file, by kind**. The bug this replaces came from
 * sending a whole multi-select as one request: ten 4MB photos, each of them
 * legal, became a ~40MB body that was rejected before any per-file check ran,
 * and the owner was told they had exceeded a limit no single photo was near.
 * Files are uploaded one request each now (see `PhotosScreen`), so a
 * selection's total size means nothing.
 */
export function classifyFiles(picked: File[], remainingSlots: number): ClassifiedFiles {
  const wrongType: File[] = [];
  const tooBig: File[] = [];
  const sized: File[] = [];

  for (const file of picked) {
    const video = isVideoFile(file.type);
    if (!video && !IMAGE_TYPES.includes(file.type)) {
      wrongType.push(file);
      continue;
    }
    if (file.size > (video ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES)) {
      tooBig.push(file);
      continue;
    }
    sized.push(file);
  }

  return {
    accepted: sized.slice(0, Math.max(remainingSlots, 0)),
    wrongType,
    tooBig,
    overflow: sized.slice(Math.max(remainingSlots, 0)),
  };
}

/**
 * Moves one item of the gallery to a new position, renumbering `sort`.
 *
 * The gallery's order is the order a visitor swipes through, so an owner has
 * to be able to set it. `sort` is rewritten from the array index rather than
 * nudged, because the server sorts by that field and any gap or duplicate
 * would show up as an order the owner did not choose.
 */
export function reorderMedia(list: MarketingPhoto[], from: number, to: number): MarketingPhoto[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) {
    return list.map((item, index) => ({ ...item, sort: index }));
  }
  const next = [...list];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next.map((item, index) => ({ ...item, sort: index }));
}

/**
 * The gallery after a deletion, with the cover guaranteed to survive.
 *
 * A listing with no cover has no card image in search, and the cover must be a
 * still — so it falls to the first remaining **image**, not merely the first
 * remaining item, which could be a video.
 */
export function removeMedia(list: MarketingPhoto[], index: number): MarketingPhoto[] {
  const next = list.filter((_item, i) => i !== index).map((item, i) => ({ ...item, sort: i }));
  if (next.length === 0 || next.some((item) => item.is_cover)) return next;

  const firstImage = next.findIndex((item) => item.kind !== 'video');
  return next.map((item, i) => ({ ...item, is_cover: i === firstImage }));
}

/**
 * Whether an item can be the cover. Videos cannot: the cover becomes the
 * search card's thumbnail and a shared link's preview image, and neither
 * plays.
 */
export function canBeCover(item: Pick<MarketingPhoto, 'kind'>): boolean {
  return item.kind !== 'video';
}

export function setCover(list: MarketingPhoto[], index: number): MarketingPhoto[] {
  if (!canBeCover(list[index] ?? { kind: 'image' })) return list;
  return list.map((item, i) => ({ ...item, is_cover: i === index }));
}

/**
 * Shrinks a photo in the browser before it is uploaded.
 *
 * Not a size *check* — a re-encode. A 6MB phone photo becomes a few hundred
 * kilobytes at a resolution the listing can actually use, which is the
 * difference between an upload that completes on mobile data and one the owner
 * gives up on. Videos are passed through untouched: re-encoding video in a
 * browser tab is not something to do to someone's phone.
 *
 * Any failure returns the original file. A photo that uploads slowly is a
 * much better outcome than a photo that does not upload at all.
 */
export async function compressImage(file: File): Promise<File> {
  if (isVideoFile(file.type) || typeof document === 'undefined') return file;
  if (!IMAGE_TYPES.includes(file.type)) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    // Already small enough that re-encoding would only lose quality.
    if (scale === 1 && file.size <= 1_500_000) {
      bitmap.close?.();
      return file;
    }

    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext('2d');
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close?.();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY),
    );
    if (!blob || blob.size >= file.size) return file;

    const name = file.name.replace(/\.[^.]+$/, '') || 'photo';
    return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
  } catch {
    return file;
  }
}
