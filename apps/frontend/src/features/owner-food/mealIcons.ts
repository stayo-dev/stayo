import { Sunrise, Soup, Coffee, UtensilsCrossed, type LucideIcon } from 'lucide-react';

/**
 * Meal-slot icons.
 *
 * Replaces the emoji (🍳 🍛 ☕ 🍽️) that shipped with the mockup, for the same
 * reasons as the expense categories: emoji render differently on every
 * platform, can't inherit colour or stroke weight, and sit on inconsistent
 * baselines, so a row of them never aligns.
 *
 * Each slot already carries a `color`/`tint` in `MEAL_CATEGORY_META`, so the
 * icon inherits that rather than introducing a second colour system.
 *
 * Used by both the owner app and the tenant portal — the same meal must look
 * the same on both sides.
 */
export const MEAL_ICONS: Record<string, LucideIcon> = {
  breakfast: Sunrise,
  lunch: Soup,
  snacks: Coffee,
  dinner: UtensilsCrossed,
};

export function mealIcon(slot: string): LucideIcon {
  return MEAL_ICONS[slot] ?? UtensilsCrossed;
}
