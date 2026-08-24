import { describe, it, expect } from "vitest";
import {
  canConvertLeadToInvitation,
  canTransitionLeadStatus,
} from "@/src/services/admissions/lead-transition-guards";

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

/**
 * The rule that replaced `status === "ACCEPTED"`.
 *
 * That old shape forced the Accept button to mark the lead accepted before
 * opening the Add Tenant wizard, so closing the wizard left an "Accepted"
 * lead with no invitation behind it.
 */
describe("canConvertLeadToInvitation", () => {
  const OPEN = ["NEW", "INTERESTED", "ROOM_VISITED", "DECISION_PENDING", "READY_TO_JOIN"];

  it("lets an open lead be invited without being accepted first", () => {
    for (const status of OPEN) {
      expect(canConvertLeadToInvitation(status)).toEqual({ ok: true });
    }
  });

  // Leads parked in ACCEPTED by the old flow — the four an owner is looking at
  // right now — must still be convertible.
  it("still allows a lead already sitting in ACCEPTED", () => {
    expect(canConvertLeadToInvitation("ACCEPTED")).toEqual({ ok: true });
  });

  // Sending an invitation is a stronger commitment than accepting, so
  // requiring an un-hold first would be ceremony — and would dead-end an
  // on-hold lead whose owner pressed Accept.
  it("allows an on-hold lead, which the old rule refused", () => {
    expect(canConvertLeadToInvitation("ON_HOLD")).toEqual({ ok: true });
  });

  it("refuses a lead that already has a tenant behind it", () => {
    const result = canConvertLeadToInvitation("ACCEPTED", "tenant-1");
    expect(result.ok).toBe(false);
    expect((result as any).reason).toMatch(/already connected to a tenant invitation/);
  });

  it("refuses every closed status, each in its own words", () => {
    expect((canConvertLeadToInvitation("REJECTED") as any).reason).toMatch(/was rejected/);
    expect((canConvertLeadToInvitation("INVITED") as any).reason).toMatch(/already been converted/);
    expect((canConvertLeadToInvitation("JOINED") as any).reason).toMatch(/already been converted/);
    expect((canConvertLeadToInvitation("LOST") as any).reason).toMatch(/not proceeding/);
  });

  it("is case-insensitive and refuses an unknown status by name", () => {
    expect(canConvertLeadToInvitation("new")).toEqual({ ok: true });
    const result = canConvertLeadToInvitation("SOMETHING_ELSE");
    expect(result.ok).toBe(false);
    expect((result as any).reason).toMatch(/SOMETHING_ELSE/);
  });

  it("treats a null converted_tenant_id as not converted", () => {
    expect(canConvertLeadToInvitation("NEW", null)).toEqual({ ok: true });
    expect(canConvertLeadToInvitation("NEW", undefined)).toEqual({ ok: true });
  });
});
