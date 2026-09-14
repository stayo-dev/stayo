import { describe, expect, it } from 'vitest';
import {
  boardHeadline, boardSections, friendlyDate, roomLines, scanViewFor, screenFor, shouldConfirmPresence,
  suggestedLabel, tonightCards,
} from './stayState';
import type { MyStay, StayBoard, TenantStay } from './types';

const TODAY = '2026-09-14'; // Monday
const WINDOW = { today: TODAY, suggestedReturn: { date: '2026-09-15', label: 'tomorrow' as const }, minReturnDate: '2026-09-15', maxReturnDate: '2026-12-13' };
const stay = (status: TenantStay['status'], expectedReturnDate?: string): TenantStay => ({
  ...WINDOW,
  status,
  leave: expectedReturnDate ? { leaveType: 'GOING_HOME', startDate: '2026-09-12', expectedReturnDate } : null,
});

describe('friendlyDate', () => {
  it('speaks like a person', () => {
    expect(friendlyDate('2026-09-14', TODAY)).toBe('today');
    expect(friendlyDate('2026-09-15', TODAY)).toBe('tomorrow');
    expect(friendlyDate('2026-09-13', TODAY)).toBe('yesterday');
    expect(friendlyDate('2026-09-20', TODAY)).toBe('Sunday');
    expect(friendlyDate('2026-09-30', TODAY)).toBe('30 Sep');
    expect(friendlyDate('2026-09-10', TODAY)).toBe('10 Sep');
  });
});

describe('screenFor — one primary action at most', () => {
  it('present: a confirmation, no button, leave options behind More', () => {
    expect(screenFor(stay('PRESENT'), 'Sri Adithya')).toEqual({
      kind: 'present', headline: "You're in", detail: 'Sri Adithya', primary: null, more: ['GOING_HOME', 'VACATION'],
    });
  });

  it.each([
    ['ON_LEAVE', '2026-09-20', 'Away', 'Back Sunday'],
    ['RETURNING_TODAY', TODAY, 'Back today?', 'Tap when you arrive'],
    ['LATE', '2026-09-13', 'Are you back?', 'You were due back yesterday'],
  ] as const)('%s: one big I am back', (status, date, headline, detail) => {
    expect(screenFor(stay(status, date), 'Sri Adithya')).toEqual({
      kind: 'away', headline, detail, primary: 'IM_BACK', more: ['CHANGE_DATE', 'CANCEL_LEAVE'],
    });
  });

  it('labels the smart default', () => {
    expect(suggestedLabel({ date: '2026-09-20', label: 'sunday' })).toBe('Back Sunday');
    expect(suggestedLabel({ date: '2026-09-15', label: 'tomorrow' })).toBe('Back tomorrow');
  });
});

describe('scanViewFor', () => {
  const mine: MyStay = { tenantId: 't1', hostel: { id: 'h1', name: 'Sri Adithya' }, resident: true, stay: stay('PRESENT') };
  it('routes every visitor to exactly one screen', () => {
    expect(scanViewFor({ signedIn: false, role: null, mine: undefined, hostelId: 'h1' })).toBe('SIGNED_OUT');
    expect(scanViewFor({ signedIn: true, role: 'OWNER', mine: undefined, hostelId: 'h1' })).toBe('NOT_TENANT');
    expect(scanViewFor({ signedIn: true, role: 'tenant', mine: { ...mine, resident: false, stay: null }, hostelId: 'h1' })).toBe('NOT_RESIDENT');
    expect(scanViewFor({ signedIn: true, role: 'TENANT', mine, hostelId: 'h2' })).toBe('OTHER_HOSTEL');
    expect(scanViewFor({ signedIn: true, role: 'TENANT', mine, hostelId: 'h1' })).toBe('READY');
  });

  it('confirms presence only for a present resident of this hostel', () => {
    expect(shouldConfirmPresence('READY', stay('PRESENT'))).toBe(true);
    expect(shouldConfirmPresence('READY', stay('ON_LEAVE', '2026-09-20'))).toBe(false);
    expect(shouldConfirmPresence('OTHER_HOSTEL', stay('PRESENT'))).toBe(false);
  });
});

const board: StayBoard = {
  ...WINDOW,
  residents: 6, hereTonight: 3, away: 3, late: 1,
  beds: { capacity: 8, occupied: 6, free: 1 },
  meals: { expected: 3, lateMayTurnUp: 1 },
  backToday: [
    { tenantId: 'E', name: 'Esha', roomNo: '103', arrived: false },
    { tenantId: 'F', name: 'Farhan', roomNo: '104', arrived: true },
  ],
  lateList: [{ tenantId: 'D', name: 'Dev', roomNo: '102', expectedReturnDate: '2026-09-11', daysLate: 3 }],
  awayList: [{ tenantId: 'B', name: 'Bala', roomNo: '101', leaveType: 'GOING_HOME', expectedReturnDate: '2026-09-15' }],
  roomsToCheck: [
    { roomId: 'r102', roomNo: '102', reason: 'EMPTY_TONIGHT', names: ['Chitra', 'Dev'] },
    { roomId: 'r103', roomNo: '103', reason: 'BACK_TODAY', names: ['Esha'] },
  ],
  here: [{ tenantId: 'A', name: 'Asha', roomNo: '101' }],
};

describe('owner board — answers in priority order', () => {
  it('orders Late, Back today, Away, then everyone here collapsed', () => {
    const sections = boardSections(board);
    expect(sections.map((s) => [s.id, s.title, s.tone, s.collapsed])).toEqual([
      ['late', 'Late', 'danger', false],
      ['back-today', 'Back today', 'default', false],
      ['away', 'Away', 'default', false],
      ['here', 'Everyone here (1)', 'default', true],
    ]);
  });

  it('gives each row one action and the right words', () => {
    const [late, back, away, here] = boardSections(board);
    expect(late.rows[0]).toEqual({ tenantId: 'D', name: 'Dev', roomNo: '102', detail: '3 days late', primary: 'MARK_BACK', more: ['CHANGE_DATE', 'CANCEL_LEAVE'] });
    expect(back.rows.map((r) => [r.detail, r.primary])).toEqual([['Expected today', 'MARK_BACK'], ['Arrived ✓', null]]);
    expect(away.rows[0].detail).toBe('Back tomorrow');
    expect(here.rows[0]).toMatchObject({ primary: 'PUT_ON_LEAVE', more: [] });
  });

  it('says a single day late as a person would', () => {
    const one = { ...board, lateList: [{ ...board.lateList[0], daysLate: 1 }] };
    expect(boardSections(one)[0].rows[0].detail).toBe('Due back yesterday');
  });

  it('omits empty sections entirely', () => {
    const quiet = { ...board, lateList: [], backToday: [], awayList: [] };
    expect(boardSections(quiet).map((s) => s.id)).toEqual(['here']);
  });

  it('describes rooms that need attention', () => {
    expect(roomLines(board)).toEqual([
      { roomId: 'r102', text: 'Room 102', detail: 'Empty tonight · Chitra, Dev' },
      { roomId: 'r103', text: 'Room 103', detail: 'Esha back today' },
    ]);
  });

  it('headlines the three numbers an owner opens the app for', () => {
    expect(boardHeadline(board)).toEqual({
      here: '3 here tonight',
      meals: '≈ 3 for dinner & breakfast · +1 late may turn up',
      beds: '1 bed free',
    });
  });
});

describe('tonightCards — Owner Home', () => {
  const summary = (late: number, residents = 6) => ({
    totals: { residents, hereTonight: 3, backToday: 2, late, roomsToCheck: 2, mealsExpected: 3 },
    hostels: [],
  });
  it('shows nothing until someone lives here', () => {
    expect(tonightCards(undefined)).toBeNull();
    expect(tonightCards(summary(0, 0))).toBeNull();
  });
  it('answers, and turns red only when someone is late', () => {
    expect(tonightCards(summary(0))).toEqual({
      hereTonight: { value: 3, caption: '≈ 3 meals' },
      backToday: { value: 2, caption: 'Expected back', tone: 'default' },
      roomsToCheck: { value: 2, caption: 'Empty or returning' },
    });
    expect(tonightCards(summary(2))?.backToday).toEqual({ value: 2, caption: '2 late', tone: 'danger' });
  });
});
