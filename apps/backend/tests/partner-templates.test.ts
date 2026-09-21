import { describe, it, expect } from "vitest";
import {
  PARTNER_TEMPLATES,
  partnerTemplateName,
  partnerTemplateLanguage,
  isPartnerTemplateApproved,
  buildListingLivePayload,
  buildNewEnquiryPayload,
  buildEnquiryLockedPayload,
  buildActivatedPayload,
} from "@/lib/services/notifications/providers/whatsapp/partner-template-contracts";
import {
  ADMIN_INVITATION_TEMPLATES,
  adminInvitationTemplateName,
  humaniseExpiry,
  buildAdminInvitationPayload,
  buildAdminInvitationReminderPayload,
} from "@/lib/services/notifications/providers/whatsapp/admin-invitation-template-contracts";

describe("partner template registry", () => {
  it("declares the four marketplace templates with their Meta names", () => {
    expect(PARTNER_TEMPLATES.LISTING_LIVE.defaultName).toBe("stayo_partner_listing_live");
    expect(PARTNER_TEMPLATES.NEW_ENQUIRY.defaultName).toBe("stayo_partner_new_enquiry");
    expect(PARTNER_TEMPLATES.ENQUIRY_LOCKED.defaultName).toBe("stayo_partner_enquiry_locked");
    expect(PARTNER_TEMPLATES.ACTIVATED.defaultName).toBe("stayo_partner_activated");
  });

  // All four were submitted under plain English, not en_IN. A template is
  // addressed by (name, language): sending en_IN to a template approved as
  // en fails with Meta error 132001.
  it("matches the language each template was approved under", () => {
    expect(partnerTemplateLanguage("LISTING_LIVE")).toBe("en");
    expect(partnerTemplateLanguage("NEW_ENQUIRY")).toBe("en");
    expect(partnerTemplateLanguage("ENQUIRY_LOCKED")).toBe("en");
  });

  /**
   * Meta categorised two of these differently from how they were submitted.
   * The record matters: NEW_ENQUIRY clearing as UTILITY is what makes a
   * message on every enquiry affordable and uncapped, and this test is what
   * notices if someone edits promotional language into it.
   */
  it("records the category Meta actually assigned", () => {
    expect(PARTNER_TEMPLATES.NEW_ENQUIRY.category).toBe("UTILITY");
    expect(PARTNER_TEMPLATES.LISTING_LIVE.category).toBe("MARKETING");
    expect(PARTNER_TEMPLATES.ENQUIRY_LOCKED.category).toBe("MARKETING");
  });

  it("knows that the post-claim template is not approved yet", () => {
    expect(isPartnerTemplateApproved("NEW_ENQUIRY")).toBe(true);
    expect(isPartnerTemplateApproved("ACTIVATED")).toBe(false);
  });

  it("lets an env var override a template name without a redeploy", () => {
    const previous = process.env.WHATSAPP_PARTNER_NEW_ENQUIRY_TEMPLATE;
    process.env.WHATSAPP_PARTNER_NEW_ENQUIRY_TEMPLATE = "stayo_partner_new_enquiry_v2";
    expect(partnerTemplateName("NEW_ENQUIRY")).toBe("stayo_partner_new_enquiry_v2");
    if (previous === undefined) delete process.env.WHATSAPP_PARTNER_NEW_ENQUIRY_TEMPLATE;
    else process.env.WHATSAPP_PARTNER_NEW_ENQUIRY_TEMPLATE = previous;
  });

  it("every declared param shape matches what its builder fills", () => {
    const cases = [
      [
        PARTNER_TEMPLATES.LISTING_LIVE,
        buildListingLivePayload({ ownerName: "A", hostelName: "H", city: "C", portalToken: "t" }),
      ],
      [
        PARTNER_TEMPLATES.NEW_ENQUIRY,
        buildNewEnquiryPayload({
          ownerName: "A",
          hostelName: "H",
          studentName: "S",
          moveIn: "Jan",
          deliveredCount: 1,
          freeQuota: 3,
          deliveryToken: "t",
        }),
      ],
      [
        PARTNER_TEMPLATES.ENQUIRY_LOCKED,
        buildEnquiryLockedPayload({
          ownerName: "A",
          hostelName: "H",
          enquiriesThisMonth: 4,
          freeQuota: 3,
          activationToken: "t",
        }),
      ],
      [
        PARTNER_TEMPLATES.ACTIVATED,
        buildActivatedPayload({ ownerName: "A", hostelName: "H", releasedCount: 2 }),
      ],
    ] as const;

    for (const [definition, payload] of cases) {
      expect(payload.bodyParameters).toHaveLength(definition.bodyParameters.length);
      expect(payload.buttonParameters).toHaveLength(definition.buttonParameters.length);
    }
  });
});

describe("partner payload builders", () => {
  it("strips newlines and runs of spaces that Meta rejects with error 132000", () => {
    const payload = buildNewEnquiryPayload({
      ownerName: "  Ravi \n Kumar ",
      hostelName: "Sai\t\tResidency",
      studentName: "Abhi",
      moveIn: "Jan",
      deliveredCount: 1,
      freeQuota: 3,
      deliveryToken: "tok",
    });

    expect(payload.bodyParameters[0]).toBe("Ravi Kumar");
    expect(payload.bodyParameters[1]).toBe("Sai Residency");
    for (const value of payload.bodyParameters) {
      expect(value).not.toMatch(/[\n\t]|\s{4,}/);
    }
  });

  // An enquiry with no stated move-in date is ordinary. Meta rejects an empty
  // parameter outright, so the absence has to be worded.
  it("says 'Not specified' rather than sending an empty move-in date", () => {
    const payload = buildNewEnquiryPayload({
      ownerName: "A",
      hostelName: "H",
      studentName: "S",
      moveIn: null,
      deliveredCount: 1,
      freeQuota: 3,
      deliveryToken: "tok",
    });
    expect(payload.bodyParameters[3]).toBe("Not specified");
  });

  it("puts every token in the button and never in the body", () => {
    const enquiry = buildNewEnquiryPayload({
      ownerName: "A",
      hostelName: "H",
      studentName: "S",
      moveIn: "Jan",
      deliveredCount: 2,
      freeQuota: 3,
      deliveryToken: "delivery-tok",
    });
    expect(enquiry.buttonParameters).toEqual(["delivery-tok"]);
    expect(enquiry.bodyParameters).not.toContain("delivery-tok");

    const locked = buildEnquiryLockedPayload({
      ownerName: "A",
      hostelName: "H",
      enquiriesThisMonth: 4,
      freeQuota: 3,
      activationToken: "activate-tok",
    });
    expect(locked.buttonParameters).toEqual(["activate-tok"]);
    expect(locked.bodyParameters).not.toContain("activate-tok");
  });

  /**
   * The locked template's button was submitted as a STATIC url and corrected
   * to dynamic before approval. A blank token would send the owner to a page
   * that cannot know which enquiry they came to unlock, so it fails here
   * instead — where the listing id is still in hand to log against.
   */
  it("refuses to build a payload with a blank button token", () => {
    expect(() =>
      buildEnquiryLockedPayload({
        ownerName: "A",
        hostelName: "H",
        enquiriesThisMonth: 4,
        freeQuota: 3,
        activationToken: "   ",
      })
    ).toThrow(/activation token is empty/i);
  });

  it("renders counts as whole non-negative numbers", () => {
    const payload = buildEnquiryLockedPayload({
      ownerName: "A",
      hostelName: "H",
      enquiriesThisMonth: Number.NaN,
      freeQuota: -2,
      activationToken: "tok",
    });
    expect(payload.bodyParameters[2]).toBe("0");
    expect(payload.bodyParameters[3]).toBe("0");
  });

  it("falls back to a neutral name rather than sending an empty greeting", () => {
    const payload = buildActivatedPayload({ ownerName: "", hostelName: "", releasedCount: 2 });
    expect(payload.bodyParameters[0]).toBe("there");
    expect(payload.bodyParameters[1]).toBe("your hostel");
  });
});

describe("admin invitation templates", () => {
  it("declares both staff templates with their Meta names", () => {
    expect(ADMIN_INVITATION_TEMPLATES.INVITATION.defaultName).toBe("stayo_admin_invitation");
    expect(ADMIN_INVITATION_TEMPLATES.INVITATION_REMINDER.defaultName).toBe(
      "stayo_admin_invitation_reminder"
    );
  });

  it("lets an env var override a template name without a redeploy", () => {
    const previous = process.env.WHATSAPP_ADMIN_INVITATION_TEMPLATE;
    process.env.WHATSAPP_ADMIN_INVITATION_TEMPLATE = "stayo_admin_invitation_v2";
    expect(adminInvitationTemplateName("INVITATION")).toBe("stayo_admin_invitation_v2");
    if (previous === undefined) delete process.env.WHATSAPP_ADMIN_INVITATION_TEMPLATE;
    else process.env.WHATSAPP_ADMIN_INVITATION_TEMPLATE = previous;
  });

  it("every declared param shape matches what its builder fills", () => {
    const invitation = buildAdminInvitationPayload({
      adminName: "A",
      titleLabel: "Manager",
      inviterName: "B",
      expiryDays: 10,
      activationToken: "tok",
    });
    expect(invitation.bodyParameters).toHaveLength(
      ADMIN_INVITATION_TEMPLATES.INVITATION.bodyParameters.length
    );
    expect(invitation.buttonParameters).toHaveLength(1);

    const reminder = buildAdminInvitationReminderPayload({
      adminName: "A",
      hoursRemaining: 48,
      activationToken: "tok",
    });
    expect(reminder.bodyParameters).toHaveLength(
      ADMIN_INVITATION_TEMPLATES.INVITATION_REMINDER.bodyParameters.length
    );
  });

  // Rounding down keeps the message from promising more time than the token
  // has. An invite that expires earlier than it said is the failure to avoid.
  it("humanises the remaining time, rounding down", () => {
    expect(humaniseExpiry(48)).toBe("2 days");
    expect(humaniseExpiry(47)).toBe("1 day");
    expect(humaniseExpiry(24)).toBe("1 day");
    expect(humaniseExpiry(23.9)).toBe("23 hours");
    expect(humaniseExpiry(1)).toBe("1 hour");
    expect(humaniseExpiry(0.4)).toBe("less than an hour");
    expect(humaniseExpiry(-5)).toBe("less than an hour");
    expect(humaniseExpiry(Number.NaN)).toBe("less than an hour");
  });

  it("never sends an expiry of zero days", () => {
    const payload = buildAdminInvitationPayload({
      adminName: "A",
      titleLabel: "Manager",
      inviterName: "B",
      expiryDays: 0,
      activationToken: "tok",
    });
    expect(payload.bodyParameters[3]).toBe("1");
  });
});
