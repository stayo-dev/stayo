import { afterEach, describe, expect, it } from "vitest";
import {
  GUARDIAN_HEADS_UP_DAYS,
  decideGuardianReminder,
} from "@/lib/services/notifications/command-center/guardian-reminder-policy";
import {
  RENT_REMINDER_FOOTER,
  RENT_REMINDER_TEMPLATES,
  rentReminderParameterNames,
  rentReminderTemplateName,
} from "@/lib/services/notifications/providers/whatsapp/rent-reminder-template-contract";

/** Stand-in for `normalizeWhatsAppPhone` — same job, no I/O. */
const normalise = (phone: string) => String(phone || "").replace(/\D/g, "").slice(-10);

const decide = (daysOverdue: number, guardianPhone: string | null = "9876500999") =>
  decideGuardianReminder({
    daysOverdue,
    guardianPhone,
    residentPhone: "+919876500123",
    normalise,
  });

describe("guardian reminder policy", () => {
  it("reaches the guardian BEFORE the due date — the message that collects on time", () => {
    // The rule this replaces (`daysOverdue >= 3`) meant a guardian's very first
    // contact was always about money already late.
    expect(decide(-1)).toEqual({ notify: true, reason: "HEADS_UP" });
    expect(decide(-GUARDIAN_HEADS_UP_DAYS)).toEqual({ notify: true, reason: "HEADS_UP" });
  });

  it("stays quiet while the bill is still far off", () => {
    expect(decide(-(GUARDIAN_HEADS_UP_DAYS + 1))).toEqual({ notify: false, reason: "TOO_EARLY" });
    expect(decide(-30)).toEqual({ notify: false, reason: "TOO_EARLY" });
  });

  it("includes the guardian on the due day", () => {
    expect(decide(0)).toEqual({ notify: true, reason: "DUE_TODAY" });
  });

  it("escalates from the first overdue day, not the third", () => {
    expect(decide(1)).toEqual({ notify: true, reason: "OVERDUE" });
    expect(decide(2)).toEqual({ notify: true, reason: "OVERDUE" });
    expect(decide(30)).toEqual({ notify: true, reason: "OVERDUE" });
  });

  it("does nothing when no guardian is on file", () => {
    expect(decide(5, null)).toEqual({ notify: false, reason: "NO_GUARDIAN_PHONE" });
    expect(decide(5, "   ")).toEqual({ notify: false, reason: "NO_GUARDIAN_PHONE" });
  });

  it("never sends the same reminder twice to one handset", () => {
    // The schema stores phones inconsistently, so this has to compare
    // normalised digits rather than raw strings.
    expect(decide(5, "+919876500123")).toEqual({ notify: false, reason: "SAME_AS_RESIDENT" });
    expect(decide(5, "9876500123")).toEqual({ notify: false, reason: "SAME_AS_RESIDENT" });
    expect(decide(5, "919876500123")).toEqual({ notify: false, reason: "SAME_AS_RESIDENT" });
  });
});

describe("rent reminder template copy", () => {
  /**
   * The generation switch these tests used to cover is gone (ADR-196). It
   * chose between an approved template and a `*_v1` name that had never
   * existed in this WABA, so its "safe" default was a guaranteed Meta 132001.
   * Name, language and parameter order now live in one entry per template and
   * are asserted against the live WABA listing in
   * `whatsapp-rent-template-contract.test.ts`.
   */
  it("resolves a name without reading the environment", () => {
    delete process.env.WHATSAPP_RENT_DUE_TODAY_TEMPLATE;
    expect(rentReminderTemplateName("DUE_TODAY")).toBe("stayo_rent_due_today");
  });

  it("names the hostel in every reminder — the reader's trust anchor", () => {
    for (const kind of ["DUE_SOON", "DUE_TODAY", "OVERDUE", "PAYMENT_RECEIPT"] as const) {
      expect(rentReminderParameterNames(kind), kind).toContain("hostel_name");
    }
  });

  it("carries no 'HMS' anywhere, and no instruction to use an app", () => {
    for (const kind of ["DUE_SOON", "DUE_TODAY", "OVERDUE"] as const) {
      const body = RENT_REMINDER_TEMPLATES[kind].body;
      expect(body, kind).not.toContain("HMS");
      // Guardians have no app; the payment button is the whole route.
      expect(body.toLowerCase(), kind).not.toContain("using the app");
    }

    expect(RENT_REMINDER_FOOTER).not.toContain("HMS");
    expect(RENT_REMINDER_FOOTER).toContain("Stayo");
  });
});
