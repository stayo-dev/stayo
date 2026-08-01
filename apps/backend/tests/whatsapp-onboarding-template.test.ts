import { describe, expect, it, afterEach } from "vitest";
import {
  ONBOARDING_TEMPLATE_CONTRACT,
  assertOnboardingTemplateMatchesContract,
  onboardingTemplateLanguage,
  onboardingTemplateName,
} from "../lib/services/notifications/providers/whatsapp/onboarding-template-contract";
import {
  ONBOARDING_COMPLETED_TEMPLATE_NAME,
  buildTenantOnboardingTemplatePayload,
} from "../lib/services/notifications/providers/whatsapp/templates";

/**
 * Tenant onboarding-complete template.
 *
 * `ONBOARDING_COMPLETED_TEMPLATE_NAME` was `tenant_onboarding_completed_v1` —
 * a template that does not exist in this WABA — and the handler hardcoded
 * `en_IN` while the approved template is published as `en`. Every
 * post-activation message therefore failed at Meta. Same bug class as the
 * invitation template, one flow over.
 *
 * Read from the live Graph API rather than the WhatsApp Manager UI:
 *   stayo_tenant_onboarding_complete | en | APPROVED | body=6 | button=URL (static)
 */

const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** The approved template exactly as the Graph API returns it. */
function liveTemplate(overrides: Record<string, unknown> = {}) {
  return {
    name: "stayo_tenant_onboarding_complete",
    status: "APPROVED",
    category: "UTILITY",
    language: "en",
    components: [
      { type: "HEADER", text: "Admission Confirmed" },
      {
        type: "BODY",
        text:
          "Hello {{1}}, your admission at {{2}} is complete. \nRoom: {{3}}. \nJoining Date: {{4}}. " +
          "\nMonthly Rent: {{5}}. \nRent is due on the {{6}} of every month. " +
          "\nType BAL anytime to check your payment status.",
      },
      { type: "FOOTER", text: "Stayo Property Management" },
      // Static URL — no {{1}} — so no button parameter may be sent.
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Open Dashboard", url: "https://yourstayo.com/" }] },
    ],
    ...overrides,
  };
}

describe("onboarding template name and language", () => {
  it("points at the template that actually exists in the WABA", () => {
    expect(ONBOARDING_COMPLETED_TEMPLATE_NAME).toBe("stayo_tenant_onboarding_complete");
  });

  it("resolves the same name through the contract helper", () => {
    delete process.env.WHATSAPP_ONBOARDING_TEMPLATE;
    expect(onboardingTemplateName()).toBe("stayo_tenant_onboarding_complete");
  });

  // en and en_IN are different templates to Meta (#132001).
  it("defaults to en, the language the template is published in", () => {
    delete process.env.WHATSAPP_ONBOARDING_LANGUAGE;
    expect(onboardingTemplateLanguage()).toBe("en");
  });

  it("allows env overrides", () => {
    process.env.WHATSAPP_ONBOARDING_TEMPLATE = "other";
    process.env.WHATSAPP_ONBOARDING_LANGUAGE = "en_IN";
    expect(onboardingTemplateName()).toBe("other");
    expect(onboardingTemplateLanguage()).toBe("en_IN");
  });

  it("ignores the retired name if still set in a deployed environment", () => {
    process.env.WHATSAPP_ONBOARDING_TEMPLATE = "tenant_onboarding_completed_v1";
    expect(onboardingTemplateName()).toBe("stayo_tenant_onboarding_complete");
  });
});

describe("contract", () => {
  it("declares the six body parameters in template order", () => {
    expect(ONBOARDING_TEMPLATE_CONTRACT.bodyParameters).toEqual([
      "tenant_name",
      "hostel_name",
      "room_number",
      "joining_date",
      "monthly_rent",
      "rent_due_day",
    ]);
  });

  // The button URL is static, so sending a button component would be rejected.
  it("declares no button parameters", () => {
    expect(ONBOARDING_TEMPLATE_CONTRACT.buttonParameters).toEqual([]);
  });
});

describe("buildTenantOnboardingTemplatePayload", () => {
  const input = {
    tenantName: "Shiva",
    hostelName: "Delux Hostel",
    roomNumber: "G4",
    joiningDate: new Date("2025-06-21T00:00:00Z"),
    monthlyRent: 8500,
    rentDueDay: 7,
  };

  it("produces exactly six parameters, matching the template", () => {
    expect(buildTenantOnboardingTemplatePayload(input)).toHaveLength(
      ONBOARDING_TEMPLATE_CONTRACT.bodyParameters.length,
    );
  });

  it("orders them as {{1}}..{{6}}", () => {
    const [name, hostel, room, , rent, dueDay] = buildTenantOnboardingTemplatePayload(input);

    expect(name).toBe("Shiva");
    expect(hostel).toBe("Delux Hostel");
    expect(room).toBe("G4");
    // Formatted for display by `formatTemplateAmount` — "8,500", not "8500".
    expect(rent).toBe("8,500");
    expect(dueDay).toBe("7");
  });

  it("never emits an empty parameter — Meta rejects those", () => {
    const params = buildTenantOnboardingTemplatePayload({
      tenantName: "",
      hostelName: "",
      roomNumber: "",
      joiningDate: "",
      monthlyRent: 0,
      rentDueDay: 0,
    });

    expect(params).toHaveLength(6);
    expect(params.every((p) => String(p).trim().length > 0)).toBe(true);
  });

  it("clamps an out-of-range rent due day into 1–28", () => {
    expect(buildTenantOnboardingTemplatePayload({ ...input, rentDueDay: 31 })[5]).toBe("28");
    expect(buildTenantOnboardingTemplatePayload({ ...input, rentDueDay: 0 })[5]).toBe("1");
  });
});

describe("assertOnboardingTemplateMatchesContract", () => {
  it("accepts the live approved template", () => {
    const shape = assertOnboardingTemplateMatchesContract(liveTemplate() as any);
    expect(shape.bodyParameterCount).toBe(6);
  });

  it("fails loudly if the body loses a variable", () => {
    const drifted = liveTemplate({
      components: [{ type: "BODY", text: "Hello {{1}}, your admission at {{2}} is complete." }],
    });

    expect(() => assertOnboardingTemplateMatchesContract(drifted as any)).toThrow(/body takes 2 parameter/);
  });

  it("names the template and the Meta error so the message is actionable", () => {
    const drifted = liveTemplate({ components: [{ type: "BODY", text: "Hello {{1}}." }] });

    expect(() => assertOnboardingTemplateMatchesContract(drifted as any)).toThrow(
      /stayo_tenant_onboarding_complete/,
    );
    expect(() => assertOnboardingTemplateMatchesContract(drifted as any)).toThrow(/132000/);
  });

  it("fails when the template is not approved", () => {
    expect(() => assertOnboardingTemplateMatchesContract(liveTemplate({ status: "REJECTED" }) as any)).toThrow(
      /REJECTED/,
    );
  });

  // A static-URL button needs no parameter, so its presence must not be
  // mistaken for drift the way a missing *dynamic* button would be.
  it("accepts the static URL button without demanding a parameter for it", () => {
    expect(() => assertOnboardingTemplateMatchesContract(liveTemplate() as any)).not.toThrow();
  });
});
