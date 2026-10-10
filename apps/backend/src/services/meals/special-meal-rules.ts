import { addDaysIso, weekdayOfIso } from "@/lib/timezone";
import type { HeadcountLeave } from "@/src/services/stay/stay-board";

/**
 * Special-meal choices — the rules, with no I/O (spec 2026-10-10).
 *
 * Two facts decide everything, in this order: is the resident here for this
 * serving (Stay's leaves and the move-out date), and what did they say. A
 * preference never overrides absence, and nothing is guessed — a silent
 * resident is cooked for only under LAST_CHOICE, and is labelled so.
 */

export type MealChoice = "VEG" | "NON_VEG" | "AWAY" | "SKIP";
export const MEAL_CHOICES: readonly MealChoice[] = ["VEG", "NON_VEG", "AWAY", "SKIP"];
export const isMealChoice = (v: unknown): v is MealChoice => MEAL_CHOICES.includes(v as MealChoice);

export type NoAnswerPolicy = "LAST_CHOICE" | "LEAVE_OUT";
export const isNoAnswerPolicy = (v: unknown): v is NoAnswerPolicy => v === "LAST_CHOICE" || v === "LEAVE_OUT";

export type Presence = "MOVED_OUT" | "ON_LEAVE" | "RETURNING" | "HERE";

export interface MealResident {
  tenantId: string;
  name: string;
  roomNo: string;
  /** `tenants.exit_date` as YYYY-MM-DD: the move-out day. Gone on and after it. */
  exitDate: string | null;
  phone: string | null;
}

/**
 * Where a resident is for one serving. Same leave convention as `headcountOn`:
 * covered while `start <= date < return`, and back (RETURNING) on the return date.
 */
export function presenceOn(input: {
  tenantId: string;
  exitDate: string | null;
  leaves: HeadcountLeave[];
  serveDate: string;
}): Presence {
  const { tenantId, exitDate, leaves, serveDate } = input;
  if (exitDate && exitDate <= serveDate) return "MOVED_OUT";
  const own = leaves.filter((l) => l.tenantId === tenantId);
  if (own.some((l) => l.startDate <= serveDate && l.expectedReturnDate > serveDate)) return "ON_LEAVE";
  if (own.some((l) => l.startDate < serveDate && l.expectedReturnDate === serveDate)) return "RETURNING";
  return "HERE";
}

/** Who gets the question (or the reminder): here or returning, reachable, not yet answered. */
export function askAudience(input: {
  serveDate: string;
  residents: MealResident[];
  leaves: HeadcountLeave[];
  answered: Set<string>;
}): Array<{ tenantId: string; name: string; phone: string; returning: boolean }> {
  const out: Array<{ tenantId: string; name: string; phone: string; returning: boolean }> = [];
  for (const r of input.residents) {
    if (input.answered.has(r.tenantId)) continue;
    const phone = (r.phone || "").trim();
    if (!phone) continue;
    const presence = presenceOn({ tenantId: r.tenantId, exitDate: r.exitDate, leaves: input.leaves, serveDate: input.serveDate });
    if (presence === "MOVED_OUT" || presence === "ON_LEAVE") continue;
    out.push({ tenantId: r.tenantId, name: r.name, phone, returning: presence === "RETURNING" });
  }
  return out;
}

export type PersonBasis = "CONFIRMED" | "LAST_CHOICE" | "NO_ANSWER" | "ON_LEAVE";

export interface CountPerson {
  tenantId: string;
  name: string;
  roomNo: string;
  choice: MealChoice | null;
  basis: PersonBasis;
  source: "WHATSAPP" | "OWNER" | null;
}

export interface MealCount {
  cook: { veg: number; nonVeg: number };
  confirmed: number;
  lastChoice: number;
  noAnswer: number;
  skipping: number;
  awaySaid: number;
  onLeave: number;
  people: CountPerson[];
}

export function buildMealCount(input: {
  serveDate: string;
  policy: NoAnswerPolicy;
  residents: MealResident[];
  leaves: HeadcountLeave[];
  answers: Map<string, { choice: MealChoice; source: "WHATSAPP" | "OWNER" }>;
  lastChoices: Map<string, "VEG" | "NON_VEG">;
}): MealCount {
  const count: MealCount = {
    cook: { veg: 0, nonVeg: 0 },
    confirmed: 0, lastChoice: 0, noAnswer: 0, skipping: 0, awaySaid: 0, onLeave: 0,
    people: [],
  };
  const add = (choice: MealChoice | null) => {
    if (choice === "VEG") count.cook.veg += 1;
    if (choice === "NON_VEG") count.cook.nonVeg += 1;
  };

  for (const r of input.residents) {
    const presence = presenceOn({ tenantId: r.tenantId, exitDate: r.exitDate, leaves: input.leaves, serveDate: input.serveDate });
    if (presence === "MOVED_OUT") continue;
    const person = { tenantId: r.tenantId, name: r.name, roomNo: r.roomNo };

    if (presence === "ON_LEAVE") {
      count.onLeave += 1;
      count.people.push({ ...person, choice: null, basis: "ON_LEAVE", source: null });
      continue;
    }

    const answer = input.answers.get(r.tenantId);
    if (answer) {
      count.confirmed += 1;
      if (answer.choice === "AWAY") count.awaySaid += 1;
      if (answer.choice === "SKIP") count.skipping += 1;
      add(answer.choice);
      count.people.push({ ...person, choice: answer.choice, basis: "CONFIRMED", source: answer.source });
      continue;
    }

    const last = input.policy === "LAST_CHOICE" ? input.lastChoices.get(r.tenantId) : undefined;
    if (last) {
      count.lastChoice += 1;
      add(last);
      count.people.push({ ...person, choice: last, basis: "LAST_CHOICE", source: null });
      continue;
    }

    count.noAnswer += 1;
    count.people.push({ ...person, choice: null, basis: "NO_ANSWER", source: null });
  }

  count.people.sort((a, b) => a.roomNo.localeCompare(b.roomNo, "en", { numeric: true }) || a.name.localeCompare(b.name));
  return count;
}

/** The next date (today included) that falls on `weekday` (0 = Sunday). */
export function nextServeDate(weekday: number, today: string): string {
  const delta = (weekday - weekdayOfIso(today) + 7) % 7;
  return addDaysIso(today, delta);
}

const IST_OFFSET_MINUTES = 330;

/** When answers close: the meal's IST start time minus `minutesBefore`, as an instant. */
export function cutoffInstant(serveDate: string, mealStart: string, minutesBefore: number): Date {
  const [y, m, d] = serveDate.split("-").map(Number);
  const [hh, mm] = mealStart.split(":").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MINUTES * 60_000 - minutesBefore * 60_000;
  return new Date(utcMs);
}
