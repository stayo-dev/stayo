import { MEAL_CATEGORY_META } from '@shared/mocks/food';
import { cellAt, dayKeyFor, DAY_ORDER, EMPTY_CELL_LABEL, isFilled, SLOT_ORDER, type DayKey, type WeekGrid } from './weekGrid';

export interface KitchenSheetInput {
  grid: WeekGrid;
  now: Date;
  hostelName: string;
}

function nextDay(day: DayKey): DayKey {
  return DAY_ORDER[(DAY_ORDER.indexOf(day) + 1) % DAY_ORDER.length];
}

function nameFor(grid: WeekGrid, day: DayKey, slot: (typeof SLOT_ORDER)[number]): string {
  const cell = cellAt(grid, day, slot);
  return isFilled(cell) ? cell!.item_name : EMPTY_CELL_LABEL;
}

/**
 * The message the owner sends to the kitchen group.
 *
 * Tomorrow is on it deliberately — prep starts the night before, which is the
 * entire reason a kitchen sheet exists rather than a today screen.
 *
 * WhatsApp-flavoured markdown (*bold*) because that is where this goes.
 */
export function buildKitchenMessage({ grid, now, hostelName }: KitchenSheetInput): string {
  const today = dayKeyFor(now);
  const tomorrow = nextDay(today);
  const dateLabel = now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

  const lines = [
    `*${dateLabel} — ${hostelName}*`,
    '',
    ...SLOT_ORDER.map((slot) => `${MEAL_CATEGORY_META[slot].label.padEnd(10)} ${nameFor(grid, today, slot)}`),
    '',
    `_Tomorrow_: ${SLOT_ORDER.map((slot) => nameFor(grid, tomorrow, slot)).join(' · ')}`,
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
