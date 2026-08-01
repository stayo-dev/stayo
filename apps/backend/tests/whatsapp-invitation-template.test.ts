import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  INVITATION_TEMPLATE_CONTRACT,
  assertInvitationTemplateMatchesContract,
  buildInvitationTemplatePayload,
  invitationTemplateLanguage,
  invitationTemplateName,
} from "../lib/services/notifications/providers/whatsapp/invitation-template-contract";

/**
 * Tenant invitation template contract.
 *
 * The payload builder sent **four** body parameters (tenant, owner, room, rent)
 * while the approved `stayo_tenant_invitation` template declares **two**
 * ({{1}} tenant, {{2}} hostel), and defaulted to language `en_IN` against a
 * template published as `en`. Every invitation therefore failed at Meta with
 * #132000 / #132001 — invisible until Task 2 made the wizard stop claiming
 * success.
 *
 * The live template was read from the Graph API rather than a screenshot:
 *   stayo_tenant_invitation | en | APPROVED | body=2 button=1
 */

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

/** The approved template exactly as the Graph API returns it. */
function liveTemplate(overrides: Record<string, unknown> = {}) {
  return {
    name: "stayo_tenant_invitation",
    status: "APPROVED",
    category: "UTILITY",
    language: "en",
    components: [
      { type: "HEADER", text: "You Have Been Invited" },
      {
        type: "BODY",
        text: "Hello {{1}}, you have been invited to join {{2}} on Stayo. Your room has been assigned and your account is ready to activate. This invitation expires in 48 hours.",
      },
      { type: "FOOTER", text: "Stayo Property Management" },
      {
        type: "BUTTONS",
        buttons: [{ type: "URL", text: "Activate Account", url: "https://yourstayo.com/activate/{{1}}" }],
      },
    ],
    ...overrides,
  };
}

const INPUT = {
  tenantName: "Shiva",
  hostelName: "Delux Hostel",
  activationLink: "https://yourstayo.com/activate/abc123token",
};

describe("invitation template contract", () => {
  it("declares exactly the two body parameters the approved template takes", () => {
    expect(INVITATION_TEMPLATE_CONTRACT.bodyParameters).toEqual(["tenant_name", "hostel_name"]);
  });

  it("declares the single activation-token button parameter", () => {
    expect(INVITATION_TEMPLATE_CONTRACT.buttonParameters).toEqual(["activation_token"]);
  });
});

describe("buildInvitationTemplatePayload", () => {
  it("sends two body parameters, not four", () => {
    const payload = buildInvitationTemplatePayload(INPUT);
    const body = payload.components.find((c: any) => c.type === "body")! as any;

    expect(body.parameters).toHaveLength(2);
  });

  it("sends tenant name then hostel name, matching {{1}} and {{2}}", () => {
    const body = buildInvitationTemplatePayload(INPUT).components.find((c: any) => c.type === "body")!;

    expect(body.parameters).toEqual([
      { type: "text", text: "Shiva" },
      { type: "text", text: "Delux Hostel" },
    ]);
  });

  // The old payload sent owner name and rent, which the approved template has
  // no placeholders for — the direct cause of Meta #132000.
  it("no longer sends owner name, room number or rent", () => {
    const body = buildInvitationTemplatePayload({
      ...INPUT,
      ownerName: "Srinivasa Rao",
      roomNumber: "G4",
      roomRent: 8500,
    } as any).components.find((c: any) => c.type === "body")!;

    const values = body.parameters.map((p: any) => p.text);
    expect(values).not.toContain("Srinivasa Rao");
    expect(values).not.toContain("G4");
    expect(values).not.toContain("8500");
  });

  it("passes the activation token as the URL button parameter", () => {
    const button = buildInvitationTemplatePayload(INPUT).components.find((c: any) => c.type === "button")!;

    expect(button).toMatchObject({ sub_type: "url", index: "0" });
    expect(button.parameters).toEqual([{ type: "text", text: "abc123token" }]);
  });

  it("extracts the token from the link rather than sending the whole URL", () => {
    const button = buildInvitationTemplatePayload({
      ...INPUT,
      activationLink: "https://yourstayo.com/activate/xyz789",
    }).components.find((c: any) => c.type === "button")!;

    expect(button.parameters[0].text).toBe("xyz789");
  });

  it("coerces a missing hostel name to something sendable — Meta rejects an empty parameter", () => {
    const body = buildInvitationTemplatePayload({ ...INPUT, hostelName: "" }).components.find(
      (c: any) => c.type === "body",
    )!;

    expect(body.parameters[1].text.length).toBeGreaterThan(0);
  });
});

describe("template name and language resolution", () => {
  beforeEach(() => {
    delete process.env.WHATSAPP_INVITATION_TEMPLATE;
    delete process.env.WHATSAPP_INVITATION_LANGUAGE;
  });

  it("defaults to the approved stayo_tenant_invitation template", () => {
    expect(invitationTemplateName()).toBe("stayo_tenant_invitation");
  });

  // Language codes are distinct templates to Meta: en != en_IN (#132001).
  it("defaults to en, the language the template is published in", () => {
    expect(invitationTemplateLanguage()).toBe("en");
  });

  it("lets both be overridden by env", () => {
    process.env.WHATSAPP_INVITATION_TEMPLATE = "other_template";
    process.env.WHATSAPP_INVITATION_LANGUAGE = "en_IN";

    expect(invitationTemplateName()).toBe("other_template");
    expect(invitationTemplateLanguage()).toBe("en_IN");
  });

  it("ignores a blank env value rather than sending an empty template name", () => {
    process.env.WHATSAPP_INVITATION_TEMPLATE = "   ";
    expect(invitationTemplateName()).toBe("stayo_tenant_invitation");
  });

  it("still routes the retired placeholder name to the real template", () => {
    process.env.WHATSAPP_INVITATION_TEMPLATE = "hms_tenant_invite_v2";
    expect(invitationTemplateName()).toBe("stayo_tenant_invitation");
  });
});

describe("assertInvitationTemplateMatchesContract", () => {
  it("accepts the live approved template", () => {
    const shape = assertInvitationTemplateMatchesContract(liveTemplate() as any);

    expect(shape.bodyParameterCount).toBe(2);
    expect(shape.buttonParameterCount).toBe(1);
  });

  it("fails loudly when the template gains a body variable", () => {
    const drifted = liveTemplate({
      components: [
        { type: "BODY", text: "Hello {{1}}, join {{2}} in room {{3}}." },
        { type: "BUTTONS", buttons: [{ type: "URL", text: "Activate", url: "https://x/activate/{{1}}" }] },
      ],
    });

    expect(() => assertInvitationTemplateMatchesContract(drifted as any)).toThrow(/body takes 3 parameter/);
  });

  it("names the template and the Meta error code so the message is actionable", () => {
    const drifted = liveTemplate({
      components: [
        { type: "BODY", text: "Hello {{1}}." },
        { type: "BUTTONS", buttons: [{ type: "URL", text: "Activate", url: "https://x/activate/{{1}}" }] },
      ],
    });

    expect(() => assertInvitationTemplateMatchesContract(drifted as any)).toThrow(/stayo_tenant_invitation/);
    expect(() => assertInvitationTemplateMatchesContract(drifted as any)).toThrow(/132000/);
  });

  it("fails when the activation button is removed — the tenant would get no link", () => {
    const noButton = liveTemplate({
      components: [{ type: "BODY", text: "Hello {{1}}, join {{2}}." }],
    });

    expect(() => assertInvitationTemplateMatchesContract(noButton as any)).toThrow(/button/i);
  });

  it("fails when the template is not approved", () => {
    expect(() => assertInvitationTemplateMatchesContract(liveTemplate({ status: "PENDING" }) as any)).toThrow(
      /PENDING/,
    );
  });
});
