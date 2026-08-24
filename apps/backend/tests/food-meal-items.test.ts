import { describe, expect, it } from "vitest";
import { validateMenuItemIds, deriveLegacyFields } from "@/lib/services/food/meal-items";

const allowed = [
  { id: "rice", name: "Rice" },
  { id: "dal", name: "Dal" },
  { id: "curry", name: "Curry" },
  { id: "chutney", name: "Chutney" },
];

describe("validateMenuItemIds", () => {
  it("accepts a single item", () => {
    const result = validateMenuItemIds(["rice"], allowed);
    expect(result).toEqual({ ok: true, items: [{ menu_item_id: "rice", item_name: "Rice" }] });
  });

  it("accepts multiple items, preserving the given order", () => {
    const result = validateMenuItemIds(["chutney", "rice", "dal"], allowed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.map((i) => i.item_name)).toEqual(["Chutney", "Rice", "Dal"]);
    }
  });

  it("accepts an empty array — a meal can hold zero items", () => {
    expect(validateMenuItemIds([], allowed)).toEqual({ ok: true, items: [] });
  });

  it("dedupes a repeated id, keeping only its first position", () => {
    const result = validateMenuItemIds(["rice", "dal", "rice"], allowed);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.items.map((i) => i.menu_item_id)).toEqual(["rice", "dal"]);
    }
  });

  it("rejects an id that isn't in the allowed set — e.g. from another hostel or meal type", () => {
    const result = validateMenuItemIds(["rice", "not-in-library"], allowed);
    expect(result).toEqual({ ok: false, reason: "That item isn't available for this meal type" });
  });

  it("rejects a non-array body", () => {
    expect(validateMenuItemIds("rice", allowed)).toEqual({ ok: false, reason: "menuItemIds must be an array" });
    expect(validateMenuItemIds(undefined, allowed)).toEqual({ ok: false, reason: "menuItemIds must be an array" });
  });

  it("rejects an array containing a non-string entry", () => {
    const result = validateMenuItemIds(["rice", 123], allowed);
    expect(result).toEqual({ ok: false, reason: "menuItemIds must be an array of item ids" });
  });
});

describe("deriveLegacyFields", () => {
  it("uses the first item's id and its name alone for a single-item meal", () => {
    expect(deriveLegacyFields([{ menu_item_id: "rice", item_name: "Rice" }])).toEqual({
      menu_item_id: "rice",
      item_name: "Rice",
    });
  });

  it("joins multiple items' names in display order, keyed on the first item's id", () => {
    const items = [
      { menu_item_id: "rice", item_name: "Rice" },
      { menu_item_id: "dal", item_name: "Dal" },
      { menu_item_id: "curry", item_name: "Curry" },
      { menu_item_id: "chutney", item_name: "Chutney" },
    ];
    expect(deriveLegacyFields(items)).toEqual({
      menu_item_id: "rice",
      item_name: "Rice, Dal, Curry, Chutney",
    });
  });

  it("returns a null id and empty name for an empty meal", () => {
    expect(deriveLegacyFields([])).toEqual({ menu_item_id: null, item_name: "" });
  });
});
