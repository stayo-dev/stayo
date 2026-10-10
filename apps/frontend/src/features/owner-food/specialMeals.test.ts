import { describe, expect, it } from 'vitest';
import { absentLine, breakdownLine, cookLine, lockLine, occasionTitle, peopleGroups, type SpecialCount } from './specialMeals';

const count: SpecialCount['count'] = {
  cook: { veg: 28, nonVeg: 57 },
  confirmed: 61, lastChoice: 20, noAnswer: 4, skipping: 6, awaySaid: 4, onLeave: 11,
  people: [
    { tenantId: 'a', name: 'Asha', roomNo: '101', choice: 'VEG', basis: 'CONFIRMED', source: 'WHATSAPP' },
    { tenantId: 'b', name: 'Bala', roomNo: '101', choice: 'NON_VEG', basis: 'LAST_CHOICE', source: null },
    { tenantId: 'c', name: 'Chetan', roomNo: '102', choice: null, basis: 'NO_ANSWER', source: null },
    { tenantId: 'd', name: 'Dev', roomNo: '103', choice: null, basis: 'ON_LEAVE', source: null },
    { tenantId: 'e', name: 'Esha', roomNo: '104', choice: 'AWAY', basis: 'CONFIRMED', source: 'WHATSAPP' },
    { tenantId: 'f', name: 'Faiz', roomNo: '105', choice: 'SKIP', basis: 'CONFIRMED', source: 'OWNER' },
  ],
};

describe('special meal display', () => {
  it('titles an occasion', () => {
    expect(occasionTitle({ weekday: 0, mealType: 'LUNCH' })).toBe('Sunday lunch');
  });
  it('puts the cook numbers first, non-veg first', () => {
    expect(cookLine(count)).toEqual([{ label: 'Non-veg', value: 57 }, { label: 'Veg', value: 28 }]);
  });
  it('explains where the numbers came from, naming the no-answer policy', () => {
    expect(breakdownLine(count, 'LAST_CHOICE')).toBe('Confirmed 61 · Last choice 20 · No answer 4');
    expect(breakdownLine({ ...count, lastChoice: 0 }, 'LEAVE_OUT')).toBe('Confirmed 61 · No answer 4 (not cooked for)');
  });
  it('splits away into on-leave and said-so', () => {
    expect(absentLine(count)).toBe('Skipping 6 · Away 15 (11 on leave · 4 said "I\'m away")');
  });
  it('says when answers lock or locked', () => {
    const cutoff = '2026-10-11T04:00:00.000Z';
    expect(lockLine(cutoff, true)).toBe('Answers close at 9:30 AM');
    expect(lockLine(cutoff, false)).toBe('Closed at 9:30 AM · you can still edit');
  });
  it('groups people for the drill-down, keeping room order', () => {
    const groups = peopleGroups(count.people);
    expect(groups.map((g) => [g.key, g.people.map((p) => p.tenantId)])).toEqual([
      ['NON_VEG', ['b']], ['VEG', ['a']], ['NO_ANSWER', ['c']], ['SKIP', ['f']], ['AWAY', ['e']], ['ON_LEAVE', ['d']],
    ]);
  });
});

import { readyButtons } from './specialMeals';

describe('ready buttons', () => {
  it('shows nothing on a day the meal is not served', () => {
    expect(readyButtons(count, [], false)).toBeNull();
  });

  it('offers non-veg first, veg, and both while neither is sent', () => {
    const r = readyButtons(count, [], true)!;
    expect(r.buttons.map((b) => [b.choice, b.label, b.sent])).toEqual([
      ['NON_VEG', 'Non-veg is ready · tell 57', null],
      ['VEG', 'Veg is ready · tell 28', null],
    ]);
    expect(r.bothLabel).toBe('Both are ready · tell 85');
  });

  it('turns a sent choice into a receipt and drops the both button', () => {
    const r = readyButtons(count, [{ choice: 'NON_VEG', sentAt: '2026-10-11T07:11:00.000Z', recipients: 55 }], true)!;
    expect(r.buttons[0].sent).toBe('Told 55 at 12:41 PM');
    expect(r.buttons[1].sent).toBeNull();
    expect(r.bothLabel).toBeNull();
  });

  it('does not offer a choice nobody is eating', () => {
    const r = readyButtons({ ...count, cook: { veg: 0, nonVeg: 12 } }, [], true)!;
    expect(r.buttons.map((b) => b.choice)).toEqual(['NON_VEG']);
    expect(r.bothLabel).toBeNull();
  });
});
