import { describe, it, expect } from 'vitest';
import {
  kindForOffset,
  isSelected,
  toggleDay,
  selectedDays,
  totalReminders,
  dayLabel,
  describePlan,
  crowdingWarning,
  fromPolicy,
  toPolicyPatch,
  messagePreview,
  MAX_AFTER,
} from './reminderDays';

const schedule = (over: Partial<Parameters<typeof toggleDay>[0]> = {}) => ({
  beforeDays: [3],
  afterDays: [1, 5, 10],
  onDueDay: true,
  ...over,
});

describe('kindForOffset', () => {
  it('derives the message from where the day sits, so the owner never picks one', () => {
    // Offering a choice would let an owner pick "overdue" for a day before
    // rent is due — a message we cannot send.
    expect(kindForOffset(-3)).toBe('DUE_SOON');
    expect(kindForOffset(0)).toBe('DUE_TODAY');
    expect(kindForOffset(5)).toBe('OVERDUE');
  });
});

describe('toggleDay', () => {
  it('adds and removes a day before the due date', () => {
    expect(toggleDay(schedule(), -7).beforeDays).toEqual([3, 7]);
    expect(toggleDay(schedule(), -3).beforeDays).toEqual([]);
  });

  it('adds and removes a day after the due date', () => {
    expect(toggleDay(schedule(), 3).afterDays).toEqual([1, 3, 5, 10]);
    expect(toggleDay(schedule(), 5).afterDays).toEqual([1, 10]);
  });

  it('toggles the due day itself', () => {
    expect(toggleDay(schedule(), 0).onDueDay).toBe(false);
    expect(toggleDay(schedule({ onDueDay: false }), 0).onDueDay).toBe(true);
  });

  it('keeps days sorted and unique, whatever order they were tapped', () => {
    const s = toggleDay(toggleDay(schedule({ afterDays: [] }), 9), 2);
    expect(s.afterDays).toEqual([2, 9]);
  });

  it('never mutates the input', () => {
    const original = schedule();
    toggleDay(original, 7);
    expect(original.afterDays).toEqual([1, 5, 10]);
  });
});

describe('isSelected', () => {
  it('reads each side of the due day independently', () => {
    const s = schedule();
    expect(isSelected(s, -3)).toBe(true);
    expect(isSelected(s, 3)).toBe(false);
    expect(isSelected(s, 0)).toBe(true);
    expect(isSelected(schedule({ onDueDay: false }), 0)).toBe(false);
  });
});

describe('selectedDays', () => {
  it('reads in the order a tenant experiences them', () => {
    expect(selectedDays(schedule()).map((d) => d.offset)).toEqual([-3, 0, 1, 5, 10]);
  });

  it('labels each day with the message it will send', () => {
    expect(selectedDays(schedule()).map((d) => d.kind)).toEqual([
      'DUE_SOON',
      'DUE_TODAY',
      'OVERDUE',
      'OVERDUE',
      'OVERDUE',
    ]);
  });

  it('counts what a tenant would actually receive', () => {
    expect(totalReminders(schedule())).toBe(5);
    expect(totalReminders({ beforeDays: [], afterDays: [], onDueDay: false })).toBe(0);
  });
});

describe('dayLabel', () => {
  it('names a day the way an owner would say it', () => {
    expect(dayLabel(0)).toBe('Due day');
    expect(dayLabel(-1)).toBe('1 day before');
    expect(dayLabel(-3)).toBe('3 days before');
    expect(dayLabel(5)).toBe('5 days after');
  });
});

describe('describePlan', () => {
  it('summarises the whole schedule in a sentence', () => {
    expect(describePlan(schedule())).toBe(
      '5 reminders per tenant — 1 before rent is due, one on the due day and 3 after.',
    );
  });

  it('says plainly when nothing will be sent', () => {
    expect(describePlan({ beforeDays: [], afterDays: [], onDueDay: false })).toBe('No reminders will be sent.');
  });

  it('omits the parts that are empty', () => {
    expect(describePlan({ beforeDays: [], afterDays: [2], onDueDay: false })).toBe(
      '1 reminder per tenant — 1 after.',
    );
  });
});

describe('crowdingWarning', () => {
  it('warns once overdue reminders get crowded', () => {
    // A tenant who mutes the number stops receiving the ones that matter.
    expect(crowdingWarning(schedule({ afterDays: [1, 2, 3, 4, 5, 6] }))).toContain('mute');
  });

  it('stays quiet for an ordinary schedule — it is the owner\'s hostel', () => {
    expect(crowdingWarning(schedule())).toBeNull();
  });
});

describe('fromPolicy', () => {
  it('reads the stored schedule', () => {
    expect(fromPolicy({ schedule: { before_due_days: [3, 1], after_due_days: [5] } })).toEqual({
      beforeDays: [1, 3],
      afterDays: [5],
      onDueDay: true,
    });
  });

  it('treats an absent due-day flag as on, matching the backend default', () => {
    expect(fromPolicy({}).onDueDay).toBe(true);
    expect(fromPolicy({ send_due_day_reminder: false }).onDueDay).toBe(false);
  });

  it('drops stored days the picker cannot show, rather than losing them silently on save', () => {
    // A day beyond the strip would be invisible and then written back as
    // absent. Dropping it on read makes the screen honest about what it holds.
    expect(fromPolicy({ schedule: { after_due_days: [5, MAX_AFTER + 4, 0, -2] } }).afterDays).toEqual([5]);
  });

  it('survives a missing policy', () => {
    expect(fromPolicy(null)).toEqual({ beforeDays: [], afterDays: [], onDueDay: true });
  });
});

describe('toPolicyPatch', () => {
  it('writes the shape the backend reads', () => {
    expect(toPolicyPatch(schedule())).toEqual({
      reminders: {
        schedule: { before_due_days: [3], after_due_days: [1, 5, 10] },
        send_due_day_reminder: true,
      },
    });
  });

  it('touches nothing but the schedule — channels are saved separately', () => {
    const patch = toPolicyPatch(schedule()) as any;
    expect(patch.reminders.channels).toBeUndefined();
    expect(patch.billing).toBeUndefined();
  });
});

describe('messagePreview', () => {
  it('shows what the tenant actually reads on each kind of day', () => {
    expect(messagePreview('DUE_SOON', -3, 'Sunrise')).toContain('due in 3 day(s)');
    expect(messagePreview('DUE_TODAY', 0, 'Sunrise')).toContain('due today');
    expect(messagePreview('OVERDUE', 5, 'Sunrise')).toContain('overdue by 5 day(s)');
  });

  it("uses the hostel's own name, which is the name the reader trusts", () => {
    expect(messagePreview('DUE_SOON', -1, 'Sunrise Residency')).toContain('Sunrise Residency');
  });
});
