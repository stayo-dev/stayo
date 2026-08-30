import { describe, it, expect } from "vitest";
import {
  canEnterActivation,
  hasCompletedActivation,
  isAwaitingTenantOnboarding,
  ACTIVATABLE_STATUSES,
} from "@/src/services/tenants/activation-entry";

const at = new Date("2026-08-01T00:00:00.000Z");

/**
 * The guards on a legal ceremony. The risk in this change is not that the
 * claimed path stays broken — it is that fixing it quietly lets an ordinary
 * invited tenant, or a tenant who already signed, back into the flow. Both
 * directions are asserted. See ADR-155.
 */
describe("canEnterActivation", () => {
  it("lets an invited tenant in, as it always did", () => {
    expect(canEnterActivation({ status: "INVITED", activationCompletedAt: null })).toEqual({ allowed: true });
  });

  it("lets a live tenancy in when the tenant has never onboarded", () => {
    // An owner-managed tenancy: ACTIVE from the moment the owner created it,
    // with the tenant having seen no onboarding screen. This is the case the
    // old status-only guard refused, which is why claiming collected nothing.
    expect(canEnterActivation({ status: "ACTIVE", activationCompletedAt: null })).toEqual({ allowed: true });
  });

  it("lets an adopted tenancy in despite its adoption-stamped timestamp", () => {
    // The case that made the first version of this module inert: adoption
    // stamps `activation_completed_at` and supersedes the invitation, so the
    // timestamp alone reported every claiming tenant as already finished.
    expect(canEnterActivation({
      status: "ACTIVE",
      activationCompletedAt: at,
      invitationStatus: "SUPERSEDED",
      ownerAttested: true,
    })).toEqual({ allowed: true });
  });

  it("still refuses a tenant who has already completed activation", () => {
    // The guard that must survive: re-entering would re-run a ceremony with a
    // signed agreement and a consent record behind it.
    expect(canEnterActivation({ status: "ACTIVE", activationCompletedAt: at })).toMatchObject({
      allowed: false,
      code: "ALREADY_ACTIVE",
    });
  });

  it("refuses a claimed tenant once they have finished onboarding", () => {
    // Completion moves the invitation to ACTIVATED even though the tenancy was
    // adopted and still carries an attestation. Without this the tenant would
    // be sent back into onboarding on every visit.
    expect(canEnterActivation({
      status: "ACTIVE",
      activationCompletedAt: at,
      invitationStatus: "ACTIVATED",
      ownerAttested: true,
    })).toMatchObject({ allowed: false, code: "ALREADY_ACTIVE" });
  });

  it("refuses a cancelled or expired invitation, with its own reason", () => {
    expect(canEnterActivation({ status: "CANCELLED", activationCompletedAt: null })).toMatchObject({
      allowed: false,
      code: "CANCELLED",
    });
    expect(canEnterActivation({ status: "EXPIRED", activationCompletedAt: null })).toMatchObject({
      allowed: false,
      code: "EXPIRED",
    });
  });

  it("refuses a cancelled tenancy even if it somehow carries a completion stamp", () => {
    // Status is checked before completion: a cancelled tenancy is not a
    // finished one, and must not report ALREADY_ACTIVE.
    expect(canEnterActivation({ status: "CANCELLED", activationCompletedAt: at })).toMatchObject({
      code: "CANCELLED",
    });
  });

  it("refuses any other status rather than assuming it is safe", () => {
    for (const status of ["FORMER_TENANT", "SUSPENDED", "", "something-new"]) {
      expect(canEnterActivation({ status, activationCompletedAt: null })).toMatchObject({
        allowed: false,
        code: "INVALID",
      });
    }
  });

  it("reads status case-insensitively, since it arrives from the database as text", () => {
    expect(canEnterActivation({ status: "invited", activationCompletedAt: null })).toEqual({ allowed: true });
  });
});

describe("hasCompletedActivation", () => {
  it("is a fact about the tenant, not about the tenancy being live", () => {
    expect(hasCompletedActivation({ status: "ACTIVE", activationCompletedAt: null })).toBe(false);
    expect(hasCompletedActivation({ status: "ACTIVE", activationCompletedAt: at })).toBe(true);
  });

  it("trusts an ACTIVATED invitation over everything else", () => {
    // The only write that fires when a tenant finishes the ceremony.
    expect(hasCompletedActivation({
      status: "ACTIVE", activationCompletedAt: null, invitationStatus: "ACTIVATED",
    })).toBe(true);
  });

  it("does not believe an adoption-stamped timestamp", () => {
    // `owner-managed-tenancy-service` stamps the timestamp and writes an
    // attestation in the same breath. The attestation is the honest signal.
    expect(hasCompletedActivation({
      status: "ACTIVE", activationCompletedAt: at, ownerAttested: true,
    })).toBe(false);
    expect(hasCompletedActivation({
      status: "ACTIVE", activationCompletedAt: at, invitationStatus: "SUPERSEDED", ownerAttested: true,
    })).toBe(false);
  });

  it("falls back to the timestamp for a tenancy that was never invited", () => {
    // No invitation and no attestation: nothing but the tenant's own
    // completion could have stamped it.
    expect(hasCompletedActivation({
      status: "ACTIVE", activationCompletedAt: at, invitationStatus: null, ownerAttested: false,
    })).toBe(true);
  });

  it("accepts the timestamp as a string, as JSON delivers it", () => {
    expect(hasCompletedActivation({ status: "ACTIVE", activationCompletedAt: at.toISOString() })).toBe(true);
  });
});

describe("ACTIVATABLE_STATUSES", () => {
  it("covers both an invited tenant and a live owner-managed one", () => {
    expect([...ACTIVATABLE_STATUSES]).toEqual(["INVITED", "ACTIVE"]);
  });
});

/**
 * The carve-out `completeActivation` relies on. It must stay *narrow*: it is
 * the only thing standing between "let a claiming tenant finish" and "re-run a
 * completed activation for everybody who is ACTIVE". See ADR-155.
 */
describe("isAwaitingTenantOnboarding", () => {
  it("is true for a tenancy the owner set up and the tenant has not finished", () => {
    expect(isAwaitingTenantOnboarding({
      status: "ACTIVE", activationCompletedAt: at, invitationStatus: "SUPERSEDED", ownerAttested: true,
    })).toBe(true);
  });

  it("is false once that tenant finishes, so completion is never re-run", () => {
    expect(isAwaitingTenantOnboarding({
      status: "ACTIVE", activationCompletedAt: at, invitationStatus: "ACTIVATED", ownerAttested: true,
    })).toBe(false);
  });

  it("is false for an ordinary self-serve tenancy, which has no attestation", () => {
    // The guarantee that the existing flow is untouched: without an
    // attestation this never fires, whatever the status or timestamp says.
    expect(isAwaitingTenantOnboarding({ status: "ACTIVE", activationCompletedAt: at })).toBe(false);
    expect(isAwaitingTenantOnboarding({ status: "INVITED", activationCompletedAt: null })).toBe(false);
    expect(isAwaitingTenantOnboarding({
      status: "ACTIVE", activationCompletedAt: null, invitationStatus: "PENDING", ownerAttested: false,
    })).toBe(false);
  });
});
