/**
 * The parts of a hostel a photo can be of — the owner's side of the listing's
 * photo tour. Mirrors `PHOTO_CATEGORIES` in the backend's `marketing-content`,
 * which is the schema that validates them.
 *
 * Fixed rather than free text: four owners typing "Room", "rooms", "Bedroom"
 * and "4-sharing" would produce four sections of one photo each.
 */
export const PHOTO_CATEGORIES = [
  { key: 'rooms', label: 'Rooms' },
  { key: 'bathrooms', label: 'Bathrooms' },
  { key: 'mess', label: 'Mess & kitchen' },
  { key: 'common', label: 'Common areas' },
  { key: 'study', label: 'Study & work' },
  { key: 'outside', label: 'Building & outside' },
  { key: 'other', label: 'More photos' },
] as const;

export type PhotoCategoryKey = (typeof PHOTO_CATEGORIES)[number]['key'];

export function categoryLabel(key: string | undefined): string {
  return PHOTO_CATEGORIES.find((category) => category.key === key)?.label ?? 'More photos';
}

export const PHOTO_CATEGORY_KEYS: PhotoCategoryKey[] = PHOTO_CATEGORIES.map((category) => category.key);

/**
 * The order a listing's photo tour groups its sections in — the owner's own
 * arrangement, repaired into a complete one.
 *
 * Mirrors `orderPhotoSections` in the backend's `marketing-content`, which is
 * what actually validates and stores it. Complete rather than partial because
 * both the owner's strip and the public tour index this list: a key missing
 * from it would silently drop a whole section of photos off the listing. So an
 * unplaced section keeps its standard position at the end, an unknown key is
 * dropped, and a repeated one counts once.
 */
export function orderPhotoSections(order: readonly string[] | null | undefined): PhotoCategoryKey[] {
  const arranged: PhotoCategoryKey[] = [];
  for (const key of order ?? []) {
    const known = PHOTO_CATEGORY_KEYS.find((candidate) => candidate === key);
    if (known && !arranged.includes(known)) arranged.push(known);
  }
  for (const key of PHOTO_CATEGORY_KEYS) {
    if (!arranged.includes(key)) arranged.push(key);
  }
  return arranged;
}

export interface TourGrouped<T> {
  key: PhotoCategoryKey;
  label: string;
  items: T[];
}

/**
 * Photos grouped into the tour's sections, in the owner's order.
 *
 * The one grouping function for both ends: the public tour renders this, and
 * the owner's section-order strip is built from the same call, so what an
 * owner arranges is exactly what a tenant is shown. Mirrors `groupPhotoTour`
 * on the backend — an uncategorised photo lands in "More photos" and is never
 * dropped, and an empty section never appears.
 */
export function groupTourSections<T extends { category?: string | null }>(
  media: T[],
  order?: readonly string[] | null,
): TourGrouped<T>[] {
  return orderPhotoSections(order)
    .map((key) => ({
      key,
      label: categoryLabel(key),
      items: media.filter((item) => (item.category ?? 'other') === key),
    }))
    .filter((section) => section.items.length > 0);
}

/**
 * The order after the owner moves one section a step earlier or later.
 *
 * It steps over the sections that have no photos — those are hidden from the
 * strip, and a move that appeared to do nothing (because it swapped with an
 * invisible neighbour) is a broken button. Their stored slots are left where
 * they are, so a section keeps its place until it has photos again.
 */
export function moveSection(
  order: readonly string[] | null | undefined,
  key: string,
  direction: -1 | 1,
  visibleKeys: readonly string[],
): PhotoCategoryKey[] {
  const full = orderPhotoSections(order);
  const visible = full.filter((candidate) => visibleKeys.includes(candidate));
  const at = visible.indexOf(key as PhotoCategoryKey);
  const neighbour = visible[at + direction];
  if (at === -1 || neighbour === undefined) return full;

  const from = full.indexOf(key as PhotoCategoryKey);
  const to = full.indexOf(neighbour);
  const next = [...full];
  next[from] = neighbour;
  next[to] = key as PhotoCategoryKey;
  return next;
}
