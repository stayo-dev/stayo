import { describe, it, expect } from "vitest";
import { marketingScopeWhere, type MarketingActor } from "@/src/services/marketing/marketing-scope";

const OWNER: MarketingActor = { id: "owner-1", isAdmin: false };
const ADMIN: MarketingActor = { id: "admin-1", isAdmin: true };

describe("marketingScopeWhere", () => {
  it("scopes an owner to hostels they actually own", () => {
    expect(marketingScopeWhere(OWNER, "h1")).toEqual({ id: "h1", owner_id: "owner-1" });
  });

  /**
   * Stayo's team writes listings on the owner's behalf — with permission, and
   * having gone out to photograph the property. That is only possible if an
   * admin can open the editor for a hostel they do not own.
   */
  it("lets an admin author for any hostel, including one an owner runs", () => {
    expect(marketingScopeWhere(ADMIN, "h1")).toEqual({ id: "h1" });
  });

  it("never widens an owner's scope, whatever id they pass", () => {
    // The invariant this protects: a multi-hostel owner must not be able to
    // edit a listing belonging to someone else by guessing an id.
    const where = marketingScopeWhere({ id: "owner-2", isAdmin: false }, "someone-elses-hostel");
    expect(where).toHaveProperty("owner_id", "owner-2");
  });

  it("treats a missing isAdmin as not-admin", () => {
    expect(marketingScopeWhere({ id: "x" } as MarketingActor, "h1")).toEqual({
      id: "h1",
      owner_id: "x",
    });
  });
});
