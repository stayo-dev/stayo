export interface AllowedMealItem {
  id: string;
  name: string;
}

export interface OrderedMealItem {
  menu_item_id: string;
  item_name: string;
}

export type ValidateMenuItemIdsResult =
  | { ok: true; items: OrderedMealItem[] }
  | { ok: false; reason: string };

/**
 * Turns the raw `menuItemIds` a PATCH body sends into an ordered, deduped
 * list of real library items, or a rejection reason.
 *
 * Dedup is first-occurrence-wins so a client that double-taps a checkbox
 * can't silently double up a dish. Every id must appear in `allowed` —
 * `allowed` is the caller's hostel+meal-type-scoped `food_menu_items` query,
 * so an id from another hostel (or the wrong meal type, or a deactivated
 * item) is rejected here rather than silently applied or silently dropped.
 */
export function validateMenuItemIds(menuItemIds: unknown, allowed: AllowedMealItem[]): ValidateMenuItemIdsResult {
  if (!Array.isArray(menuItemIds)) {
    return { ok: false, reason: "menuItemIds must be an array" };
  }
  if (!menuItemIds.every((id) => typeof id === "string" && id.length > 0)) {
    return { ok: false, reason: "menuItemIds must be an array of item ids" };
  }

  const allowedById = new Map(allowed.map((item) => [item.id, item.name]));

  const seen = new Set<string>();
  const items: OrderedMealItem[] = [];
  for (const id of menuItemIds as string[]) {
    if (seen.has(id)) continue;
    seen.add(id);
    const name = allowedById.get(id);
    if (name === undefined) {
      return { ok: false, reason: "That item isn't available for this meal type" };
    }
    items.push({ menu_item_id: id, item_name: name });
  }

  return { ok: true, items };
}

/**
 * The legacy single-item snapshot `food_schedule_meals.menu_item_id`/
 * `.item_name` derived from the real, ordered item list — kept live so
 * `src/services/marketing/mess-import.ts` (a direct, out-of-scope reader of
 * `item_name`) keeps working with zero changes. First item wins the FK slot;
 * names join in display order, empty string when the meal has no items.
 */
export function deriveLegacyFields(items: OrderedMealItem[]): { menu_item_id: string | null; item_name: string } {
  return {
    menu_item_id: items[0]?.menu_item_id ?? null,
    item_name: items.map((i) => i.item_name).join(", "),
  };
}
