import {
  ShoppingBasket,
  Users,
  Zap,
  Flame,
  Armchair,
  Droplet,
  Wrench,
  Wifi,
  Package,
  type LucideIcon,
} from 'lucide-react';

/**
 * Expense category icons.
 *
 * Replaces the emoji set that shipped with the mockup. Emoji render
 * differently on every platform (Apple, Google and Windows draw 🍚 and 🛠️
 * quite differently), can't inherit colour or stroke weight, and sit at
 * whatever baseline the system font decides — so a grid of them never lines
 * up and never looks deliberate.
 *
 * Line icons at one stroke weight, tinted by state rather than by category,
 * give the calm and consistent look the design language asks for. Colour is
 * carried by selection, not by nine competing hues.
 *
 * Keyed by category **id**, so the data in `shared/mocks/expenses.ts` stays
 * plain data with no React dependency, and `shared/` stays a leaf.
 */
export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  food: ShoppingBasket,
  staff: Users,
  electricity: Zap,
  gas: Flame,
  furniture: Armchair,
  water: Droplet,
  maintenance: Wrench,
  internet: Wifi,
  other: Package,
};

/** Falls back to the neutral icon rather than rendering nothing. */
export function categoryIcon(id: string): LucideIcon {
  return CATEGORY_ICONS[id] ?? Package;
}
