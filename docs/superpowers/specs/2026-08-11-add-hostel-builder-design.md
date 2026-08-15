# Add Hostel — building a hostel, not filling a form

**Date:** 2026-08-11
**Status:** approved, implementing
**Related:** `docs/obsidian/Features.md`, `docs/obsidian/APIs.md`, `docs/obsidian/Decisions.md`, `2026-08-07-owner-onboarding-ux-design.md`

## Problem

Hostel creation lives inside the 12-step owner onboarding wizard, before the owner has seen a single screen of value. It asks for floors, rooms-per-floor, beds-per-room and one monthly rent, then provisions the building from those four numbers.

The friction is not the number of questions. It is that **the answers cannot be right**. `OwnerOnboardingData` models the whole building as four scalars:

```ts
floors: number          // 4
roomsPerFloor: number   // 10
bedsPerRoom: number     // 4
monthlyRent: string     // one rent, every room
```

`hostel-provisioning-service.ts` loops those into `floors × roomsPerFloor` identical rooms, numbered `${floor}${nn}`. A real hostel cannot be described this way:

| Reality | Current model |
|---|---|
| Ground floor has 4 rooms, upper floors have 10 | impossible — one `roomsPerFloor` |
| One floor mixes 4-sharing and 2-sharing rooms | impossible — one `bedsPerRoom` |
| 4-sharing ₹6,000, 2-sharing ₹9,000 | impossible — one `base_rent` |
| Rooms numbered `G-01` or `A-101` | impossible — hardcoded pattern |

So the owner commits hard numbers in the abstract, and the building is wrong on arrival — to be fixed room-by-room in the Rooms tab afterwards. The questions feel premature because the answers genuinely do not matter.

Two smaller symptoms of the same cause: `capacity` is both asked directly in `DetailsStep` and derived as `floors × rooms × beds` (two sources, one truth), and `FloorsStep`'s generated floor rows carry an "Edit" affordance that does nothing.

## Constraint discovered during the audit: room rent is a default, not a price

Verified in code, not assumed:

- `rooms.base_rent` → `billing_defaults.auto_fill_room_rent` → **prefills** the invite wizard's rent field
- `allow_override: true` (the default) → the owner freely changes it per tenant at invite time
- the binding figure is `tenants.monthly_rent`, which is what obligations are generated from

Two tenants in the same room can already pay different rents, and that is normal for this sector. The builder must therefore present room rent as a **starting suggestion**, never as a price list, and must not compute revenue projections from it.

## Decisions

1. **Hostel creation leaves onboarding entirely.** Onboarding keeps only what only it can do: welcome → account (+OTP) → KYC → done → the real dashboard. Eight of twelve screens are removed (`create`, `location`, `details`, `floors`, `rooms`, `beds`, `review`, `publish`), along with `roomsPerFloor` / `bedsPerRoom` / `monthlyRent` / `capacity` from the wizard state and the now-meaningless `generationGate`.

2. **A new owner lands on their real dashboard**, with one prominent "set up your first hostel" invitation where the property list will be, and the rest of the dashboard present but quiet. Nothing is blocked and no sample data is fabricated.

3. **Rooms are configured per room, from a per-floor default.** The owner sets a room count and a default sharing/rent for that floor, gets a generated list, and taps any room to override it. Mixed floors are the expected case, not an edge case.

4. **Writes happen incrementally.** The `hostels` row is created when the hostel is named; each floor's rooms are saved on leaving that floor. "Finish later" is therefore free — the partly-built hostel is already on the home screen, and resuming is just reopening it. Build progress is **derived** (a floor with zero rooms is a floor still to do), not stored in a new column.

5. **The first hostel skips the password gate.** `AddHostelModal` currently requires `confirmIdentity(password, 'CREATE_HOSTEL')`. Re-entering a password minutes after signup is pure friction; the gate stays for the second hostel onward, where it guards a real account with real data.

6. **The builder is a guided first run of the Rooms tab**, and hands off to it on finish. Everything it creates stays editable there (floors and rooms already have `PATCH` + `DELETE`, plus room reorder). "Add a floor" in the Rooms tab reuses the builder's floor screen, so filling a floor later is the same experience as filling one during setup.

## Flow

Route `/owner/hostels/new`, resumable at `/owner/hostels/:id/build`. Full screen — this is a craft flow, not a sheet.

**Step 0 · Name it.** Hostel name, city optional. `POST /owner/hostels` fires here; the hostel exists from this moment. Address, pincode and phone are deferred.

**Step 1 · Raise the floors.** Count plus editable names (Ground, 1st, 2nd…). All floor rows are created now, each empty — which is what makes progress derivable.

**Step 2 · Fill each floor** (repeated per floor):

```
Ground floor                          1 of 4

How many rooms?        [ − ]  4  [ + ]

Default for these rooms
  Sharing   [2] [3] ▣4▣ [6]
  Rent      ₹ 6,000 /mo
  ⓘ A starting figure. You set each tenant's
    actual rent when you invite them.

Numbering  ▣101, 102▣  [G-01]  [A-1]

┌──────────────────────────────────┐
│ 101   4-sharing   ₹6,000     ›   │
│ 102   4-sharing   ₹6,000     ›   │
│ 103   4-sharing   ₹6,000     ›   │
│ 104   2-sharing   ₹9,000  ✎  ›   │
└──────────────────────────────────┘
        4 rooms · 14 beds

     [ Floor 1: same as this ▸ ]
```

Three behaviours carry the weight:

- **Tap any room to override** its sharing or rent.
- **Rent is remembered per sharing-count** within the session: set 2-sharing to ₹9,000 once, and every later 2-sharing room prefills ₹9,000.
- **"Same as this"** clones the room count and defaults to the next floor, which the owner then tweaks. Floor 1 is the only one that costs real effort.

**Step 3 · Review.** Floors, rooms, beds. Any floor reopens. Finish lands on the hostel's Rooms tab.

## Explicitly not in scope

- **No revenue projection.** Rooms and beds are facts; rent is a default that varies per tenant, so a monthly-income figure built on it would be a fabricated number on a real dashboard.
- **No bed entities.** Beds are `rooms.capacity`, an integer. There is no beds table and this must not add one.
- **No sample/demo hostel.**
- **No photos, amenities or wifi in the builder** — `rooms.wifi_name` / `notes` already exist and belong in the room sheet.
- **No deposit question in the builder.** The Configuration Hub already owns deposit properly (calculation modes, months-of-rent). New hostels take `DEFAULT_BILLING_DEFAULTS`; the finish screen points there.
- **No room-type preset library.** Per-room editing plus remembered rent covers mixed floors without adding a concept.

## Backend

| Change | Rationale |
|---|---|
| **New** `POST /api/floors/[id]/rooms/bulk` | One request per floor instead of one per room. Single transaction; room numbers validated against `@@unique([hostel_id, room_no])` with a clear conflict error. |
| `POST /owner/hostels` | Already exists; becomes the builder's step 0. |
| `PATCH`/`DELETE` on `/floors/[id]` and `/rooms/[id]` | Already exist; unchanged. The builder relies on them for "edit later". |
| `POST /owner/hostels/provision` | Loses its only caller. Marked deprecated in `APIs.md`; removed in a follow-up rather than in this change. |
| Build progress | Derived from floors with zero rooms. No schema change. |

**Lead-funnel consequence to verify, not assume:** the funnel reaches `LIVE` via `markHostelCreated`, which fires from `provision`. With provisioning removed from onboarding, a lead-originated owner reaches `HOSTEL_CREATED` only when they actually create a hostel. `POST /owner/hostels` already fires the same side effect (ADR-032), so the path should hold — this must be confirmed in code before shipping.

## Testing

Pure, node-environment logic with colocated tests (this frontend has no jsdom):

- room-number generation for each pattern, continuing correctly across floors
- remembered-rent-per-sharing-count resolution
- floor cloning
- build-progress derivation from floors/rooms
- bed and room tallies

Backend: DB-backed coverage for the bulk endpoint — happy path, duplicate room number, cross-owner floor rejection, and atomicity (a failed batch leaves no rooms).
