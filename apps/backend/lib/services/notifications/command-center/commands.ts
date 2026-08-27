/**
 * The resident/guardian command vocabulary.
 *
 * Five commands replace the old six (BAL, BALANCE, DUES, PAY, STATUS, SWITCH,
 * HELP), and the shape of the change matters more than the count:
 *
 * - `BAL`, `BALANCE`, `DUES` and `STATUS` all answered variations of one
 *   question — "what do I owe and when" — from the same data, and disagreed
 *   with each other in the process. They collapse into `RENT`.
 * - `SWITCH` existed only to escape the invisible 30-minute "active resident"
 *   mode. That mode is gone (selection now travels in the interactive payload,
 *   not in ambient state), so the escape hatch has nothing to escape from.
 * - `PLAN` and `RECEIPT` are new. They are the two things a guardian actually
 *   needs and could not get: how far through the instalments we are, and proof
 *   that the last payment landed.
 *
 * Retired words are kept as **silent aliases** — never advertised, always
 * honoured — because a resident who learned `BAL` last year should not hit a
 * wall today.
 */

/** What a resident or guardian can ask for. */
export const COMMANDS = {
  RENT: "RENT",
  PAY: "PAY",
  PLAN: "PLAN",
  RECEIPT: "RECEIPT",
  HELP: "HELP",
} as const;

export type CommandName = (typeof COMMANDS)[keyof typeof COMMANDS];

/**
 * Words we advertise, in menu order. `RENT` leads because it is the question
 * every other one is a follow-up to.
 */
export const PUBLISHED_COMMANDS: Array<{ name: CommandName; word: string; blurb: string }> = [
  { name: COMMANDS.RENT, word: "RENT", blurb: "What is due, and when" },
  { name: COMMANDS.PAY, word: "PAY", blurb: "Get a secure payment link" },
  { name: COMMANDS.PLAN, word: "PLAN", blurb: "Instalment progress" },
  { name: COMMANDS.RECEIPT, word: "RECEIPT", blurb: "Last payment receipt" },
  { name: COMMANDS.HELP, word: "HELP", blurb: "Show this menu" },
];

/**
 * Every accepted phrase → command. Multi-word keys are matched against the
 * whole normalised message; single words also match a leading token.
 *
 * The retired vocabulary (`BAL`, `BALANCE`, `DUES`, `STATUS`, `SWITCH`) is
 * present and deliberately absent from `PUBLISHED_COMMANDS`.
 */
const VOCABULARY: Record<string, CommandName> = {
  // ── RENT ──────────────────────────────────────────────
  RENT: COMMANDS.RENT,
  DUE: COMMANDS.RENT,
  BAL: COMMANDS.RENT,          // retired, honoured
  BALANCE: COMMANDS.RENT,      // retired, honoured
  DUES: COMMANDS.RENT,         // retired, honoured
  STATUS: COMMANDS.RENT,       // retired, honoured
  SWITCH: COMMANDS.RENT,       // retired, honoured — re-prompts selection
  OUTSTANDING: COMMANDS.RENT,
  "HOW MUCH": COMMANDS.RENT,
  "HOW MUCH DUE": COMMANDS.RENT,
  "HOW MUCH IS DUE": COMMANDS.RENT,
  "RENT DUE": COMMANDS.RENT,
  "PENDING RENT": COMMANDS.RENT,

  // ── PAY ───────────────────────────────────────────────
  PAY: COMMANDS.PAY,
  "PAY NOW": COMMANDS.PAY,
  "PAY RENT": COMMANDS.PAY,
  PAYMENT: COMMANDS.PAY,
  "PAYMENT LINK": COMMANDS.PAY,

  // ── PLAN ──────────────────────────────────────────────
  PLAN: COMMANDS.PLAN,
  SCHEDULE: COMMANDS.PLAN,
  INSTALMENTS: COMMANDS.PLAN,
  INSTALLMENTS: COMMANDS.PLAN,
  INSTALMENT: COMMANDS.PLAN,
  INSTALLMENT: COMMANDS.PLAN,
  EMI: COMMANDS.PLAN,
  "PAYMENT PLAN": COMMANDS.PLAN,

  // ── RECEIPT ───────────────────────────────────────────
  RECEIPT: COMMANDS.RECEIPT,
  RECEIPTS: COMMANDS.RECEIPT,
  PAID: COMMANDS.RECEIPT,
  "LAST PAYMENT": COMMANDS.RECEIPT,
  "PAYMENT HISTORY": COMMANDS.RECEIPT,
  HISTORY: COMMANDS.RECEIPT,

  // ── HELP ──────────────────────────────────────────────
  HELP: COMMANDS.HELP,
  MENU: COMMANDS.HELP,
  COMMANDS: COMMANDS.HELP,
  "?": COMMANDS.HELP,
};

/**
 * Openers that mean "show me the menu" *only when they are the whole message*.
 *
 * They are kept out of the token-level vocabulary on purpose. People routinely
 * greet before asking — "hi, rent?", "hello how much is due" — and if a
 * greeting could win on position, every one of those would be answered with a
 * menu instead of the number the reader actually came for.
 */
const GREETINGS: Record<string, CommandName> = {
  HI: COMMANDS.HELP,
  HII: COMMANDS.HELP,
  HEY: COMMANDS.HELP,
  HELLO: COMMANDS.HELP,
  START: COMMANDS.HELP,
  NAMASTE: COMMANDS.HELP,
};

/** Retired words, for the audit trail and for tests that assert we still take them. */
export const RETIRED_WORDS = ["BAL", "BALANCE", "DUES", "STATUS", "SWITCH"] as const;

function normalise(body: string): string {
  return String(body || "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

/**
 * Map a typed message onto a command, tolerating how people actually type.
 *
 * Order is deliberate — most specific evidence first:
 *   1. the whole message is a known phrase ("how much is due")
 *   2. the whole message is a bare greeting ("hi")
 *   3. the message *opens* with a known word ("pay for aarav please")
 *   4. exactly one known word appears anywhere in it
 *
 * Step 3 requires the match to be unique, so "should I pay now or check the
 * plan" stays unresolved rather than being guessed at. Guessing wrong on a
 * money command is worse than asking.
 */
export function resolveCommand(body: string): CommandName | null {
  const normalised = normalise(body);
  if (!normalised) return null;

  if (VOCABULARY[normalised]) return VOCABULARY[normalised];

  const stripped = normalised.replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  if (stripped && VOCABULARY[stripped]) return VOCABULARY[stripped];

  // A greeting and nothing else — open the menu. A greeting followed by a real
  // question falls through to the vocabulary, which is the whole point.
  if (stripped && GREETINGS[stripped]) return GREETINGS[stripped];

  const tokens = stripped.split(" ").filter(Boolean);
  if (tokens.length === 0) return null;

  if (VOCABULARY[tokens[0]]) return VOCABULARY[tokens[0]];

  const matched = Array.from(
    new Set(tokens.filter((token) => VOCABULARY[token]).map((token) => VOCABULARY[token]))
  );
  return matched.length === 1 ? matched[0] : null;
}
