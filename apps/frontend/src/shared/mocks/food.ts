/**
 * Meal-slot design tokens shared by the owner app and the tenant portal — the
 * same meal must look the same on both sides.
 *
 * This file is named `mocks/` for historical reasons; nothing in it is mock
 * data any more. The mock Food Polls surface that lived here was deleted, and
 * these constants should move to `shared/food/slots.ts` when something else
 * touches this directory.
 */

export type MealSlotKey = 'breakfast' | 'lunch' | 'snacks' | 'dinner';

export interface FoodSlotMeta {
  key: MealSlotKey;
  label: string;
  color: string;
  tint: string;
}

export const FOOD_SLOTS: FoodSlotMeta[] = [
  { key: 'breakfast', label: 'Breakfast', color: '#B46A55', tint: '#F6ECE6' },
  { key: 'lunch', label: 'Lunch', color: '#1F7A52', tint: '#E9F3EE' },
  { key: 'snacks', label: 'Snacks', color: '#B07E28', tint: '#F6EFE0' },
  { key: 'dinner', label: 'Dinner', color: '#5B6E8C', tint: '#EBEEF4' },
];

export const MEAL_CATEGORY_META: Record<MealSlotKey, { label: string }> = {
  breakfast: { label: 'Breakfast' },
  lunch: { label: 'Lunch' },
  snacks: { label: 'Snacks' },
  dinner: { label: 'Dinner' },
};
