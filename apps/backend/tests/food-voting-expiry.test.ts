import { describe, expect, it } from "vitest";
import { shouldAutoClose } from "@/lib/services/food/voting-expiry";

/** Pure — no database. Runs under `npm run test:pure`. */
const NOW = new Date("2026-08-05T09:00:00Z");

describe("shouldAutoClose", () => {
  it("closes an OPEN period whose end time has passed", () => {
    expect(shouldAutoClose({ status: "OPEN", voting_ends_at: new Date("2026-08-04T09:00:00Z") }, NOW)).toBe(true);
  });

  it("leaves an OPEN period that has not ended yet", () => {
    expect(shouldAutoClose({ status: "OPEN", voting_ends_at: new Date("2026-08-06T09:00:00Z") }, NOW)).toBe(false);
  });

  it("is a no-op on an already CLOSED period", () => {
    expect(shouldAutoClose({ status: "CLOSED", voting_ends_at: new Date("2026-08-01T09:00:00Z") }, NOW)).toBe(false);
  });

  it("is a no-op on a DRAFT period", () => {
    expect(shouldAutoClose({ status: "DRAFT", voting_ends_at: new Date("2026-08-01T09:00:00Z") }, NOW)).toBe(false);
  });

  it("closes exactly at the boundary", () => {
    expect(shouldAutoClose({ status: "OPEN", voting_ends_at: NOW }, NOW)).toBe(true);
  });
});
