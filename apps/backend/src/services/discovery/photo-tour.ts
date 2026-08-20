import { PHOTO_CATEGORIES, type PhotoCategoryKey } from "@/src/services/marketing/marketing-content";

/**
 * A hostel's photos grouped into a tour — Airbnb's "Photo tour", in Stayo's
 * vocabulary of rooms, mess and common areas.
 *
 * The grouping lives here rather than in the component because it has rules
 * worth pinning: empty sections never appear, the order is the order someone
 * decides in (where you sleep, then where you wash, then where you eat), and
 * videos travel with the photos of the same place rather than into a section
 * of their own.
 *
 * PURE MODULE — no I/O, runs under vitest.pure.config.ts.
 */

export interface TourItem {
  url: string;
  kind: "image" | "video";
  thumbnail_url: string | null;
  label: string | null;
  category: PhotoCategoryKey;
}

export interface TourSection {
  key: PhotoCategoryKey;
  label: string;
  items: TourItem[];
}

export function groupPhotoTour(items: TourItem[]): TourSection[] {
  return PHOTO_CATEGORIES.map((category) => ({
    key: category.key,
    label: category.label,
    items: items.filter((item) => (item.category ?? "other") === category.key),
  })).filter((section) => section.items.length > 0);
}

/**
 * The one photo that represents a section in the tour's thumbnail strip: the
 * first, which is the owner's own ordering.
 */
export function sectionCover(section: TourSection): TourItem | null {
  return section.items.find((item) => item.kind === "image") ?? section.items[0] ?? null;
}

/**
 * The tour flattened back into one list, in section order.
 *
 * The full-screen viewer steps through *this*, so "next" from the last room
 * photo lands on the first bathroom photo instead of jumping somewhere the
 * grid never showed.
 */
export function flattenTour(sections: TourSection[]): TourItem[] {
  return sections.flatMap((section) => section.items);
}
