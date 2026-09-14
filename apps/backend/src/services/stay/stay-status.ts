import { addDaysIso, daysBetweenIso, weekdayOfIso } from "@/lib/timezone";

/**
 * Stay Status rules — pure. Status is never stored: it is derived from the
 * tenant's active leave (or its absence) and IST today. Silence = Present.
 * See ADR-193 and docs/superpowers/specs/2026-09-14-stay-status-design.md.
 */

export const LEAVE_TYPES = ["GOING_HOME", "VACATION"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const STAY_SOURCES = ["QR", "APP", "OWNER", "WHATSAPP"] as const;
export type StaySource = (typeof STAY_SOURCES)[number];

export type StayStatus = "PRESENT" | "ON_LEAVE" | "RETURNING_TODAY" | "LATE";

/** Long enough for a semester break; short enough that a typo'd year is caught. */
export const MAX_RETURN_DAYS = 90;

export function deriveStayStatus(leave: { expectedReturnDate: string } | null, today: string): StayStatus {
  if (!leave) return "PRESENT";
  const days = daysBetweenIso(today, leave.expectedReturnDate);
  if (days === 0) return "RETURNING_TODAY";
  if (days < 0) return "LATE";
  return "ON_LEAVE";
}

/**
 * Sleeping here tonight. Due back today counts; late does not — they said
 * they would be back and are not, so the kitchen should not cook for them.
 */
export function isHereTonight(status: StayStatus): boolean {
  return status === "PRESENT" || status === "RETURNING_TODAY";
}

export type ReturnDateProblem = "INVALID_DATE" | "TOO_SOON" | "TOO_FAR";

export function validateReturnDate(date: unknown, today: string): ReturnDateProblem | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "INVALID_DATE";
  if (Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) return "INVALID_DATE";
  if (addDaysIso(date, 0) !== date) return "INVALID_DATE"; // 2026-02-30 rolls to March
  const days = daysBetweenIso(today, date);
  if (days < 1) return "TOO_SOON";
  if (days > MAX_RETURN_DAYS) return "TOO_FAR";
  return null;
}

export interface SuggestedReturn {
  date: string;
  label: "tomorrow" | "sunday";
}

/**
 * The single date Going Home offers, so the common path is two taps.
 * Thursday and Friday → this Sunday (the weekend trip home); any other day →
 * tomorrow. Saturday's Sunday is tomorrow, and it says so.
 */
export function smartReturnDate(today: string): SuggestedReturn {
  const weekday = weekdayOfIso(today);
  if (weekday === 4 || weekday === 5) return { date: addDaysIso(today, 7 - weekday), label: "sunday" };
  return { date: addDaysIso(today, 1), label: "tomorrow" };
}

export function isLeaveType(value: unknown): value is LeaveType {
  return typeof value === "string" && (LEAVE_TYPES as readonly string[]).includes(value);
}

export function isStaySource(value: unknown): value is StaySource {
  return typeof value === "string" && (STAY_SOURCES as readonly string[]).includes(value);
}
