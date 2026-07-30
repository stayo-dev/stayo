/**
 * Centralized floor/room/bed mock data — shared/mocks/, not per-feature.
 * `hostelId`s match `shared/mocks/dashboard.ts`'s `mockProperties`. Matches
 * the shape and tone of Stayo App.dc.html's Hostel Drill-down → Rooms tab
 * (4 floors, 25/100 beds, floor-grouped rooms with 4 bed-status dots each).
 * Stat tiles (beds occupied, vacant rooms, reserved rooms) are meant to be
 * *derived* from this data via `getHostelRoomStats`, not hardcoded
 * separately, so the UI can never drift out of sync with the room list.
 */

export type BedStatus = 'occupied' | 'reserved' | 'vacant';

export interface RoomBed {
  id: string;
  status: BedStatus;
  tenantId?: string;
}

export interface Room {
  id: string;
  number: string;
  floorId: string;
  hostelId: string;
  rent: number;
  beds: RoomBed[];
}

export interface Floor {
  id: string;
  hostelId: string;
  name: string;
  order: number;
}

function bed(id: string, status: BedStatus, tenantId?: string): RoomBed {
  return { id, status, tenantId };
}

// Sunrise Boys Hostel — matches the design's own example numbers
// (4 floors, 25/100 beds occupied) as closely as a consistent dataset allows.
const sunriseFloors: Floor[] = [
  { id: 'sun-ground', hostelId: 'sunrise-boys-hostel', name: 'Ground Floor', order: 0 },
  { id: 'sun-1', hostelId: 'sunrise-boys-hostel', name: '1st Floor', order: 1 },
  { id: 'sun-2', hostelId: 'sunrise-boys-hostel', name: '2nd Floor', order: 2 },
  { id: 'sun-3', hostelId: 'sunrise-boys-hostel', name: '3rd Floor', order: 3 },
];

const sunriseRooms: Room[] = [
  // Ground — 6 rooms, mostly occupied
  ...['G01', 'G02', 'G03', 'G04', 'G05', 'G06'].map((n, i) => ({
    id: `sun-room-${n}`,
    number: n,
    floorId: 'sun-ground',
    hostelId: 'sunrise-boys-hostel',
    rent: 8000,
    beds: [
      bed(`${n}-a`, i < 4 ? 'occupied' : 'vacant', i < 4 ? 'chinthala-pavan-sai-raj' : undefined),
      bed(`${n}-b`, i < 3 ? 'occupied' : 'vacant'),
      bed(`${n}-c`, 'vacant'),
      bed(`${n}-d`, 'vacant'),
    ],
  })),
  // 1st Floor — 5 rooms, room 101 is 2/4 occupied like the design's example room
  {
    id: 'sun-room-101',
    number: '101',
    floorId: 'sun-1',
    hostelId: 'sunrise-boys-hostel',
    rent: 8000,
    beds: [bed('101-a', 'occupied', 'm-durga-prasad'), bed('101-b', 'occupied'), bed('101-c', 'vacant'), bed('101-d', 'vacant')],
  },
  { id: 'sun-room-102', number: '102', floorId: 'sun-1', hostelId: 'sunrise-boys-hostel', rent: 8000, beds: [bed('102-a', 'vacant'), bed('102-b', 'vacant'), bed('102-c', 'vacant'), bed('102-d', 'vacant')] },
  { id: 'sun-room-103', number: '103', floorId: 'sun-1', hostelId: 'sunrise-boys-hostel', rent: 8000, beds: [bed('103-a', 'vacant'), bed('103-b', 'vacant'), bed('103-c', 'vacant'), bed('103-d', 'vacant')] },
  {
    id: 'sun-room-104',
    number: '104',
    floorId: 'sun-1',
    hostelId: 'sunrise-boys-hostel',
    rent: 8000,
    beds: [bed('104-a', 'reserved'), bed('104-b', 'reserved'), bed('104-c', 'vacant'), bed('104-d', 'vacant')],
  },
  {
    id: 'sun-room-105',
    number: '105',
    floorId: 'sun-1',
    hostelId: 'sunrise-boys-hostel',
    rent: 8000,
    beds: [bed('105-a', 'occupied', 'rohan-reddy'), bed('105-b', 'occupied'), bed('105-c', 'occupied'), bed('105-d', 'vacant')],
  },
  // 2nd Floor — 7 rooms, lightly occupied
  ...['201', '202', '203', '204', '205', '206', '207'].map((n, i) => ({
    id: `sun-room-${n}`,
    number: n,
    floorId: 'sun-2',
    hostelId: 'sunrise-boys-hostel',
    rent: 8200,
    beds: [
      bed(`${n}-a`, i < 2 ? 'occupied' : 'vacant', i === 0 ? 'rishi-singh-raj-purohit' : undefined),
      bed(`${n}-b`, 'vacant'),
      bed(`${n}-c`, 'vacant'),
      bed(`${n}-d`, 'vacant'),
    ],
  })),
  // 3rd Floor — 7 rooms, all vacant (newly opened)
  ...['301', '302', '303', '304', '305', '306', '307'].map((n) => ({
    id: `sun-room-${n}`,
    number: n,
    floorId: 'sun-3',
    hostelId: 'sunrise-boys-hostel',
    rent: 8200,
    beds: [bed(`${n}-a`, 'vacant'), bed(`${n}-b`, 'vacant'), bed(`${n}-c`, 'vacant'), bed(`${n}-d`, 'vacant')],
  })),
];

/** Simple procedural generator for the other mock hostels — same shape, lighter detail. */
function generateHostel(hostelId: string, floorCount: number, roomsPerFloor: number, bedsPerRoom: number, rent: number, occupiedFraction: number) {
  const floorNames = ['Ground Floor', '1st Floor', '2nd Floor', '3rd Floor', '4th Floor'];
  const floors: Floor[] = Array.from({ length: floorCount }, (_, i) => ({
    id: `${hostelId}-f${i}`,
    hostelId,
    name: floorNames[i] ?? `${i}th Floor`,
    order: i,
  }));
  const rooms: Room[] = [];
  let bedIndex = 0;
  const totalBeds = floorCount * roomsPerFloor * bedsPerRoom;
  const occupiedTarget = Math.round(totalBeds * occupiedFraction);
  for (let f = 0; f < floorCount; f++) {
    for (let r = 0; r < roomsPerFloor; r++) {
      const number = `${f === 0 ? 'G' : f}${String(r + 1).padStart(2, '0')}`;
      const beds: RoomBed[] = [];
      for (let b = 0; b < bedsPerRoom; b++) {
        const status: BedStatus = bedIndex < occupiedTarget ? 'occupied' : 'vacant';
        beds.push({ id: `${hostelId}-${number}-${b}`, status });
        bedIndex++;
      }
      rooms.push({ id: `${hostelId}-room-${number}`, number, floorId: floors[f].id, hostelId, rent, beds });
    }
  }
  return { floors, rooms };
}

const nest = generateHostel('nest-co-living', 3, 6, 2, 8500, 0.91);
const urbanRoost = generateHostel('urban-roost-girls-pg', 3, 5, 1, 11000, 0.76);

export const mockFloors: Floor[] = [...sunriseFloors, ...nest.floors, ...urbanRoost.floors];
export const mockRooms: Room[] = [...sunriseRooms, ...nest.rooms, ...urbanRoost.rooms];

export function getHostelFloors(hostelId: string): Floor[] {
  return mockFloors.filter((f) => f.hostelId === hostelId).sort((a, b) => a.order - b.order);
}

export function getHostelRooms(hostelId: string): Room[] {
  return mockRooms.filter((r) => r.hostelId === hostelId);
}

export interface HostelRoomStats {
  bedsOccupied: number;
  bedsTotal: number;
  vacantRooms: number;
  reservedRooms: number;
}

/** Derives the Rooms tab's stat tiles from the room list, so they can never drift out of sync. */
export function getHostelRoomStats(hostelId: string): HostelRoomStats {
  const rooms = getHostelRooms(hostelId);
  let bedsOccupied = 0;
  let bedsTotal = 0;
  let vacantRooms = 0;
  let reservedRooms = 0;
  for (const room of rooms) {
    bedsTotal += room.beds.length;
    bedsOccupied += room.beds.filter((b) => b.status === 'occupied').length;
    if (room.beds.every((b) => b.status === 'vacant')) vacantRooms++;
    if (room.beds.some((b) => b.status === 'reserved')) reservedRooms++;
  }
  return { bedsOccupied, bedsTotal, vacantRooms, reservedRooms };
}
