# Rooms

## What this does

The rooms module lets owners create floors, create rooms, assign tenants, shift tenants, and inspect occupancy. It connects physical space to tenant allocations and billing.

## Screen breakdown

| Screen | Purpose | Data shown |
|---|---|---|
| Rooms tab | Manages rooms inside a hostel | Floors, rooms, capacity, occupants |
| Room overview | Shows one room deeply | Current tenants, capacity, status |
| Transfer sheet | Moves a tenant | Available rooms and allocation history |
| Allocation timeline | Shows room history | Start date, end date, active allocation |

## Data it needs

- `floorService.getAll(hostelId)` from `/floors`.
- `roomService.getAll(hostelId)` from `/rooms`.
- `roomService.getOverview(id)` from `/rooms/:id/overview`.
- `roomService.getInviteDefaults(id)` from `/rooms/:id/invite-defaults`.
- `allocationService.shift(hostelId, data)` from `/allocations/shift`.
- `allocationService.end(allocationId, data)` from `/allocations/:id/end`.

## Data it produces

- `floors` records.
- `rooms` records.
- `roomAllocation` records.
- Room capacity and occupancy state.
- Allocation activity logs.

## Key components

- `HostelDetailView` contains the room workspace.
- `TransferRoomSheet` moves tenants between rooms.
- `AllocationHistoryTimeline` shows allocation changes.
- Room dialogs inside `HostelDetailView` create, edit, and delete rooms.

## Business logic in this module

- Occupancy is occupied tenants divided by room capacity.
- Full rooms cannot accept more active tenants.
- Active allocation has `is_active = true` and no `end_date`.
- Move-out freezes can block room transfers.

## How this works (step by step)

1. The owner opens a hostel room tab.
2. The UI fetches floors and rooms for the hostel.
3. The owner creates floors or rooms, then assigns tenants.
4. Transfers call `allocationService.shift`.
5. Related room, tenant, and dashboard queries refresh.

## How to reuse this for a new client

- Keep floors optional because smaller hostels may not need them.
- Keep capacity as a room-level field.
- Confirm whether beds need explicit numbering.
- Adjust room labels and gender rules for the new client.

**How this works:**
1. Rooms describe capacity.
2. Allocations describe who occupies that capacity.
3. Dashboard stats calculate occupancy from active allocations.

