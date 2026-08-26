import { ShieldCheck, ShowerHead, Sparkles, UtensilsCrossed, Users, Wifi, Wrench } from 'lucide-react';

/**
 * A small icon per category — decoration, not information, so a missing key
 * just renders nothing. "Amenities" was dropped as a rating category; no
 * backend migration needed since `rating_amenities` just stops being
 * referenced, it isn't dropped from the table.
 */
export const CATEGORY_ICONS: Record<string, typeof Sparkles> = {
  cleanliness: Sparkles,
  maintenance: Wrench,
  food: UtensilsCrossed,
  room_comfort: ShowerHead,
  staff: Users,
  safety: ShieldCheck,
  wifi: Wifi,
};

/** Friendly tag for a highly-rated category — matches `deriveHighlights` on the backend. */
export const HIGHLIGHT_LABELS: Record<string, string> = {
  cleanliness: 'Clean Rooms',
  maintenance: 'Well Maintained',
  food: 'Good Food',
  room_comfort: 'Comfortable Rooms',
  staff: 'Helpful Staff',
  safety: 'Safe Environment',
  wifi: 'Good Wi-Fi',
};
