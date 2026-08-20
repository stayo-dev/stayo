import { describe, it, expect } from "vitest";
import { canTransitionLeadStatus } from "@/src/services/admissions/lead-transition-guards";

describe("canTransitionLeadStatus", () => {
  it("allows an open lead to be accepted, held, or rejected", () => {
    for (const status of ["NEW", "INTERESTED", "ROOM_VISITED", "DECISION_PENDING", "READY_TO_JOIN"]) {
      expect(canTransitionLeadStatus(status, "ACCEPTED")).toEqual({ ok: true });
      expect(canTransitionLeadStatus(status, "ON_HOLD")).toEqual({ ok: true });
      expect(canTransitionLeadStatus(status, "REJECTED")).toEqual({ ok: true });
    }
  });

  it("allows a held lead to be accepted or rejected", () => {
    expect(canTransitionLeadStatus("ON_HOLD", "ACCEPTED")).toEqual({ ok: true });
    expect(canTransitionLeadStatus("ON_HOLD", "REJECTED")).toEqual({ ok: true });
  });

  it("allows re-holding an already-held lead to update the message", () => {
    expect(canTransitionLeadStatus("ON_HOLD", "ON_HOLD")).toEqual({ ok: true });
  });

  it("refuses to reopen a rejected lead", () => {
    expect(canTransitionLeadStatus("REJECTED", "ACCEPTED").ok).toBe(false);
    expect(canTransitionLeadStatus("REJECTED", "ON_HOLD").ok).toBe(false);
    expect(canTransitionLeadStatus("REJECTED", "REJECTED").ok).toBe(false);
  });

  it("refuses to accept/hold/reject a lead already converted to a tenant", () => {
    expect(canTransitionLeadStatus("INVITED", "ACCEPTED").ok).toBe(false);
    expect(canTransitionLeadStatus("JOINED", "REJECTED").ok).toBe(false);
  });

  it("refuses to accept/hold/reject a lead already marked LOST", () => {
    expect(canTransitionLeadStatus("LOST", "ACCEPTED").ok).toBe(false);
  });

  it("gives a distinct, clear reason per terminal state", () => {
    expect(canTransitionLeadStatus("REJECTED", "ACCEPTED").ok ? "" : (canTransitionLeadStatus("REJECTED", "ACCEPTED") as any).reason)
      .toMatch(/already been rejected/i);
    expect((canTransitionLeadStatus("INVITED", "ACCEPTED") as any).reason).toMatch(/already been converted/i);
  });
});
