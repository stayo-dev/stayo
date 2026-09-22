import { tenantDisplayName } from "./guardian-activation-template-contract";

/**
 * The two templates a guardian receives about their ward's stay (ADR-233).
 *
 * One tells them the ward has left; the other tells them the ward is back.
 * Nothing else in this family exists, and the copy says so — "Nothing is
 * needed from you" and "We'll message you again when {{2}} returns" are
 * promises about the *set* of messages, not decoration.
 *
 * ── Two properties the rest of the slice depends on ──
 *
 * 1. **Both bodies carry their own date or time.** The sweep that recovers a
 *    lost send (`/api/cron/stay-guardian-sweep`) can only run daily on this
 *    Vercel plan, so a recovered message may arrive up to a day late.
 *    "checked in at 7:40 PM, 28 Sep" is still true and still legible the next
 *    morning; "checked in just now" would not be. Any future template in this
 *    family must be self-dating for the same reason.
 *
 * 2. **`{{4}}` in DEPARTURE is why both leave types share one template.** The
 *    body's single preposition "for" carries `for home` and `for a trip`
 *    alike. An unrecognised leave type falls back to `a trip` rather than an
 *    empty string, which Meta rejects outright.
 *
 * Names and languages are hard-coded with no environment-variable fallback —
 * ADR-196 records that a fallback to names never registered at Meta cost weeks
 * of silent 132001 failures.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export type StayGuardianKind = "DEPARTURE" | "RETURN";

export type StayGuardianTemplate = {
  /** Exactly as registered at Meta. */
  name: string;
  language: string;
  /** Parameter names in the order Meta's body reads them. The order is the contract. */
  parameters: readonly string[];
  /** A copy of the approved body. Meta holds the real one; the test asserts this against `parameters`. */
  body: string;
};

export const STAY_GUARDIAN_TEMPLATES: Record<StayGuardianKind, StayGuardianTemplate> = {
  DEPARTURE: {
    name: "stayo_guardian_stay_departure",
    language: "en",
    parameters: ["guardian_name", "tenant_name", "hostel_name", "leave_type", "return_date"],
    body:
      "Hello {{1}}, {{2}} has left {{3}} for {{4}} and is expected back on {{5}}. " +
      "We'll message you again when {{2}} returns.",
  },
  RETURN: {
    name: "stayo_guardian_stay_return",
    language: "en",
    parameters: ["guardian_name", "tenant_name", "hostel_name", "check_in_time"],
    body:
      "Hello {{1}}, {{2}} has returned to {{3}} and checked in at {{4}}. " +
      "Nothing is needed from you — this is just so you know.",
  },
};

/**
 * The footer both templates carry at Meta.
 *
 * STOP is disclosed here rather than in the body because it is an escape
 * hatch, not an instruction — and scoped to *stay* updates, because a parent
 * who wants less location reporting must not silently lose their rent
 * reminders and payment links. `commands.ts` enforces that scope.
 */
export const STAY_GUARDIAN_FOOTER = "Stayo · Reply STOP to pause stay updates";

const IST = "Asia/Kolkata";

/**
 * Intl inserts U+202F (narrow no-break space) before the meridiem on newer
 * ICU builds and U+00A0 on some others. A guardian reads one space.
 *
 * Every formatter below is en-US deliberately: en-GB abbreviates September as
 * "Sept", and the approved copy shows "Sep".
 */
function plainSpaces(value: string): string {
  return value.replace(/[  ]/g, " ");
}

/** `{{4}}` of DEPARTURE. Reads after the body's "for". Never empty. */
export function leaveTypeWord(leaveType: string | null | undefined): string {
  return String(leaveType || "").trim().toUpperCase() === "GOING_HOME" ? "home" : "a trip";
}

/** `{{5}}` of DEPARTURE: "Sunday, 28 September". */
export function formatReturnDate(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return "the agreed date";
  // Formatted in UTC: the value is already an IST calendar date, so converting
  // it again would shift it back a day.
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "long" }).format(date);
  return plainSpaces(`${weekday}, ${day} ${month}`);
}

/** `{{4}}` of RETURN: "7:40 PM, 28 Sep", always IST. */
export function formatCheckInTime(instant: string | Date): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) return "today";
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: IST,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: IST, day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en-US", { timeZone: IST, month: "short" }).format(date);
  return plainSpaces(`${time}, ${day} ${month}`);
}

function nonEmpty(value: string | null | undefined, fallback: string): string {
  return String(value || "").trim() || fallback;
}

export type StayDepartureInput = {
  guardianName: string | null | undefined;
  tenantName: string | null | undefined;
  hostelName: string | null | undefined;
  leaveType: string | null | undefined;
  returnDate: string;
};

export function buildStayDeparturePayload(input: StayDepartureInput): string[] {
  return [
    nonEmpty(input.guardianName, "there"),
    tenantDisplayName(String(input.tenantName || "")),
    nonEmpty(input.hostelName, "the hostel"),
    leaveTypeWord(input.leaveType),
    formatReturnDate(input.returnDate),
  ];
}

export type StayReturnInput = {
  guardianName: string | null | undefined;
  tenantName: string | null | undefined;
  hostelName: string | null | undefined;
  checkInAt: string | Date;
};

export function buildStayReturnPayload(input: StayReturnInput): string[] {
  return [
    nonEmpty(input.guardianName, "there"),
    tenantDisplayName(String(input.tenantName || "")),
    nonEmpty(input.hostelName, "the hostel"),
    formatCheckInTime(input.checkInAt),
  ];
}
