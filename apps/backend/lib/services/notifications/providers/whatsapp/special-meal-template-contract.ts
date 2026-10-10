import type { MealChoice } from "@/src/services/meals/special-meal-rules";

/**
 * The special-meal question (spec 2026-10-10). One template, also used as the
 * reminder. Self-dating, because the daily crons fire anywhere in their hour.
 *
 * The three quick replies carry a PER-SEND payload naming the occasion, the
 * serving date and the resident, so a tap on last week's message answers last
 * week (and is refused as closed) and a shared phone cannot answer for the
 * wrong person. Unlike the guardian [Help] button, these payloads are ids, not
 * keywords: they are routed by the MEAL_CHOICE intent before the text vocabulary.
 *
 * Name and language are hard-coded, with no env fallback (ADR-196).
 *
 * PURE MODULE. Imports nothing with I/O.
 */
export const SPECIAL_MEAL_QUESTION_TEMPLATE = {
  name: "stayo_special_meal_question",
  language: "en",
  parameters: ["tenant_first_name", "occasion_label", "dishes", "cutoff_time"] as const,
  quickReplies: [
    { text: "Veg", choice: "VEG" },
    { text: "Non-veg", choice: "NON_VEG" },
    { text: "I'm away", choice: "AWAY" },
  ] as const satisfies readonly { text: string; choice: MealChoice }[],
  body:
    "Hi {{1}}! {{2}} is a special meal: {{3}}.\n" +
    "What would you like? Please answer by {{4}}.\n\n" +
    "If you won't be at the hostel for this meal, tap I'm away and we won't cook for you.",
};

const PREFIX = "MEAL";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHOICES: readonly MealChoice[] = ["VEG", "NON_VEG", "AWAY", "SKIP"];

export function encodeMealPayload(p: { occasionId: string; serveDate: string; tenantId: string; choice: MealChoice }): string {
  return [PREFIX, p.occasionId, p.serveDate, p.tenantId, p.choice].join(":");
}

export function decodeMealPayload(raw: string) {
  const parts = String(raw || "").trim().split(":");
  if (parts.length !== 5 || parts[0] !== PREFIX) return null;
  const [, occasionId, serveDate, tenantId, choice] = parts;
  if (!UUID.test(occasionId) || !UUID.test(tenantId) || !ISO_DATE.test(serveDate)) return null;
  if (!CHOICES.includes(choice as MealChoice)) return null;
  return { occasionId, serveDate, tenantId, choice: choice as MealChoice };
}

const TYPED: Record<string, MealChoice> = {
  veg: "VEG",
  "non veg": "NON_VEG", nonveg: "NON_VEG", nv: "NON_VEG",
  skip: "SKIP",
  away: "AWAY", "im away": "AWAY", "i am away": "AWAY",
};

/** A typed answer, only when the whole message is the answer ("veg biryani was great" is not). */
export function parseTypedChoice(body: string): MealChoice | null {
  const key = String(body || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return TYPED[key] ?? null;
}

function plainSpaces(value: string): string {
  return value.replace(/[  ]/g, " ");
}

const MEAL_WORD: Record<string, string> = { BREAKFAST: "breakfast", LUNCH: "lunch", SNACKS: "snacks", DINNER: "dinner" };

/** "Sunday lunch, 11 Oct". The serve date is already an IST calendar date, so format it in UTC. */
export function occasionLabel(serveDate: string, mealType: string): string {
  const date = new Date(`${serveDate}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" }).format(date);
  return plainSpaces(`${weekday} ${MEAL_WORD[mealType] ?? "meal"}, ${day} ${month}`);
}

/** "9:30 AM", in IST. */
export function formatCutoff(instant: Date): string {
  return plainSpaces(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(instant),
  );
}

export function dishLine(vegDish: string | null, nonVegDish: string | null): string {
  const veg = (vegDish || "").trim();
  const nonVeg = (nonVegDish || "").trim();
  if (veg && nonVeg) return `${nonVeg} or ${veg}`;
  return "veg or non-veg";
}

export function buildQuestionParameters(input: {
  tenantName: string | null | undefined;
  serveDate: string;
  mealType: string;
  vegDish: string | null;
  nonVegDish: string | null;
  cutoffAt: Date;
}): string[] {
  const first = String(input.tenantName || "").trim().split(/\s+/)[0];
  return [
    first || "there",
    occasionLabel(input.serveDate, input.mealType),
    dishLine(input.vegDish, input.nonVegDish),
    formatCutoff(input.cutoffAt),
  ];
}

const CHOICE_WORD: Record<MealChoice, string> = { VEG: "Veg", NON_VEG: "Non-veg", AWAY: "away", SKIP: "skipping" };

/** Sent inside the 24-hour window after a tap or typed answer. */
export function answeredReply(input: { choice: MealChoice; serveDate: string; mealType: string; cutoffAt: Date }): string {
  const label = occasionLabel(input.serveDate, input.mealType);
  const until = `You can change it until ${formatCutoff(input.cutoffAt)}.`;
  if (input.choice === "AWAY") return `✓ Noted, you're away for ${label}. We won't cook for you. ${until}`;
  if (input.choice === "SKIP") return `✓ Noted, you're skipping ${label}. ${until}`;
  return `✓ Got it: ${CHOICE_WORD[input.choice]} for ${label}. ${until}`;
}

export function closedReply(input: { serveDate: string; mealType: string; cutoffAt: Date }): string {
  return `Answers for ${occasionLabel(input.serveDate, input.mealType)} closed at ${formatCutoff(input.cutoffAt)}. Please tell the warden.`;
}
