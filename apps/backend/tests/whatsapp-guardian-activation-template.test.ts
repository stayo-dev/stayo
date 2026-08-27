import { afterEach, describe, expect, it } from "vitest";
import {
  GUARDIAN_ACTIVATION_TEMPLATE,
  buildGuardianActivationPayload,
  guardianActivationTemplateLanguage,
  guardianActivationTemplateName,
  tenantDisplayName,
} from "@/lib/services/notifications/providers/whatsapp/guardian-activation-template-contract";
import { possessive } from "@/lib/services/notifications/command-center/voice";
import { resolveCommand, COMMANDS } from "@/lib/services/notifications/command-center/commands";

describe("guardian activation template contract", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("defaults to the submitted name and language, and honours an override", () => {
    delete process.env.WHATSAPP_GUARDIAN_ACTIVATION_TEMPLATE;
    delete process.env.WHATSAPP_GUARDIAN_ACTIVATION_LANGUAGE;
    expect(guardianActivationTemplateName()).toBe("stayo_guardian_whatsapp_activated");
    expect(guardianActivationTemplateLanguage()).toBe("en");

    process.env.WHATSAPP_GUARDIAN_ACTIVATION_TEMPLATE = "stayo_guardian_activated_v2";
    expect(guardianActivationTemplateName()).toBe("stayo_guardian_activated_v2");
  });

  it("builds the three body parameters in the declared order", () => {
    const params = buildGuardianActivationPayload({
      guardianName: "Shiva",
      tenantName: "Sharan",
      hostelName: "Delux hostel",
    });

    expect(params).toEqual(["Shiva", "Sharan", "Delux hostel"]);
    expect(params).toHaveLength(GUARDIAN_ACTIVATION_TEMPLATE.bodyParameters.length);
  });

  it("never emits an empty parameter — Meta rejects the send outright", () => {
    const params = buildGuardianActivationPayload({
      guardianName: "   ",
      tenantName: null,
      hostelName: undefined,
    });

    expect(params.every((value) => value.trim().length > 0)).toBe(true);
  });
});

describe("{{2}} is a name, never a possessive", () => {
  it("strips a possessive that reaches the builder", () => {
    // The body reads "the guardian for {{2}} at {{3}}" — a possessive here
    // would render "the guardian for Sharan's at Delux hostel".
    expect(tenantDisplayName("Sharan's")).toBe("Sharan");
    expect(tenantDisplayName("Sharan’s")).toBe("Sharan");
    expect(tenantDisplayName("Anders'")).toBe("Anders");
    expect(tenantDisplayName("  Sharan  ")).toBe("Sharan");
  });

  it("undoes exactly what voice.ts::possessive produces, for both name forms", () => {
    for (const name of ["Sharan", "Anders", "Aarav Sharma"]) {
      const subject = { name, hostelName: "Delux hostel", roomNo: "204" };
      const possessiveForm = possessive("GUARDIAN", subject);
      expect(tenantDisplayName(possessiveForm), name).toBe(name);
    }
  });

  it("leaves an ordinary name untouched, including one ending in s", () => {
    expect(tenantDisplayName("Anders")).toBe("Anders");
    expect(tenantDisplayName("Das")).toBe("Das");
  });

  it("falls back to 'your ward' rather than an empty variable", () => {
    expect(tenantDisplayName("")).toBe("your ward");
    expect(tenantDisplayName("   ")).toBe("your ward");
  });
});

describe("the Help quick reply", () => {
  it("carries a plain keyword, not a CC: payload id", () => {
    // A template quick reply is the reader *saying* the word, so it must
    // resolve through the ordinary vocabulary rather than decodePayload.
    expect(GUARDIAN_ACTIVATION_TEMPLATE.quickReply.payload).toBe("Help");
    expect(GUARDIAN_ACTIVATION_TEMPLATE.quickReply.payload).not.toMatch(/^CC:/);
  });

  it("resolves to HELP through the command vocabulary", () => {
    const { payload, text } = GUARDIAN_ACTIVATION_TEMPLATE.quickReply;
    expect(resolveCommand(payload)).toBe(COMMANDS.HELP);
    expect(resolveCommand(text)).toBe(COMMANDS.HELP);
  });
});
