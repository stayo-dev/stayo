/**
 * Rent reminder templates, generation 2.
 *
 * Three templates carry every rupee this product collects, and all three were
 * wrong in ways no amount of in-app polish compensates for:
 *
 *   rent_due_reminder_v1    "…to avoid late fees. - HMS"
 *   rent_due_today_v1       "…Please pay using the app to avoid late fees. - HMS"
 *   rent_overdue_warm_v1    "…as soon as possible. - HMS"
 *
 * Two defects, both fatal to trust:
 *
 * 1. **`- HMS`.** They are signed by a product name no reader has ever seen.
 *    A message about money, from an unrecognised number, signed by an
 *    unrecognised brand, is indistinguishable from a scam — and the reader is
 *    being asked to tap a payment link. Generation 2 signs with the *hostel's*
 *    own name, which is the only name in this exchange the reader trusts.
 * 2. **"Please pay using the app."** Guardians have no app, and they are the
 *    people most likely to be paying. The message told its most important
 *    reader to do something impossible.
 *
 * ── Why this file cannot simply fix the strings ──
 *
 * A Meta template's body lives at Meta, approved server-side. `templateBody`
 * in `templates.ts` is a local *preview* only — editing it changes what the
 * owner dashboard renders and not one character of what a tenant receives.
 * Correcting these therefore means submitting three new templates for review
 * and switching over once approved.
 *
 * So both generations are defined here and the switch is per-template and
 * environment-driven: set the env var to the approved v2 name and that
 * template starts sending the new copy with the new parameter list. Until
 * then v1 keeps sending, unchanged. There is no flag day and no window where
 * a name and a parameter shape disagree — the generation determines both.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export type RentReminderKind = "DUE_SOON" | "DUE_TODAY" | "OVERDUE" | "PAYMENT_RECEIPT";

export type RentReminderGeneration = "v1" | "v2";

/**
 * Submit these to Meta, then set the matching env var to the approved
 * name. The bodies below are the exact text to submit — they are what the
 * reader will see, and the parameter order here is the order to declare.
 */
export const RENT_REMINDER_TEMPLATES: Record<
  RentReminderKind,
  {
    envVar: string;
    /** Live today. Do not edit — it mirrors what Meta already approved. */
    v1: { name: string; language: string; parameters: readonly string[] };
    /** Pending Meta review. Becomes live when `envVar` is set to its name. */
    v2: { name: string; language: string; parameters: readonly string[]; body: string };
  }
> = {
  DUE_SOON: {
    envVar: "WHATSAPP_RENT_DUE_SOON_TEMPLATE",
    v1: {
      name: "rent_due_reminder_v1",
      language: "en_IN",
      parameters: ["tenant_name", "days_until_due", "amount", "rent_month", "due_date"],
    },
    v2: {
      name: "stayo_rent_due_reminder",
      language: "en",
      parameters: ["tenant_name", "hostel_name", "days_until_due", "amount", "rent_month", "due_date"],
      body:
        "Hello {{1}}, your rent payment at {{2}} is due in {{3}} day(s).\n" +
        "*Amount:* {{4}} Rs *for* {{5}}.\n" +
        "*Due Date:* {{6}}.\n" +
        "Tap below to pay securely..",
    },
  },
  DUE_TODAY: {
    envVar: "WHATSAPP_RENT_DUE_TODAY_TEMPLATE",
    v1: {
      name: "rent_due_today_v1",
      language: "en",
      parameters: ["tenant_name", "amount", "rent_month"],
    },
    v2: {
      name: "stayo_rent_due_today",
      language: "en",
      parameters: ["tenant_name", "amount", "rent_month", "hostel_name"],
      body:
        "Hello {{1}}, your rent of {{2}} *for* {{3}} at {{4}} is *due today.*\n" +
        "Pay now to keep your account in good standing.\n" +
        "*Tap below to pay securely.*\n" +
        "Thank You :)",
    },
  },
  OVERDUE: {
    envVar: "WHATSAPP_RENT_OVERDUE_TEMPLATE",
    v1: {
      name: "rent_overdue_warm_v1",
      language: "en_IN",
      parameters: ["tenant_name", "amount", "rent_month", "due_date", "days_overdue"],
    },
    v2: {
      name: "stayo_rent_overdue_reminder",
      language: "en",
      parameters: ["tenant_name", "amount", "rent_month", "hostel_name", "days_overdue"],
      body:
        "Hello {{1}}, your rent of {{2}} for {{3}} at {{4}} is *overdue by* {{5}} *day(s).* " +
        "Please complete the payment at your earliest convenience. Contact the hostel if you need assistance.\n" +
        "*Tap below to pay securely.*",
    },
  },
  PAYMENT_RECEIPT: {
    envVar: "WHATSAPP_PAYMENT_RECEIPT_TEMPLATE",
    v1: {
      name: "stayo_payment_receipt_v1",
      language: "en",
      parameters: ["tenant_name", "amount", "rent_month", "hostel_name", "payment_status", "balance_due"],
    },
    v2: {
      name: "stayo_payment_receipt",
      language: "en",
      parameters: ["tenant_name", "amount", "rent_month", "hostel_name", "payment_status", "balance_due"],
      body:
        "Hello {{1}}, we have *successfully received your rent payment of* {{2}} *Rs for* {{3}} *at* {{4}}.\n\n" +
        "*Payment Status:* {{5}}\n" +
        "*Balance Due:* ₹{{6}}\n\n" +
        "*Thank you for staying with us :)*",
    },
  },
};

/**
 * All three templates carry the same footer at Meta. It replaces `- HMS` and
 * is the authenticity anchor: the reader recognises their own hostel's name
 * from the body, and Stayo is disclosed as the channel rather than posing as
 * the counterparty.
 */
export const RENT_REMINDER_V2_FOOTER = "Sent via Stayo on behalf of your hostel";

/** One dynamic URL button on every template, carrying the payment-link token. */
export const RENT_REMINDER_V2_BUTTON = {
  label: "Pay securely",
  parameters: ["payment_link_token"] as const,
};

/**
 * Which generation is live for one template. Per-template, so the three can be
 * approved and rolled out independently rather than waiting on the slowest.
 */
export function rentReminderGeneration(kind: RentReminderKind): RentReminderGeneration {
  const configured = String(process.env[RENT_REMINDER_TEMPLATES[kind].envVar] || "").trim();
  return configured && configured === RENT_REMINDER_TEMPLATES[kind].v2.name ? "v2" : "v1";
}

export function rentReminderTemplateName(kind: RentReminderKind): string {
  const entry = RENT_REMINDER_TEMPLATES[kind];
  const configured = String(process.env[entry.envVar] || "").trim();
  return configured || entry.v1.name;
}

export function rentReminderTemplateLanguage(kind: RentReminderKind): string {
  const entry = RENT_REMINDER_TEMPLATES[kind];
  return rentReminderGeneration(kind) === "v2" ? entry.v2.language : entry.v1.language;
}

/** The parameter names, in order, for whichever generation is live. */
export function rentReminderParameterNames(kind: RentReminderKind): readonly string[] {
  const entry = RENT_REMINDER_TEMPLATES[kind];
  return rentReminderGeneration(kind) === "v2" ? entry.v2.parameters : entry.v1.parameters;
}
