# Occupancy Rules

## Rule

Occupancy is active occupants divided by room capacity.
At portfolio level, totals aggregate across rooms and hostels.

**How this works:**
1. Rooms define capacity.
2. Active allocations define occupants.
3. UI shows `occupied / capacity` as an occupancy rate.

## Room status

| Status | Meaning |
|---|---|
| Vacant | No active tenants occupy the room. |
| Occupied | Some capacity is used. |
| Full | Active tenants meet or exceed capacity. |

**How this works:**
1. Room helpers count tenants per room.
2. Capacity decides if a room is full.
3. Owners see whether a room can accept another tenant.

## Data sources

| Data | Model |
|---|---|
| Hostel | `hostels` |
| Room | `rooms` |
| Floor | `floors` |
| Tenant assignment | `roomAllocation` |
| Tenant state | `tenants.status` |

**How this works:**
1. Backend returns rooms with tenants or allocations.
2. Frontend normalizes `room_no`, `number`, tenants, and status.
3. Dashboards render counts and occupancy percentage.

## Edge cases

- Zero capacity returns zero occupancy.
- Ended allocations should not count.
- Move-out completion should release occupancy.
- Imported tenants need active allocations to affect occupancy.

**How this works:**
1. Capacity protects division by zero.
2. Allocation dates protect historical records.
3. Active flags decide current occupancy.

