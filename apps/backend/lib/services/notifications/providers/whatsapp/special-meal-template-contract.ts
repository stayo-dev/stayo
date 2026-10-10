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

// ─── "Food's ready" alerts ────────────────────────────────────────────────
//
// Sent when the cook taps Ready, only to residents the food was cooked for.
// Three wordings rotate weekly so the ping never goes stale: the Zomato
// lesson is that a push people *enjoy* reading is one they keep opening.
// Each carries an [I'm on my way] quick reply whose per-send payload opens a
// conversation, which is the point: a resident who answers once is a
// resident who reads the next message.
//
// Names are hard-coded (ADR-196). All three must be approved at Meta; the
// service falls back to the first if a rotated one is rejected.

export interface MealReadyTemplate {
  name: string;
  language: "en";
  parameters: readonly ["tenant_first_name", "dish", "hostel_name"];
  quickReply: string;
  body: string;
}

const READY_PARAMS = ["tenant_first_name", "dish", "hostel_name"] as const;

export const MEAL_READY_TEMPLATES: readonly MealReadyTemplate[] = [
  {
    name: "stayo_meal_ready_hot",
    language: "en",
    parameters: READY_PARAMS,
    quickReply: "I'm on my way",
    body:
      "🔥 It's ready, {{1}}! {{2}} is hot and being served now at {{3}}.\n\n" +
      "Grab your plate before the first round runs out.",
  },
  {
    name: "stayo_meal_ready_wait_over",
    language: "en",
    parameters: READY_PARAMS,
    quickReply: "I'm on my way",
    body:
      "The wait is over, {{1}} 🍽️ {{2}} just came off the stove at {{3}}.\n\n" +
      "Your plate is waiting. Come and get it!",
  },
  {
    name: "stayo_meal_ready_ding",
    language: "en",
    parameters: READY_PARAMS,
    quickReply: "I'm on my way",
    body:
      "Ding ding! 🔔 {{1}}, {{2}} is ready to serve at {{3}}.\n\n" +
      "Hungry? This one's for you. See you at the counter!",
  },
];

/** 1970-01-04 was a Sunday: weeks run Sunday–Saturday, so a hostel's Wednesday and Sunday specials share a wording. */
const FIRST_SUNDAY_DAYS = 3;

export function readyTemplateFor(serveDate: string): MealReadyTemplate {
  const days = Math.floor(Date.parse(`${serveDate}T00:00:00.000Z`) / 86_400_000);
  const week = Math.floor((days - FIRST_SUNDAY_DAYS) / 7);
  const n = MEAL_READY_TEMPLATES.length;
  return MEAL_READY_TEMPLATES[((week % n) + n) % n];
}

export function buildReadyParameters(input: {
  tenantName: string | null | undefined;
  dish: string | null | undefined;
  choice: "VEG" | "NON_VEG";
  hostelName: string | null | undefined;
}): string[] {
  const first = String(input.tenantName || "").trim().split(/\s+/)[0];
  const dish = String(input.dish || "").trim() || (input.choice === "VEG" ? "Today's veg special" : "Today's non-veg special");
  return [first || "there", dish, String(input.hostelName || "").trim() || "the hostel"];
}

const READY_PREFIX = "MEALREADY";

export function encodeReadyPayload(p: { occasionId: string; serveDate: string; tenantId: string }): string {
  return [READY_PREFIX, p.occasionId, p.serveDate, p.tenantId].join(":");
}

export function decodeReadyPayload(raw: string) {
  const parts = String(raw || "").trim().split(":");
  if (parts.length !== 4 || parts[0] !== READY_PREFIX) return null;
  const [, occasionId, serveDate, tenantId] = parts;
  if (!UUID.test(occasionId) || !UUID.test(tenantId) || !ISO_DATE.test(serveDate)) return null;
  return { occasionId, serveDate, tenantId };
}

const ON_MY_WAY_LINES = [
  "🏃 See you at the counter, {name}! Enjoy every bite.",
  "🍽️ Plate's on its way to you, {name}. Enjoy!",
  "😋 Go go go, {name}! Enjoy your meal.",
];

/** The reply to [I'm on my way]. Picked by resident, so one person always gets the same line in a day. */
export function onMyWayReply(tenantName: string | null | undefined, tenantId: string): string {
  const first = String(tenantName || "").trim().split(/\s+/)[0] || "friend";
  let h = 0;
  for (const ch of tenantId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return ON_MY_WAY_LINES[h % ON_MY_WAY_LINES.length].replace("{name}", first);
}
