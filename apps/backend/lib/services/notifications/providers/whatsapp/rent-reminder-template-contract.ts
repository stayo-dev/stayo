/**
 * Rent reminder templates — the one place a Meta template name, its language
 * and its parameter order are written down.
 *
 * ── Why there is no longer a "generation" switch ──
 *
 * This file used to carry two generations per template and choose between
 * them with an environment variable: set `WHATSAPP_RENT_OVERDUE_TEMPLATE` to
 * the approved v2 name and that template started sending the new copy, and
 * "until then v1 keeps sending, unchanged".
 *
 * That last clause was false, and it cost weeks of silence. The v1 names
 * (`rent_due_reminder_v1`, `rent_due_today_v1`, `rent_overdue_warm_v1`,
 * `stayo_payment_receipt_v1`) had never been registered in this WABA at all.
 * The fallback was not a safe older path — it was a guaranteed Meta error
 * 132001, "Template name does not exist in the translation". Every rent
 * reminder and every WhatsApp payment receipt failed from the day the v2
 * templates were submitted until the day the env vars were finally set, and
 * nobody saw it because the owner's dashboard reported "Reminder sent"
 * regardless of what the provider returned.
 *
 * So the fallback is gone, and so are the env vars. A template's name and its
 * parameter vector must change together — a rename is never *just* a rename —
 * which makes them a code change, not configuration. Hard-coding both here
 * means the compiler and `whatsapp-rent-template-contract.test.ts` see any
 * future drift, where an unset environment variable never could.
 *
 * See [[Decisions]] ADR-196 and [[Bugs]].
 *
 * ── Changing a template ──
 *
 * Submit the new body to Meta, wait for APPROVED, then edit the entry here —
 * `name`, `language`, `parameters` and `body` in the same commit. The names
 * below were verified against the live WABA on 2026-09-14 via
 * `GET /{waba-id}/message_templates`; all four are APPROVED in `en`.
 *
 * PURE MODULE. Imports nothing with I/O, so it runs under
 * vitest.pure.config.ts. Keep it that way.
 */

export type RentReminderKind = "DUE_SOON" | "DUE_TODAY" | "OVERDUE" | "PAYMENT_RECEIPT";

export type RentReminderTemplate = {
  /** Exactly as registered at Meta. */
  name: string;
  language: string;
  /**
   * Parameter names in the order Meta's body reads them. The order is the
   * contract: a vector of the right length in the wrong order produces a
   * plausible-looking message about the wrong thing, and Meta cannot catch it.
   */
  parameters: readonly string[];
  /**
   * A copy of the approved body. Not sent anywhere — Meta holds the real one
   * — but it is what the owner dashboard previews, and the test asserts the
   * placeholder count against `parameters`, so it cannot rot silently.
   */
  body: string;
};

export const RENT_REMINDER_TEMPLATES: Record<RentReminderKind, RentReminderTemplate> = {
  DUE_SOON: {
    name: "stayo_rent_due_reminder",
    language: "en",
    parameters: ["tenant_name", "hostel_name", "days_until_due", "amount", "rent_month", "due_date"],
    body:
      "Hello {{1}}, your rent payment at {{2}} is due in {{3}} *day(s)*.\n" +
      "*Amount:* {{4}} Rs *for* {{5}}.\n" +
      "*Due Date:* {{6}}.\n" +
      "_Tap below to pay securely._",
  },
  DUE_TODAY: {
    name: "stayo_rent_due_today",
    language: "en",
    parameters: ["tenant_name", "amount", "rent_month", "hostel_name"],
    body:
      "Hello {{1}}, your rent of {{2}} *for* {{3}} at {{4}} is *due today.*\n" +
      "Pay now to keep your account in good standing.\n" +
      "*Tap below to pay securely.*\n" +
      "Thank You :)",
  },
  OVERDUE: {
    name: "stayo_rent_overdue_reminder",
    language: "en",
    parameters: ["tenant_name", "amount", "rent_month", "hostel_name", "days_overdue"],
    body:
      "Hello {{1}}, your rent of {{2}} for {{3}} at {{4}} is *overdue by* {{5}} *day(s).* " +
      "Please complete the payment at your earliest convenience. " +
      "_Contact the hostel if you need assistance._\n" +
      "*Tap below to pay securely.*",
  },
  PAYMENT_RECEIPT: {
    name: "stayo_payment_receipt",
    language: "en",
    parameters: ["tenant_name", "amount", "rent_month", "hostel_name", "payment_status", "balance_due"],
    body:
      "Hello {{1}}, we have *successfully received your rent payment of* {{2}} *Rs for* {{3}} *at* {{4}}.\n\n" +
      "*Payment Status:* {{5}}\n" +
      "*Balance Due:* ₹{{6}}\n\n" +
      "*Thank you for staying with us :)*",
  },
};

/**
 * The footer every one of these carries at Meta. It replaced `- HMS`, a
 * product name no reader had ever seen: a message about money, from an
 * unrecognised number, signed by an unrecognised brand, is indistinguishable
 * from a scam — and it asks the reader to tap a payment link. The hostel's own
 * name now appears in the body, and Stayo is disclosed as the channel rather
 * than posing as the counterparty.
 */
export const RENT_REMINDER_FOOTER = "Stayo Property Management";

/** One dynamic URL button on every template, carrying the payment-link token. */
export const RENT_REMINDER_BUTTON = {
  label: "Pay Now",
  parameters: ["payment_link_token"] as const,
};

export function rentReminderTemplateName(kind: RentReminderKind): string {
  return RENT_REMINDER_TEMPLATES[kind].name;
}

export function rentReminderTemplateLanguage(kind: RentReminderKind): string {
  return RENT_REMINDER_TEMPLATES[kind].language;
}

/** The parameter names, in the order Meta's body reads them. */
export function rentReminderParameterNames(kind: RentReminderKind): readonly string[] {
  return RENT_REMINDER_TEMPLATES[kind].parameters;
}
