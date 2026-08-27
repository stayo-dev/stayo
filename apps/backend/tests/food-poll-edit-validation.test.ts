import { describe, expect, it } from "vitest";
import { validatePollOptionEdits } from "@/lib/services/food/poll-edit-validation";

/** Pure — no database. Runs under `npm run test:pure`. */

describe("validatePollOptionEdits", () => {
  it("blocks removing an option that already has votes", () => {
    const existing = [
      { id: "a", label: "Bendi Fry", votes: 3 },
      { id: "b", label: "Dal", votes: 0 },
    ];
    const requested = [{ id: "b", label: "Dal" }, { label: "Sambar" }];
    const error = validatePollOptionEdits(existing, requested);
    expect(error?.code).toBe("OPTION_HAS_VOTES");
    expect(error?.message).toContain("Bendi Fry");
  });

  it("allows removing an option with zero votes", () => {
    const existing = [
      { id: "a", label: "Bendi Fry", votes: 0 },
      { id: "b", label: "Dal", votes: 5 },
    ];
    const requested = [{ id: "b", label: "Dal" }, { label: "Sambar" }];
    expect(validatePollOptionEdits(existing, requested)).toBeNull();
  });

  it("allows adding a new option alongside untouched ones", () => {
    const existing = [
      { id: "a", label: "Bendi Fry", votes: 2 },
      { id: "b", label: "Dal", votes: 1 },
    ];
    const requested = [{ id: "a", label: "Bendi Fry" }, { id: "b", label: "Dal" }, { label: "Sambar" }];
    expect(validatePollOptionEdits(existing, requested)).toBeNull();
  });

  it("allows relabeling an option with votes, as long as it isn't removed", () => {
    const existing = [{ id: "a", label: "Bendi Fry", votes: 4 }, { id: "b", label: "Dal", votes: 0 }];
    const requested = [{ id: "a", label: "Bendi Fry (spicy)" }, { id: "b", label: "Dal" }];
    expect(validatePollOptionEdits(existing, requested)).toBeNull();
  });

  it("rejects fewer than 2 resulting options", () => {
    const existing = [{ id: "a", label: "Bendi Fry", votes: 0 }, { id: "b", label: "Dal", votes: 0 }];
    const requested = [{ id: "a", label: "Bendi Fry" }];
    expect(validatePollOptionEdits(existing, requested)?.code).toBe("TOO_FEW_OPTIONS");
  });
});
