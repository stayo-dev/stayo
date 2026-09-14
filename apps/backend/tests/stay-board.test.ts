import { describe, expect, it } from "vitest";
import { buildStayBoard, headcountOn, summarizeHostel, summarizePortfolio, type BoardResident } from "@/src/services/stay/stay-board";

const TODAY = "2026-09-14";
const R = (tenantId: string, roomNo: string, name = tenantId): BoardResident => ({ tenantId, name, roomId: `room-${roomNo}`, roomNo });

// 101: A here, B away           → not empty
// 102: C away, D late (2 days)  → EMPTY_TONIGHT
// 103: E due back today         → BACK_TODAY
// 104: F here, tapped I'm Back today
const residents = [R("A", "101"), R("B", "101"), R("C", "102"), R("D", "102"), R("E", "103"), R("F", "104")];
const activeLeaves = [
  { tenantId: "B", leaveType: "GOING_HOME" as const, expectedReturnDate: "2026-09-16" },
  { tenantId: "C", leaveType: "VACATION" as const, expectedReturnDate: "2026-09-30" },
  { tenantId: "D", leaveType: "GOING_HOME" as const, expectedReturnDate: "2026-09-12" },
  { tenantId: "E", leaveType: "GOING_HOME" as const, expectedReturnDate: TODAY },
];
const rooms = [
  { roomId: "room-101", capacity: 3, occupied: 2, available: 1 },
  { roomId: "room-102", capacity: 2, occupied: 2, available: 0 },
  { roomId: "room-103", capacity: 2, occupied: 1, available: 1 },
  { roomId: "room-104", capacity: 1, occupied: 1, available: 0 },
];
const board = buildStayBoard({ residents, activeLeaves, returnedTodayTenantIds: ["F"], rooms, today: TODAY });

describe("buildStayBoard answers the owner's questions", () => {
  it("how many here tonight — present plus due back today", () => {
    expect(board.hereTonight).toBe(3); // A, E, F
    expect(board.here.map((p) => p.tenantId)).toEqual(["A", "E", "F"]);
  });

  it("holds here + away = residents = occupied beds", () => {
    expect(board.hereTonight + board.away).toBe(board.residents);
    expect(board.residents).toBe(board.beds.occupied);
  });

  it("how many meals — here tonight, with late tenants called out separately", () => {
    expect(board.meals).toEqual({ expected: 3, lateMayTurnUp: 1 });
  });

  it("who is back today — not yet arrived first, then arrived", () => {
    expect(board.backToday).toEqual([
      { tenantId: "E", name: "E", roomNo: "103", arrived: false },
      { tenantId: "F", name: "F", roomNo: "104", arrived: true },
    ]);
  });

  it("who is late — oldest first, with days late", () => {
    expect(board.lateList).toEqual([{ tenantId: "D", name: "D", roomNo: "102", expectedReturnDate: "2026-09-12", daysLate: 2 }]);
    expect(board.late).toBe(1);
  });

  it("who is away — soonest back first", () => {
    expect(board.awayList.map((p) => p.tenantId)).toEqual(["B", "C"]);
  });

  it("which rooms need attention", () => {
    expect(board.roomsToCheck).toEqual([
      { roomId: "room-102", roomNo: "102", reason: "EMPTY_TONIGHT", names: ["C", "D"] },
      { roomId: "room-103", roomNo: "103", reason: "BACK_TODAY", names: ["E"] },
    ]);
  });

  it("beds free comes from capacity, not from stay", () => {
    expect(board.beds).toEqual({ capacity: 8, occupied: 6, free: 2 });
  });

  it("the identity holds for every combination of statuses", () => {
    const dates = [null, "2026-09-12", TODAY, "2026-09-20"];
    for (const a of dates) {
      for (const b of dates) {
        const leaves = [
          ...(a ? [{ tenantId: "X", leaveType: "GOING_HOME" as const, expectedReturnDate: a }] : []),
          ...(b ? [{ tenantId: "Y", leaveType: "VACATION" as const, expectedReturnDate: b }] : []),
        ];
        const bd = buildStayBoard({ residents: [R("X", "1"), R("Y", "1")], activeLeaves: leaves, returnedTodayTenantIds: [], rooms: [], today: TODAY });
        expect(bd.hereTonight + bd.away).toBe(2);
      }
    }
  });
});

describe("headcountOn — the denominator for a meal forecast", () => {
  const people = [{ tenantId: "A" }, { tenantId: "B" }, { tenantId: "C" }];
  const leave = (tenantId: string, startDate: string, expectedReturnDate: string) => ({ tenantId, startDate, expectedReturnDate });

  it("counts everyone when nobody is away", () => {
    expect(headcountOn(people, [], "2026-09-14")).toBe(3);
  });

  it("does not count someone whose leave covers the date", () => {
    expect(headcountOn(people, [leave("B", "2026-09-12", "2026-09-20")], "2026-09-14")).toBe(2);
  });

  it("counts them again on their return date", () => {
    const away = [leave("B", "2026-09-12", "2026-09-14")];
    expect(headcountOn(people, away, "2026-09-13")).toBe(2);
    expect(headcountOn(people, away, "2026-09-14")).toBe(3);
  });

  it("counts them on the day before the leave starts, not on the first day", () => {
    const away = [leave("B", "2026-09-15", "2026-09-18")];
    expect(headcountOn(people, away, "2026-09-14")).toBe(3);
    expect(headcountOn(people, away, "2026-09-15")).toBe(2);
  });

  it("answers for tomorrow, which is the point of it", () => {
    const away = [leave("A", "2026-09-10", "2026-09-16"), leave("C", "2026-09-15", "2026-09-17")];
    expect(headcountOn(people, away, "2026-09-14")).toBe(2);
    expect(headcountOn(people, away, "2026-09-15")).toBe(1);
  });

  it("ignores a leave belonging to someone who no longer lives here", () => {
    expect(headcountOn(people, [leave("Z", "2026-09-01", "2026-12-01")], "2026-09-14")).toBe(3);
  });
});

describe("portfolio summary", () => {
  it("adds hostels up", () => {
    const one = summarizeHostel("h1", "Sri Adithya", board);
    expect(one).toEqual({ hostelId: "h1", hostelName: "Sri Adithya", residents: 6, hereTonight: 3, backToday: 2, late: 1, roomsToCheck: 2, mealsExpected: 3 });
    const { totals, hostels } = summarizePortfolio([one, { ...one, hostelId: "h2" }]);
    expect(totals).toEqual({ residents: 12, hereTonight: 6, backToday: 4, late: 2, roomsToCheck: 4, mealsExpected: 6 });
    expect(hostels).toHaveLength(2);
  });
});
