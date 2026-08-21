import { describe, it, expect } from "vitest";
import {
  ENQUIRY_TEMPLATES,
  resolveEnquiryTemplateName,
  buildOwnerEnquiryReceived,
  buildTenantEnquiryRejected,
  formatRent,
  rejectionReasonText,
} from "@/lib/services/notifications/providers/whatsapp/enquiry-template-contracts";


/**
 * Meta rejects a send whose parameter count does not match the approved
 * template exactly. These pin the builders against the declarations, so a
 * parameter added to one and not the other fails here rather than in
 * production against a live customer.
 */
describe("builders match their declared parameter shape", () => {
  it("owner enquiry received", () => {
    const def = ENQUIRY_TEMPLATES.OWNER_ENQUIRY_RECEIVED;
    const built = buildOwnerEnquiryReceived({});
    expect(built.bodyParameters).toHaveLength(def.bodyParameters.length);
    expect(built.buttonParameters).toHaveLength(def.buttonParameters.length);
  });

  it("tenant enquiry rejected", () => {
    const def = ENQUIRY_TEMPLATES.TENANT_ENQUIRY_REJECTED;
    const built = buildTenantEnquiryRejected({});
    expect(built.bodyParameters).toHaveLength(def.bodyParameters.length);
    expect(built.buttonParameters).toHaveLength(def.buttonParameters.length);
  });
});

describe("no parameter is ever empty", () => {
  // WhatsApp rejects the whole message if any body parameter is blank, so a
  // missing move-in date must not silently break the owner's notification.
  it("fills every owner slot even from an empty enquiry", () => {
    const built = buildOwnerEnquiryReceived({});
    for (const p of built.bodyParameters) expect(p.trim().length).toBeGreaterThan(0);
  });

  it("fills every tenant slot even with no reason given", () => {
    const built = buildTenantEnquiryRejected({});
    for (const p of built.bodyParameters) expect(p.trim().length).toBeGreaterThan(0);
  });

  it("says a missing bed preference was not specified, rather than blanking it", () => {
    const built = buildOwnerEnquiryReceived({ bedType: "   " });
    expect(built.bodyParameters[3]).toBe("Not specified");
  });
});

describe("content", () => {
  it("puts the values in the order the approved template reads them", () => {
    const built = buildOwnerEnquiryReceived({
      ownerName: "Shiva", hostelName: "Starlink", tenantName: "harsha",
      bedType: "4-Bed AC", monthlyRent: 6000, moveInDate: "12 Aug 2026",
    });
    expect(built.bodyParameters).toEqual([
      "Shiva", "Starlink", "harsha", "4-Bed AC", "₹6,000", "12 Aug 2026",
    ]);
    // Both approved templates use a STATIC URL button. Sending a button
    // parameter to one is rejected by Meta, so this must stay empty.
    expect(built.buttonParameters).toEqual([]);
  });

  it("carries the rejection reason the owner gave", () => {
    const built = buildTenantEnquiryRejected({
      tenantName: "Harsha", hostelName: "StarLink", reason: "out of rooms",
    });
    expect(built.bodyParameters).toEqual(["Harsha", "StarLink", "out of rooms"]);
  });

  it("falls back to a non-arbitrary-sounding reason when none was given", () => {
    expect(buildTenantEnquiryRejected({}).bodyParameters[2]).toMatch(/no rooms available/i);
  });
});

describe("formatRent", () => {
  it("formats in Indian grouping without repeating 'per month'", () => {
    expect(formatRent(6000)).toBe("₹6,000");
    expect(formatRent(125000)).toBe("₹1,25,000");
  });

  it("degrades rather than printing ₹0 or NaN", () => {
    expect(formatRent(0)).toBe("—");
    expect(formatRent(null)).toBe("—");
    expect(formatRent("abc")).toBe("—");
  });
});

describe("resolveEnquiryTemplateName", () => {
  it("defaults to the names approved in WhatsApp Manager", () => {
    expect(resolveEnquiryTemplateName("OWNER_ENQUIRY_RECEIVED", {} as NodeJS.ProcessEnv))
      .toEqual({ name: "stayo_owner_enquiry_received", language: "en_IN" });
    expect(resolveEnquiryTemplateName("TENANT_ENQUIRY_REJECTED", {} as NodeJS.ProcessEnv))
      .toEqual({ name: "stayo_tenant_enquiry_rejected", language: "en" });
  });

  it("lets env override the name, so a Meta rename is config not a redeploy", () => {
    const env = { WHATSAPP_OWNER_ENQUIRY_RECEIVED_TEMPLATE: "stayo_owner_enquiry_v2" } as any;
    expect(resolveEnquiryTemplateName("OWNER_ENQUIRY_RECEIVED", env).name).toBe("stayo_owner_enquiry_v2");
  });
});

/**
 * `TENANT_ENQUIRY_REJECTED` was an approved template that nothing ever sent —
 * a Discovery applicant heard nothing back, forever. It is wired to the
 * owner's reject action now, and what it says about *why* is a decision about
 * a person, not a string lookup.
 */
describe("rejectionReasonText", () => {
  it("puts the owner's internal reason into words for the applicant", () => {
    expect(rejectionReasonText("PRICE_HIGH")).toBe("the budget did not match");
    expect(rejectionReasonText("LOCATION_UNSUITABLE")).toBe("the location did not suit");
  });

  it("never repeats a reason that blames the person", () => {
    // "They went to a competitor" is the owner's read of someone else's
    // decision; "no response" is an accusation. Both fall through to the
    // template's neutral floor.
    expect(rejectionReasonText("JOINED_COMPETITOR")).toBeNull();
    expect(rejectionReasonText("NO_RESPONSE")).toBeNull();
  });

  it("never leaks a raw CRM value into a message", () => {
    expect(rejectionReasonText("SOMETHING_NEW")).toBeNull();
    expect(rejectionReasonText(null)).toBeNull();
    expect(rejectionReasonText(undefined)).toBeNull();
  });

  it("falls back to the template's own wording when unmapped", () => {
    expect(buildTenantEnquiryRejected({ reason: rejectionReasonText("NO_RESPONSE") }).bodyParameters[2])
      .toBe("no rooms available right now");
  });
});
