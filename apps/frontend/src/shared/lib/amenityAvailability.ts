/**
 * How an amenity is available — the one extra thing worth knowing about it.
 *
 * ## Why this replaced two free-text boxes
 *
 * The first attempt gave every amenity a "what it is" field and a "when" field.
 * Eight amenities meant sixteen identical empty inputs, and most of them had no
 * sensible answer: the chip already says "CCTV security", so a box asking what
 * it is has nothing to receive.
 *
 * The real observation is that amenities differ in *what kind* of answer they
 * need, and the owner is the only one who knows which:
 *
 * - **"3 meals / day"** needs **hours** — when the mess is actually open.
 * - **"Power backup"** needs a **note** — "runs whenever the power goes off"
 *   is not a time range and never will be.
 * - **"CCTV security"**, **"RO water"**, **"Parking"** need **nothing**, or at
 *   most "always".
 *
 * So the owner picks the kind, and only then types — and the common answer,
 * *nothing*, costs no typing at all.
 */

export type AmenityAvailabilityKind = 'ALWAYS' | 'HOURS' | 'NOTE';

/** One block of time, as 24-hour `HH:MM`. Picked from a clock, never typed. */
export interface TimeSlot {
  start: string;
  end: string;
}

export interface AmenityAvailability {
  /** null means the label already says everything. The default, and the most common. */
  availability?: AmenityAvailabilityKind | null;
  /** The note. `NOTE` only — hours live in `availabilitySlots`. */
  availabilityValue?: string | null;
  /**
   * The blocks a `HOURS` amenity runs in.
   *
   * Structured rather than a typed string, so the owner picks from a clock
   * instead of inventing a format, every hostel's timings render identically,
   * and the data can later answer "is the mess open right now?" — which a
   * string like "7–9 AM · 12–2 PM" never could.
   */
  availabilitySlots?: TimeSlot[] | null;
}

/** How many blocks a day. Three is meals; two is hot water; one is laundry. */
export const SLOT_COUNTS = [1, 2, 3, 4] as const;

/** `"07:00"` → `{ h: 7, m: 0 }`, or null for anything malformed. */
function parseTime(value: string | null | undefined): { h: number; m: number } | null {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

function meridiem(h: number): 'AM' | 'PM' {
  return h < 12 ? 'AM' : 'PM';
}

/** 13 → 1, 0 → 12. */
function hour12(h: number): number {
  const twelve = h % 12;
  return twelve === 0 ? 12 : twelve;
}

function clockText(t: { h: number; m: number }, withMeridiem: boolean): string {
  const minutes = t.m === 0 ? '' : `:${String(t.m).padStart(2, '0')}`;
  return `${hour12(t.h)}${minutes}${withMeridiem ? ` ${meridiem(t.h)}` : ''}`;
}

/**
 * `7–9 AM`, `11 AM–2 PM`, `8:30–10 PM`.
 *
 * The meridiem is written once when both ends share it, because "7 AM – 9 AM"
 * is how a form thinks and "7–9 AM" is how a person says it.
 */
export function formatSlot(slot: TimeSlot): string {
  const start = parseTime(slot?.start);
  const end = parseTime(slot?.end);
  if (!start || !end) return '';
  const sameHalf = meridiem(start.h) === meridiem(end.h);
  return `${clockText(start, !sameHalf)}–${clockText(end, true)}`;
}

/** `7–9 AM · 12–2 PM · 8–10 PM` — every hostel formatted the same way. */
export function formatSlots(slots: TimeSlot[] | null | undefined): string {
  return (slots ?? []).map(formatSlot).filter(Boolean).join(' · ');
}

/** Both ends set, and not the same instant. */
export function isCompleteSlot(slot: TimeSlot | null | undefined): boolean {
  const start = parseTime(slot?.start);
  const end = parseTime(slot?.end);
  if (!start || !end) return false;
  // A block that starts and ends at the same moment is a typo, not a schedule.
  // Ordering is otherwise left alone: 10 PM–1 AM is a real overnight block, and
  // refusing it would force the owner to lie about it.
  return !(start.h === end.h && start.m === end.m);
}

export const AVAILABILITY_OPTIONS: Array<{
  kind: AmenityAvailabilityKind | 'NONE';
  label: string;
  hint: string;
}> = [
  { kind: 'NONE', label: 'Nothing extra', hint: 'The name says it — most amenities need this' },
  { kind: 'ALWAYS', label: 'Always available', hint: 'Shows as 24×7' },
  { kind: 'HOURS', label: 'Specific timings', hint: 'Mess hours, hot water, laundry' },
  { kind: 'NOTE', label: 'A short note', hint: 'Power backup, anything that is not a clock' },
];

/** Placeholder for the one kind that still takes words. */
export function placeholderFor(kind: AmenityAvailabilityKind | null): string {
  if (kind === 'NOTE') return 'Runs whenever the power goes off';
  return '';
}

/** Whether this kind needs the owner to *type* anything. Hours are picked. */
export function needsValue(kind: AmenityAvailabilityKind | null | undefined): boolean {
  return kind === 'NOTE';
}

/** Whether this kind is set with the clock rather than the keyboard. */
export function needsSlots(kind: AmenityAvailabilityKind | null | undefined): boolean {
  return kind === 'HOURS';
}

/**
 * Normalise before saving.
 *
 * A kind that needs a value but has none is stored as **nothing**, not as an
 * empty pill. Someone who picked "Specific timings" and then thought better of
 * it should end up with a clean amenity, not one advertising blank hours.
 */
export function normaliseAvailability(input: AmenityAvailability): AmenityAvailability {
  const kind = input.availability ?? null;
  const empty = { availability: null, availabilityValue: null, availabilitySlots: null };
  if (!kind) return empty;

  if (kind === 'ALWAYS') return { availability: 'ALWAYS', availabilityValue: null, availabilitySlots: null };

  if (kind === 'HOURS') {
    // Half-filled blocks are dropped rather than saved: a tenant reading
    // "7–9 AM · –" learns less than one reading nothing.
    const slots = (input.availabilitySlots ?? []).filter(isCompleteSlot);
    if (slots.length === 0) return empty;
    return { availability: 'HOURS', availabilityValue: null, availabilitySlots: slots };
  }

  const value = String(input.availabilityValue ?? '').trim();
  if (!value) return empty;
  return { availability: 'NOTE', availabilityValue: value, availabilitySlots: null };
}

/**
 * How it renders, for the tenant Room tab and the Discovery listing alike.
 *
 * `pill` is the short badge beside the name; `line` is the sentence beneath it.
 * A time range belongs in a pill because it is scannable; "runs whenever the
 * power goes off" does not, because a pill that long stops being a pill.
 */
export function describeAvailability(input: AmenityAvailability): { pill: string | null; line: string | null } {
  const { availability, availabilityValue, availabilitySlots } = normaliseAvailability(input);
  if (availability === 'ALWAYS') return { pill: '24×7', line: null };
  if (availability === 'HOURS') return { pill: formatSlots(availabilitySlots) || null, line: null };
  if (availability === 'NOTE') return { pill: null, line: availabilityValue };
  return { pill: null, line: null };
}

/** The one-line summary on the owner's row — what is set, or an invitation. */
export function summariseAvailability(input: AmenityAvailability): { text: string; set: boolean } {
  const described = describeAvailability(input);
  const text = described.pill ?? described.line;
  return text ? { text, set: true } : { text: 'Add timings or a note', set: false };
}
