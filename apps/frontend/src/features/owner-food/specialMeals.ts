/** Special-meal choices (Phase 1) — the owner screen's words and groupings. Pure. */

export type MealChoice = 'VEG' | 'NON_VEG' | 'AWAY' | 'SKIP';
export type PersonBasis = 'CONFIRMED' | 'LAST_CHOICE' | 'NO_ANSWER' | 'ON_LEAVE';
export type NoAnswerPolicy = 'LAST_CHOICE' | 'LEAVE_OUT';

export interface SpecialOccasion {
  id: string;
  weekday: number;
  mealType: 'BREAKFAST' | 'LUNCH' | 'SNACKS' | 'DINNER';
  vegDish: string | null;
  nonVegDish: string | null;
  cutoffMinutesBefore: number;
  noAnswerPolicy: NoAnswerPolicy;
  isActive: boolean;
  nextServeDate: string;
}

export interface SpecialCountPerson {
  tenantId: string;
  name: string;
  roomNo: string;
  choice: MealChoice | null;
  basis: PersonBasis;
  source: 'WHATSAPP' | 'OWNER' | null;
}

export interface ReadyAlert {
  choice: 'VEG' | 'NON_VEG';
  sentAt: string;
  recipients: number;
}

export interface Outreach {
  asked: number;
  reminded: number;
  unreachable: number;
  toAsk: number;
  toRemind: number;
}

export interface SpecialCount {
  occasion: SpecialOccasion;
  serveDate: string;
  cutoffAt: string;
  isOpen: boolean;
  /** True only on the serving day itself: the only day "food's ready" can be sent. */
  isToday: boolean;
  readyAlerts: ReadyAlert[];
  /** Who has been messaged for this serving, by the crons or the owner's buttons. */
  outreach?: Outreach;
  count: {
    cook: { veg: number; nonVeg: number };
    confirmed: number; lastChoice: number; noAnswer: number; skipping: number; awaySaid: number; onLeave: number;
    people: SpecialCountPerson[];
  };
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const CUTOFF_OPTIONS = [
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 180, label: '3 hours before' },
  { minutes: 360, label: '6 hours before' },
  { minutes: 720, label: '12 hours before' },
] as const;

const MEAL_WORD = { BREAKFAST: 'breakfast', LUNCH: 'lunch', SNACKS: 'snacks', DINNER: 'dinner' } as const;

export function occasionTitle(o: Pick<SpecialOccasion, 'weekday' | 'mealType'>): string {
  return `${WEEKDAYS[o.weekday]} ${MEAL_WORD[o.mealType]}`;
}

export function choiceLabel(choice: MealChoice | null): string {
  return choice === 'VEG' ? 'Veg' : choice === 'NON_VEG' ? 'Non-veg' : choice === 'AWAY' ? "I'm away" : choice === 'SKIP' ? 'Skipping' : 'No answer';
}

export function cookLine(c: SpecialCount['count']) {
  return [{ label: 'Non-veg', value: c.cook.nonVeg }, { label: 'Veg', value: c.cook.veg }];
}

export function breakdownLine(c: SpecialCount['count'], policy: NoAnswerPolicy): string {
  const parts = [`Confirmed ${c.confirmed}`];
  if (c.lastChoice > 0) parts.push(`Last choice ${c.lastChoice}`);
  parts.push(policy === 'LEAVE_OUT' ? `No answer ${c.noAnswer} (not cooked for)` : `No answer ${c.noAnswer}`);
  return parts.join(' · ');
}

export function absentLine(c: SpecialCount['count']): string {
  const away = c.onLeave + c.awaySaid;
  return `Skipping ${c.skipping} · Away ${away} (${c.onLeave} on leave · ${c.awaySaid} said "I'm away")`;
}

function istTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso))
    .replace(/[  ]/g, ' ');
}

export function lockLine(cutoffAt: string, isOpen: boolean): string {
  return isOpen ? `Answers close at ${istTime(cutoffAt)}` : `Closed at ${istTime(cutoffAt)} · you can still edit`;
}

const GROUPS: Array<{ key: string; label: string; match: (p: SpecialCountPerson) => boolean }> = [
  { key: 'NON_VEG', label: 'Non-veg', match: (p) => p.choice === 'NON_VEG' && p.basis !== 'ON_LEAVE' },
  { key: 'VEG', label: 'Veg', match: (p) => p.choice === 'VEG' && p.basis !== 'ON_LEAVE' },
  { key: 'NO_ANSWER', label: 'No answer', match: (p) => p.basis === 'NO_ANSWER' },
  { key: 'SKIP', label: 'Skipping', match: (p) => p.choice === 'SKIP' },
  { key: 'AWAY', label: "Said I'm away", match: (p) => p.choice === 'AWAY' },
  { key: 'ON_LEAVE', label: 'On leave', match: (p) => p.basis === 'ON_LEAVE' },
];

/** Drill-down groups, in the order the owner needs them. People keep the server's room order. */
export function peopleGroups(people: SpecialCountPerson[]) {
  return GROUPS.map((g) => ({ key: g.key, label: g.label, people: people.filter(g.match) })).filter((g) => g.people.length > 0);
}

/**
 * The cook's "food's ready" buttons. Only on the serving day; non-veg first
 * (it is usually the one people are queueing for); a choice nobody is eating
 * is not offered; a sent choice becomes a receipt; "Both" only while neither
 * has gone out.
 */
export function readyButtons(c: SpecialCount['count'], alerts: ReadyAlert[], isToday: boolean) {
  if (!isToday) return null;
  const sentOf = (choice: ReadyAlert['choice']) => alerts.find((a) => a.choice === choice) ?? null;
  const options = [
    { choice: 'NON_VEG' as const, word: 'Non-veg', n: c.cook.nonVeg },
    { choice: 'VEG' as const, word: 'Veg', n: c.cook.veg },
  ].filter((o) => o.n > 0);
  const buttons = options.map((o) => {
    const sent = sentOf(o.choice);
    return {
      choice: o.choice,
      label: `${o.word} is ready · tell ${o.n}`,
      sent: sent ? `Told ${sent.recipients} at ${istTime(sent.sentAt)}` : null,
    };
  });
  const bothOpen = buttons.length === 2 && buttons.every((b) => b.sent === null);
  return { buttons, bothLabel: bothOpen ? `Both are ready · tell ${c.cook.nonVeg + c.cook.veg}` : null };
}

/**
 * The owner's "Ask now" / "Remind now" (the crons fire only at ~18:00 and
 * ~08:00). Only while answers are open; each button names how many residents
 * it will message, and disappears once there is nobody left for it.
 */
export function outreachActions(o: Outreach | undefined, isOpen: boolean) {
  if (!isOpen || !o) return null;
  const parts: string[] = [];
  if (o.asked > 0 || o.reminded > 0) parts.push(`Asked ${o.asked}`, `Reminded ${o.reminded}`);
  if (o.unreachable > 0) parts.push(`${o.unreachable} couldn't be reached`);
  const fresh = o.asked === 0 && o.reminded === 0;
  return {
    status: parts.length ? parts.join(' · ') : null,
    ask: o.toAsk > 0 ? (fresh ? `Ask residents now · ${o.toAsk}` : `Ask ${o.toAsk} more`) : null,
    remind: o.toRemind > 0 ? `Remind ${o.toRemind} who haven't answered` : null,
  };
}
