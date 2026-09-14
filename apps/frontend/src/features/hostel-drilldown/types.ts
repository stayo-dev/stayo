export type { Floor, Room, RoomBed, BedStatus } from '@shared/mocks/rooms';

export type HostelDrilldownTab = 'overview' | 'rooms' | 'tenants';

export interface RoomOccupant {
  tenant_id: string;
  name: string;
  rent: number;
  pending_dues: number;
  status: string;
  /** Uploaded at onboarding (`tenants.photo_url`); null when there is none. */
  photo_url?: string | null;
  /**
   * The backend's own verdict from `getTenantPaymentSummary()` — `OVERDUE`
   * drives the red dot on the Rooms tab. Never infer it from `pending_dues`,
   * which includes rent that is not yet due.
   */
  payment_status?: string;
  /** `INVITED` for someone holding a bed who has not moved in yet. */
  occupant_type?: string;
}

/** Real room shape — the bed/id/rent fields the mock `Room` type has, plus the
 * real per-occupant detail the building (`building/buildingModel`) and
 * `RoomSheetModal` draw from. */
export interface RoomWithOccupants {
  id: string;
  number: string;
  floorId: string;
  hostelId: string;
  rent: number;
  beds: Array<{ id: string; status: 'occupied' | 'reserved' | 'vacant'; tenantId?: string }>;
  occupants: RoomOccupant[];
  /**
   * What the room is like to live in (migration 073) — the owner's own
   * measurements. Null throughout for a room nobody has measured, which the
   * listing shows as nothing rather than as a zero.
   */
  space?: {
    length_ft: number | null;
    width_ft: number | null;
    cupboard_per_bed: boolean | null;
    under_bed_storage: string | null;
    study_desk: string | null;
    windows: number | null;
  } | null;
}
