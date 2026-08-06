import { describe, it, expect } from "vitest";
import { mapLeadStatusToStage, buildLeadTimeline } from "@/src/services/platform-leads/lead-stage-mapper";
import { canRejectLead } from "@/src/services/platform-leads/lead-transition-guards";

const ALL_STATUSES = [
  "NEW", "UNDER_REVIEW", "APPROVED", "INVITE_SENT",
  "OWNER_ACTIVATED", "HOSTEL_CREATED", "LIVE", "LOST",
];

describe("mapLeadStatusToStage", () => {
  it("gives every status a label — no status can render blank", () => {
    for (const status of ALL_STATUSES) {
      expect(mapLeadStatusToStage(status).label.length).toBeGreaterThan(0);
    }
  });

  // The whole point of the mapper: internal vocabulary must not reach a
  // public page. "INVITE_SENT" means nothing to an applicant.
  it("never leaks a raw internal status string as the label", () => {
    for (const status of ALL_STATUSES) {
      expect(mapLeadStatusToStage(status).label).not.toBe(status);
    }
  });

  it("collapses APPROVED and INVITE_SENT into one applicant-facing stage", () => {
    expect(mapLeadStatusToStage("APPROVED").label).toBe(mapLeadStatusToStage("INVITE_SENT").label);
  });

  it("collapses OWNER_ACTIVATED and HOSTEL_CREATED into one applicant-facing stage", () => {
    expect(mapLeadStatusToStage("OWNER_ACTIVATED").label).toBe(mapLeadStatusToStage("HOSTEL_CREATED").label);
  });

  it("marks LIVE and LOST terminal, and everything else not", () => {
    expect(mapLeadStatusToStage("LIVE").isTerminal).toBe(true);
    expect(mapLeadStatusToStage("LOST").isTerminal).toBe(true);
    expect(mapLeadStatusToStage("NEW").isTerminal).toBe(false);
    expect(mapLeadStatusToStage("INVITE_SENT").isTerminal).toBe(false);
  });

  it("degrades safely on an unrecognised status rather than throwing", () => {
    expect(mapLeadStatusToStage("SOMETHING_NEW").label).toBe("In progress");
  });
});

describe("buildLeadTimeline", () => {
  it("marks earlier stages done, the current one current, later ones pending", () => {
    const timeline = buildLeadTimeline("INVITE_SENT");
    const byKey = Object.fromEntries(timeline.map((s) => [s.key, s.state]));
    expect(byKey.submitted).toBe("done");
    expect(byKey.under_review).toBe("done");
    expect(byKey.approved).toBe("current");
    expect(byKey.setup).toBe("pending");
    expect(byKey.live).toBe("pending");
  });

  it("shows a rejected enquiry as a single decided stage, not a half-done ladder", () => {
    const timeline = buildLeadTimeline("LOST");
    expect(timeline.some((s) => s.key === "not_proceeding" && s.state === "current")).toBe(true);
    expect(timeline.some((s) => s.key === "live")).toBe(false);
  });

  it("marks every stage done when the hostel is live", () => {
    expect(buildLeadTimeline("LIVE").every((s) => s.state === "done")).toBe(true);
  });
});

describe("canRejectLead", () => {
  it("allows rejecting a lead still under consideration", () => {
    expect(canRejectLead("NEW").ok).toBe(true);
    expect(canRejectLead("UNDER_REVIEW").ok).toBe(true);
  });

  // Once an activation link is out, "decline" is a cancellation of that
  // invitation, not a status write. Out of scope — refuse rather than
  // half-do it.
  it("refuses once an activation link has been issued", () => {
    for (const status of ["APPROVED", "INVITE_SENT", "OWNER_ACTIVATED", "HOSTEL_CREATED", "LIVE"]) {
      const result = canRejectLead(status);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/activation link/i);
    }
  });

  it("refuses to reject an already-rejected lead", () => {
    expect(canRejectLead("LOST").ok).toBe(false);
  });
});
