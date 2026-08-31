/**
 * The rent month, drawn as a calendar.
 *
 * The screen asked for three numbers — generation day, due day, grace period —
 * and explained them with a sentence. Each number is clear on its own and the
 * three together are not: an owner has to hold "raised on the 1st", "due on
 * the 5th" and "late after 0 more days" in their head at once and imagine a
 * month to see what it means for a tenant. Owners here are not technical, and
 * that is a lot of imagining to configure something they will live with every
 * month.
 *
 * A month they can look at answers it directly. The same three numbers become
 * marked days on a grid, so "raised on the 25th, due on the 5th" is visibly a
 * schedule that crosses into the next month rather than an arithmetic problem.
 *
 * Pure, because the roles are the whole design and a calendar is exactly the
 * kind of thing that looks right while being subtly wrong.
 */

export type DayRole = 'raised' | 'due' | 'grace' | 'late' | 'plain';

export interface RentSchedule {
  /** Day of the month rent is raised. */
  generationDay: number;
  /** Day of the month payment is expected. */
  dueDay: number;
  /** Days after the due day before it counts as late. */
  graceDays: number;
}

export interface CalendarDay {
  day: number;
  role: DayRole;
}

/** The steppers cap at 28, so every day exists in every month. */
export const DAYS_IN_MONTH = 31;

function clampDay(value: number | null | undefined, fallback: number): number {
  const n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, DAYS_IN_MONTH);
}

function normalise(schedule: RentSchedule) {
  const graceRaw = Math.trunc(Number(schedule?.graceDays));
  return {
    generationDay: clampDay(schedule?.generationDay, 1),
    dueDay: clampDay(schedule?.dueDay, 1),
    graceDays: Number.isFinite(graceRaw) && graceRaw > 0 ? graceRaw : 0,
  };
}

/** The first day a tenant is actually late. May fall past the month's end. */
export function firstLateDay(schedule: RentSchedule): number {
  const { dueDay, graceDays } = normalise(schedule);
  return dueDay + graceDays + 1;
}

/**
 * What one day means.
 *
 * `raised` wins over `due` when they are the same day: rent appearing is what
 * starts the month, and a day that is both is better described as the day
 * everything happens at once — which the summary line then spells out.
 */
export function dayRole(day: number, schedule: RentSchedule): DayRole {
  const { generationDay, dueDay, graceDays } = normalise(schedule);
  if (day === generationDay) return 'raised';
  if (day === dueDay) return 'due';
  if (day > dueDay && day <= dueDay + graceDays) return 'grace';
  if (day >= dueDay + graceDays + 1) return 'late';
  return 'plain';
}

export function monthDays(schedule: RentSchedule): CalendarDay[] {
  return Array.from({ length: DAYS_IN_MONTH }, (_, i) => ({
    day: i + 1,
    role: dayRole(i + 1, schedule),
  }));
}

/**
 * Whether the schedule runs past the end of the month.
 *
 * True when rent is raised after it is due — the common "raise on the 25th for
 * the 5th" arrangement — or when grace pushes the late date into next month.
 * Worth saying out loud: a single-month grid cannot show it, and an owner
 * looking at one would otherwise read the marks as being in the wrong order.
 */
export function crossesMonthEnd(schedule: RentSchedule): boolean {
  const { generationDay, dueDay } = normalise(schedule);
  return generationDay > dueDay || firstLateDay(schedule) > DAYS_IN_MONTH;
}

export interface ScheduleMilestone {
  role: Exclude<DayRole, 'plain' | 'grace'>;
  day: number;
  label: string;
  detail: string;
}

/**
 * The three moments in order, as a timeline. The calendar shows *where*; this
 * says *what happens*, in the order a tenant experiences it.
 */
export function scheduleMilestones(schedule: RentSchedule): ScheduleMilestone[] {
  const { generationDay, dueDay, graceDays } = normalise(schedule);
  const late = firstLateDay(schedule);

  return [
    {
      role: 'raised',
      day: generationDay,
      label: 'Rent appears',
      detail: "The bill is created and the tenant can see what they owe",
    },
    {
      role: 'due',
      day: dueDay,
      label: 'Payment expected',
      detail: graceDays > 0
        ? `Nothing happens yet — there are ${graceDays} more day${graceDays === 1 ? '' : 's'} of grace`
        : 'Payment is expected on this day',
    },
    {
      role: 'late',
      day: late > DAYS_IN_MONTH ? late - DAYS_IN_MONTH : late,
      label: 'Counted late',
      detail: late > DAYS_IN_MONTH
        ? 'Falls in the next month'
        : 'Late fees start from this day, if you charge them',
    },
  ];
}

/** One sentence under the calendar, in the owner's words. */
export function describeSchedule(schedule: RentSchedule): string {
  const { generationDay, dueDay, graceDays } = normalise(schedule);
  const gap = dueDay - generationDay;

  const window =
    gap > 0
      ? `${gap} day${gap === 1 ? '' : 's'} to pay`
      : gap === 0
        ? 'the same day it appears'
        : 'the following month';

  const late =
    graceDays > 0
      ? `${graceDays} day${graceDays === 1 ? '' : 's'} of grace after that`
      : 'late the very next day';

  return `Tenants get ${window}, with ${late}.`;
}
