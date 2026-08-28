import { describe, expect, it } from "vitest";
import { assertTransferActorOwnsTenant } from "@/src/services/tenants/tenant-transfer-authorization";

/**
 * Who is allowed to move a tenant between hostels.
 *
 * `tenant-transfer-service` validated that the **target room and the tenant
 * belong to the same owner** — and never that this owner is the caller. The
 * only other gate was the route's `["OWNER", "ADMIN"].includes(session.role)`.
 * So any authenticated owner could transfer any other owner's tenant between
 * that owner's hostels, and `transferred_by` would record the wrong actor in
 * an audit log built precisely to answer "who did this".
 *
 * It went unnoticed because nothing in the app called the endpoint. Wiring it
 * into the owner's Move flow is what made it reachable.
 */

describe("assertTransferActorOwnsTenant", () => {
  it("allows an owner to move their own tenant", () => {
    expect(() => assertTransferActorOwnsTenant("owner-1", "owner-1")).not.toThrow();
  });

  it("refuses an owner acting on someone else's tenant", () => {
    expect(() => assertTransferActorOwnsTenant("owner-2", "owner-1")).toThrow(/FORBIDDEN/);
  });

  it("lets an admin act without an owner scope", () => {
    // Platform admins legitimately operate across owners; they are identified
    // by the route passing no scope at all, never by matching an owner id.
    expect(() => assertTransferActorOwnsTenant(undefined, "owner-1")).not.toThrow();
    expect(() => assertTransferActorOwnsTenant(null, "owner-1")).not.toThrow();
  });

  it("refuses when the tenant has no owner rather than treating it as open", () => {
    expect(() => assertTransferActorOwnsTenant("owner-1", null)).toThrow(/FORBIDDEN/);
    expect(() => assertTransferActorOwnsTenant("owner-1", "")).toThrow(/FORBIDDEN/);
  });

  it("does not let an empty scope pass as an admin", () => {
    // An empty string is a resolution failure, not "no scope given". Treating
    // it as admin would turn a bug into a privilege escalation.
    expect(() => assertTransferActorOwnsTenant("", "owner-1")).toThrow(/FORBIDDEN/);
  });
});
