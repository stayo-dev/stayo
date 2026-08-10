export type { Floor, Room, RoomBed, BedStatus } from '@shared/mocks/rooms';

export type HostelDrilldownTab = 'overview' | 'rooms' | 'tenants';

export interface RoomOccupant {
  tenant_id: string;
  name: string;
  rent: number;
  pending_dues: number;
  status: string;
}

/** Real room shape — same bed/id/rent fields the mock `Room` type has (so
 * `RoomRow`/`FloorGroup` need no changes), plus the real per-occupant detail
 * `RoomSheetModal` needs instead of a mock tenant lookup. */
export interface RoomWithOccupants {
  id: string;
  number: string;
  floorId: string;
  hostelId: string;
  rent: number;
  beds: Array<{ id: string; status: 'occupied' | 'reserved' | 'vacant'; tenantId?: string }>;
  occupants: RoomOccupant[];
}
