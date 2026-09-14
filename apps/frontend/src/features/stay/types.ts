/** Wire types for Stay Status — mirror `apps/backend/src/services/stay/*`. See ADR-193. */

export type StayStatus = 'PRESENT' | 'ON_LEAVE' | 'RETURNING_TODAY' | 'LATE';
export type LeaveType = 'GOING_HOME' | 'VACATION';
export type StayEventType = 'LEAVE_STARTED' | 'RETURN_DATE_CHANGED' | 'RETURNED' | 'LEAVE_CANCELLED' | 'PRESENCE_CONFIRMED';

export interface SuggestedReturn {
  date: string;
  label: 'tomorrow' | 'sunday';
}

export interface DateWindow {
  today: string;
  suggestedReturn: SuggestedReturn;
  minReturnDate: string;
  maxReturnDate: string;
}

export interface TenantStay extends DateWindow {
  status: StayStatus;
  leave: { leaveType: LeaveType; startDate: string; expectedReturnDate: string } | null;
}

export interface MyStay {
  tenantId: string | null;
  hostel: { id: string; name: string } | null;
  resident: boolean;
  stay: TenantStay | null;
}

export interface StayEventInput {
  type: StayEventType;
  leaveType?: LeaveType;
  expectedReturnDate?: string;
  idempotencyKey: string;
}

export interface TenantStayEventInput extends StayEventInput {
  source: 'QR' | 'APP';
}

export interface BoardPerson {
  tenantId: string;
  name: string;
  roomNo: string;
}

export interface StayBoard extends DateWindow {
  residents: number;
  hereTonight: number;
  away: number;
  late: number;
  beds: { capacity: number; occupied: number; free: number };
  meals: { expected: number; lateMayTurnUp: number };
  backToday: Array<BoardPerson & { arrived: boolean }>;
  lateList: Array<BoardPerson & { expectedReturnDate: string; daysLate: number }>;
  awayList: Array<BoardPerson & { leaveType: LeaveType; expectedReturnDate: string }>;
  roomsToCheck: Array<{ roomId: string; roomNo: string; reason: 'EMPTY_TONIGHT' | 'BACK_TODAY'; names: string[] }>;
  here: BoardPerson[];
  /** Tonight's dinner, learned from served counts (ADR-194). Null until it is. */
  mealForecast?: { expected: number; basis: 'learned' | 'headcount'; samples?: number } | null;
}

export interface StayHostelSummary {
  hostelId: string;
  hostelName: string;
  residents: number;
  hereTonight: number;
  backToday: number;
  late: number;
  roomsToCheck: number;
  mealsExpected: number;
}

export interface StaySummary {
  totals: Omit<StayHostelSummary, 'hostelId' | 'hostelName'>;
  hostels: StayHostelSummary[];
  /** Tonight's dinner across the portfolio, learned from served counts (ADR-194). */
  mealForecast?: { expected: number; basis: 'learned' | 'headcount' } | null;
}
