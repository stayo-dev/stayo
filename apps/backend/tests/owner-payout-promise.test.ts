import { describe, it, expect } from "vitest";
import {
  expectedPayoutDate,
  scorePromises,
  istDateOf,
  PAYOUT_WORKING_DAYS,
} from "@/src/services/settlements/payout-promise";

/**
 * The promise is the product: an owner's building lease is due on the 5th and
 * he plans around a date, not a status. These tests pin the two things that
 * would quietly break that — a date that lands on a day banks are shut, and an
 * on-time counter that flatters itself.
 */
describe("expectedPayoutDate", () => {
  it("commits to two working days by default", () => {
    expect(PAYOUT_WORKING_DAYS).toBe(2);
    // Mon 2026-08-24 -> Wed 2026-08-26
    expect(expectedPayoutDate("2026-08-24T09:00:00.000Z")).toBe("2026-08-26");
  });

  it("skips the weekend rather than promising a day the bank is shut", () => {
    // Thu 2026-08-27 + 2 working days = Mon 2026-08-31, not Sat the 29th.
    expect(expectedPayoutDate("2026-08-27T09:00:00.000Z")).toBe("2026-08-31");
    // Fri 2026-08-28 -> Tue 2026-09-01
    expect(expectedPayoutDate("2026-08-28T09:00:00.000Z")).toBe("2026-09-01");
  });

  it("counts from the IST day, not the UTC one", () => {
    // 2026-08-24T20:00Z is already Tue the 25th in IST (01:30). Counting from
    // the UTC date would promise Wednesday and be a day early every evening.
    expect(istDateOf("2026-08-24T20:00:00.000Z")).toBe("2026-08-25");
    expect(expectedPayoutDate("2026-08-24T20:00:00.000Z")).toBe("2026-08-27");
  });

  it("treats a weekend capture as still costing the weekend", () => {
    // Sat 2026-08-29 -> Mon+Tue -> Tue 2026-09-01.
    expect(expectedPayoutDate("2026-08-29T09:00:00.000Z")).toBe("2026-09-01");
  });
});

describe("scorePromises", () => {
  it("skips payouts that carried no promise instead of inventing a verdict", () => {
    // Items created before migration 075 have no expected date. Counting them
    // as either kept or broken would make the number meaningless in exactly
    // the place it has to be trusted.
    const score = scorePromises([
      { expectedPayoutDate: null, paidAt: "2026-08-20T10:00:00.000Z" },
      { expectedPayoutDate: "2026-08-20", paidAt: "2026-08-20T10:00:00.000Z" },
    ]);
    expect(score.judged).toBe(1);
    expect(score.onTime).toBe(1);
    expect(score.allOnTime).toBe(true);
  });

  it("counts a payout made ON the promised day as kept", () => {
    // 12:00 UTC is 17:30 IST — comfortably inside the promised day.
    const score = scorePromises([
      { expectedPayoutDate: "2026-08-26", paidAt: "2026-08-26T12:00:00.000Z" },
    ]);
    expect(score.onTime).toBe(1);
  });

  it("judges lateness by the IST day, not the UTC one", () => {
    // 18:30 UTC is exactly 00:00 IST the NEXT day. An admin who transfers at
    // 11:55 PM IST met the promise; one who transfers at 12:05 AM IST did not,
    // and the owner reads both in IST. Scoring in UTC would call the first late
    // every evening after 6:30 PM.
    expect(
      scorePromises([{ expectedPayoutDate: "2026-08-26", paidAt: "2026-08-26T18:25:00.000Z" }]).onTime,
    ).toBe(1);
    expect(
      scorePromises([{ expectedPayoutDate: "2026-08-26", paidAt: "2026-08-26T18:30:00.000Z" }]).onTime,
    ).toBe(0);
  });

  it("counts a payout made after the promised day as late", () => {
    const score = scorePromises([
      { expectedPayoutDate: "2026-08-26", paidAt: "2026-08-27T04:00:00.000Z" },
    ]);
    expect(score.judged).toBe(1);
    expect(score.onTime).toBe(0);
    expect(score.allOnTime).toBe(false);
  });

  it("breaks the streak at the first late payout, newest first", () => {
    const score = scorePromises([
      { expectedPayoutDate: "2026-08-26", paidAt: "2026-08-26T10:00:00.000Z" },
      { expectedPayoutDate: "2026-08-24", paidAt: "2026-08-24T10:00:00.000Z" },
      { expectedPayoutDate: "2026-08-20", paidAt: "2026-08-25T10:00:00.000Z" }, // late
      { expectedPayoutDate: "2026-08-18", paidAt: "2026-08-18T10:00:00.000Z" },
    ]);
    expect(score.judged).toBe(4);
    expect(score.onTime).toBe(3);
    expect(score.streak).toBe(2);
    expect(score.allOnTime).toBe(false);
  });

  it("reports nothing rather than a perfect record when there is no history", () => {
    // "All on time" out of zero payouts is a claim, not a fact, and it would
    // appear on the screen of every owner who has never been paid.
    const score = scorePromises([]);
    expect(score.judged).toBe(0);
    expect(score.allOnTime).toBe(false);
  });

  it("ignores an unpaid item, however overdue its promise", () => {
    const score = scorePromises([{ expectedPayoutDate: "2020-01-01", paidAt: null }]);
    expect(score.judged).toBe(0);
  });
});
