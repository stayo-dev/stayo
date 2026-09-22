import { describe, expect, it } from "vitest";
import {
  STAY_GUARDIAN_TEMPLATES,
  STAY_GUARDIAN_FOOTER,
  buildStayDeparturePayload,
  buildStayReturnPayload,
  formatCheckInTime,
  formatReturnDate,
  leaveTypeWord,
} from "@/lib/services/notifications/providers/whatsapp/stay-guardian-template-contracts";

describe("stay guardian template contracts", () => {
  it("names both templates exactly as submitted to Meta", () => {
    expect(STAY_GUARDIAN_TEMPLATES.DEPARTURE.name).toBe("stayo_guardian_stay_departure");
    expect(STAY_GUARDIAN_TEMPLATES.RETURN.name).toBe("stayo_guardian_stay_return");
    expect(STAY_GUARDIAN_TEMPLATES.DEPARTURE.language).toBe("en");
    expect(STAY_GUARDIAN_TEMPLATES.RETURN.language).toBe("en");
  });

  it("every body placeholder has a declared parameter, and vice versa", () => {
    for (const kind of ["DEPARTURE", "RETURN"] as const) {
      const { body, parameters } = STAY_GUARDIAN_TEMPLATES[kind];
      const placeholders = new Set(body.match(/\{\{\d+\}\}/g) ?? []);
      expect(placeholders.size, kind).toBe(parameters.length);
      for (let i = 1; i <= parameters.length; i += 1) {
        expect(body, `${kind} {{${i}}}`).toContain(`{{${i}}}`);
      }
    }
  });

  it("carries the one footer both templates were approved with", () => {
    expect(STAY_GUARDIAN_FOOTER).toBe("Stayo · Reply STOP to pause stay updates");
  });
});

describe("leaveTypeWord", () => {
  it("reads naturally after the body's single preposition 'for'", () => {
    expect(leaveTypeWord("GOING_HOME")).toBe("home");
    expect(leaveTypeWord("VACATION")).toBe("a trip");
  });

  it("never returns an empty string — Meta rejects a blank parameter", () => {
    for (const value of [null, undefined, "", "   ", "SABBATICAL"]) {
      expect(leaveTypeWord(value).trim().length, String(value)).toBeGreaterThan(0);
    }
    expect(leaveTypeWord("SABBATICAL")).toBe("a trip");
  });
});

describe("dates are rendered in IST, never the server's zone", () => {
  it("formats a return date as a weekday and a full month", () => {
    expect(formatReturnDate("2026-09-27")).toBe("Sunday, 27 September");
  });

  it("formats a check-in instant in IST", () => {
    // 14:10 UTC = 19:40 IST on the same day.
    expect(formatCheckInTime("2026-09-27T14:10:00.000Z")).toBe("7:40 PM, 27 Sep");
  });

  it("converts rather than relabelling: a UTC instant late in the day rolls the IST date forward", () => {
    // 20:00 UTC on the 27th is 01:30 IST on the 28th.
    expect(formatCheckInTime("2026-09-27T20:00:00.000Z")).toBe("1:30 AM, 28 Sep");
  });
});

describe("payload builders", () => {
  it("builds the five departure parameters in the declared order", () => {
    const params = buildStayDeparturePayload({
      guardianName: "Ramesh",
      tenantName: "Aarav",
      hostelName: "Sunrise PG",
      leaveType: "GOING_HOME",
      returnDate: "2026-09-27",
    });
    expect(params).toEqual(["Ramesh", "Aarav", "Sunrise PG", "home", "Sunday, 27 September"]);
    expect(params).toHaveLength(STAY_GUARDIAN_TEMPLATES.DEPARTURE.parameters.length);
  });

  it("builds the four return parameters in the declared order", () => {
    const params = buildStayReturnPayload({
      guardianName: "Ramesh",
      tenantName: "Aarav",
      hostelName: "Sunrise PG",
      checkInAt: "2026-09-27T14:10:00.000Z",
    });
    expect(params).toEqual(["Ramesh", "Aarav", "Sunrise PG", "7:40 PM, 27 Sep"]);
    expect(params).toHaveLength(STAY_GUARDIAN_TEMPLATES.RETURN.parameters.length);
  });

  it("strips a possessive from the tenant name, both apostrophe forms", () => {
    // The body reads "{{2}} has left {{3}}" — "Aarav's has left Sunrise PG" is the bug.
    for (const name of ["Aarav's", "Aarav’s", "Anders'"]) {
      const [, tenantName] = buildStayDeparturePayload({
        guardianName: "Ramesh",
        tenantName: name,
        hostelName: "Sunrise PG",
        leaveType: "VACATION",
        returnDate: "2026-09-28",
      });
      expect(tenantName, name).not.toMatch(/['’]s?$/);
    }
  });

  it("never emits an empty parameter from missing data", () => {
    const departure = buildStayDeparturePayload({
      guardianName: "  ",
      tenantName: null,
      hostelName: undefined,
      leaveType: null,
      returnDate: "2026-09-28",
    });
    const ret = buildStayReturnPayload({
      guardianName: null,
      tenantName: "   ",
      hostelName: "",
      checkInAt: "2026-09-28T14:10:00.000Z",
    });
    expect(departure.every((v) => v.trim().length > 0)).toBe(true);
    expect(ret.every((v) => v.trim().length > 0)).toBe(true);
  });
});
