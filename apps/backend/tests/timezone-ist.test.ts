import { describe, expect, it } from "vitest";
import { addDaysIso, daysBetweenIso, istDateOf, istToday, weekdayOfIso } from "@/lib/timezone";
import { istDateOf as payoutIstDateOf } from "@/src/services/settlements/payout-promise";

describe("IST calendar dates", () => {
  it("rolls over at IST midnight, not UTC midnight", () => {
    expect(istDateOf("2026-09-14T18:29:59.000Z")).toBe("2026-09-14");
    expect(istDateOf("2026-09-14T18:30:00.000Z")).toBe("2026-09-15");
    expect(istToday(new Date("2026-09-14T18:30:00.000Z"))).toBe("2026-09-15");
  });

  it("is the same function the payout promise has always used", () => {
    expect(payoutIstDateOf).toBe(istDateOf);
  });

  it("does calendar arithmetic across month and year ends", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetweenIso("2026-09-14", "2026-09-16")).toBe(2);
    expect(daysBetweenIso("2026-09-16", "2026-09-14")).toBe(-2);
  });

  it("knows the weekday of a date", () => {
    expect(weekdayOfIso("2026-09-14")).toBe(1); // Monday
    expect(weekdayOfIso("2026-09-20")).toBe(0); // Sunday
  });
});
