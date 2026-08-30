import { describe, it, expect } from "vitest";
import {
  buildMenuContent,
  monogramFor,
  monthLabelFor,
  formatClock,
  formatWindow,
  EMPTY_CELL,
  MENU_DAYS,
  type MenuContentInput,
} from "@/lib/pdf/menu-content";

const cell = (day: string, slot: string, ...names: string[]) => ({
  day,
  slot,
  items: names.map((name) => ({ name })),
});

const build = (over: Partial<MenuContentInput> = {}) =>
  buildMenuContent({
    hostelName: "Sunrise Residency",
    month: "2026-08",
    cells: [],
    ...over,
  });

/**
 * The printed weekly menu's content. Unlike the receipt, nobody holds this —
 * it is taped to a canteen wall and read across a room, so the failure modes
 * are about legibility and being wrong in public. See ADR-144.
 */
describe("buildMenuContent", () => {
  it("lays out all seven days in order, every time", () => {
    const content = build();
    expect(content.rows.map((r) => r.day)).toEqual([...MENU_DAYS]);
    expect(content.rows[0].label).toBe("Monday");
  });

  it("gives every row one cell per meal column", () => {
    for (const row of build().rows) expect(row.cells).toHaveLength(4);
  });

  it("prints a dash for an unplanned slot rather than leaving a blank box", () => {
    // A blank cell on a wall reads as a broken menu and someone asks the cook.
    const content = build({ cells: [cell("MONDAY", "breakfast", "Idly")] });
    expect(content.rows[0].cells[0]).toBe("Idly");
    expect(content.rows[0].cells[1]).toBe(EMPTY_CELL);
    expect(content.rows[1].cells.every((c) => c === EMPTY_CELL)).toBe(true);
  });

  it("lists several dishes in one cell, comma separated", () => {
    const content = build({ cells: [cell("MONDAY", "lunch", "Rice", "Dal", "Curry")] });
    expect(content.rows[0].cells[1]).toBe("Rice, Dal, Curry");
  });

  it("title-cases dish names typed before the app started doing it", () => {
    // Items created before ADR-142 are stored as typed. The stored value is
    // never rewritten; only this document's display is corrected.
    const content = build({ cells: [cell("MONDAY", "breakfast", "bonda", "idly")] });
    expect(content.rows[0].cells[0]).toBe("Bonda, Idly");
  });

  it("reads days and slots case-insensitively, as they arrive from the grid", () => {
    const content = build({ cells: [{ day: "monday", slot: "DINNER", items: [{ name: "Rice" }] }] });
    expect(content.rows[0].cells[3]).toBe("Rice");
  });

  it("accepts the schedule row's own `item_name` as well as `name`", () => {
    const content = build({
      cells: [{ day: "MONDAY", slot: "breakfast", items: [{ item_name: "Poori" }] }],
    });
    expect(content.rows[0].cells[0]).toBe("Poori");
  });

  it("drops an item with no usable name instead of printing an empty entry", () => {
    const content = build({
      cells: [{ day: "MONDAY", slot: "breakfast", items: [{ name: "  " }, { name: "Dosa" }] }],
    });
    expect(content.rows[0].cells[0]).toBe("Dosa");
  });

  it("puts the serving window in the column header, which wall charts never carry", () => {
    const content = build({
      timings: { breakfast: { start: "07:00", end: "09:00" }, lunch: { start: "12:30", end: "14:00" } },
    });
    expect(content.columns[0].window).toBe("7:00 AM – 9:00 AM");
    expect(content.columns[1].window).toBe("12:30 PM – 2:00 PM");
    expect(content.columns[2].window).toBeNull();
  });

  it("marks a schedule that has not been published", () => {
    // Taping an unfinished menu to a wall is the obvious way this goes wrong.
    expect(build({ status: "DRAFT" }).draftNotice).toContain("Draft");
    expect(build({ status: "PUBLISHED" }).draftNotice).toBeNull();
    expect(build().draftNotice).toBeNull();
  });

  it("only offers a QR when there is a live listing to point at", () => {
    expect(build().qrUrl).toBeNull();
    expect(build({ publicSlug: "sunrise" }).qrUrl).toBeNull();
    expect(build({ publicBaseUrl: "https://yourstayo.com" }).qrUrl).toBeNull();

    const withBoth = build({ publicSlug: "sunrise", publicBaseUrl: "https://yourstayo.com" });
    expect(withBoth.qrUrl).toBe("https://yourstayo.com/discover/h/sunrise");
    expect(withBoth.qrCaption).toContain("Stayo");
  });

  it("does not double the slash when the base URL carries one", () => {
    const content = build({ publicSlug: "sunrise", publicBaseUrl: "https://yourstayo.com/" });
    expect(content.qrUrl).toBe("https://yourstayo.com/discover/h/sunrise");
  });

  it("builds an address from whatever parts exist, without stray commas", () => {
    expect(build({ address: "12 MG Road", city: "Hyderabad" }).addressLine).toBe("12 MG Road, Hyderabad");
    expect(build({ city: "Hyderabad" }).addressLine).toBe("Hyderabad");
    expect(build().addressLine).toBeNull();
  });

  it("never renders a nameless hostel", () => {
    // The name falls back first, so the monogram is derived from "Hostel"
    // rather than from nothing — the badge reads HO, not a bare H.
    expect(build({ hostelName: "   " }).hostelName).toBe("Hostel");
    expect(build({ hostelName: null }).monogram).toBe("HO");
  });
});

describe("monogramFor", () => {
  it("takes one letter per word, up to two", () => {
    expect(monogramFor("Sunrise Residency")).toBe("SR");
    expect(monogramFor("Sunrise Residency For Men")).toBe("SR");
  });

  it("falls back to two letters of a single-word name", () => {
    expect(monogramFor("Sunrise")).toBe("SU");
  });

  it("survives empty input", () => {
    expect(monogramFor("")).toBe("H");
    expect(monogramFor(undefined)).toBe("H");
  });
});

describe("monthLabelFor", () => {
  it("names the month for a human", () => {
    expect(monthLabelFor("2026-08")).toBe("August 2026");
    expect(monthLabelFor("2026-01")).toBe("January 2026");
  });

  it("returns empty rather than a wrong month for bad input", () => {
    expect(monthLabelFor("2026-13")).toBe("");
    expect(monthLabelFor("nonsense")).toBe("");
  });
});

describe("formatClock / formatWindow", () => {
  it("reads 24-hour times the way residents do", () => {
    expect(formatClock("07:00")).toBe("7:00 AM");
    expect(formatClock("12:30")).toBe("12:30 PM");
    expect(formatClock("00:15")).toBe("12:15 AM");
    expect(formatClock("19:45")).toBe("7:45 PM");
  });

  it("refuses a time it cannot read", () => {
    expect(formatClock("25:00")).toBeNull();
    expect(formatClock("7")).toBeNull();
    expect(formatClock(null)).toBeNull();
  });

  it("prints a window only when both ends are known", () => {
    expect(formatWindow({ start: "07:00", end: "09:00" })).toBe("7:00 AM – 9:00 AM");
    expect(formatWindow({ start: "07:00", end: null })).toBeNull();
    expect(formatWindow(null)).toBeNull();
  });
});
