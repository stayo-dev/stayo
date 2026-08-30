/**
 * What the enquiry screen says it is about to send.
 *
 * The screen used to be a form: five sections — move-in, duration, preferred
 * room, message, phone — each with its own heading, all shouting at the same
 * volume. Every one of them is optional at the API (only `slug` is required)
 * and every one already had a value, so a seeker was being asked five
 * questions that had already been answered, with the one action that mattered
 * pushed below the fold.
 *
 * It is now a summary: rows that state the current answer and open a sheet
 * when tapped. These functions produce the words in those rows, which is the
 * part worth testing — an empty state that reads like a blank field puts the
 * screen straight back to being a form.
 */

export interface RoomPreference {
  floorName: string | null;
  roomNo: string | null;
}

/** The action `Send enquiry` should take, given who is looking at it. */
export type SendAction = 'sign_in' | 'verify_phone' | 'submit';

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** Local Y-M-D, matching `MoveInDateField`'s own convention. */
export function toLocalISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * `null` means the seeker never touched the date, and is sent as *no*
 * move-in date rather than as today.
 *
 * The old screen defaulted the field to today, which is aggressive: most
 * seekers are not moving in today, and an owner reading "moving in today"
 * acts differently from one reading "flexible". Now that the value is stated
 * as an answer rather than sat in a picker, defaulting it would be asserting
 * something on the seeker's behalf.
 */
export function moveInLabel(iso: string | null | undefined, today: Date = new Date()): string {
  const value = String(iso ?? '').trim();
  if (!value) return 'Flexible';

  const todayISO = toLocalISO(today);
  if (value === todayISO) return 'Today';

  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
  if (value === toLocalISO(tomorrow)) return 'Tomorrow';

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return 'Flexible';
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return 'Flexible';
  return `${Number(match[3])} ${month} ${match[1]}`;
}

export function durationLabel(months: number | null | undefined): string {
  const value = Number(months);
  if (!Number.isFinite(value) || value <= 0) return 'Not sure yet';
  if (value === 12) return '1 year';
  return `${value} months`;
}

/**
 * `null` when nothing is chosen, so the caller can show the invitation to add
 * one instead of an empty row. A floor without a room is a real preference —
 * "this floor, any room on it" — and says so rather than looking unfinished.
 */
export function roomPreferenceLabel(preference: RoomPreference | null | undefined): string | null {
  const floor = String(preference?.floorName ?? '').trim();
  if (!floor) return null;
  const room = String(preference?.roomNo ?? '').trim();
  return room ? `${floor} · Room ${room}` : `${floor} · Any room`;
}

/** A one-line preview of the note, or `null` when there is none. */
export function notePreview(message: string | null | undefined, maxLength = 40): string | null {
  const text = String(message ?? '').trim().replace(/\s+/g, ' ');
  if (!text) return null;
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * The single line under the summary rows. It is an invitation while empty and
 * a statement once used, so a seeker who set a preference can see it without
 * opening the sheet to check.
 */
export function detailsLabel(
  preference: RoomPreference | null | undefined,
  message: string | null | undefined,
): string {
  const room = roomPreferenceLabel(preference);
  const note = notePreview(message);
  if (room && note) return `${room} · note added`;
  if (room) return room;
  if (note) return `Note: ${note}`;
  return 'Add a room preference or a note';
}

/**
 * What `Send enquiry` does. Phone verification is no longer a card sitting
 * inline above the button — it is what the button opens, at the moment it is
 * needed, so it reads as the last step rather than a precondition.
 */
export function sendAction(input: {
  isSeeker: boolean;
  needsPhoneVerification: boolean;
}): SendAction {
  if (!input?.isSeeker) return 'sign_in';
  return input.needsPhoneVerification ? 'verify_phone' : 'submit';
}
