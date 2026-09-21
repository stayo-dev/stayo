import { describe, it, expect } from "vitest";
import {
  FALLBACK_THRESHOLD_HOURS,
  MAX_ALTERNATIVES,
  isFallbackDue,
  selectAlternatives,
  buildFallbackMessage,
} from "@/src/services/marketing/partner-fallback-policy";

const NOW = new Date("2026-09-21T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 60 * 60 * 1000);

describe("when a held enquiry becomes a person left waiting", () => {
  const held = { state: "HELD", created_at: hoursAgo(13), fallback_at: null };

  it("is due once the threshold has passed", () => {
    expect(isFallbackDue(held, { now: NOW })).toBe(true);
  });

  it("is not due before it", () => {
    expect(isFallbackDue({ ...held, created_at: hoursAgo(11) }, { now: NOW })).toBe(false);
  });

  it("is due exactly on the boundary", () => {
    expect(
      isFallbackDue({ ...held, created_at: hoursAgo(FALLBACK_THRESHOLD_HOURS) }, { now: NOW })
    ).toBe(true);
  });

  it("never fires twice for the same enquiry", () => {
    expect(isFallbackDue({ ...held, fallback_at: hoursAgo(1) }, { now: NOW })).toBe(false);
  });

  /**
   * A claim between the sweep's read and its write releases the enquiry.
   * Telling a student about alternatives moments after their actual first
   * choice became reachable is worse than saying nothing.
   */
  it("does not fire for an enquiry that is no longer held", () => {
    for (const state of ["RELEASED", "SENT", "PENDING", "FAILED", "EXPIRED"]) {
      expect(isFallbackDue({ ...held, state }, { now: NOW })).toBe(false);
    }
  });

  it("honours an overridden threshold, and ignores a nonsensical one", () => {
    expect(isFallbackDue({ ...held, created_at: hoursAgo(5) }, { now: NOW, thresholdHours: 4 })).toBe(true);
    expect(isFallbackDue({ ...held, created_at: hoursAgo(5) }, { now: NOW, thresholdHours: -1 })).toBe(false);
  });

  it("does not fire on an unparseable timestamp", () => {
    expect(isFallbackDue({ ...held, created_at: "not a date" }, { now: NOW })).toBe(false);
  });
});

describe("choosing what to offer instead", () => {
  const candidates = [
    { id: "a", name: "Sunrise", city: "Pune", public_slug: "sunrise" },
    { id: "b", name: "Blue Nest", city: "Pune", public_slug: "blue-nest" },
    { id: "c", name: "Draft House", city: "Pune", public_slug: null },
    { id: "d", name: "Green Court", city: "Pune", public_slug: "green-court" },
    { id: "e", name: "Far Lodge", city: "Pune", public_slug: "far-lodge" },
  ];

  // Listing their first choice back to them reads as a system that was not
  // paying attention.
  it("never offers the hostel they enquired about", () => {
    const picked = selectAlternatives(candidates, { excludeHostelId: "a" });
    expect(picked.map((h) => h.id)).not.toContain("a");
  });

  // A recommendation they cannot open is worse than one fewer.
  it("drops anything with no public page", () => {
    const picked = selectAlternatives(candidates, { excludeHostelId: "zzz" });
    expect(picked.map((h) => h.id)).not.toContain("c");
  });

  it("offers a choice, not a search results page", () => {
    expect(selectAlternatives(candidates, { excludeHostelId: "zzz" })).toHaveLength(MAX_ALTERNATIVES);
  });

  it("is safe on an empty or missing candidate list", () => {
    expect(selectAlternatives([], { excludeHostelId: "a" })).toEqual([]);
    expect(selectAlternatives(undefined as any, { excludeHostelId: "a" })).toEqual([]);
  });
});

describe("what the student is told", () => {
  const alternatives = [{ id: "b", name: "Blue Nest", city: "Pune", public_slug: "blue-nest" }];

  it("uses their first name and names the hostel they asked about", () => {
    const msg = buildFallbackMessage({
      studentName: "Abhishek Rao",
      hostelName: "Sunrise Residency",
      alternatives,
    });
    expect(msg.body).toContain("Hi Abhishek");
    expect(msg.body).toContain("Sunrise Residency");
    expect(msg.body).toContain("Blue Nest");
  });

  /**
   * The owner not having signed up is our commercial situation, not the
   * student's. Framing the delay as somebody else's failure invites them to
   * chase a hostel we have just told them is unreachable.
   */
  it("never explains the delay as the owner's fault", () => {
    const msg = buildFallbackMessage({
      studentName: "Abhi",
      hostelName: "Sunrise",
      alternatives,
    });
    for (const leak of [/not on stayo/i, /has not signed up/i, /owner/i, /unlock/i, /account/i]) {
      expect(msg.body).not.toMatch(leak);
      expect(msg.subject).not.toMatch(leak);
    }
  });

  it("still says something useful when there is nothing to offer", () => {
    const msg = buildFallbackMessage({ studentName: "Abhi", hostelName: "Sunrise", alternatives: [] });
    expect(msg.body).toContain("Sunrise");
    expect(msg.body).toMatch(/let you know/i);
  });

  it("falls back to a neutral greeting rather than an empty one", () => {
    const msg = buildFallbackMessage({ studentName: "", hostelName: "Sunrise", alternatives: [] });
    expect(msg.body).toContain("Hi there");
  });
});
