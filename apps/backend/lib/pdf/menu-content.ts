/**
 * The weekly menu's content model — what the sheet says, decided separately
 * from how it is drawn.
 *
 * This document is unlike the receipt and the agreement in one way that shapes
 * every decision here: **nobody holds it.** It is taped to a canteen wall and
 * read from two metres away by residents deciding whether to eat in, and by a
 * cook at 6am. So the rules are:
 *
 * - A cell with nothing planned prints an em dash, never an empty box. A blank
 *   cell on a wall reads as "the menu is wrong", and someone will ask the cook.
 * - Serving windows are printed in the column headers. The real wall charts
 *   this replaces almost never carry them, and "what time is dinner" is the
 *   question residents ask most.
 * - A schedule still in `DRAFT` is marked as a draft on its face. Printing an
 *   unfinished menu and taping it up is the obvious way this feature goes
 *   wrong, and saying so costs one line.
 * - Dish names are title-cased for display. Items created before ADR-142 are
 *   stored exactly as typed ("bonda", "idly"), and this is the surface where
 *   that would look careless — the stored value is never rewritten.
 *
 * PURE MODULE — no pdf-lib, no I/O, no fonts. Tested directly. Same split as
 * `receipt-content.ts`, and for the same reason: every content defect below
 * became a unit test rather than something to notice on a printed sheet.
 *
 * See ADR-144.
 */

import { titleCaseText } from "../text-case";

export const MENU_DAYS = [
  "MONDAY",
  "TUESDAY",
  "WEDNESDAY",
  "THURSDAY",
  "FRIDAY",
  "SATURDAY",
  "SUNDAY",
] as const;
export type MenuDay = (typeof MENU_DAYS)[number];

export const MENU_SLOTS = ["breakfast", "lunch", "snacks", "dinner"] as const;
export type MenuSlot = (typeof MENU_SLOTS)[number];

/** Printed when a slot has nothing planned. Never an empty cell. */
export const EMPTY_CELL = "—";

const DAY_LABEL: Record<MenuDay, string> = {
  MONDAY: "Monday",
  TUESDAY: "Tuesday",
  WEDNESDAY: "Wednesday",
  THURSDAY: "Thursday",
  FRIDAY: "Friday",
  SATURDAY: "Saturday",
  SUNDAY: "Sunday",
};

const SLOT_LABEL: Record<MenuSlot, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  snacks: "Snacks",
  dinner: "Dinner",
};

export interface MenuColumn {
  slot: MenuSlot;
  label: string;
  /** "7:00 AM – 9:00 AM", or null when the hostel has not set a window. */
  window: string | null;
}

export interface MenuRow {
  day: MenuDay;
  label: string;
  /** One entry per column, in `MENU_SLOTS` order. Never empty strings. */
  cells: string[];
}

export interface MenuContent {
  hostelName: string;
  /** Two initials, for a hostel with no logo. */
  monogram: string;
  logoUrl: string | null;
  addressLine: string | null;
  contactLine: string | null;
  /** "August 2026". */
  monthLabel: string;
  title: string;
  columns: MenuColumn[];
  rows: MenuRow[];
  /** Present only for a schedule that has not been published. */
  draftNotice: string | null;
  /** Absent unless the hostel has a live public listing to point at. */
  qrUrl: string | null;
  qrCaption: string | null;
  footerNote: string;
}

export interface MenuCellInput {
  day: string;
  slot: string;
  items: Array<{ name?: string | null; item_name?: string | null }>;
}

export interface MenuContentInput {
  hostelName?: string | null;
  logoUrl?: string | null;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  /** `YYYY-MM`. */
  month: string;
  status?: string | null;
  cells: MenuCellInput[];
  /** Serving windows keyed by slot, each `{ start, end }` as "HH:MM". */
  timings?: Partial<Record<MenuSlot, { start?: string | null; end?: string | null } | null>> | null;
  /** The hostel's public listing slug, when it has a live one. */
  publicSlug?: string | null;
  /** Base URL for the QR target, no trailing slash. */
  publicBaseUrl?: string | null;
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function monthLabelFor(month: string): string {
  const match = /^(\d{4})-(\d{2})$/.exec(String(month ?? ""));
  if (!match) return "";
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) return "";
  return `${MONTH_NAMES[index]} ${match[1]}`;
}

/**
 * Up to two letters, one per word. Mirrors the initials badge the tenant
 * activation screen already shows for a hostel with no logo, so the same
 * hostel is not represented two different ways in two places.
 */
export function monogramFor(name: string | null | undefined): string {
  const words = String(name ?? "").trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "H";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** "07:00" → "7:00 AM". Returns null for anything it cannot read. */
export function formatClock(value: string | null | undefined): string | null {
  const match = /^(\d{1,2}):(\d{2})/.exec(String(value ?? "").trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2];
  if (hours < 0 || hours > 23 || Number(minutes) > 59) return null;
  const suffix = hours >= 12 ? "PM" : "AM";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes} ${suffix}`;
}

/** A serving window, or null when either end is missing — half a window is worse than none. */
export function formatWindow(
  timing: { start?: string | null; end?: string | null } | null | undefined,
): string | null {
  const start = formatClock(timing?.start);
  const end = formatClock(timing?.end);
  if (!start || !end) return null;
  return `${start} – ${end}`;
}

export function joinParts(parts: Array<string | null | undefined>, separator = ", "): string {
  return parts.map((p) => String(p ?? "").trim()).filter(Boolean).join(separator);
}

export function buildMenuContent(input: MenuContentInput): MenuContent {
  const hostelName = String(input.hostelName ?? "").trim() || "Hostel";

  // Index the cells once: `cells` arrives as a flat list and is read 28 times.
  const byKey = new Map<string, MenuCellInput>();
  for (const cell of input.cells ?? []) {
    byKey.set(`${String(cell.day).toUpperCase()}|${String(cell.slot).toLowerCase()}`, cell);
  }

  const rows: MenuRow[] = MENU_DAYS.map((day) => ({
    day,
    label: DAY_LABEL[day],
    cells: MENU_SLOTS.map((slot) => {
      const cell = byKey.get(`${day}|${slot}`);
      const names = (cell?.items ?? [])
        .map((item) => titleCaseText(String(item?.name ?? item?.item_name ?? "")))
        .filter(Boolean);
      return names.length > 0 ? names.join(", ") : EMPTY_CELL;
    }),
  }));

  const columns: MenuColumn[] = MENU_SLOTS.map((slot) => ({
    slot,
    label: SLOT_LABEL[slot],
    window: formatWindow(input.timings?.[slot]),
  }));

  const slug = String(input.publicSlug ?? "").trim();
  const base = String(input.publicBaseUrl ?? "").trim().replace(/\/+$/, "");
  // A QR that leads nowhere is worse than no QR — it sits on a wall for a year
  // being scanned by people who then think the hostel is broken.
  const qrUrl = slug && base ? `${base}/discover/h/${slug}` : null;

  const isDraft = String(input.status ?? "").toUpperCase() === "DRAFT";

  return {
    hostelName,
    monogram: monogramFor(hostelName),
    logoUrl: String(input.logoUrl ?? "").trim() || null,
    addressLine: joinParts([input.address, input.city]) || null,
    contactLine: String(input.phone ?? "").trim() || null,
    monthLabel: monthLabelFor(input.month),
    title: "Weekly Menu",
    columns,
    rows,
    draftNotice: isDraft ? "Draft — not published yet" : null,
    qrUrl,
    qrCaption: qrUrl ? "Scan to see this hostel on Stayo" : null,
    footerNote: "Menu managed on Stayo · yourstayo.com",
  };
}
