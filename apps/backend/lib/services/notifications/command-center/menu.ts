/**
 * Buttons, menus, and the resident picker.
 *
 * The single most important thing in this file is the payload scheme: every
 * action a reader can tap carries **which resident it is about**, inside the
 * payload itself.
 *
 * The system this replaces kept that selection in Redis as a 30-minute
 * "active resident" mode. A guardian with two children in the same hostel was
 * therefore inside an invisible mode they could not inspect: ask about one
 * child, wait thirty-one minutes, ask again, and the answer silently switched
 * to the other. Wrong child, right formatting, no warning — the same failure
 * class as the "first hostel as fallback" bug that
 * `architectural-invariants-check.ts` exists to prevent. Encoding the subject in the payload removes the mode, and
 * with it the `SWITCH` command whose only job was escaping it.
 *
 * Pure — returns descriptors, sends nothing.
 */

import { COMMANDS, CommandName, PUBLISHED_COMMANDS } from "./commands";
import { Audience, Subject, compose, lines, rupees, signature, subjectLine } from "./voice";

/** WhatsApp's own limits. Exceeding any of these is a 400 from Meta, not a warning. */
export const LIMITS = {
  BUTTON_TITLE: 20,
  BUTTONS_PER_MESSAGE: 3,
  LIST_ROW_TITLE: 24,
  LIST_ROW_DESCRIPTION: 72,
  LIST_ROWS: 10,
  PAYLOAD_ID: 200,
} as const;

export const PAYLOAD_PREFIX = "CC";

export type Button = { id: string; title: string };
export type ListRow = { id: string; title: string; description?: string };

/**
 * `CC:PAY:<tenantId>` — the command and its subject, together, always.
 *
 * An optional fourth segment carries *which one* when a command needs it:
 * `CC:RECEIPT:<tenantId>:<paymentId>` names the payment a reader picked out of
 * their history. Two UUIDs plus the prefix is ~85 characters, well inside
 * WhatsApp's 200-character ceiling, which the guard below enforces anyway.
 */
export function encodePayload(
  command: CommandName,
  tenantId?: string | null,
  ref?: string | null
): string {
  const segments = [PAYLOAD_PREFIX, command];
  if (tenantId) {
    segments.push(tenantId);
    if (ref) segments.push(ref);
  }
  const payload = segments.join(":");
  if (payload.length > LIMITS.PAYLOAD_ID) {
    throw new Error(`Command-center payload exceeds ${LIMITS.PAYLOAD_ID} characters: ${payload}`);
  }
  return payload;
}

export type DecodedPayload = {
  command: CommandName;
  tenantId: string | null;
  /** The specific thing the reader picked — a payment id, for `RECEIPT`. */
  ref: string | null;
};

export function decodePayload(raw: string): DecodedPayload | null {
  const parts = String(raw || "").trim().split(":");
  if (parts[0] !== PAYLOAD_PREFIX || parts.length < 2) return null;

  const command = parts[1]?.toUpperCase();
  if (!command || !(command in COMMANDS)) return null;

  return {
    command: COMMANDS[command as keyof typeof COMMANDS],
    tenantId: parts[2] || null,
    ref: parts[3] || null,
  };
}

/** Truncate to a hard limit without producing a bare ellipsis mid-word. */
function fit(text: string, limit: number): string {
  const clean = String(text || "").trim();
  if (clean.length <= limit) return clean;
  return `${clean.slice(0, limit - 1).trimEnd()}…`;
}

/**
 * The actions offered after an answer. Never more than three (WhatsApp's
 * ceiling), and never one the reader has no use for — a settled account is not
 * offered a payment button, which is what made the old fixed
 * `[View Dues][Pay Now][Switch Resident]` row feel like boilerplate.
 */
export function actionsFor(options: {
  command: CommandName;
  tenantId: string | null;
  payableNow: number;
  hasPayments: boolean;
}): Button[] {
  const { command, tenantId, payableNow, hasPayments } = options;
  const buttons: Button[] = [];

  const payButton: Button = {
    id: encodePayload(COMMANDS.PAY, tenantId),
    // The amount lives on the button: the reader commits to a number, not to
    // an unknown. "Pay ₹8,000" and "Pay now" are not the same promise.
    title: fit(payableNow > 0 ? `Pay ${rupees(payableNow)}` : "Pay now", LIMITS.BUTTON_TITLE),
  };
  const planButton: Button = {
    id: encodePayload(COMMANDS.PLAN, tenantId),
    title: "Instalments",
  };
  const receiptButton: Button = {
    id: encodePayload(COMMANDS.RECEIPT, tenantId),
    title: "Last receipt",
  };
  const rentButton: Button = {
    id: encodePayload(COMMANDS.RENT, tenantId),
    title: "What's due",
  };

  if (command !== COMMANDS.PAY && payableNow > 0) buttons.push(payButton);
  if (command !== COMMANDS.RENT && command !== COMMANDS.HELP) buttons.push(rentButton);
  if (command !== COMMANDS.PLAN) buttons.push(planButton);
  if (hasPayments && command !== COMMANDS.RECEIPT) buttons.push(receiptButton);

  return buttons.slice(0, LIMITS.BUTTONS_PER_MESSAGE);
}

/**
 * The picker shown when a phone maps to more than one resident — a guardian
 * paying for two siblings, most often. Every row states the room and what that
 * resident owes, so the choice is made on the facts rather than on a name
 * alone, and the tap carries both the resident and the action forward.
 */
export function residentPicker(options: {
  command: CommandName;
  residents: Array<{ tenantId: string; name: string; roomNo: string | null; payableNow: number }>;
}): { body: string; rows: ListRow[] } {
  const rows = options.residents.slice(0, LIMITS.LIST_ROWS).map((resident) => {
    const place = resident.roomNo ? `Room ${resident.roomNo}` : "Room not assigned";
    const money =
      resident.payableNow > 0 ? `${rupees(resident.payableNow)} due` : "Nothing due";
    return {
      id: encodePayload(options.command, resident.tenantId),
      title: fit(resident.name, LIMITS.LIST_ROW_TITLE),
      description: fit(`${place} · ${money}`, LIMITS.LIST_ROW_DESCRIPTION),
    };
  });

  return { body: "Which resident is this about?", rows };
}

/**
 * "Which payment?" — shown when a reader asks for a receipt and has made more
 * than one payment.
 *
 * Asking is only worth a turn when there is a genuine choice: a reader with a
 * single payment gets that receipt straight away, and one with none is told so
 * rather than handed an empty list. Rows lead with the amount and date, since
 * that is what someone actually remembers about a payment they made.
 */
export function paymentPicker(options: {
  tenantId: string;
  payments: Array<{
    paymentId: string;
    amount: string;
    paidOn: string | null;
    towards: string | null;
  }>;
}): { body: string; rows: ListRow[] } {
  const rows = options.payments.slice(0, LIMITS.LIST_ROWS).map((payment) => ({
    id: encodePayload(COMMANDS.RECEIPT, options.tenantId, payment.paymentId),
    title: fit(payment.paidOn ? `${payment.amount} · ${payment.paidOn}` : payment.amount, LIMITS.LIST_ROW_TITLE),
    description: fit(payment.towards || "Payment received", LIMITS.LIST_ROW_DESCRIPTION),
  }));

  return { body: "Which payment do you need the receipt for?", rows };
}

/**
 * `HELP`. Opens with what the reader can do rather than with a greeting,
 * and — for a guardian — names the residents they are recognised for, because
 * "am I even connected to the right child" is the question underneath.
 */
export function helpMessage(options: {
  audience: Audience;
  subject: Subject | null;
  residentNames: string[];
}): string {
  const { audience, subject, residentNames } = options;

  const opening =
    audience === "GUARDIAN"
      ? residentNames.length === 1
        ? `You are set up to manage rent for *${residentNames[0]}*.`
        : residentNames.length > 1
          ? `You are set up to manage rent for *${residentNames.join("*, *")}*.`
          : "You are set up to manage rent here."
      : "Here is what you can do from this chat.";

  const vocabulary = PUBLISHED_COMMANDS.map(
    (entry) => `*${entry.word}* — ${entry.blurb}`
  ).join("\n");

  return compose(
    subject ? subjectLine(audience, subject) : null,
    opening,
    vocabulary,
    "Tap a button below, or just send one of these words.",
    subject ? signature(subject) : null
  );
}

/**
 * Nothing matched. Answers with the two things worth knowing rather than with
 * an apology — the old reply opened "Sorry — I didn't understand that", which
 * spends the reader's attention telling them the system failed.
 */
export function unrecognisedMessage(options: { audience: Audience; subject: Subject | null }): string {
  return compose(
    options.subject ? subjectLine(options.audience, options.subject) : null,
    lines(
      "That one is not something this chat can answer.",
      "",
      "Send *RENT* to see what is due, or *HELP* for everything else."
    ),
    options.subject ? signature(options.subject) : null
  );
}

/**
 * The number is not connected to anyone. Addresses guardians explicitly —
 * the old copy offered only "if you're a resident…" and "if you're an owner…",
 * leaving the one reader most likely to be here with no instruction at all.
 */
export function unknownSenderMessage(): string {
  return lines(
    "This number is not connected to a Stayo account yet, so there is nothing to look up.",
    "",
    "*If you are a parent or guardian* — ask the hostel to add this number as the guardian contact on the resident's profile. Rent updates and payment links will then come here.",
    "",
    "*If you are a resident* — ask the hostel to add this number to your profile.",
    "",
    "*If you are a hostel owner* — send LINK followed by the code shown in your Stayo dashboard."
  );
}
