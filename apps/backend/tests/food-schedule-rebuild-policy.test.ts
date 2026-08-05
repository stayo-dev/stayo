import { describe, expect, it } from "vitest";
import { decideRebuild } from "@/lib/services/food/schedule-rebuild-policy";

/** Pure — no database. Runs under `npm run test:pure`. */
describe("decideRebuild", () => {
  it("builds a fresh schedule when none exists", () => {
    expect(decideRebuild({ mode: "BUILD", currentStatus: null })).toEqual({
      allowed: true,
      replace: "ALL",
      nextStatus: "DRAFT",
      reason: "New schedule",
    });
  });

  it("rebuilds a draft freely", () => {
    const d = decideRebuild({ mode: "BUILD", currentStatus: "DRAFT" });
    expect(d.allowed).toBe(true);
    expect(d.replace).toBe("ALL");
    expect(d.nextStatus).toBe("DRAFT");
  });

  it("REFUSES to rebuild a published schedule under BUILD", () => {
    const d = decideRebuild({ mode: "BUILD", currentStatus: "PUBLISHED" });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/published/i);
  });

  it("REFUSES START_OVER on a published schedule — it is draft-only", () => {
    const d = decideRebuild({ mode: "START_OVER", currentStatus: "PUBLISHED" });
    expect(d.allowed).toBe(false);
  });

  it("allows START_OVER on a draft", () => {
    const d = decideRebuild({ mode: "START_OVER", currentStatus: "DRAFT" });
    expect(d).toEqual({ allowed: true, replace: "ALL", nextStatus: "DRAFT", reason: "Started over" });
  });

  it("allows FILL_GAPS on a published schedule WITHOUT demoting it", () => {
    const d = decideRebuild({ mode: "FILL_GAPS", currentStatus: "PUBLISHED" });
    expect(d.allowed).toBe(true);
    expect(d.replace).toBe("EMPTY_ONLY");
    expect(d.nextStatus).toBeNull();      // <- the critical assertion: stays PUBLISHED
  });

  it("allows FILL_GAPS on a draft, keeping it a draft", () => {
    const d = decideRebuild({ mode: "FILL_GAPS", currentStatus: "DRAFT" });
    expect(d.allowed).toBe(true);
    expect(d.replace).toBe("EMPTY_ONLY");
    expect(d.nextStatus).toBeNull();
  });

  it("never returns nextStatus PUBLISHED — publishing is a separate action", () => {
    const modes: Array<"BUILD" | "FILL_GAPS" | "START_OVER"> = ["BUILD", "FILL_GAPS", "START_OVER"];
    const statuses: Array<"DRAFT" | "PUBLISHED" | null> = ["DRAFT", "PUBLISHED", null];
    for (const mode of modes) {
      for (const currentStatus of statuses) {
        expect(decideRebuild({ mode, currentStatus }).nextStatus).not.toBe("PUBLISHED");
      }
    }
  });
});
