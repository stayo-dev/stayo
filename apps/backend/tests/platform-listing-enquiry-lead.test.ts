import { describe, it, expect } from "vitest";
import {
  shouldRaisePlatformLead,
  buildPlatformLeadFromEnquiry,
  bumpEnquiryNote,
} from "@/src/services/marketing/platform-listing-leads";

const hostel = { id: "h1", name: "Green Nest", city: "Bengaluru", listing_source: "PLATFORM_LISTED" };

describe("shouldRaisePlatformLead", () => {
  it("raises a lead for an unclaimed Stayo listing — that is the demand signal", () => {
    expect(shouldRaisePlatformLead(hostel)).toBe(true);
  });

  it("does not for a hostel a real owner already runs — they get the enquiry directly", () => {
    expect(shouldRaisePlatformLead({ ...hostel, listing_source: "OWNER_MANAGED" })).toBe(false);
  });

  it("does not when listing_source is absent, matching the claim guard's safe default", () => {
    expect(shouldRaisePlatformLead({ ...hostel, listing_source: undefined })).toBe(false);
  });
});

describe("buildPlatformLeadFromEnquiry", () => {
  it("names the lead after the hostel, not the enquiring tenant", () => {
    // The lead is the OWNER we want to sign up. The tenant is the evidence,
    // not the prospect.
    const lead = buildPlatformLeadFromEnquiry(hostel);
    expect(lead.hostel_name).toBe("Green Nest");
    expect(lead.city).toBe("Bengaluru");
  });

  it("starts at NEW so it enters the top of the pipeline", () => {
    expect(buildPlatformLeadFromEnquiry(hostel).status).toBe("NEW");
  });

  it("records where it came from, so it is not mistaken for a sign-up", () => {
    const lead = buildPlatformLeadFromEnquiry(hostel);
    expect(lead.notes).toMatch(/stayo-listed|discovery/i);
  });

  it("carries no phone, because nobody from the hostel has given us one", () => {
    // A platform listing's contact number belongs to the hostel, not to a
    // person who agreed to be contacted — the lead must not imply consent.
    expect(buildPlatformLeadFromEnquiry(hostel).phone).toBe("");
  });
});

describe("bumpEnquiryNote", () => {
  it("counts up from an existing note", () => {
    expect(bumpEnquiryNote("Stayo-listed · 3 enquiries from Discovery")).toMatch(/4 enquiries/);
  });

  it("starts at 1 when there is no prior note", () => {
    expect(bumpEnquiryNote(null)).toMatch(/1 enquiry/);
  });

  it("does not lose an admin's own note when bumping", () => {
    const out = bumpEnquiryNote("Called, owner interested\nStayo-listed · 2 enquiries from Discovery");
    expect(out).toContain("Called, owner interested");
    expect(out).toMatch(/3 enquiries/);
  });
});
