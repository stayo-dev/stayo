import {
  BookOpen, Car, Droplets, Dumbbell, ShieldCheck, Shirt, Snowflake, Sparkles, Tag, Utensils, Wifi, Zap,
} from 'lucide-react';

/**
 * The design's amenity chips each carry an icon. Rather than storing a glyph
 * per amenity, the label is matched to one — so a custom amenity an owner types
 * still gets a sensible mark instead of a blank space, and the mapping can grow
 * without a migration.
 *
 * Shared by the editor's chip row and the tenant preview so one amenity cannot
 * pick up two different glyphs on two screens.
 */
const AMENITY_ICONS: { match: RegExp; Icon: typeof Wifi }[] = [
  { match: /wi-?fi|internet/i, Icon: Wifi },
  { match: /meal|food|mess|dining/i, Icon: Utensils },
  { match: /laundry|washing/i, Icon: Shirt },
  { match: /power|backup|generator/i, Icon: Zap },
  { match: /study|desk|library/i, Icon: BookOpen },
  { match: /housekeep|clean/i, Icon: Sparkles },
  { match: /cctv|security|guard|safe/i, Icon: ShieldCheck },
  { match: /water|ro\b/i, Icon: Droplets },
  { match: /ac\b|air.?con|cooling/i, Icon: Snowflake },
  { match: /parking|bike|car/i, Icon: Car },
  { match: /gym|fitness/i, Icon: Dumbbell },
];

export function amenityIcon(label: string) {
  return AMENITY_ICONS.find((entry) => entry.match.test(label))?.Icon ?? Tag;
}
