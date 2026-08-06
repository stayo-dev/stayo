import { describe, it, expect } from "vitest";
import {
  PLATFORM_LEAD_TEMPLATES,
  platformLeadTemplateName,
  buildLeadReceivedPayload,
  buildInvitationPayload,
  buildAccountActivatedPayload,
  buildOnboardingCompletePayload,
  buildLeadRejectedPayload,
} from "@/lib/services/notifications/providers/whatsapp/platform-lead-template-contracts";

describe("platform lead template registry", () => {
  it("declares the five funnel templates with their Meta names", () => {
    expect(PLATFORM_LEAD_TEMPLATES.LEAD_RECEIVED.defaultName).toBe("stayo_owner_lead_received");
    expect(PLATFORM_LEAD_TEMPLATES.INVITATION.defaultName).toBe("stayo_owner_invitation");
    expect(PLATFORM_LEAD_TEMPLATES.ACCOUNT_ACTIVATED.defaultName).toBe("stayo_owner_account_activated");
    expect(PLATFORM_LEAD_TEMPLATES.ONBOARDING_COMPLETE.defaultName).toBe("stayo_owner_onboarding_complete");
    expect(PLATFORM_LEAD_TEMPLATES.LEAD_REJECTED.defaultName).toBe("stayo_owner_lead_rejected");
  });

  it("lets an env var override a template name without a redeploy", () => {
    const previous = process.env.WHATSAPP_OWNER_INVITATION_TEMPLATE;
    process.env.WHATSAPP_OWNER_INVITATION_TEMPLATE = "stayo_owner_invitation_v2";
    expect(platformLeadTemplateName("INVITATION")).toBe("stayo_owner_invitation_v2");
    if (previous === undefined) delete process.env.WHATSAPP_OWNER_INVITATION_TEMPLATE;
    else process.env.WHATSAPP_OWNER_INVITATION_TEMPLATE = previous;
  });

  it("every declared param shape matches what its builder fills", () => {
    const cases = [
      [PLATFORM_LEAD_TEMPLATES.LEAD_RECEIVED, buildLeadReceivedPayload({ ownerName: "A", trackingToken: "t" })],
      [PLATFORM_LEAD_TEMPLATES.INVITATION, buildInvitationPayload({ ownerName: "A", expiryDays: 7, activationToken: "t" })],
      [PLATFORM_LEAD_TEMPLATES.ACCOUNT_ACTIVATED, buildAccountActivatedPayload({ ownerName: "A" })],
      [PLATFORM_LEAD_TEMPLATES.ONBOARDING_COMPLETE, buildOnboardingCompletePayload({ ownerName: "A", hostelName: "H" })],
      [PLATFORM_LEAD_TEMPLATES.LEAD_REJECTED, buildLeadRejectedPayload({ ownerName: "A", reason: "R" })],
    ] as const;

    for (const [definition, payload] of cases) {
      expect(payload.bodyParameters).toHaveLength(definition.bodyParameters.length);
      expect(payload.buttonParameters).toHaveLength(definition.buttonParameters.length);
    }
  });
});

describe("payload builders", () => {
  it("puts the tracking token in the button, not the body", () => {
    const payload = buildLeadReceivedPayload({ ownerName: "Shiva", trackingToken: "abc123" });
    expect(payload.bodyParameters).toEqual(["Shiva"]);
    expect(payload.buttonParameters).toEqual(["abc123"]);
  });

  it("sends expiry as days, matching the approved template copy", () => {
    const payload = buildInvitationPayload({ ownerName: "Shiva", expiryDays: 7, activationToken: "tok" });
    expect(payload.bodyParameters).toEqual(["Shiva", "7"]);
    expect(payload.buttonParameters).toEqual(["tok"]);
  });

  it("falls back to a neutral name when the lead has none", () => {
    expect(buildAccountActivatedPayload({ ownerName: "   " }).bodyParameters).toEqual(["there"]);
  });

  it("falls back to a neutral hostel name", () => {
    const payload = buildOnboardingCompletePayload({ ownerName: "Shiva", hostelName: "" });
    expect(payload.bodyParameters).toEqual(["Shiva", "your hostel"]);
  });

  // Meta rejects parameters containing newlines, tabs, or 4+ consecutive
  // spaces with a 132000 error. Rejection reasons are free-text from an
  // admin textarea, so this is the realistic failure.
  it("collapses whitespace in a multi-line rejection reason", () => {
    const payload = buildLeadRejectedPayload({
      ownerName: "Shiva",
      reason: "We could not verify\nthe property.\n\nPlease    reapply later.",
    });
    expect(payload.bodyParameters[1]).toBe("We could not verify the property. Please reapply later.");
    expect(payload.bodyParameters[1]).not.toMatch(/[\n\t]/);
    expect(payload.bodyParameters[1]).not.toMatch(/ {4}/);
  });

  it("gives the rejected template a reason even when the admin left it blank", () => {
    expect(buildLeadRejectedPayload({ ownerName: "Shiva", reason: "" }).bodyParameters[1])
      .toBe("Not specified");
  });

  // An empty button parameter makes Meta 400 the whole send. Failing loudly
  // at build time is better than a provider error with no context.
  it("throws rather than building an empty button parameter", () => {
    expect(() => buildLeadReceivedPayload({ ownerName: "Shiva", trackingToken: "" }))
      .toThrow(/tracking token/i);
    expect(() => buildInvitationPayload({ ownerName: "Shiva", expiryDays: 7, activationToken: "  " }))
      .toThrow(/activation token/i);
  });
});
