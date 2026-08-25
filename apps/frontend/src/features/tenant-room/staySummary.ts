/**
 * The stay someone is in right now, summarised for their profile.
 *
 * `residencyHistoryService.getOwnHistory()` has returned this all along — every
 * stay, with `is_current` and `duration_months` already computed. The profile
 * called the hook and then only ever linked out to the history page, so it
 * could tell you where you *had* lived and never where you live.
 *
 * PURE — the card is a renderer over this.
 */

export interface Stay {
  is_current?: boolean;
  hostel_name?: string | null;
  room_no?: string | null;
  city?: string | null;
  start_date?: string | null;
  duration_months?: number | null;
}

export interface StayHistory {
  stays?: Stay[];
  total_stays?: number;
  total_months?: number;
}

/** The live one, or null for someone who is only browsing. */
export function currentStay(history: StayHistory | null | undefined): Stay | null {
  return (history?.stays ?? []).find((stay) => stay?.is_current) ?? null;
}

/** `1 Sep 2026`, from integer parts — never `new Date(iso)`, which shifts west of UTC. */
export function formatStayDate(iso: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!match) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${Number(match[3])} ${months[Number(match[2]) - 1]} ${match[1]}`;
}

/** "Room 105 · since 24 Aug 2026" — only the parts that are actually known. */
export function stayLine(stay: Stay | null | undefined): string {
  if (!stay) return '';
  const parts: string[] = [];
  if (stay.room_no) parts.push(`Room ${stay.room_no}`);
  const since = formatStayDate(stay.start_date);
  if (since) parts.push(`since ${since}`);
  return parts.join(' · ');
}

/** "3 months so far", or '' when the stay is younger than a month. */
export function stayDuration(stay: Stay | null | undefined): string {
  const months = stay?.duration_months;
  if (typeof months !== 'number' || months < 1) return '';
  return `${months} month${months === 1 ? '' : 's'} so far`;
}

/**
 * The line under "Stay history".
 *
 * It used to read `${total_stays} past stays`, and `total_stays` counts only
 * stays where `is_current` is false — so someone in their first hostel was told
 * **"0 past stays"** on the profile of a person who is, at that moment, living
 * somewhere. Counting the current stay is the difference between a record and
 * an accusation of having none.
 */
export function historySummaryLine(history: StayHistory | null | undefined): string {
  if (!history) return 'Where you’ve stayed, and who can see it';

  const past = history.total_stays ?? 0;
  const hasCurrent = Boolean(currentStay(history));
  const total = past + (hasCurrent ? 1 : 0);

  if (total === 0) return 'Where you’ve stayed, and who can see it';

  const noun = `${total} stay${total === 1 ? '' : 's'}`;
  const qualified = hasCurrent && past === 0 ? `${noun}, including this one` : noun;
  return `${qualified} · you choose who sees it`;
}
