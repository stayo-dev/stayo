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

import { outreachActions } from './specialMeals';

describe('ask / remind now', () => {
  const o = (x: Partial<{ asked: number; reminded: number; unreachable: number; toAsk: number; toRemind: number }>) => ({
    asked: 0, reminded: 0, unreachable: 0, toAsk: 0, toRemind: 0, ...x,
  });

  it('offers nothing once answers have closed', () => {
    expect(outreachActions(o({ toAsk: 49 }), false)).toBeNull();
  });

  it('offers to ask everyone before anything was sent', () => {
    expect(outreachActions(o({ toAsk: 49 }), true)).toEqual({ status: null, ask: 'Ask residents now · 49', remind: null });
  });

  it('after asking, offers a reminder for the silent and says what happened', () => {
    expect(outreachActions(o({ asked: 49, toRemind: 31 }), true)).toEqual({
      status: 'Asked 49 · Reminded 0',
      ask: null,
      remind: "Remind 31 who haven't answered",
    });
  });

  it('asks newcomers as "more", and owns up to unreachable phones', () => {
    expect(outreachActions(o({ asked: 49, reminded: 31, unreachable: 2, toAsk: 1 }), true)).toEqual({
      status: "Asked 49 · Reminded 31 · 2 couldn't be reached",
      ask: 'Ask 1 more',
      remind: null,
    });
  });

  it('copes with a server that has not sent outreach yet', () => {
    expect(outreachActions(undefined, true)).toBeNull();
  });
});

import { answeredProgress, closePreview, dishSummary, phaseOf, servingLine } from './specialMeals';

describe('special meals screen — v2', () => {
  const base = {
    occasion: { id: 'o', weekday: 0, mealType: 'LUNCH', vegDish: null, nonVegDish: null, cutoffMinutesBefore: 180, noAnswerPolicy: 'LAST_CHOICE', isActive: true, nextServeDate: '2026-10-11' },
    serveDate: '2026-10-11', mealStart: '12:30', cutoffAt: '2026-10-11T04:00:00.000Z', isOpen: true, isToday: true, count, readyAlerts: [],
  } as any;

  it('names the phase: collecting, closed, paused', () => {
    expect(phaseOf(base, '2026-10-11')).toEqual({ tone: 'success', label: 'Collecting answers · closes 9:30 AM today' });
    expect(phaseOf({ ...base, isToday: false, serveDate: '2026-10-12', cutoffAt: '2026-10-12T04:00:00.000Z' }, '2026-10-11'))
      .toEqual({ tone: 'success', label: 'Collecting answers · closes 9:30 AM tomorrow' });
    expect(phaseOf({ ...base, isOpen: false }, '2026-10-11')).toEqual({ tone: 'warning', label: 'Answers closed · serving today' });
    expect(phaseOf({ ...base, isOpen: false, isToday: false }, '2026-10-10')).toEqual({ tone: 'neutral', label: 'Answers closed · final count' });
    expect(phaseOf({ ...base, occasion: { ...base.occasion, isActive: false } }, '2026-10-11'))
      .toEqual({ tone: 'neutral', label: "Paused · residents won't be asked" });
  });

  it('says when and what is served', () => {
    expect(servingLine('2026-10-11', 'LUNCH', '12:30', '2026-10-11')).toBe('Today · Lunch at 12:30 PM');
    expect(servingLine('2026-10-12', 'DINNER', '19:00', '2026-10-11')).toBe('Tomorrow · Dinner at 7:00 PM');
    expect(servingLine('2026-10-14', 'DINNER', '19:00', '2026-10-11')).toBe('Wed 14 Oct · Dinner at 7:00 PM');
  });

  it('counts answers against everyone who is here', () => {
    // 6 people, 1 on leave → 5 here; 3 confirmed answers.
    expect(answeredProgress(count)).toEqual({ answered: 3, here: 5, pct: 60 });
    expect(answeredProgress({ ...count, people: [], confirmed: 0, onLeave: 0 })).toEqual({ answered: 0, here: 0, pct: 0 });
  });

  it('shows the dishes, or nothing', () => {
    expect(dishSummary({ nonVegDish: 'Chicken Biryani', vegDish: 'Veg Biryani' })).toBe('Chicken Biryani · Veg Biryani');
    expect(dishSummary({ nonVegDish: null, vegDish: 'Paneer' })).toBe('Paneer');
    expect(dishSummary({ nonVegDish: null, vegDish: null })).toBeNull();
  });

  it('previews when answers will close as the owner picks a cutoff', () => {
    expect(closePreview('12:30', 180)).toBe('Answers close at 9:30 AM on the day');
    expect(closePreview('12:30', 720)).toBe('Answers close at 12:30 AM on the day');
    expect(closePreview('07:00', 720)).toBe('Answers close at 7:00 PM the evening before');
  });
});
