# Rooms tab as a building — design

**Date:** 2026-09-14 · **Branch:** `feat/ui-ux-polish` · **ADR:** 199 · **Status:** approved by the user in brainstorming (visual companion, three screens); built — where the build differs, this page says so

## Why

The owner's Rooms tab (`features/hostel-drilldown/pages/HostelRoomsPage.tsx`) is a list of collapsible floor cards. Each room row shows one dot per bed (occupied / reserved / vacant). Owners don't think about hostels in dots. They think "who lives where": they recognise tenants by face long before they remember a room number. The dots answer a question owners seldom ask and hide the one they always ask.

The goal is to make the tab **the hostel, drawn as a building**, with every tenant's face in the room they live in, visible the moment the page opens. Every add / edit / move / delete of a floor or room should be one or two taps from that picture.

## What the owner sees

Top to bottom:

1. **Lens chips**, replacing the three stat cards: `N free beds` · `N overdue` · `N invited`. Tapping a chip *filters by emphasis*: matching beds glow, everything else fades to about 25%. Tapping it again clears the filter. Only one lens is active at a time. A chip whose count is 0 is shown but disabled.
2. **Search + actions row:** `Room or tenant…` · `+ Add` (opens Add room on the top floor — its floor picker already offers `+ New` floor, so no menu was needed) · `⇅ Arrange` (the existing reorder mode, ADR-064, unchanged; icon-only below 380px).
3. **Lift strip.** Shown only when the hostel has ≥ 3 floors. It is a sticky row of chips in lift-panel order (G, 1, 2 …). Each chip shows the floor's plate label and free beds, plus a red dot when someone on that floor is overdue. It lights up the floor currently in view, and a tap scrolls to that floor.
4. **First-visit tip card**, dismissible, remembered per browser in `localStorage` (a convenience, not state): *"This is your hostel. Tap a room to see who lives there, invite someone into a free bed, or edit it. Tap a floor number to rename or remove it."*
5. **The building:**
   - The **roof** shows `X of Y beds filled`. A **+ Add floor** pill sits on the roof.
   - **Floors** stack in real-building order: top floor at the top, ground floor at the bottom. Floors are drawn in reverse of `sort_order`, so Arrange still controls the order.
   - Each **floor band** has a left **plate column**:
     - the plate label (tap → floor sheet: rename / summary / remove)
     - `N free`
     - a dashed **+** (tap → add a room to this floor)
   - Each floor band has a **room grid** that wraps: `repeat(auto-fill, minmax(…, 1fr))`. That gives 4 tiles per row on a phone and more on the desktop pane. Faces never shrink.
   - The **ground** and entrance are drawn under the lowest floor.
   - **Rooms without a floor** (the backend's `__unassigned` bucket) appear as an "Not on a floor" band below the ground, with the same tiles. Its plate has no rename/remove.
6. **Legend:** `face = tenant · ● overdue · dashed = invited · + free bed`.

### Room tile

- The room number, then a grid of **bed slots**. The column count is `tileColumns(capacity)`: 1–4 beds → 2, 5–9 → 3, 10+ → 4.
- **Bed slot kinds** (in this order):
  - **tenant:** a photo from ImageKit's face crop, with `TenantAvatar` initials as the fallback. It gets a red dot when `payment_status === 'OVERDUE'`.
  - **invited:** dashed amber, showing the invitee's initials.
  - **free:** a dashed `+`.
- The whole tile is **one button** (≥ 64 px). The faces inside are decorative (`aria-hidden`). The tile's `aria-label` spells the room out, e.g. *"Room 302: Arjun Reddy, overdue; Ravi Kumar, invited; 2 free beds"*.
- Search matches the room number or any occupant's name, case-insensitively. Non-matching tiles fade to 30%, matching tiles get a primary ring, and the page scrolls to the first match. With no match, a line under the search reads *No room or tenant matches "…"*.

### Room sheet (upgraded `RoomSheetModal`)

- A row of **big bed slots** (52 px). Tapping a free slot opens the invite wizard for **this room**. The wizard gets `hostelId` + `preferredRoomId` + `preferredFloorId`, and its preferred-room auto-select now applies the room's rent defaults through the same `selectRoom` path a manual pick uses.
- **Residents** show `TenantAvatar` photos, and an *Overdue* label when overdue (the amount shown stays `pending_dues`, as today). Tapping a resident opens their profile. A **Move** button opens the existing `ChangeRoomSheet`.
- **Edit room** (number, rent, floor) as today, plus a **Beds −/+** stepper. Its minimum is filled + reserved beds and its maximum is 20, mirroring `property-service.updateRoom`'s own validation. The server still decides.
- **Delete** as today (`canDeleteRoom` reasons).

### Add room / add floor

- The **+** under a floor opens `AddRoomModal` with defaults from `suggestRoomDefaults(floorRooms, allRooms)`:
  - **floor:** preselected.
  - **number:** the next free number after the floor's highest numbered room, keeping any prefix and zero padding (`304 → 305`, `G04 → G05`, `A-9 → A-10`). Empty floor → `${plateNumber}01`, e.g. `401` / `G01`. Skips numbers that already exist in the hostel.
  - **beds / rent:** the floor's most common capacity and rent, falling back to the hostel's, falling back to 4 beds / blank rent.
  - The sheet **resets to fresh defaults every time it opens** (today it keeps stale state). An **"Add another"** toggle keeps the sheet open after a save, with the next number suggested.
- **+ Add floor** (roof, and the `+ Add` menu) opens `AddFloorModal`:
  - **name** from `suggestFloorName(existingNames)`: `Ground floor` when there are none, then the next ordinal ("Fourth floor") after the highest one it recognises, else `Floor N`. This fixes today's `${n+1}th Floor` ("2th Floor").
  - **rooms** created with the floor are numbered by `newFloorRoomNumbers(plate, count)`, e.g. `401…405`. Today it produces `"Four-01"`.
  - It also gains a **rent per bed** field, defaulted from the hostel's most common rent, so bulk-created rooms aren't ₹0.

### Floor sheet (`EditFloorSheet`)

Unchanged (rename, summary, delete when empty), plus an **"Add a room here"** button.

### Empty state

With no floors, the building outline (roof + ground) is drawn with one dashed *+ Add your first floor*. `StayoDog` (`expression="happy"`) appears above *"Let's build your hostel"*. This is an allowed dog moment under ADR-191: an empty state in the owner app.

### Loading

A building-shaped skeleton: roof plus three floor bands of pulsing tiles.

## Floor plate labels

`floorPlate(name, index)`, pure:
- `ground` / `g` → `G`; `basement` → `B`; `terrace` / `roof` → `T`
- a leading or trailing number (`Floor 2`, `2nd floor`, `Level 3`) → that number
- an English ordinal word (`first` … `twentieth`) → its number
- otherwise the first letters of up to two words (`Annexe` → `A`, `Block B` → `BB`)

## Data

**Backend (`lib/services/property-service.ts` → `getFloorsWithRooms`).** Each **active** occupant gains `photo_url` (`tenants.photo_url`) and `payment_status` (the `getTenantPaymentSummary()` result the function *already computes*: composed, not recalculated). Each **invited** occupant gains `photo_url` (`reservation.tenant.photo_url`, usually null). The response change is additive. The occupant mapping moves into pure helpers in `lib/services/property/room-occupants.ts` so it can be unit-tested (`test:pure` allowlist).

**Frontend.**
- `RoomOccupant` gains `photo_url`, `payment_status` and `occupant_type`.
- `useHostelRooms`' synthesized `beds[]` stays, since `RoomsReorderPanel` and `BedStatusDots` still use it.
- The building reads `roomBedSlots(room)`: active occupants map to tenant slots and the `reserved` count maps to invited slots (paired with invited occupants by order; if there are fewer occupants than reserved beds, a slot without a name is still dashed amber). Free slots fill up to `capacity`.
- `photoThumbnail(url, px)` rewrites only `*.imagekit.io` URLs to `?tr=w-{2px},h-{2px},fo-face`, which doubles the pixels for retina screens. It returns any other URL unchanged.

## Units (all pure logic tested, components thin)

`features/hostel-drilldown/building/`:
- `buildingModel.ts`: `floorsTopDown`, `floorPlate`, `roomBedSlots`, `floorSummary`, `hostelSummary`, `tileColumns`, `roomMatches`, `slotEmphasis`, `roomAriaLabel`
- `roomSuggestions.ts`: `suggestRoomDefaults`, `nextRoomNumber`, `suggestFloorName`, `newFloorRoomNumbers`
- `liftStrip.ts`: `showLiftStrip`, `activeFloorId` (from band tops vs. the scroll line)
- `photoThumbnail.ts`
- Components: `HostelBuilding`, `FloorBand`, `RoomTile`, `BedSlot`, `LensChips`, `LiftStrip`, `BuildingTip`, `BuildingLegend`, `BuildingSkeleton`, `EmptyBuilding`

`HostelRoomsPage` is rewired to them. `FloorGroup` and `RoomRow` are deleted once nothing imports them. `BedStatusDots` stays (the reorder panel uses it).

## Error handling

- A photo that fails to load falls back to initials (`TenantAvatar` already does this).
- Mutations surface the server's reason through the existing `removalError` / toast pattern.
- A beds stepper below the taken count is disabled at the minimum, and the server message still shows if it refuses.

## Testing

- Frontend: node-only vitest over the pure modules above, with no component rendering (repo rule). Real-browser check with Playwright at phone and desktop widths, run against a harness that feeds the real components fixture data.
- Backend: the pure occupant mappers under `test:pure`. `tsc` is filtered to touched files.

## Not in this change

- Per-bed identity (the backend has none).
- Dragging tenants between rooms in the building.
- A "moving out soon" marker (`tenants.exit_date` exists; later).
- A compact density toggle for 100+ bed hostels.
- Reworking Arrange mode visually.
