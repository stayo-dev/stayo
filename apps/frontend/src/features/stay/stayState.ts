import type { MyStay, StayBoard, StaySummary, SuggestedReturn, TenantStay } from './types';

/**
 * Stay Status screen models — pure, so the two-second rule and the
 * "one primary action" rule are tested, not hoped for. Components render
 * these and decide nothing. See ADR-193.
 */

export type MoreAction = 'GOING_HOME' | 'VACATION' | 'CHANGE_DATE' | 'CANCEL_LEAVE';
export type ReturnDateMode = 'GOING_HOME' | 'VACATION' | 'CHANGE_DATE';

export interface StayScreen {
  kind: 'present' | 'away';
  headline: string;
  detail: string;
  /** At most one primary action, ever. */
  primary: 'IM_BACK' | null;
  more: MoreAction[];
}

export const MORE_ACTION_LABEL: Record<MoreAction, string> = {
  GOING_HOME: 'Going home',
  VACATION: 'Vacation',
  CHANGE_DATE: 'Change return date',
  CANCEL_LEAVE: 'Cancel leave',
};

export const RETURN_SHEET_TITLE: Record<ReturnDateMode, string> = {
  GOING_HOME: 'Going home',
  VACATION: 'Vacation — back on',
  CHANGE_DATE: 'New return date',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/** "today", "tomorrow", "yesterday", a weekday within the coming week, else "20 Sep". */
export function friendlyDate(iso: string, today: string): string {
  const days = daysFrom(today, iso);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (days > 1 && days < 7) return WEEKDAYS[date.getUTCDay()];
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function suggestedLabel(suggested: SuggestedReturn): string {
  return suggested.label === 'sunday' ? 'Back Sunday' : 'Back tomorrow';
}

export function screenFor(stay: TenantStay, hostelName: string): StayScreen {
  if (!stay.leave || stay.status === 'PRESENT') {
    return { kind: 'present', headline: "You're in", detail: hostelName, primary: null, more: ['GOING_HOME', 'VACATION'] };
  }
  const back = friendlyDate(stay.leave.expectedReturnDate, stay.today);
  const copy =
    stay.status === 'RETURNING_TODAY'
      ? { headline: 'Back today?', detail: 'Tap when you arrive' }
      : stay.status === 'LATE'
        ? { headline: 'Are you back?', detail: `You were due back ${back}` }
        : { headline: 'Away', detail: `Back ${back}` };
  return { kind: 'away', ...copy, primary: 'IM_BACK', more: ['CHANGE_DATE', 'CANCEL_LEAVE'] };
}

export type ScanView = 'SIGNED_OUT' | 'NOT_TENANT' | 'NOT_RESIDENT' | 'OTHER_HOSTEL' | 'READY';

export function scanViewFor(input: {
  signedIn: boolean;
  role: string | null | undefined;
  mine: MyStay | undefined;
  hostelId: string | undefined;
}): ScanView {
  if (!input.signedIn) return 'SIGNED_OUT';
  if (String(input.role ?? '').toLowerCase() !== 'tenant') return 'NOT_TENANT';
  if (!input.mine?.resident || !input.mine.stay || !input.mine.hostel) return 'NOT_RESIDENT';
  if (input.mine.hostel.id !== input.hostelId) return 'OTHER_HOSTEL';
  return 'READY';
}

export const SCAN_MESSAGE: Record<'NOT_TENANT' | 'NOT_RESIDENT' | 'OTHER_HOSTEL', string> = {
  NOT_TENANT: 'This code is for residents of this hostel.',
  NOT_RESIDENT: "You're not staying here right now. Your dashboard has everything else.",
  OTHER_HOSTEL: 'This code is for another hostel.',
};

/** The QR page records a presence confirmation once, for a present resident of this hostel only. */
export function shouldConfirmPresence(view: ScanView, stay: TenantStay | null | undefined): boolean {
  return view === 'READY' && stay?.status === 'PRESENT';
}

export type OwnerRowAction = 'MARK_BACK' | 'PUT_ON_LEAVE';

export interface BoardRow {
  tenantId: string;
  name: string;
  roomNo: string;
  detail: string;
  primary: OwnerRowAction | null;
  more: Array<'CHANGE_DATE' | 'CANCEL_LEAVE'>;
}

export interface BoardSection {
  id: 'late' | 'back-today' | 'away' | 'here';
  title: string;
  tone: 'danger' | 'default';
  collapsed: boolean;
  rows: BoardRow[];
}

const LEAVE_EDITS: BoardRow['more'] = ['CHANGE_DATE', 'CANCEL_LEAVE'];
const who = (p: { tenantId: string; name: string; roomNo: string }) => ({ tenantId: p.tenantId, name: p.name, roomNo: p.roomNo });

/** The board's people sections, in the order an owner needs them. Empty sections are omitted. */
export function boardSections(board: StayBoard): BoardSection[] {
  const sections: BoardSection[] = [];
  if (board.lateList.length > 0) {
    sections.push({
      id: 'late', title: 'Late', tone: 'danger', collapsed: false,
      rows: board.lateList.map((p) => ({
        ...who(p),
        detail: p.daysLate === 1 ? 'Due back yesterday' : `${p.daysLate} days late`,
        primary: 'MARK_BACK',
        more: LEAVE_EDITS,
      })),
    });
  }
  if (board.backToday.length > 0) {
    sections.push({
      id: 'back-today', title: 'Back today', tone: 'default', collapsed: false,
      rows: board.backToday.map((p) => ({
        ...who(p),
        detail: p.arrived ? 'Arrived ✓' : 'Expected today',
        primary: p.arrived ? null : 'MARK_BACK',
        more: p.arrived ? [] : LEAVE_EDITS,
      })),
    });
  }
  if (board.awayList.length > 0) {
    sections.push({
      id: 'away', title: 'Away', tone: 'default', collapsed: false,
      rows: board.awayList.map((p) => ({
        ...who(p),
        detail: `Back ${friendlyDate(p.expectedReturnDate, board.today)}`,
        primary: 'MARK_BACK',
        more: LEAVE_EDITS,
      })),
    });
  }
  if (board.here.length > 0) {
    sections.push({
      id: 'here', title: `Everyone here (${board.here.length})`, tone: 'default', collapsed: true,
      rows: board.here.map((p) => ({ ...who(p), detail: '', primary: 'PUT_ON_LEAVE', more: [] })),
    });
  }
  return sections;
}

export function roomLines(board: StayBoard): Array<{ roomId: string; text: string; detail: string }> {
  return board.roomsToCheck.map((r) => ({
    roomId: r.roomId,
    text: `Room ${r.roomNo}`,
    detail: r.reason === 'EMPTY_TONIGHT' ? `Empty tonight · ${r.names.join(', ')}` : `${r.names.join(', ')} back today`,
  }));
}

export function boardHeadline(board: StayBoard): { here: string; meals: string; beds: string } {
  const lateNote = board.meals.lateMayTurnUp > 0 ? ` · +${board.meals.lateMayTurnUp} late may turn up` : '';
  // A learned number is the better answer and replaces the headcount outright;
  // the late note only belongs on the headcount, which cannot know about them.
  const meals =
    board.mealForecast && board.mealForecast.basis === 'learned'
      ? `≈ ${board.mealForecast.expected} for dinner · from the last 2 weeks`
      : `≈ ${board.meals.expected} for dinner & breakfast${lateNote}`;
  return {
    here: `${board.hereTonight} here tonight`,
    meals,
    beds: `${board.beds.free} ${board.beds.free === 1 ? 'bed' : 'beds'} free`,
  };
}

export interface TonightCards {
  hereTonight: { value: number; caption: string };
  backToday: { value: number; caption: string; tone: 'danger' | 'default' };
  roomsToCheck: { value: number; caption: string };
}

/** Owner Home's "Tonight" row. Null until someone lives here — never a row of zeros. */
export function tonightCards(summary: StaySummary | undefined): TonightCards | null {
  if (!summary || summary.totals.residents === 0) return null;
  const t = summary.totals;
  return {
    hereTonight: {
      value: t.hereTonight,
      caption:
        summary.mealForecast?.basis === 'learned'
          ? `≈ ${summary.mealForecast.expected} meals`
          : `≈ ${t.mealsExpected} meals`,
    },
    backToday: { value: t.backToday, caption: t.late > 0 ? `${t.late} late` : 'Expected back', tone: t.late > 0 ? 'danger' : 'default' },
    roomsToCheck: { value: t.roomsToCheck, caption: 'Empty or returning' },
  };
}
