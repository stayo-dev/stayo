import { afterEach, describe, expect, it } from "vitest";
import {
  GUARDIAN_HEADS_UP_DAYS,
  decideGuardianReminder,
} from "@/lib/services/notifications/command-center/guardian-reminder-policy";
import {
  RENT_REMINDER_TEMPLATES,
  RENT_REMINDER_V2_FOOTER,
  rentReminderGeneration,
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

describe("rent reminder template generations", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("keeps generation 1 live until an approved v2 name is configured", () => {
    delete process.env.WHATSAPP_RENT_DUE_TODAY_TEMPLATE;

    expect(rentReminderGeneration("DUE_TODAY")).toBe("v1");
    expect(rentReminderTemplateName("DUE_TODAY")).toBe("rent_due_today_v1");
    expect(rentReminderParameterNames("DUE_TODAY")).toEqual(["tenant_name", "amount", "rent_month"]);
  });

  it("switches name, language and parameter shape together — never one without the others", () => {
    process.env.WHATSAPP_RENT_DUE_TODAY_TEMPLATE = "stayo_rent_due_today";

    expect(rentReminderGeneration("DUE_TODAY")).toBe("v2");
    expect(rentReminderTemplateName("DUE_TODAY")).toBe("stayo_rent_due_today");
    // Generation 2 adds the hostel name — the reader's trust anchor.
    expect(rentReminderParameterNames("DUE_TODAY")).toContain("hostel_name");
  });

  it("switches each template independently, so approvals need not land together", () => {
    process.env.WHATSAPP_RENT_OVERDUE_TEMPLATE = "stayo_rent_overdue";
    delete process.env.WHATSAPP_RENT_DUE_SOON_TEMPLATE;

    expect(rentReminderGeneration("OVERDUE")).toBe("v2");
    expect(rentReminderGeneration("DUE_SOON")).toBe("v1");
  });

  it("does not treat an unrelated override as a v2 rollout", () => {
    // A name that is not the declared v2 name keeps the v1 parameter shape —
    // sending v2 parameters at a v1 template is a 400 from Meta.
    process.env.WHATSAPP_RENT_OVERDUE_TEMPLATE = "some_other_template";

    expect(rentReminderGeneration("OVERDUE")).toBe("v1");
    expect(rentReminderTemplateName("OVERDUE")).toBe("some_other_template");
    expect(rentReminderParameterNames("OVERDUE")).not.toContain("hostel_name");
  });

  it("carries no 'HMS' anywhere in generation 2, and no instruction to use an app", () => {
    for (const kind of ["DUE_SOON", "DUE_TODAY", "OVERDUE"] as const) {
      const body = RENT_REMINDER_TEMPLATES[kind].v2.body;
      expect(body, kind).not.toContain("HMS");
      // Guardians have no app; the payment button is the whole route.
      expect(body.toLowerCase(), kind).not.toContain("using the app");
      // Every generation-2 body names the hostel.
      expect(body, kind).toContain("{{2}}");
    }

    expect(RENT_REMINDER_V2_FOOTER).not.toContain("HMS");
    expect(RENT_REMINDER_V2_FOOTER).toContain("Stayo");
  });
});
