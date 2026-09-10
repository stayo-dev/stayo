/**
 * Which days rent reminders go out.
 *
 * ## Days, not message types
 *
 * The owner chooses *when*. What each reminder says follows from where the day
 * sits relative to that tenant's due date, and there is nothing to pick:
 *
 *   before the due day  →  "your rent at {hostel} is due in {N} day(s)"
 *   on the due day      →  "your rent … is *due today*"
 *   after the due day   →  "your rent … is *overdue by* {N} day(s)"
 *
 * Those are the three live WhatsApp templates (`RentReminderKind` in
 * `rent-reminder-template-contract.ts`). Offering the owner a choice of type
 * would let them pick "overdue" for a day before rent is due, which is a
 * message we cannot send and a promise we cannot keep.
 *
 * ## Why a timeline and not a month calendar
 *
 * `reminder_before_due_days` / `reminder_after_due_days` are **offsets from
 * each tenant's own due date**, not dates in a month. A tenant due on the 5th
 * and one due on the 20th share this schedule and are reminded on different
 * calendar days. A 1-31 grid would therefore be a lie for everyone except
 * whoever happens to match the hostel's default due day — so the picker is a
 * strip centred on the due day, which is exactly what is stored.
 *
 * Pure: what an owner is agreeing to send, and to whom, on which day.
 */

export type ReminderKind = 'DUE_SOON' | 'DUE_TODAY' | 'OVERDUE';

export interface ReminderSchedule {
  /** Days *before* the due date, e.g. [3, 1]. */
  beforeDays: number[];
  /** Days *after* the due date, e.g. [1, 5, 10]. */
  afterDays: number[];
  /** Whether a reminder goes out on the due day itself. */
  onDueDay: boolean;
}

/** How far either side of the due day the picker offers. */
export const MAX_BEFORE = 10;
export const MAX_AFTER = 15;

/** Offset 0 is the due day; negative is before it, positive after. */
export function kindForOffset(offset: number): ReminderKind {
  if (offset < 0) return 'DUE_SOON';
  if (offset === 0) return 'DUE_TODAY';
  return 'OVERDUE';
}

export const KIND_LABEL: Record<ReminderKind, string> = {
  DUE_SOON: 'Rent due soon',
  DUE_TODAY: 'Rent due today',
  OVERDUE: 'Rent overdue',
};

/**
 * What the tenant actually reads, with the hostel's own values filled in.
 * Shortened from the approved template bodies — an owner checking whether a
 * reminder sounds right does not need the payment-button footer.
 */
export function messagePreview(kind: ReminderKind, offset: number, hostel = 'your hostel'): string {
  switch (kind) {
    case 'DUE_SOON':
      return `Hello Ravi, your rent payment at ${hostel} is due in ${Math.abs(offset)} day(s). Amount: 8,000 Rs for September.`;
    case 'DUE_TODAY':
      return `Hello Ravi, your rent of 8,000 for September at ${hostel} is due today. Pay now to keep your account in good standing.`;
    default:
      return `Hello Ravi, your rent of 8,000 for September at ${hostel} is overdue by ${offset} day(s). Please complete the payment at your earliest convenience.`;
  }
}

export function isSelected(schedule: ReminderSchedule, offset: number): boolean {
  if (offset === 0) return Boolean(schedule.onDueDay);
  return offset < 0
    ? (schedule.beforeDays ?? []).includes(Math.abs(offset))
    : (schedule.afterDays ?? []).includes(offset);
}

const sortAsc = (days: number[]) => [...new Set(days)].sort((a, b) => a - b);

export function toggleDay(schedule: ReminderSchedule, offset: number): ReminderSchedule {
  if (offset === 0) return { ...schedule, onDueDay: !schedule.onDueDay };

  if (offset < 0) {
    const day = Math.abs(offset);
    const has = (schedule.beforeDays ?? []).includes(day);
    return {
      ...schedule,
      beforeDays: sortAsc(has ? schedule.beforeDays.filter((d) => d !== day) : [...schedule.beforeDays, day]),
    };
  }

  const has = (schedule.afterDays ?? []).includes(offset);
  return {
    ...schedule,
    afterDays: sortAsc(has ? schedule.afterDays.filter((d) => d !== offset) : [...schedule.afterDays, offset]),
  };
}

/** Every selected day, in the order a tenant experiences them. */
export function selectedDays(schedule: ReminderSchedule): { offset: number; kind: ReminderKind }[] {
  const before = sortAsc(schedule.beforeDays ?? [])
    .map((d) => -d)
    .sort((a, b) => a - b);
  const after = sortAsc(schedule.afterDays ?? []);
  return [
    ...before.map((offset) => ({ offset, kind: kindForOffset(offset) })),
    ...(schedule.onDueDay ? [{ offset: 0, kind: kindForOffset(0) }] : []),
    ...after.map((offset) => ({ offset, kind: kindForOffset(offset) })),
  ];
}

export function totalReminders(schedule: ReminderSchedule): number {
  return selectedDays(schedule).length;
}

export function dayLabel(offset: number): string {
  if (offset === 0) return 'Due day';
  const n = Math.abs(offset);
  return offset < 0 ? `${n} day${n === 1 ? '' : 's'} before` : `${n} day${n === 1 ? '' : 's'} after`;
}

/** One sentence describing the whole schedule, in the owner's words. */
export function describePlan(schedule: ReminderSchedule): string {
  const days = selectedDays(schedule);
  if (days.length === 0) return 'No reminders will be sent.';

  const before = days.filter((d) => d.offset < 0).length;
  const after = days.filter((d) => d.offset > 0).length;
  const parts: string[] = [];
  if (before > 0) parts.push(`${before} before rent is due`);
  if (schedule.onDueDay) parts.push('one on the due day');
  if (after > 0) parts.push(`${after} after`);

  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
  return `${days.length} reminder${days.length === 1 ? '' : 's'} per tenant — ${list}.`;
}

/**
 * Too many overdue reminders stops reading as help and starts reading as
 * harassment — and a tenant who mutes the number stops receiving the ones
 * that matter. Advisory only: it is the owner's hostel and their call.
 */
export function crowdingWarning(schedule: ReminderSchedule): string | null {
  const after = (schedule.afterDays ?? []).length;
  if (after >= 6) {
    return `${after} overdue reminders is a lot. Tenants who feel chased tend to mute the number, and then none of them land.`;
  }
  return null;
}

export function fromPolicy(reminders: any): ReminderSchedule {
  const schedule = reminders?.schedule ?? {};
  const clean = (days: unknown, max: number): number[] =>
    sortAsc(
      (Array.isArray(days) ? days : [])
        .map((d) => Math.round(Number(d)))
        .filter((d) => Number.isFinite(d) && d >= 1 && d <= max),
    );
  return {
    beforeDays: clean(schedule.before_due_days, MAX_BEFORE),
    afterDays: clean(schedule.after_due_days, MAX_AFTER),
    // Absent means on, matching `selectReminderForDay`'s own default.
    onDueDay: reminders?.send_due_day_reminder !== false,
  };
}

export function toPolicyPatch(schedule: ReminderSchedule) {
  return {
    reminders: {
      schedule: {
        before_due_days: sortAsc(schedule.beforeDays ?? []),
        after_due_days: sortAsc(schedule.afterDays ?? []),
      },
      send_due_day_reminder: Boolean(schedule.onDueDay),
    },
  };
}
