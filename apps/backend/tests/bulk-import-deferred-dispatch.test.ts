import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * Invitations created but not yet sent.
 *
 * ADR-165 requires that every imported tenancy gets a real invitation the
 * tenant accepts. It does not require that forty of them leave in the same
 * instant. This is deliberately NOT the removed `suppressInvitationNotification`
 * path: acceptance stays mandatory, the invitation still expires, and only the
 * moment of sending moves.
 */

const LIFECYCLE = readFileSync("src/services/tenants/tenant-invitation-lifecycle-service.ts", "utf8");
const EXPIRY_SWEEP = readFileSync("src/services/tenants/unaccepted-tenancy-expiry-service.ts", "utf8");
const REMINDERS = readFileSync("src/services/tenants/invitation-expiry-reminder-service.ts", "utf8");
const CONFIRM = readFileSync("app/api/bulk-import/[batch_id]/confirm/route.ts", "utf8");

describe("a deferred invitation", () => {
  it("is written QUEUED rather than PENDING", () => {
    expect(LIFECYCLE).toContain('status: deferDispatch ? "QUEUED" : "PENDING"');
  });

  it("sends nothing at creation", () => {
    // The deferred branch returns before the dispatch call.
    const deferredBranch = LIFECYCLE.slice(LIFECYCLE.indexOf("if (deferDispatch) {"));
    const returnIndex = deferredBranch.indexOf("} as any;");
    expect(deferredBranch.slice(0, returnIndex)).not.toContain("dispatchInvitationNotification");
  });

  it("starts the expiry clock when it is sent, not when it was created", () => {
    const dispatchFn = LIFECYCLE.slice(
      LIFECYCLE.indexOf("async dispatchQueuedInvitations"),
      LIFECYCLE.indexOf("async createInvitation")
    );
    expect(dispatchFn).toContain("addDays(DEFAULT_INVITE_DAYS)");
    expect(dispatchFn).toContain('status: "PENDING"');
  });

  it("skips anything no longer queued, so a double tap cannot send twice", () => {
    const dispatchFn = LIFECYCLE.slice(
      LIFECYCLE.indexOf("async dispatchQueuedInvitations"),
      LIFECYCLE.indexOf("async createInvitation")
    );
    expect(dispatchFn).toContain('status: "QUEUED"');
  });

  it("is what bulk import asks for", () => {
    expect(CONFIRM).toContain('dispatch: "DEFERRED"');
  });
});

describe("what QUEUED must never trip", () => {
  // Both sweeps use allowlists, so QUEUED is excluded for free. These pin that
  // — a future edit widening either list to "everything except X" would put
  // unsent invitations back in the firing line.
  it("is not swept by the unaccepted-tenancy expiry", () => {
    expect(EXPIRY_SWEEP).toContain('status: { in: ["PENDING", "OPENED", "EXPIRED"] }');
    expect(EXPIRY_SWEEP).not.toContain("QUEUED");
    expect(EXPIRY_SWEEP).not.toContain("not:");
  });

  it("gets no expiry reminder while it is unsent", () => {
    expect(REMINDERS).toContain('status: { in: ["PENDING", "OPENED"] }');
    expect(REMINDERS).not.toContain("QUEUED");
  });

  it("still blocks a duplicate import, because its tenancy is live", () => {
    // Duplicate detection is tenancy-based (INVITED/ACTIVE), not
    // invitation-status based, so a queued invitation's tenancy already
    // blocks a re-import of the same person.
    const validation = readFileSync("lib/services/bulk-import/validation-service.ts", "utf8");
    expect(validation).toContain('LIVE_TENANCY_STATUSES = ["INVITED", "ACTIVE"]');
    expect(validation).toContain("prisma.tenants.findMany");
  });
});

describe("the rule this does not break", () => {
  it("does not reintroduce a path that skips tenant acceptance", () => {
    // Used as code, not merely named in a comment explaining why it is gone.
    expect(LIFECYCLE).not.toMatch(/suppressInvitationNotification\s*[:)=.]/);
    expect(LIFECYCLE).not.toMatch(/data\.suppressInvitationNotification/);
    // The deferred branch must not stamp acceptance or attest on the owner's
    // behalf — that is exactly what ADR-165 removed.
    const deferredBranch = LIFECYCLE.slice(
      LIFECYCLE.indexOf("if (deferDispatch) {"),
      LIFECYCLE.indexOf("const activationLink")
    );
    expect(deferredBranch).not.toContain("acceptance_status");
    expect(deferredBranch).not.toContain("tenant_owner_attestations");
    expect(deferredBranch).not.toContain("activation_completed_at");
  });
});
