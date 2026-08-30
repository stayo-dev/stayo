import { MEAL_CATEGORY_META } from '@shared/mocks/food';
import { titleCaseText } from '@shared/lib/textFormat';
import { formatTimeRange, type MealTimings } from '@features/food/mealTimings';
import { cellAt, dayKeyFor, DAY_ORDER, formatCellItems, isFilled, slotsInUse, SLOT_ORDER, type DayKey, type WeekGrid } from './weekGrid';

export interface KitchenSheetInput {
  grid: WeekGrid;
  now: Date;
  hostelName: string;
  /** Serving windows, when the hostel has them. Omitted leaves times off. */
  timings?: MealTimings | null;
}

function nextDay(day: DayKey): DayKey {
  return DAY_ORDER[(DAY_ORDER.indexOf(day) + 1) % DAY_ORDER.length];
}

/**
 * Dish names as they should read, not as they were typed. Items created before
 * ADR-142 are stored exactly as entered ("bonda", "idly"), and this message is
 * pasted into a kitchen group where it is the hostel's own writing. Display
 * only — the stored value is never rewritten.
 */
/** A gap in a meal the hostel does serve. See `slotsInUse` and ADR-147. */
const GAP = '—';

function nameFor(grid: WeekGrid, day: DayKey, slot: (typeof SLOT_ORDER)[number]): string {
  const cell = cellAt(grid, day, slot);
  // Only dish names are tidied. `formatCellItems` returns product copy for an
  // empty slot, and title-casing that turned it into "Not Set" — caught by
  // this module's existing tests. An unplanned meal reads as a dash here
  // rather than as a sentence: this message goes to a cook, not a settings
  // screen, and "Not set" describes the app rather than the kitchen.
  return isFilled(cell) ? titleCaseText(formatCellItems(cell)) || GAP : GAP;
}

/** "Breakfast (7:00 AM – 9:00 AM)", or just the label when no window is set. */
function slotHeading(slot: (typeof SLOT_ORDER)[number], timings?: MealTimings | null): string {
  const label = MEAL_CATEGORY_META[slot].label;
  const entry = timings?.[slot];
  if (!entry || !entry.enabled) return label;
  return `${label} (${formatTimeRange(entry)})`;
}

/**
 * The message the owner sends to the kitchen group.
 *
 * Tomorrow is on it deliberately — prep starts the night before, which is the
 * entire reason a kitchen sheet exists rather than a today screen.
 *
 * WhatsApp-flavoured markdown (*bold*) because that is where this goes.
 */
export function buildKitchenMessage({ grid, now, hostelName, timings }: KitchenSheetInput): string {
  const today = dayKeyFor(now);
  const tomorrow = nextDay(today);
  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  // A meal the kitchen never runs is left off entirely rather than sent as a
  // dash every day; a meal it does run but has not planned today still shows
  // one, because there the absence is real information.
  const served = slotsInUse(grid);

  /**
   * Tomorrow gets one labelled line per meal, like today.
   *
   * It used to be all four joined by "·" into a single run — "Bonda • Dosa •
   * Puri · Rice • Dal • Curry · Chai · Rice • Sambar" — with nothing marking
   * where breakfast ended and lunch began, on the one line whose whole purpose
   * is telling a cook what to prepare tonight. Four short lines cost four
   * newlines in a WhatsApp message and are actually readable.
   */
  const lines = [
    `*${dateLabel} — ${hostelName}*`,
    '',
    ...served.map((slot) => `*${slotHeading(slot, timings)}*\n${nameFor(grid, today, slot)}`),
    '',
    '_Tomorrow — prep tonight_',
    ...served.map((slot) => `${MEAL_CATEGORY_META[slot].label}: ${nameFor(grid, tomorrow, slot)}`),
  ];

  return lines.join('\n');
}

/**
 * A share link, not an API call. The owner sends from their own WhatsApp, so
 * this needs no Meta template approval and no backend — the same pattern the
 * tenant quick-actions already use.
 *
 * `encodeURIComponent` leaves `*` unescaped (it's in its "unreserved" set),
 * but WhatsApp-flavoured bold markdown depends on literal asterisks — encode
 * them explicitly so the message still round-trips through a URL bar/clipboard
 * without the `*bold*` markers getting mangled.
 */
export function whatsappShareUrl(message: string): string {
  const encoded = encodeURIComponent(message).replace(/\*/g, '%2A');
  return `https://wa.me/?text=${encoded}`;
}
