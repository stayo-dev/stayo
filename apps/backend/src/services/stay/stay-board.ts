import { daysBetweenIso } from "@/lib/timezone";
import { deriveStayStatus, isHereTonight, type LeaveType, type StayStatus } from "./stay-status";

/**
 * The owner's Stay board — a read model over residents + active leaves.
 * Every field answers a question an owner asks ("how many for dinner?",
 * "who is late?", "which rooms need attention?"); none is a raw status.
 * Beds come from `roomCapacityService` (passed in as `rooms`), never recomputed.
 */

export interface BoardResident { tenantId: string; name: string; roomId: string; roomNo: string }
export interface BoardLeave { tenantId: string; leaveType: LeaveType; expectedReturnDate: string }
export interface BoardRoom { roomId: string; capacity: number; occupied: number; available: number }
export interface BoardPerson { tenantId: string; name: string; roomNo: string }

export interface StayBoard {
  today: string;
  residents: number;
  hereTonight: number;
  away: number;
  late: number;
  beds: { capacity: number; occupied: number; free: number };
  meals: { expected: number; lateMayTurnUp: number };
  backToday: Array<BoardPerson & { arrived: boolean }>;
  lateList: Array<BoardPerson & { expectedReturnDate: string; daysLate: number }>;
  awayList: Array<BoardPerson & { leaveType: LeaveType; expectedReturnDate: string }>;
  roomsToCheck: Array<{ roomId: string; roomNo: string; reason: "EMPTY_TONIGHT" | "BACK_TODAY"; names: string[] }>;
  here: BoardPerson[];
}

type Placed = { r: BoardResident; leave: BoardLeave | null; status: StayStatus };

const byRoom = (a: BoardPerson, b: BoardPerson) =>
  a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }) || a.name.localeCompare(b.name);
const person = (r: BoardResident): BoardPerson => ({ tenantId: r.tenantId, name: r.name, roomNo: r.roomNo });

export function buildStayBoard(input: {
  residents: BoardResident[];
  activeLeaves: BoardLeave[];
  returnedTodayTenantIds: string[];
  rooms: BoardRoom[];
  today: string;
}): StayBoard {
  const { today } = input;
  const leaveByTenant = new Map(input.activeLeaves.map((l) => [l.tenantId, l]));
  const returnedToday = new Set(input.returnedTodayTenantIds);
  const people: Placed[] = input.residents.map((r) => {
    const leave = leaveByTenant.get(r.tenantId) ?? null;
    return { r, leave, status: deriveStayStatus(leave, today) };
  });

  const here = people.filter((p) => isHereTonight(p.status)).map((p) => person(p.r)).sort(byRoom);
  const late = people.filter((p) => p.status === "LATE");
  const onLeave = people.filter((p) => p.status === "ON_LEAVE");

  const backToday = [
    ...people
      .filter((p) => p.status === "RETURNING_TODAY")
      .map((p) => ({ ...person(p.r), arrived: false }))
      .sort(byRoom),
    ...people
      .filter((p) => p.status === "PRESENT" && returnedToday.has(p.r.tenantId))
      .map((p) => ({ ...person(p.r), arrived: true }))
      .sort(byRoom),
  ];

  const lateList = late
    .map((p) => ({
      ...person(p.r),
      expectedReturnDate: p.leave!.expectedReturnDate,
      daysLate: daysBetweenIso(p.leave!.expectedReturnDate, today),
    }))
    .sort((a, b) => a.expectedReturnDate.localeCompare(b.expectedReturnDate) || byRoom(a, b));

  const awayList = onLeave
    .map((p) => ({ ...person(p.r), leaveType: p.leave!.leaveType, expectedReturnDate: p.leave!.expectedReturnDate }))
    .sort((a, b) => a.expectedReturnDate.localeCompare(b.expectedReturnDate) || byRoom(a, b));

  const byRoomId = new Map<string, Placed[]>();
  for (const p of people) byRoomId.set(p.r.roomId, [...(byRoomId.get(p.r.roomId) ?? []), p]);
  const names = (list: Placed[]) => list.map((p) => p.r.name).sort();
  const roomsToCheck: StayBoard["roomsToCheck"] = [];
  byRoomId.forEach((members: Placed[], roomId: string) => {
    const roomNo = members[0].r.roomNo;
    if (members.every((p) => !isHereTonight(p.status))) {
      roomsToCheck.push({ roomId, roomNo, reason: "EMPTY_TONIGHT", names: names(members) });
      return;
    }
    const due = members.filter((p) => p.status === "RETURNING_TODAY");
    if (due.length > 0) roomsToCheck.push({ roomId, roomNo, reason: "BACK_TODAY", names: names(due) });
  });
  roomsToCheck.sort((a, b) => a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }));

  const sum = (pick: (r: BoardRoom) => number) => input.rooms.reduce((total, r) => total + pick(r), 0);

  return {
    today,
    residents: people.length,
    hereTonight: here.length,
    away: late.length + onLeave.length,
    late: late.length,
    beds: { capacity: sum((r) => r.capacity), occupied: sum((r) => r.occupied), free: sum((r) => r.available) },
    meals: { expected: here.length, lateMayTurnUp: late.length },
    backToday,
    lateList,
    awayList,
    roomsToCheck,
    here,
  };
}

export interface StayHostelSummary {
  hostelId: string;
  hostelName: string;
  residents: number;
  hereTonight: number;
  backToday: number;
  late: number;
  roomsToCheck: number;
  mealsExpected: number;
}

export function summarizeHostel(hostelId: string, hostelName: string, board: StayBoard): StayHostelSummary {
  return {
    hostelId,
    hostelName,
    residents: board.residents,
    hereTonight: board.hereTonight,
    backToday: board.backToday.length,
    late: board.late,
    roomsToCheck: board.roomsToCheck.length,
    mealsExpected: board.meals.expected,
  };
}

export function summarizePortfolio(hostels: StayHostelSummary[]) {
  const add = (key: keyof Omit<StayHostelSummary, "hostelId" | "hostelName">) =>
    hostels.reduce((total, h) => total + h[key], 0);
  return {
    totals: {
      residents: add("residents"),
      hereTonight: add("hereTonight"),
      backToday: add("backToday"),
      late: add("late"),
      roomsToCheck: add("roomsToCheck"),
      mealsExpected: add("mealsExpected"),
    },
    hostels,
  };
}
