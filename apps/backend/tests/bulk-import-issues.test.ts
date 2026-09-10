import { describe, expect, it } from "vitest";
import {
  buildIssue,
  severityOf,
  groupIssuesByCode,
  type RowIssue,
} from "@/lib/services/bulk-import/issues";

describe("severity", () => {
  it("blocks rows that cannot import", () => {
    expect(severityOf("ROOM_NOT_FOUND")).toBe("BLOCKER");
    expect(severityOf("PHONE_INVALID")).toBe("BLOCKER");
    expect(severityOf("PAYMENT_METHOD_MISSING")).toBe("BLOCKER");
  });

  it("lets the owner decide on capped backfill and overpayment", () => {
    expect(severityOf("BACKFILL_CAPPED")).toBe("NEEDS_CHOICE");
    expect(severityOf("OVERPAID")).toBe("NEEDS_CHOICE");
    expect(severityOf("DUPLICATE_IN_SYSTEM")).toBe("NEEDS_CHOICE");
  });
});

describe("copy", () => {
  it("names the actual room and hostel", () => {
    const issue = buildIssue("ROOM_NOT_FOUND", 7, {
      roomNo: "1O1",
      hostelName: "Sri Adithya Boys Hostel",
      nearestRooms: ["101", "102"],
    });

    expect(issue.title).toContain("1O1");
    expect(issue.title).toContain("Sri Adithya Boys Hostel");
    expect(issue.fix.kind).toBe("PICK_ROOM");
    expect(issue.fix.options).toEqual(["101", "102"]);
    expect(issue.row).toBe(7);
  });

  it("names the actual rupee amounts for an overpayment", () => {
    const issue = buildIssue("OVERPAID", 4, {
      amountPaid: 90000,
      amountOwed: 76500,
      joiningDate: "2026-01-05",
    });

    expect(issue.detail).toContain("90,000");
    expect(issue.detail).toContain("76,500");
    expect(issue.detail).toContain("13,500");
    expect(issue.severity).toBe("NEEDS_CHOICE");
  });

  it("asks for dates in Indian format", () => {
    const issue = buildIssue("DATE_UNREADABLE", 3, { value: "May" });

    expect(issue.detail).toContain("DD/MM/YYYY");
    expect(issue.detail).not.toContain("YYYY-MM-DD");
    expect(issue.detail).toContain("5 January 2026");
  });

  it("says how many months will be billed when backfill is capped", () => {
    const issue = buildIssue("BACKFILL_CAPPED", 9, {
      monthsElapsed: 32,
      cappedTo: 24,
      firstBilledMonth: "October 2023",
    });

    expect(issue.detail).toContain("32");
    expect(issue.detail).toContain("24");
    expect(issue.detail).toContain("October 2023");
    expect(issue.fix.kind).toBe("ACKNOWLEDGE");
  });

  it("never renders a bare code", () => {
    const codes = [
      "ROOM_NOT_FOUND", "ROOM_CAPACITY_EXCEEDED", "ROOM_NO_RENT",
      "PHONE_INVALID", "DUPLICATE_IN_FILE", "DUPLICATE_IN_SYSTEM",
      "PAYMENT_METHOD_MISSING", "OVERPAID", "BACKFILL_CAPPED",
      "FORMULA_IN_CELL", "DATE_UNREADABLE", "HOSTEL_STAMP_MISMATCH",
    ] as const;

    for (const code of codes) {
      const issue = buildIssue(code, 2, {});
      expect(issue.title.length).toBeGreaterThan(10);
      expect(issue.title).not.toContain("_");
      expect(issue.title).not.toBe(code);
    }
  });
});

describe("grouping", () => {
  it("collects repeated codes so the owner decides once", () => {
    const issues: RowIssue[] = [
      buildIssue("BACKFILL_CAPPED", 2, { monthsElapsed: 30, cappedTo: 24 }),
      buildIssue("BACKFILL_CAPPED", 3, { monthsElapsed: 31, cappedTo: 24 }),
      buildIssue("PHONE_INVALID", 4, { value: "98765" }),
    ];

    const groups = groupIssuesByCode(issues);
    const capped = groups.find((g) => g.code === "BACKFILL_CAPPED");

    expect(capped).toBeDefined();
    expect(capped!.rows).toEqual([2, 3]);
    expect(groups).toHaveLength(2);
  });
});
