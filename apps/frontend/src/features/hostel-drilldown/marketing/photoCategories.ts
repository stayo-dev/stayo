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
