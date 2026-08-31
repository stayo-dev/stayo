import { describe, it, expect } from 'vitest';
import {
  dayRole,
  monthDays,
  firstLateDay,
  crossesMonthEnd,
  scheduleMilestones,
  describeSchedule,
  DAYS_IN_MONTH,
} from './rentScheduleCalendar';

const schedule = (over: Partial<Parameters<typeof dayRole>[1]> = {}) => ({
  generationDay: 1,
  dueDay: 5,
  graceDays: 0,
  ...over,
});

describe('dayRole', () => {
  it('marks the day rent appears and the day it is expected', () => {
    expect(dayRole(1, schedule())).toBe('raised');
    expect(dayRole(5, schedule())).toBe('due');
  });

  it('counts every day after the due day as late when there is no grace', () => {
    expect(dayRole(6, schedule())).toBe('late');
    expect(dayRole(20, schedule())).toBe('late');
  });

  it('shows grace as its own state, not as late', () => {
    // The whole point of grace is that nothing happens yet. Colouring those
    // days as late would tell the owner the opposite of what they configured.
    const s = schedule({ graceDays: 3 });
    expect(dayRole(6, s)).toBe('grace');
    expect(dayRole(8, s)).toBe('grace');
    expect(dayRole(9, s)).toBe('late');
  });

  it('leaves days before rent appears plain', () => {
    expect(dayRole(3, schedule({ generationDay: 10, dueDay: 15 }))).toBe('plain');
  });

  it('calls a day that is both raised and due the day rent appears', () => {
    // A day doing two jobs needs one label; the summary line spells out the
    // rest. Rent appearing is what starts the month.
    expect(dayRole(5, schedule({ generationDay: 5, dueDay: 5 }))).toBe('raised');
  });
});

describe('firstLateDay', () => {
  it('is the day after the due day when there is no grace', () => {
    expect(firstLateDay(schedule())).toBe(6);
  });

  it('moves out by the grace period', () => {
    expect(firstLateDay(schedule({ graceDays: 5 }))).toBe(11);
  });
});

describe('monthDays', () => {
  it('covers a whole month', () => {
    const days = monthDays(schedule());
    expect(days).toHaveLength(DAYS_IN_MONTH);
    expect(days[0]).toEqual({ day: 1, role: 'raised' });
    expect(days[DAYS_IN_MONTH - 1].day).toBe(DAYS_IN_MONTH);
  });

  it('gives every day exactly one role', () => {
    for (const { role } of monthDays(schedule({ graceDays: 2 }))) {
      expect(['raised', 'due', 'grace', 'late', 'plain']).toContain(role);
    }
  });
});

describe('crossesMonthEnd', () => {
  it('is true when rent is raised after it is due', () => {
    // The common "raise on the 25th for the 5th" arrangement. A single-month
    // grid cannot show it, and the marks would read in the wrong order.
    expect(crossesMonthEnd(schedule({ generationDay: 25, dueDay: 5 }))).toBe(true);
  });

  it('is true when grace pushes the late day past the month', () => {
    expect(crossesMonthEnd(schedule({ dueDay: 28, graceDays: 5 }))).toBe(true);
  });

  it('is false for an ordinary schedule inside one month', () => {
    expect(crossesMonthEnd(schedule())).toBe(false);
    expect(crossesMonthEnd(schedule({ graceDays: 3 }))).toBe(false);
  });
});

describe('scheduleMilestones', () => {
  it('reads in the order a tenant experiences it', () => {
    expect(scheduleMilestones(schedule()).map((m) => m.role)).toEqual(['raised', 'due', 'late']);
  });

  it('says that nothing happens on the due day when grace is set', () => {
    // Owners set grace and then expect a late fee on the due day. Saying so on
    // the due-day milestone is where that misunderstanding gets caught.
    const [, due] = scheduleMilestones(schedule({ graceDays: 3 }));
    expect(due.detail).toContain('3 more days of grace');
  });

  it('says plainly when the late day lands in the next month', () => {
    const [, , late] = scheduleMilestones(schedule({ dueDay: 28, graceDays: 5 }));
    expect(late.detail).toContain('next month');
  });

  it('uses singular wording for one day of grace', () => {
    const [, due] = scheduleMilestones(schedule({ graceDays: 1 }));
    expect(due.detail).toContain('1 more day of grace');
  });
});

describe('describeSchedule', () => {
  it('says how long a tenant actually has to pay', () => {
    expect(describeSchedule(schedule())).toBe('Tenants get 4 days to pay, with late the very next day.');
  });

  it('counts the grace days into the sentence', () => {
    expect(describeSchedule(schedule({ graceDays: 3 }))).toContain('3 days of grace after that');
  });

  it('handles rent that is due the day it appears', () => {
    expect(describeSchedule(schedule({ generationDay: 5, dueDay: 5 }))).toContain('the same day it appears');
  });

  it('describes a schedule that runs into the next month', () => {
    expect(describeSchedule(schedule({ generationDay: 25, dueDay: 5 }))).toContain('the following month');
  });

  it('uses singular wording for a single day', () => {
    expect(describeSchedule(schedule({ generationDay: 4, dueDay: 5 }))).toContain('1 day to pay');
  });
});
