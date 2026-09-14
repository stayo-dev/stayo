import { describe, it, expect, beforeEach, afterAll } from "vitest";
import {
  RENT_REMINDER_TEMPLATES,
  RentReminderKind,
  rentReminderTemplateLanguage,
  rentReminderTemplateName,
  rentReminderParameterNames,
} from "@/lib/services/notifications/providers/whatsapp/rent-reminder-template-contract";
import {
  WhatsAppRentReminderTemplate,
  buildRentReminderBodyParameters,
  getMetaTemplateLanguage,
  getMetaTemplateName,
  selectRentReminderTemplate,
} from "@/lib/services/notifications/providers/whatsapp/templates";

/**
 * These four names were read back from the live WABA on 2026-09-14 via
 * `GET /{waba-id}/message_templates` — every one APPROVED, every one `en`.
 *
 * The outage this file exists to prevent: the code shipped names that had
 * never been registered (`rent_overdue_warm_v1` and friends), so every rent
 * reminder and every WhatsApp payment receipt failed with Meta error 132001
 * — silently, because the owner UI reported success regardless.
 */
const APPROVED: Record<RentReminderKind, { name: string; language: string }> = {
  DUE_SOON: { name: "stayo_rent_due_reminder", language: "en" },
  DUE_TODAY: { name: "stayo_rent_due_today", language: "en" },
  OVERDUE: { name: "stayo_rent_overdue_reminder", language: "en" },
  PAYMENT_RECEIPT: { name: "stayo_payment_receipt", language: "en" },
};

const KINDS = Object.keys(APPROVED) as RentReminderKind[];

const ENV_VARS = [
  "WHATSAPP_RENT_DUE_SOON_TEMPLATE",
  "WHATSAPP_RENT_DUE_TODAY_TEMPLATE",
  "WHATSAPP_RENT_OVERDUE_TEMPLATE",
  "WHATSAPP_PAYMENT_RECEIPT_TEMPLATE",
];

const saved = ENV_VARS.map((k) => [k, process.env[k]] as const);

beforeEach(() => {
  for (const k of ENV_VARS) delete process.env[k];
});

afterAll(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("rent reminder template contract", () => {
  it("resolves the approved name with no environment configuration at all", () => {
    for (const kind of KINDS) {
      expect(rentReminderTemplateName(kind)).toBe(APPROVED[kind].name);
      expect(rentReminderTemplateLanguage(kind)).toBe(APPROVED[kind].language);
    }
  });

  it("declares no template that is not approved at Meta", () => {
    for (const kind of KINDS) {
      expect(RENT_REMINDER_TEMPLATES[kind].name).toBe(APPROVED[kind].name);
      expect(RENT_REMINDER_TEMPLATES[kind].language).toBe(APPROVED[kind].language);
    }
  });

  it("declares exactly as many parameters as its body has placeholders", () => {
    for (const kind of KINDS) {
      const { body, parameters } = RENT_REMINDER_TEMPLATES[kind];
      const found = (body.match(/\{\{(\d+)\}\}/g) || []).map((m) =>
        Number(m.replace(/\D/g, ""))
      );
      const placeholders = Array.from(new Set(found)).sort((a, b) => a - b);
      expect(placeholders.length, kind).toBe(parameters.length);
      // Placeholders must be 1..N with no gaps, or Meta rejects the send.
      expect(placeholders, kind).toEqual(parameters.map((_, i) => i + 1));
    }
  });

  it("names the hostel in every reminder a resident or guardian reads", () => {
    for (const kind of KINDS) {
      expect(rentReminderParameterNames(kind)).toContain("hostel_name");
    }
  });
});

const variables = {
  obligationId: "ob-1",
  tenantName: "Demo Tenant",
  hostelName: "Sri Adithya Boys Hostel",
  amount: 16000,
  rentMonth: new Date("2026-09-01T00:00:00Z"),
  dueDate: new Date("2026-09-01T00:00:00Z"),
  prefs: {},
};

describe("rent reminder body parameters", () => {
  /**
   * Positions are asserted individually rather than as a snapshot: the whole
   * failure mode was a parameter vector whose *length* was right and whose
   * *order* was wrong, which reads as a plausible message and bills the
   * wrong story to the reader.
   */
  it("builds the overdue vector in the order the approved body reads", () => {
    const template = selectRentReminderTemplate(13);
    expect(getMetaTemplateName(template)).toBe("stayo_rent_overdue_reminder");
    expect(getMetaTemplateLanguage(template)).toBe("en");

    const params = buildRentReminderBodyParameters({ ...variables, daysOverdue: 13 });
    // "Hello {{1}}, your rent of {{2}} for {{3}} at {{4}} is overdue by {{5}} day(s)."
    expect(params).toHaveLength(5);
    expect(params[0]).toBe("Demo Tenant");
    expect(params[3]).toBe("Sri Adithya Boys Hostel");
    expect(params[4]).toBe("13");
  });

  it("builds the due-today vector with the hostel last", () => {
    const template = selectRentReminderTemplate(0);
    expect(getMetaTemplateName(template)).toBe("stayo_rent_due_today");

    const params = buildRentReminderBodyParameters({ ...variables, daysOverdue: 0 });
    // "Hello {{1}}, your rent of {{2}} for {{3}} at {{4}} is due today."
    expect(params).toHaveLength(4);
    expect(params[0]).toBe("Demo Tenant");
    expect(params[3]).toBe("Sri Adithya Boys Hostel");
  });

  it("builds the due-soon vector with the hostel second", () => {
    const template = selectRentReminderTemplate(-3);
    expect(getMetaTemplateName(template)).toBe("stayo_rent_due_reminder");

    const params = buildRentReminderBodyParameters({ ...variables, daysOverdue: -3 });
    // "Hello {{1}}, your rent payment at {{2}} is due in {{3}} day(s)..."
    expect(params).toHaveLength(6);
    expect(params[0]).toBe("Demo Tenant");
    expect(params[1]).toBe("Sri Adithya Boys Hostel");
    expect(params[2]).toBe("3");
  });

  it("sends as many parameters as the template declares, for every kind", () => {
    const cases: Array<[WhatsAppRentReminderTemplate, number]> = [
      [WhatsAppRentReminderTemplate.RENT_DUE_REMINDER, -3],
      [WhatsAppRentReminderTemplate.RENT_DUE_TODAY, 0],
      [WhatsAppRentReminderTemplate.RENT_OVERDUE_REMINDER, 13],
    ];
    for (const [template, daysOverdue] of cases) {
      const params = buildRentReminderBodyParameters({ ...variables, daysOverdue });
      const declared = rentReminderParameterNames(
        template === WhatsAppRentReminderTemplate.RENT_DUE_REMINDER
          ? "DUE_SOON"
          : template === WhatsAppRentReminderTemplate.RENT_DUE_TODAY
            ? "DUE_TODAY"
            : "OVERDUE"
      );
      expect(params).toHaveLength(declared.length);
    }
  });

  it("ignores a stale environment override rather than sending an unknown name", () => {
    process.env.WHATSAPP_RENT_OVERDUE_TEMPLATE = "rent_overdue_warm_v1";
    expect(rentReminderTemplateName("OVERDUE")).toBe("stayo_rent_overdue_reminder");
  });
});
