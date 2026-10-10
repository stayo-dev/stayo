import { describe, expect, it } from "vitest";
import {
  askAudience,
  buildMealCount,
  cutoffInstant,
  nextServeDate,
  presenceOn,
  type MealResident,
} from "@/src/services/meals/special-meal-rules";

const SUN = "2026-10-11"; // a Sunday
const r = (tenantId: string, extra: Partial<MealResident> = {}): MealResident => ({
  tenantId, name: tenantId.toUpperCase(), roomNo: "101", exitDate: null, phone: "9000000000", ...extra,
});

describe("presenceOn", () => {
  it("is HERE with no leave and no exit", () => {
    expect(presenceOn({ tenantId: "a", exitDate: null, leaves: [], serveDate: SUN })).toBe("HERE");
  });
  it("is ON_LEAVE when a leave covers the date", () => {
    const leaves = [{ tenantId: "a", startDate: "2026-10-10", expectedReturnDate: "2026-10-17" }];
    expect(presenceOn({ tenantId: "a", exitDate: null, leaves, serveDate: SUN })).toBe("ON_LEAVE");
  });
  it("is RETURNING on the return date itself", () => {
    const leaves = [{ tenantId: "a", startDate: "2026-10-05", expectedReturnDate: SUN }];
    expect(presenceOn({ tenantId: "a", exitDate: null, leaves, serveDate: SUN })).toBe("RETURNING");
  });
  it("ignores other tenants' leaves", () => {
    const leaves = [{ tenantId: "b", startDate: "2026-10-10", expectedReturnDate: "2026-10-17" }];
    expect(presenceOn({ tenantId: "a", exitDate: null, leaves, serveDate: SUN })).toBe("HERE");
  });
  it("is MOVED_OUT on or after the exit date", () => {
    expect(presenceOn({ tenantId: "a", exitDate: SUN, leaves: [], serveDate: SUN })).toBe("MOVED_OUT");
    expect(presenceOn({ tenantId: "a", exitDate: "2026-10-12", leaves: [], serveDate: SUN })).toBe("HERE");
  });
});

describe("askAudience", () => {
  it("skips the away, the moved out, the unreachable and the already answered", () => {
    const residents = [r("here"), r("leave"), r("gone", { exitDate: "2026-10-01" }), r("nophone", { phone: null }), r("done"), r("back")];
    const leaves = [
      { tenantId: "leave", startDate: "2026-10-09", expectedReturnDate: "2026-10-20" },
      { tenantId: "back", startDate: "2026-10-01", expectedReturnDate: SUN },
    ];
    const out = askAudience({ serveDate: SUN, residents, leaves, answered: new Set(["done"]) });
    expect(out.map((p) => p.tenantId)).toEqual(["here", "back"]);
    expect(out.find((p) => p.tenantId === "back")?.returning).toBe(true);
  });
});

describe("buildMealCount", () => {
  const base = { serveDate: SUN, leaves: [] as any[], lastChoices: new Map<string, "VEG" | "NON_VEG">() };

  it("cooks only confirmed veg/non-veg under LEAVE_OUT", () => {
    const answers = new Map([
      ["a", { choice: "VEG" as const, source: "WHATSAPP" as const }],
      ["b", { choice: "NON_VEG" as const, source: "WHATSAPP" as const }],
      ["c", { choice: "AWAY" as const, source: "WHATSAPP" as const }],
      ["d", { choice: "SKIP" as const, source: "OWNER" as const }],
    ]);
    const count = buildMealCount({ ...base, policy: "LEAVE_OUT", residents: [r("a"), r("b"), r("c"), r("d"), r("e")], answers });
    expect(count.cook).toEqual({ veg: 1, nonVeg: 1 });
    expect(count).toMatchObject({ confirmed: 4, lastChoice: 0, noAnswer: 1, awaySaid: 1, skipping: 1, onLeave: 0 });
  });

  it("cooks a silent tenant as their last choice under LAST_CHOICE, labelled as such", () => {
    const count = buildMealCount({
      ...base, policy: "LAST_CHOICE", residents: [r("a"), r("b")], answers: new Map(),
      lastChoices: new Map([["a", "NON_VEG"]]),
    });
    expect(count.cook).toEqual({ veg: 0, nonVeg: 1 });
    expect(count.people.find((p) => p.tenantId === "a")).toMatchObject({ choice: "NON_VEG", basis: "LAST_CHOICE" });
    expect(count.people.find((p) => p.tenantId === "b")).toMatchObject({ choice: null, basis: "NO_ANSWER" });
  });

  it("lets absence win over an answer given before the leave started", () => {
    const count = buildMealCount({
      ...base, policy: "LAST_CHOICE", residents: [r("a")],
      leaves: [{ tenantId: "a", startDate: "2026-10-10", expectedReturnDate: "2026-10-15" }],
      answers: new Map([["a", { choice: "NON_VEG" as const, source: "WHATSAPP" as const }]]),
    });
    expect(count.cook).toEqual({ veg: 0, nonVeg: 0 });
    expect(count.onLeave).toBe(1);
    expect(count.people[0]).toMatchObject({ basis: "ON_LEAVE", choice: null });
  });

  it("drops moved-out residents entirely", () => {
    const count = buildMealCount({ ...base, policy: "LAST_CHOICE", residents: [r("a", { exitDate: "2026-10-01" })], answers: new Map() });
    expect(count.people).toEqual([]);
  });

  it("sorts people by room, then name", () => {
    const count = buildMealCount({
      ...base, policy: "LEAVE_OUT", answers: new Map(),
      residents: [r("z", { roomNo: "102" }), r("b", { roomNo: "101" }), r("a", { roomNo: "101" })],
    });
    expect(count.people.map((p) => p.tenantId)).toEqual(["a", "b", "z"]);
  });
});

describe("nextServeDate", () => {
  it("is today when today is the weekday", () => {
    expect(nextServeDate(0, SUN)).toBe(SUN);
  });
  it("is the coming weekday otherwise", () => {
    expect(nextServeDate(3, SUN)).toBe("2026-10-14"); // Wednesday
    expect(nextServeDate(0, "2026-10-12")).toBe("2026-10-18");
  });
});

describe("cutoffInstant", () => {
  it("is the IST meal start minus the cutoff, as a UTC instant", () => {
    // 12:30 IST = 07:00 UTC; minus 180 min = 04:00 UTC.
    expect(cutoffInstant(SUN, "12:30", 180).toISOString()).toBe("2026-10-11T04:00:00.000Z");
  });
  it("can fall on the previous UTC day", () => {
    expect(cutoffInstant(SUN, "07:00", 180).toISOString()).toBe("2026-10-10T22:30:00.000Z");
  });
});

import { readyRecipients } from "@/src/services/meals/special-meal-rules";

describe("readyRecipients", () => {
  it("pings only residents cooked for with that choice, who have a phone", () => {
    const residents = [r("a"), r("b"), r("c"), r("d", { phone: null }), r("e"), r("f")];
    const count = buildMealCount({
      serveDate: SUN, policy: "LAST_CHOICE", residents,
      leaves: [{ tenantId: "f", startDate: "2026-10-10", expectedReturnDate: "2026-10-12" }],
      answers: new Map([
        ["a", { choice: "NON_VEG" as const, source: "WHATSAPP" as const }],
        ["c", { choice: "AWAY" as const, source: "WHATSAPP" as const }],
        ["d", { choice: "NON_VEG" as const, source: "WHATSAPP" as const }],
        ["e", { choice: "VEG" as const, source: "WHATSAPP" as const }],
        ["f", { choice: "NON_VEG" as const, source: "WHATSAPP" as const }],
      ]),
      lastChoices: new Map([["b", "NON_VEG"]]),
    });
    expect(readyRecipients(count.people, residents, "NON_VEG").map((p) => p.tenantId)).toEqual(["a", "b"]);
    expect(readyRecipients(count.people, residents, "VEG").map((p) => p.tenantId)).toEqual(["e"]);
  });
});
