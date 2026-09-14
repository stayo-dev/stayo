import { describe, expect, it } from "vitest";
import {
  deriveStayStatus, isHereTonight, isLeaveType, isStaySource, smartReturnDate, validateReturnDate,
} from "@/src/services/stay/stay-status";

const TODAY = "2026-09-14"; // Monday

describe("deriveStayStatus", () => {
  it("treats silence as present", () => expect(deriveStayStatus(null, TODAY)).toBe("PRESENT"));
  it("is on leave before the return date", () =>
    expect(deriveStayStatus({ expectedReturnDate: "2026-09-15" }, TODAY)).toBe("ON_LEAVE"));
  it("is returning today on the return date", () =>
    expect(deriveStayStatus({ expectedReturnDate: TODAY }, TODAY)).toBe("RETURNING_TODAY"));
  it("is late once the return date has passed", () =>
    expect(deriveStayStatus({ expectedReturnDate: "2026-09-13" }, TODAY)).toBe("LATE"));
});

describe("isHereTonight", () => {
  it("counts present and due-back-today, not away or late", () => {
    expect(isHereTonight("PRESENT")).toBe(true);
    expect(isHereTonight("RETURNING_TODAY")).toBe(true);
    expect(isHereTonight("ON_LEAVE")).toBe(false);
    expect(isHereTonight("LATE")).toBe(false);
  });
});

describe("validateReturnDate", () => {
  it("accepts tomorrow through 90 days out", () => {
    expect(validateReturnDate("2026-09-15", TODAY)).toBeNull();
    expect(validateReturnDate("2026-12-13", TODAY)).toBeNull(); // +90
  });
  it("rejects today, the past and beyond 90 days", () => {
    expect(validateReturnDate(TODAY, TODAY)).toBe("TOO_SOON");
    expect(validateReturnDate("2026-09-01", TODAY)).toBe("TOO_SOON");
    expect(validateReturnDate("2026-12-14", TODAY)).toBe("TOO_FAR"); // +91
  });
  it("rejects anything that is not a real YYYY-MM-DD", () => {
    expect(validateReturnDate("2026-02-30", TODAY)).toBe("INVALID_DATE");
    expect(validateReturnDate("15-09-2026", TODAY)).toBe("INVALID_DATE");
    expect(validateReturnDate(20260915, TODAY)).toBe("INVALID_DATE");
    expect(validateReturnDate(null, TODAY)).toBe("INVALID_DATE");
  });
});

describe("smartReturnDate — the one date Going Home offers", () => {
  it.each([
    ["2026-09-14", "2026-09-15", "tomorrow"], // Mon
    ["2026-09-15", "2026-09-16", "tomorrow"], // Tue
    ["2026-09-16", "2026-09-17", "tomorrow"], // Wed
    ["2026-09-17", "2026-09-20", "sunday"], // Thu → weekend trip
    ["2026-09-18", "2026-09-20", "sunday"], // Fri → weekend trip
    ["2026-09-19", "2026-09-20", "tomorrow"], // Sat: Sunday *is* tomorrow
    ["2026-09-20", "2026-09-21", "tomorrow"], // Sun
  ])("on %s suggests %s (%s)", (today, date, label) => {
    expect(smartReturnDate(today)).toEqual({ date, label });
  });
});

describe("guards", () => {
  it("knows the leave types and sources", () => {
    expect(isLeaveType("GOING_HOME")).toBe(true);
    expect(isLeaveType("AWAY_TODAY")).toBe(false);
    expect(isStaySource("QR")).toBe(true);
    expect(isStaySource("SMS")).toBe(false);
  });
});
