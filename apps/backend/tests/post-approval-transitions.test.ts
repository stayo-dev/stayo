import { describe, expect, it } from "vitest";
import {
  canTransition,
  isActionable,
  keepsListingLive,
  ownerNotification,
} from "@/src/services/marketing/post-approval-transitions";

const live = { approved: true, openStatus: null } as const;

describe("canTransition", () => {
  it("allows both actions on a live listing", () => {
    expect(canTransition("REQUEST_CHANGES", live)).toEqual({ ok: true });
    expect(canTransition("UNPUBLISH", live)).toEqual({ ok: true });
  });

  it("refuses either action when nothing is live to act on", () => {
    const nothing = { approved: false, openStatus: null } as const;
    expect(canTransition("REQUEST_CHANGES", nothing)).toMatchObject({ ok: false, code: "NOT_LIVE" });
    expect(canTransition("UNPUBLISH", nothing)).toMatchObject({ ok: false, code: "NOT_LIVE" });
  });

  it("refuses to request changes while a submission is already in the queue", () => {
    // That submission is the thing to review. Writing notes onto a different
    // draft would leave the queue item unanswered and the owner with two sets
    // of feedback about the same listing.
    const queued = { approved: true, openStatus: "PENDING_REVIEW" } as const;
    expect(canTransition("REQUEST_CHANGES", queued)).toMatchObject({ ok: false, code: "IN_REVIEW" });
  });

  it("still allows unpublishing while a submission is in the queue", () => {
    // The live page and the queued submission are different things: a false
    // claim on the live page must come down now, whatever is waiting behind it.
    const queued = { approved: true, openStatus: "PENDING_REVIEW" } as const;
    expect(canTransition("UNPUBLISH", queued)).toEqual({ ok: true });
  });

  it("allows requesting changes when the owner merely has a draft open", () => {
    const drafting = { approved: true, openStatus: "DRAFT" } as const;
    expect(canTransition("REQUEST_CHANGES", drafting)).toEqual({ ok: true });
  });
});

describe("keepsListingLive", () => {
  it("is the one thing that separates the two actions", () => {
    expect(keepsListingLive("REQUEST_CHANGES")).toBe(true);
    expect(keepsListingLive("UNPUBLISH")).toBe(false);
  });
});

describe("isActionable", () => {
  it("takes a flagged section as an instruction when requesting changes", () => {
    expect(isActionable("REQUEST_CHANGES", "", 1)).toBe(true);
    expect(isActionable("REQUEST_CHANGES", "Fix the price", 0)).toBe(true);
  });

  it("refuses a request for changes that says nothing at all", () => {
    expect(isActionable("REQUEST_CHANGES", "", 0)).toBe(false);
    expect(isActionable("REQUEST_CHANGES", "   ", 0)).toBe(false);
  });

  it("always demands a written reason to unpublish, flags or not", () => {
    // Taking a live page down with no sentence leaves the owner guessing at
    // what to fix, and there are no flags on this path to lean on.
    expect(isActionable("UNPUBLISH", "", 3)).toBe(false);
    expect(isActionable("UNPUBLISH", "  ", 0)).toBe(false);
    expect(isActionable("UNPUBLISH", "The ₹4,500 tier does not exist", 0)).toBe(true);
  });
});

describe("ownerNotification", () => {
  it("tells an owner their page is still up when changes are requested", () => {
    const { title, body } = ownerNotification("REQUEST_CHANGES", "Sunrise Residency", "Fix the mess menu.");
    expect(title).toBe("Changes requested on your listing");
    expect(body).toContain("still live");
    expect(body).toContain("Fix the mess menu.");
  });

  it("tells an owner their page is down, and how to get it back", () => {
    const { title, body } = ownerNotification("UNPUBLISH", "Sunrise Residency", "The ₹4,500 tier does not exist.");
    expect(title).toBe("Your listing has been taken down");
    expect(body).toContain("no longer visible");
    expect(body).toContain("resubmit");
    expect(body).toContain("The ₹4,500 tier does not exist.");
  });
});
