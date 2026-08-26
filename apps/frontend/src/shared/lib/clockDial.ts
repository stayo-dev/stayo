/**
 * The geometry behind a circular time picker — the alarm-clock dial.
 *
 * A typed time field asks someone to know a format. A dial asks them to point
 * at a clock, which is the object they already have in their head. It is also
 * the only picker that works the same on every phone, unlike `<input
 * type="time">`, whose UI is the browser's and differs on each.
 *
 * PURE — no DOM, no React. The component is a renderer over this, which is what
 * lets the angle maths be tested at all.
 */

/** Twelve o'clock is up, and the hand sweeps clockwise. */
const TOP_OFFSET_DEG = -90;

export type DialMode = 'hour' | 'minute';

/** Where a hand pointing at `value` sits, as degrees clockwise from 3 o'clock. */
export function angleForValue(value: number, mode: DialMode): number {
  const steps = mode === 'hour' ? 12 : 60;
  return (value % steps) * (360 / steps) + TOP_OFFSET_DEG;
}

/** The point on a circle of `radius` at `angleDeg`, centred on (`cx`,`cy`). */
export function pointOnDial(angleDeg: number, radius: number, cx: number, cy: number) {
  const radians = (angleDeg * Math.PI) / 180;
  return { x: cx + radius * Math.cos(radians), y: cy + radius * Math.sin(radians) };
}

/**
 * Which number a tap at (`x`,`y`) is pointing at.
 *
 * Distance from the centre is deliberately ignored: someone dragging near the
 * rim and someone dragging near the middle both mean the same o'clock, and
 * demanding they stay on a thin ring makes the dial feel broken.
 *
 * Minutes snap to five, because nobody sets a mess to open at 7:23 and a dial
 * fine enough to express it is a dial too fiddly to use. A minute already set
 * to something else is preserved by the caller, not clobbered here.
 */
export function valueFromPoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  mode: DialMode,
): number {
  const degrees = (Math.atan2(y - cy, x - cx) * 180) / Math.PI - TOP_OFFSET_DEG;
  const normalised = ((degrees % 360) + 360) % 360;

  if (mode === 'hour') {
    const hour = Math.round(normalised / 30) % 12;
    return hour;
  }
  return (Math.round(normalised / 30) * 5) % 60;
}

/** `{ h: 19, m: 30 }` → `"19:30"`, the storage format. */
export function toClockValue(hour24: number, minute: number): string {
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export interface DialTime {
  /** 12-hour face position, 0–11 — 0 renders as 12. */
  hour: number;
  minute: number;
  meridiem: 'AM' | 'PM';
}

/** `"19:30"` → what the dial should show. Falls back to 9:00 AM. */
export function parseClockValue(value: string | null | undefined): DialTime {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ''));
  if (!match) return { hour: 9, minute: 0, meridiem: 'AM' };
  const h24 = Math.min(23, Number(match[1]));
  const minute = Math.min(59, Number(match[2]));
  return { hour: h24 % 12, minute, meridiem: h24 < 12 ? 'AM' : 'PM' };
}

/** Dial position back to the 24-hour value that gets stored. */
export function toStoredValue(time: DialTime): string {
  const base = time.hour % 12;
  const hour24 = time.meridiem === 'PM' ? base + 12 : base;
  return toClockValue(hour24, time.minute);
}

/** `12`, `1`, … `11` — the numeral under the hand. */
export function faceLabel(hour: number): number {
  return hour === 0 ? 12 : hour;
}

/** `9:05`, never `9:5`. */
export function readout(time: DialTime): string {
  return `${faceLabel(time.hour)}:${String(time.minute).padStart(2, '0')}`;
}

/**
 * One time on its own — `7 AM`, `8:30 PM` — for the buttons that open the dial.
 *
 * Separate from `formatSlot`, which formats a *range* and drops the meridiem
 * from the start when both ends share it. Reusing that here produced "7" with
 * no AM, which is exactly the ambiguity a clock is meant to remove.
 */
export function formatTime(value: string | null | undefined): string {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ''));
  if (!match) return '';
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return '';
  const twelve = h % 12 === 0 ? 12 : h % 12;
  const minutes = m === 0 ? '' : `:${String(m).padStart(2, '0')}`;
  return `${twelve}${minutes} ${h < 12 ? 'AM' : 'PM'}`;
}
