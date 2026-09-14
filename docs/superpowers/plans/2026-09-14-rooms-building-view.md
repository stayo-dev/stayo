# Rooms tab as a building — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans. The user prefers inline execution over per-task subagents (memory `prefer-inline-execution`). Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Rooms tab's floor accordion with a building. Floors are stacked top-down, rooms are tiles of tenant faces, and every floor/room/bed action is reachable from that picture.

**Architecture:**
- The backend adds two fields to the existing grouped-rooms response: photo and overdue status, composed from data it already loads.
- The frontend puts every decision in pure `.ts` modules under `features/hostel-drilldown/building/` plus `shared/lib/photoThumbnail.ts`. They are tested under the node-only vitest.
- Components are thin renderers. The existing sheets (`AddRoomModal`, `AddFloorModal`, `EditFloorSheet`, `RoomSheetModal`, `ChangeRoomSheet`, `InviteTenantWizard`) are reused and upgraded, not replaced.

**Tech stack:** React 19 + Vite, Tailwind v4, TanStack Query, vitest (node env, frontend). Next.js 14 + Prisma (backend), vitest `test:pure` (explicit allowlist).

**Spec:** `docs/superpowers/specs/2026-09-14-rooms-building-view-design.md`

## Global constraints

- Frontend tests are `src/**/*.test.ts`, node environment, **no component rendering, no `.test.tsx`**.
- Backend pure tests run only if listed in `apps/backend/vitest.pure.config.ts` `include`.
- No raw `fetch`/`axios` in `features/`, and `src/shared` must not import from `features/app/platforms/portal/domains/services` (`check:architecture`).
- Overdue = the backend's `payment_status === 'OVERDUE'`, never `pending_dues > 0` (pending includes not-yet-due rent).
- Beds per room: 1–20 (the backend refuses more than 20, or fewer than the beds already used).
- ADR number **199** (the highest on `origin/main` was 198 on 2026-09-14). Re-check before merging.
- `apps/frontend` `npm run build` does not typecheck. Run `npx tsc --noEmit -p tsconfig.json` and filter to touched files.

## File map

| File | Responsibility |
|---|---|
| `apps/backend/lib/services/property/room-occupants.ts` (new) | pure occupant mappers (active + invited) |
| `apps/backend/tests/room-occupants.test.ts` (new) | their tests; added to `vitest.pure.config.ts` |
| `apps/backend/lib/services/property-service.ts` | use the mappers in `getFloorsWithRooms` |
| `apps/frontend/src/shared/lib/photoThumbnail.ts` (+test) | ImageKit face-crop thumbnail URL |
| `apps/frontend/src/shared/ui/TenantAvatar.tsx` | `shape="tile"` (small radius) |
| `…/hostel-drilldown/types.ts` | `RoomOccupant` + `photo_url`, `payment_status`, `occupant_type` |
| `…/hostel-drilldown/hooks/useHostelRooms.ts` | map the new fields |
| `…/building/buildingModel.ts` (+test) | floor order, plates, bed slots, summaries, search, lens, aria |
| `…/building/roomSuggestions.ts` (+test) | next room number, room defaults, floor name, new-floor numbers |
| `…/building/liftStrip.ts` (+test) | when to show the strip, which floor is active |
| `…/building/*.tsx` (new) | `BedSlot`, `RoomTile`, `FloorBand`, `LensChips`, `LiftStrip`, `BuildingTip`, `BuildingLegend`, `BuildingSkeleton`, `EmptyBuilding`, `HostelBuilding` |
| `…/add-room/AddRoomModal.tsx` | defaults, reset on open, "add another" |
| `…/add-floor/AddFloorModal.tsx` | suggested name, rent, numbered-room preview, reset on open |
| `…/edit-floor/EditFloorSheet.tsx` | "Add a room here" |
| `…/room-sheet/RoomSheetModal.tsx` | big bed slots, avatars, overdue label, Move, beds stepper |
| `…/owner-tenants/invite/steps/StayStep.tsx` | the preferred-room auto-select applies room defaults |
| `…/pages/HostelRoomsPage.tsx` | rewired to the building; the room sheet follows live data |
| `…/components/FloorGroup.tsx`, `RoomRow.tsx` | deleted |

---

### Task 1: Backend: photo and overdue status on each occupant

**Files:** create `apps/backend/lib/services/property/room-occupants.ts` and `apps/backend/tests/room-occupants.test.ts`; modify `apps/backend/vitest.pure.config.ts` and `apps/backend/lib/services/property-service.ts:44-73,950-967`.

**Produces:** `activeOccupant(allocation, summary)` and `invitedOccupantsFromReservations(reservations)`. Both return plain objects. Active ones carry `photo_url` and `payment_status`; invited ones carry `photo_url`.

- [ ] **Step 1: Failing test** (`tests/room-occupants.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import { activeOccupant, invitedOccupantsFromReservations } from '@/lib/services/property/room-occupants';

const summary = { pending_amount: 4000, payment_status: 'OVERDUE' as const };

describe('activeOccupant', () => {
  const allocation = {
    start_date: new Date('2026-08-01'),
    tenant: {
      id: 't1', monthly_rent: '8000', status: 'ACTIVE', photo_url: 'https://ik.imagekit.io/x/a.jpg',
      personal_email: null, phone_1: '999', profiles: { name: 'Arjun Reddy', email: 'arjun@example.com', phone: null },
      tenant_invitations: [],
    },
  };

  it('carries the photo and the backend’s own overdue verdict', () => {
    const o = activeOccupant(allocation, summary);
    expect(o.photo_url).toBe('https://ik.imagekit.io/x/a.jpg');
    expect(o.payment_status).toBe('OVERDUE');
    expect(o.pending_dues).toBe(4000);
    expect(o.rent).toBe(8000);
    expect(o.name).toBe('Arjun Reddy');
  });

  it('falls back to the invitation name, then "Tenant"', () => {
    const noProfile = { ...allocation, tenant: { ...allocation.tenant, profiles: null, tenant_invitations: [{ name: 'Ravi', email: null, phone: null }] } };
    expect(activeOccupant(noProfile, summary).name).toBe('Ravi');
    const nothing = { ...allocation, tenant: { ...allocation.tenant, profiles: null } };
    expect(activeOccupant(nothing, summary).name).toBe('Tenant');
  });

  it('has no photo rather than an empty string', () => {
    const blank = { ...allocation, tenant: { ...allocation.tenant, photo_url: '' } };
    expect(activeOccupant(blank, summary).photo_url).toBeNull();
  });
});

describe('invitedOccupantsFromReservations', () => {
  const reservation = (status: string) => ({
    tenant_id: 't2', invitation_id: 'i1', reserved_at: new Date('2026-09-01'),
    invitation: { status, name: 'Suresh V', email: null, phone: '888' },
    tenant: { profile_id: null, photo_url: null, monthly_rent: '7000', joined_on: null, personal_email: null, phone_1: null, profiles: null },
  });

  it('keeps live invitations, QUEUED included, and drops the rest', () => {
    const out = invitedOccupantsFromReservations([reservation('PENDING'), reservation('QUEUED'), reservation('CANCELLED')]);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ occupant_type: 'INVITED', status: 'INVITED', name: 'Suresh V', photo_url: null, rent: 7000 });
  });
});
```

- [ ] **Step 2:** add `'tests/room-occupants.test.ts'` to the `include` list. Run `npx vitest run --config vitest.pure.config.ts tests/room-occupants.test.ts`. Expected: FAIL, module missing.
- [ ] **Step 3:** create `room-occupants.ts`:
  - move `ACTIVE_INVITE_STATUSES` and `invitedOccupantsFromReservations` there (adding `photo_url: reservation.tenant?.photo_url || null`)
  - add `activeOccupant(allocation, summary)` with exactly the fields `getFloorsWithRooms` builds today, plus `photo_url: tenant.photo_url || null` and `payment_status: summary.payment_status`
  - import `realEmailOrNull` from `@/src/services/tenants/invited-profile-resolver`
- [ ] **Step 4:** in `property-service.ts`, import both helpers. Delete the local `ACTIVE_INVITE_STATUSES` and `invitedOccupantsFromReservations` only if nothing else in the file uses them (grep first). Replace the inline mapping in `getFloorsWithRooms` with `activeOccupant(a, financialService.getTenantPaymentSummary(a.tenant.id, a.tenant.rent_obligations || []))`.
- [ ] **Step 5:** run the test (PASS). Run `npx tsc --noEmit 2>&1 | grep -E 'room-occupants|property-service'` (no new errors vs. `git stash` baseline).
- [ ] **Step 6:** commit `feat(rooms): photo and overdue status on each room occupant`.

### Task 2: Face-crop thumbnails and a tile-shaped avatar

**Files:** create `apps/frontend/src/shared/lib/photoThumbnail.ts` and `.test.ts`; modify `shared/ui/TenantAvatar.tsx`.

**Produces:** `photoThumbnail(url: string | null | undefined, px: number): string | null`; `TenantAvatar` `shape?: 'square' | 'circle' | 'tile'`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { photoThumbnail } from './photoThumbnail';

describe('photoThumbnail', () => {
  it('asks ImageKit for a face-centred square at twice the size, for sharp retina screens', () => {
    expect(photoThumbnail('https://ik.imagekit.io/stayo/t/a.jpg', 24)).toBe('https://ik.imagekit.io/stayo/t/a.jpg?tr=w-48%2Ch-48%2Cfo-face');
  });
  it('keeps any query the URL already has', () => {
    const out = photoThumbnail('https://ik.imagekit.io/stayo/a.jpg?updatedAt=1', 24)!;
    expect(out).toContain('updatedAt=1');
    expect(out).toContain('tr=w-48%2Ch-48%2Cfo-face');
  });
  it('never stacks a second transform on one already there', () => {
    expect(photoThumbnail('https://ik.imagekit.io/stayo/tr:w-10/a.jpg', 24)).toBe('https://ik.imagekit.io/stayo/tr:w-10/a.jpg');
    expect(photoThumbnail('https://ik.imagekit.io/stayo/a.jpg?tr=w-10', 24)).toBe('https://ik.imagekit.io/stayo/a.jpg?tr=w-10');
  });
  it('leaves other hosts, data URLs and junk alone', () => {
    expect(photoThumbnail('https://cdn.example.com/a.jpg', 24)).toBe('https://cdn.example.com/a.jpg');
    expect(photoThumbnail('data:image/png;base64,xx', 24)).toBe('data:image/png;base64,xx');
    expect(photoThumbnail('not a url', 24)).toBe('not a url');
  });
  it('has nothing to show for no photo', () => {
    expect(photoThumbnail(null, 24)).toBeNull();
    expect(photoThumbnail('', 24)).toBeNull();
  });
});
```

- [ ] **Step 2:** run `npx vitest run src/shared/lib/photoThumbnail.test.ts`. Expected: FAIL.
- [ ] **Step 3:** implement. Parse with `new URL` inside try/catch. Rewrite only when `hostname` ends with `imagekit.io`, the pathname has no `/tr:` and there is no `tr` param: `searchParams.set('tr', \`w-${px*2},h-${px*2},fo-face\`)`.
- [ ] **Step 4:** `TenantAvatar` gets the `'tile'` shape → `rounded-[6px]`. PASS, then commit `feat(ui): face-crop thumbnails for tenant photos`.

### Task 3: The building model

**Files:** create `…/building/buildingModel.ts` and `.test.ts`; modify `…/types.ts` and `…/hooks/useHostelRooms.ts`.

**Produces:**

```ts
export type BedSlot =
  | { kind: 'tenant'; key: string; tenantId: string | null; name: string; photoUrl: string | null; overdue: boolean }
  | { kind: 'invited'; key: string; tenantId: string | null; name: string | null }
  | { kind: 'free'; key: string };
export type Lens = 'free' | 'overdue' | 'invited';
export type Emphasis = 'normal' | 'dim' | 'glow';
export interface SlotCounts { beds: number; tenants: number; free: number; invited: number; overdue: number }
export const UNASSIGNED_FLOOR_ID = '__unassigned';
export function floorLevel(name: string): number | null;          // ground → 0, "Second floor"/"2nd"/"Floor 2" → 2
export function floorPlate(name: string): string;                 // 'G' | 'B' | 'T' | '2' | initials
export function stackFloors<F extends { id: string; order: number }>(floors: F[]): { stacked: F[]; unassigned: F | null };
export function roomBedSlots(room: RoomWithOccupants): BedSlot[];
export function countSlots(slots: BedSlot[]): SlotCounts;
export function countRooms(rooms: RoomWithOccupants[]): SlotCounts;
export function tileColumns(capacity: number): 2 | 3 | 4;
export function tileMinWidthPx(maxCapacity: number): number;      // cols*23 + (cols-1)*4 + 10
export function roomMatches(room: RoomWithOccupants, query: string): boolean;
export function slotEmphasis(slot: BedSlot, lens: Lens | null): Emphasis;
export function roomAriaLabel(roomNumber: string, slots: BedSlot[]): string;
```

- [ ] **Step 1: Failing test** (`buildingModel.test.ts`)

```ts
import { describe, expect, it } from 'vitest';
import type { RoomWithOccupants } from '../types';
import {
  countRooms, countSlots, floorLevel, floorPlate, roomAriaLabel, roomBedSlots, roomMatches,
  slotEmphasis, stackFloors, tileColumns, tileMinWidthPx, UNASSIGNED_FLOOR_ID,
} from './buildingModel';

function room(p: { number?: string; occupied?: number; reserved?: number; capacity?: number; occupants?: RoomWithOccupants['occupants'] }): RoomWithOccupants {
  const { occupied = 0, reserved = 0, capacity = 4 } = p;
  const beds: RoomWithOccupants['beds'] = [];
  for (let i = 0; i < occupied; i++) beds.push({ id: `o${i}`, status: 'occupied' });
  for (let i = 0; i < reserved; i++) beds.push({ id: `r${i}`, status: 'reserved' });
  while (beds.length < capacity) beds.push({ id: `v${beds.length}`, status: 'vacant' });
  return { id: `room-${p.number ?? '101'}`, number: p.number ?? '101', floorId: 'f1', hostelId: 'h1', rent: 8000, beds, occupants: p.occupants ?? [] };
}
const tenant = (name: string, extra: Partial<RoomWithOccupants['occupants'][number]> = {}) =>
  ({ tenant_id: `t-${name}`, name, rent: 8000, pending_dues: 0, status: 'ACTIVE', photo_url: null, payment_status: 'PAID', ...extra });
const invitee = (name: string) => ({ ...tenant(name), status: 'INVITED', occupant_type: 'INVITED', payment_status: 'INVITED' });

describe('floorLevel / floorPlate', () => {
  it.each([
    ['Ground floor', 0, 'G'], ['ground', 0, 'G'], ['G', 0, 'G'],
    ['First floor', 1, '1'], ['Second Floor', 2, '2'], ['twelfth floor', 12, '12'],
    ['2nd floor', 2, '2'], ['Floor 3', 3, '3'], ['Level 4', 4, '4'], ['3', 3, '3'],
  ])('%s is level %s, plate %s', (name, level, plate) => {
    expect(floorLevel(name)).toBe(level);
    expect(floorPlate(name)).toBe(plate);
  });
  it('names the floors that are not levels', () => {
    expect(floorPlate('Basement')).toBe('B');
    expect(floorPlate('Terrace')).toBe('T');
    expect(floorPlate('Roof top')).toBe('T');
    expect(floorPlate('Annexe')).toBe('A');
    expect(floorPlate('Block B')).toBe('BB');
    expect(floorLevel('Annexe')).toBeNull();
  });
});

describe('stackFloors', () => {
  it('puts the highest floor on top, as a building stands', () => {
    const floors = [{ id: 'g', order: 0 }, { id: 'two', order: 2 }, { id: 'one', order: 1 }];
    expect(stackFloors(floors).stacked.map((f) => f.id)).toEqual(['two', 'one', 'g']);
  });
  it('keeps rooms without a floor out of the stack', () => {
    const floors = [{ id: 'g', order: 0 }, { id: UNASSIGNED_FLOOR_ID, order: 999 }];
    const { stacked, unassigned } = stackFloors(floors);
    expect(stacked.map((f) => f.id)).toEqual(['g']);
    expect(unassigned?.id).toBe(UNASSIGNED_FLOOR_ID);
  });
});

describe('roomBedSlots', () => {
  it('shows every tenant, then every invite, then the free beds', () => {
    const slots = roomBedSlots(room({ occupied: 1, reserved: 1, capacity: 4, occupants: [tenant('Arjun'), invitee('Ravi')] }));
    expect(slots.map((s) => s.kind)).toEqual(['tenant', 'invited', 'free', 'free']);
    expect(slots[1]).toMatchObject({ kind: 'invited', name: 'Ravi' });
  });
  it('marks a tenant overdue only on the backend’s OVERDUE verdict', () => {
    const slots = roomBedSlots(room({ occupied: 2, occupants: [tenant('A', { payment_status: 'OVERDUE' }), tenant('B', { pending_dues: 900, payment_status: 'PENDING' })] }));
    expect(slots[0]).toMatchObject({ kind: 'tenant', overdue: true });
    expect(slots[1]).toMatchObject({ kind: 'tenant', overdue: false });
  });
  it('keeps a held bed amber even when the invite has no name to show', () => {
    const slots = roomBedSlots(room({ reserved: 1, occupants: [] }));
    expect(slots[0]).toMatchObject({ kind: 'invited', name: null });
  });
  it('never hides a person when the counts disagree with the list', () => {
    const slots = roomBedSlots(room({ occupied: 1, capacity: 1, occupants: [tenant('A'), tenant('B')] }));
    expect(slots.filter((s) => s.kind === 'tenant')).toHaveLength(2);
  });
  it('gives every slot a stable, unique key', () => {
    const keys = roomBedSlots(room({ occupied: 1, reserved: 1, occupants: [tenant('A'), invitee('B')] })).map((s) => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('counts', () => {
  it('counts beds by what is in them', () => {
    const slots = roomBedSlots(room({ occupied: 2, reserved: 1, capacity: 4, occupants: [tenant('A', { payment_status: 'OVERDUE' }), tenant('B'), invitee('C')] }));
    expect(countSlots(slots)).toEqual({ beds: 4, tenants: 2, free: 1, invited: 1, overdue: 1 });
  });
  it('adds rooms up', () => {
    const a = room({ number: '101', occupied: 1, occupants: [tenant('A')] });
    const b = room({ number: '102', capacity: 2 });
    expect(countRooms([a, b])).toEqual({ beds: 6, tenants: 1, free: 5, invited: 0, overdue: 0 });
  });
});

describe('tile sizing', () => {
  it('fits up to four beds two across, then three, then four', () => {
    expect([1, 4, 5, 9, 10, 20].map(tileColumns)).toEqual([2, 2, 3, 3, 4, 4]);
  });
  it('sizes a tile to its widest room', () => {
    expect(tileMinWidthPx(4)).toBe(2 * 23 + 4 + 10);
    expect(tileMinWidthPx(6)).toBe(3 * 23 + 2 * 4 + 10);
  });
});

describe('roomMatches', () => {
  const r = room({ number: 'G04', occupied: 1, occupants: [tenant('Ravi Kumar')] });
  it('matches everything when nothing is typed', () => expect(roomMatches(r, '  ')).toBe(true));
  it('finds a room by its number', () => expect(roomMatches(r, 'g0')).toBe(true));
  it('finds a room by who lives there', () => expect(roomMatches(r, 'kumar')).toBe(true));
  it('does not match strangers', () => expect(roomMatches(r, 'suresh')).toBe(false));
});

describe('slotEmphasis', () => {
  const [t, i, f] = roomBedSlots(room({ occupied: 1, reserved: 1, capacity: 3, occupants: [tenant('A', { payment_status: 'OVERDUE' }), invitee('B')] }));
  it('leaves everything alone with no lens', () => expect([t, i, f].map((s) => slotEmphasis(s, null))).toEqual(['normal', 'normal', 'normal']));
  it('lights the free beds', () => expect([t, i, f].map((s) => slotEmphasis(s, 'free'))).toEqual(['dim', 'dim', 'glow']));
  it('lights who is overdue', () => expect([t, i, f].map((s) => slotEmphasis(s, 'overdue'))).toEqual(['glow', 'dim', 'dim']));
  it('lights the invites', () => expect([t, i, f].map((s) => slotEmphasis(s, 'invited'))).toEqual(['dim', 'glow', 'dim']));
});

describe('roomAriaLabel', () => {
  it('reads the room out the way an owner would say it', () => {
    const slots = roomBedSlots(room({ number: '302', occupied: 1, reserved: 1, capacity: 4, occupants: [tenant('Arjun Reddy', { payment_status: 'OVERDUE' }), invitee('Ravi Kumar')] }));
    expect(roomAriaLabel('302', slots)).toBe('Room 302: Arjun Reddy, overdue; Ravi Kumar, invited; 2 free beds');
  });
  it('handles an empty room and a single free bed', () => {
    expect(roomAriaLabel('403', roomBedSlots(room({ capacity: 4 })))).toBe('Room 403: 4 free beds');
    expect(roomAriaLabel('404', roomBedSlots(room({ occupied: 1, capacity: 2, occupants: [tenant('A')] })))).toBe('Room 404: A; 1 free bed');
  });
  it('names a held bed without an invite name', () => {
    expect(roomAriaLabel('9', roomBedSlots(room({ reserved: 1, capacity: 1 })))).toBe('Room 9: 1 bed held for an invite');
  });
});
```

- [ ] **Step 2:** run it (FAIL). **Step 3:** implement:
  - `RoomOccupant` gains `photo_url?: string | null; payment_status?: string; occupant_type?: string`, and `useHostelRooms.mapRoom` copies them through. Its backend `tenants` type gains the same optional fields.
  - `roomBedSlots` walks `room.beds` in order: occupied → the next non-invited occupant, reserved → the next invited occupant, vacant → free. It then appends any non-invited occupant left over as an extra tenant slot.
  - Plate initials: the first letter of each of up to two words, uppercased.
- [ ] **Step 4:** PASS, then commit `feat(rooms): the building model`.

### Task 4: Suggestions for new rooms and floors

**Files:** create `…/building/roomSuggestions.ts` and `.test.ts`.

**Produces:**

```ts
export function nextRoomNumber(floorNumbers: string[], hostelNumbers: string[], plate: string): string;
export function newFloorRoomNumbers(plate: string, count: number, hostelNumbers: string[]): string[];
export function mostCommon(values: number[]): number | null;
export function suggestRoomDefaults(input: { floorRooms: { number: string; capacity: number; rent: number }[]; hostelRooms: { number: string; capacity: number; rent: number }[]; plate: string }): { roomNo: string; capacity: number; rent: number | null };
export function suggestFloorName(existing: string[]): string;
```

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { mostCommon, newFloorRoomNumbers, nextRoomNumber, suggestFloorName, suggestRoomDefaults } from './roomSuggestions';

describe('nextRoomNumber', () => {
  it('continues after the highest room on the floor', () => {
    expect(nextRoomNumber(['301', '302', '304'], ['301', '302', '304'], '2')).toBe('305');
  });
  it('keeps the prefix and the padding', () => {
    expect(nextRoomNumber(['G01', 'G04'], [], 'G')).toBe('G05');
    expect(nextRoomNumber(['A-9'], [], 'A')).toBe('A-10');
    expect(nextRoomNumber(['009'], [], '0')).toBe('010');
  });
  it('starts an empty floor from its plate', () => {
    expect(nextRoomNumber([], [], '4')).toBe('401');
    expect(nextRoomNumber([], [], 'G')).toBe('G01');
  });
  it('never suggests a number the hostel already has', () => {
    expect(nextRoomNumber(['305'], ['305', '306', '307'], '3')).toBe('308');
    expect(nextRoomNumber([], ['401', 'g01'], 'G')).toBe('G02');
  });
  it('ignores rooms with no number in them', () => {
    expect(nextRoomNumber(['Suite'], ['Suite'], '1')).toBe('101');
  });
});

describe('newFloorRoomNumbers', () => {
  it('numbers a new floor from its plate, skipping taken ones', () => {
    expect(newFloorRoomNumbers('4', 3, [])).toEqual(['401', '402', '403']);
    expect(newFloorRoomNumbers('G', 2, ['G01'])).toEqual(['G02', 'G03']);
  });
});

describe('mostCommon', () => {
  it('picks the most frequent, the first on a tie, and nothing from nothing', () => {
    expect(mostCommon([4, 3, 4, 2])).toBe(4);
    expect(mostCommon([3, 4])).toBe(3);
    expect(mostCommon([])).toBeNull();
  });
});

describe('suggestRoomDefaults', () => {
  const r = (number: string, capacity: number, rent: number) => ({ number, capacity, rent });
  it('copies the floor’s usual room', () => {
    const d = suggestRoomDefaults({ floorRooms: [r('301', 3, 9000), r('302', 3, 9000), r('303', 4, 8000)], hostelRooms: [], plate: '3' });
    expect(d).toEqual({ roomNo: '304', capacity: 3, rent: 9000 });
  });
  it('falls back to the hostel’s usual room on an empty floor', () => {
    const d = suggestRoomDefaults({ floorRooms: [], hostelRooms: [r('101', 2, 7000), r('102', 2, 7000)], plate: '2' });
    expect(d).toEqual({ roomNo: '201', capacity: 2, rent: 7000 });
  });
  it('asks for rent rather than guessing ₹0 in a brand-new hostel', () => {
    expect(suggestRoomDefaults({ floorRooms: [], hostelRooms: [], plate: 'G' })).toEqual({ roomNo: 'G01', capacity: 4, rent: null });
  });
  it('does not learn a rent of zero', () => {
    expect(suggestRoomDefaults({ floorRooms: [r('101', 4, 0)], hostelRooms: [r('101', 4, 0)], plate: '1' }).rent).toBeNull();
  });
});

describe('suggestFloorName', () => {
  it('starts at the ground', () => expect(suggestFloorName([])).toBe('Ground floor'));
  it('climbs in the owner’s own style', () => {
    expect(suggestFloorName(['Ground floor', 'First floor', 'Second floor'])).toBe('Third floor');
    expect(suggestFloorName(['Ground floor'])).toBe('First floor');
    expect(suggestFloorName(['1st floor', '2nd floor'])).toBe('3rd floor');
    expect(suggestFloorName(['Floor 1', 'Floor 2'])).toBe('Floor 3');
    expect(suggestFloorName(['Level 1'])).toBe('Level 2');
  });
  it('counts on when it recognises nothing', () => {
    expect(suggestFloorName(['Annexe', 'Main block'])).toBe('Floor 3');
  });
  it('never suggests a name that is taken', () => {
    expect(suggestFloorName(['Ground floor', 'First floor', 'floor 2', 'Annexe'])).not.toMatch(/^floor 2$/i);
  });
  it('switches to numbers past the twentieth', () => {
    expect(suggestFloorName(['Twentieth floor'])).toBe('Floor 21');
  });
});
```

- [ ] **Step 2:** FAIL. **Step 3:** implement:
  - parse room numbers with `/^(.*?)(\d+)$/`
  - uniqueness is compared case-insensitively
  - `suggestFloorName` uses `floorLevel` from `buildingModel` and detects the style of the highest recognised name: word-ordinal, numeric-ordinal (`2nd`), or `Floor N` / `Level N`
- [ ] **Step 4:** PASS, then commit `feat(rooms): suggest the next room and floor`.

### Task 5: The lift strip's logic

**Files:** create `…/building/liftStrip.ts` and `.test.ts`.

**Produces:** `showLiftStrip(floorCount: number): boolean` and `activeFloorId(bands: { id: string; top: number }[], line: number): string | null`.

- [ ] **Step 1: Failing test**

```ts
import { describe, expect, it } from 'vitest';
import { activeFloorId, showLiftStrip } from './liftStrip';

describe('showLiftStrip', () => {
  it('only earns its space from three floors up', () => {
    expect([0, 1, 2, 3, 8].map(showLiftStrip)).toEqual([false, false, false, true, true]);
  });
});

describe('activeFloorId', () => {
  const bands = [{ id: 'f3', top: -400 }, { id: 'f2', top: -120 }, { id: 'f1', top: 180 }];
  it('is the last floor whose top has passed the line', () => expect(activeFloorId(bands, 60)).toBe('f2'));
  it('is the top floor before any has reached the line', () => {
    expect(activeFloorId([{ id: 'a', top: 300 }, { id: 'b', top: 500 }], 60)).toBe('a');
  });
  it('is nothing when there are no floors', () => expect(activeFloorId([], 60)).toBeNull());
});
```

- [ ] **Steps 2–4:** FAIL → implement → PASS, then commit `feat(rooms): lift strip logic`.

### Task 6: The building's components

**Files:** create in `…/building/`: `BedSlot.tsx`, `RoomTile.tsx`, `FloorBand.tsx`, `LensChips.tsx`, `LiftStrip.tsx`, `BuildingTip.tsx`, `BuildingLegend.tsx`, `BuildingSkeleton.tsx`, `EmptyBuilding.tsx`, `HostelBuilding.tsx`.

**Consumes:** Tasks 2–5. **Produces:**

```tsx
<HostelBuilding
  hostelFloors={Floor[]} roomsByFloor={Map<string, RoomWithOccupants[]>}
  lens={Lens | null} query={string} isLoading={boolean}
  onOpenRoom={(room) => void} onAddRoom={(floorId: string) => void}
  onEditFloor={(floorId: string) => void} onAddFloor={() => void}
/>
<LensChips counts={SlotCounts} lens={Lens | null} onChange={(lens: Lens | null) => void} />
```

Rendering rules (the spec holds the look; these are the contracts):
- `BedSlot`, `size` in px:
  - tenant → `TenantAvatar shape="tile"` with `photoThumbnail(photoUrl, size)`, initials from `getInitials` (`@features/tenants/utils/normalize`), and a red dot when `overdue`
  - invited → dashed amber square with initials (or none)
  - free → dashed `+`
  - emphasis: dim → `opacity-25`, glow → `ring-2` (success for free, destructive for overdue, warning for invited)
  - `aria-hidden`
- `RoomTile` is a single `<button>`:
  - `aria-label={roomAriaLabel(...)}`
  - when searching and not a match: `opacity-30`; when a match: `ring-2 ring-primary`
  - bed grid columns from `tileColumns`, 23 px slots
  - `data-room-id` for scroll-to
- `FloorBand` has a `ref` (for the lift strip and scroll-to) and `scroll-mt-*` so the sticky strip never covers a floor it jumped to:
  - plate column: a plate `<button aria-label="Edit {name}">` with a small ✎ badge, then `{free} free`, then a dashed `+` `<button aria-label="Add a room to {name}">`
  - rooms grid: `gridTemplateColumns: repeat(auto-fill, minmax(${tileMinWidthPx(maxCap)}px, 1fr))`
  - an empty floor says *No rooms yet*
  - the unassigned band has plate `–`, no edit and no +
- `HostelBuilding`:
  - with no floors and not loading → `EmptyBuilding`
  - loading → `BuildingSkeleton`
  - otherwise:
    - `LiftStrip` when `showLiftStrip(stacked.length)`, sticky at `top-0 lg:top-[41px]` (desktop's sticky tab row). Active floor comes from `activeFloorId` over band tops on a rAF-throttled scroll listener. A tap scrolls to that band.
    - roof: a `clip-path` trapezoid, `{tenants} of {beds} beds filled`, and a `+ Add floor` pill
    - stacked `FloorBand`s, ground + entrance, the unassigned band, `BuildingLegend`
    - when `query` changes and matches something, scroll the first matching tile into view
- `BuildingTip` is dismissible, `localStorage` key `stayo.rooms.buildingTip.v1`, all access in try/catch.
- `EmptyBuilding`: `StayoDog expression="happy"` (from `@shared/ui/brand`), "Let's build your hostel", and the outline with a dashed "+ Add your first floor" button.

- [ ] **Step 1:** write the components. **Step 2:** `npx tsc --noEmit -p tsconfig.json 2>&1 | grep building/` shows nothing. **Step 3:** commit `feat(rooms): the building components`.

### Task 7: The sheets

**Files:** modify `AddRoomModal.tsx`, `AddFloorModal.tsx`, `EditFloorSheet.tsx`, `RoomSheetModal.tsx`, `owner-tenants/invite/steps/StayStep.tsx`.

- [ ] **`AddRoomModal`**:
  - new props `defaults: { floorId: string; roomNo: string; capacity: number; rent: number | null }` and `nextAfter(roomNo: string): string`
  - on the `open` false→true transition, reset every field from `defaults`
  - beds max 20 (was 8)
  - the title names the floor ("Add a room to Second floor")
  - an "Add another after this" checkbox. When checked, a successful `onSubmit` keeps the sheet open, sets the number to `nextAfter(submitted)` and toasts `Room {n} added`.
  - the button reads `Add room {number}`
- [ ] **`AddFloorModal`**:
  - props `suggestedName`, `defaultRent: number | null`, `roomNumbersFor(name: string, count: number): string[]`
  - reset on open
  - a rent-per-bed field
  - the preview says "Creates {name} with rooms {first}–{last}, {beds} beds each"
  - `onSubmit({ name, roomCount?, bedsPerRoom?, rent? })`
  - beds max 20
- [ ] **`EditFloorSheet`**: optional `onAddRoom` → an "Add a room here" button above rename.
- [ ] **`RoomSheetModal`**:
  - props gain `onInvite(room)` (replacing `onAssign`), `onMoveTenant(occupant)` and `hostelId`
  - a row of 52 px `BedSlot`s from `roomBedSlots(room)` (labels under them: first name / "Invite"). Tapping a free slot → `onInvite(room)`; tapping a tenant slot → navigate to their profile.
  - resident rows use `TenantAvatar` (photo via `photoThumbnail(…, 38)`), an *Overdue* label only on `payment_status === 'OVERDUE'` (the amount stays `pending_dues`), and a **Move** button (`e.stopPropagation`) → `onMoveTenant`
  - edit mode gains a beds stepper: min = `tenants + invited` slots, max 20, sent as `capacity` only when changed. It replaces the "Bed count can't be changed here" line.
- [ ] **`StayStep`**: the preferred-room auto-select calls `selectRoom(room.id)` rather than `setD({ roomId, roomLabel })`, so the room's rent defaults apply exactly as on a manual pick.
- [ ] `npx tsc` filtered, `npm test`, then commit `feat(rooms): every floor and room action from the building`.

### Task 8: Rewire the page

**Files:** modify `pages/HostelRoomsPage.tsx`; delete `components/FloorGroup.tsx` and `components/RoomRow.tsx`.

- [ ] State: `lens`, `search`, `roomSheetRoomId`, `addRoom: { floorId } | null`, `addFloorOpen`, `editingFloorId`, `invite: Partial<InviteWizardData> | null`, `moveTenant`, and the reorder state as today.
- [ ] The room sheet reads `layout` live by id, so a capacity change or a move shows immediately (it held a stale snapshot before).
- [ ] Top: `LensChips` (counts from `countRooms(all rooms)`), then the search/`+ Add`/`⇅` row (Add → add room on the first floor in building order), then `BuildingTip`, then `HostelBuilding`. Reorder mode keeps today's panel.
- [ ] **Invite:** `setInvite({ hostelId, preferredRoomId: room.id, preferredFloorId: room.floorId, preferredRoomNo: room.number })` → `<InviteTenantWizard open={invite != null} initialData={invite ?? undefined} onClose={() => setInvite(null)} />`.
- [ ] **Add floor:** `createFloor({ name, sort_order: floors.length })`, then `newFloorRoomNumbers(floorPlate(name), count, allNumbers)` rooms with `capacity` and `base_rent`. Toast the result.
- [ ] **Deep link `?room=`:** open that room's sheet, clear the param (as today), and scroll its tile into view.
- [ ] Run `grep -rn "FloorGroup\|RoomRow" src` and confirm no users remain, then delete both. `npm run check:architecture`, `npm test`, `npx tsc` filtered, then commit `feat(rooms): the Rooms tab is a building`.

### Task 9: Verify in a real browser

- [ ] A throwaway harness (outside `src/`, deleted afterwards) renders `HostelBuilding` + `LensChips` with fixture floors (4 floors × 4 rooms, and 5 × 10). Playwright (npx-cached, `executablePath: /usr/bin/google-chrome`) shoots phone (390×844) and desktop (1200 wide) views: the lens on, search on, lift strip active after scrolling.
- [ ] Check: no horizontal overflow at 360 px, and tiles never clip. The lift strip sticks and follows the scroll, and a tap lands the floor below the strip.
- [ ] `npm run build` in `apps/frontend` (architecture + branding checks) is green.

### Task 10: Docs, in the same change

- [ ] `docs/obsidian/Decisions.md`: **ADR-199**, the Rooms tab is a building (why faces over dots, why wrap + lift strip over zoom, why one tap target per tile, overdue from `payment_status`).
- [ ] `Features.md` (the Rooms tab entry), `Frontend.md` (`building/` module notes), `APIs.md` (`GET /api/rooms?grouped=true` occupant fields `photo_url`, `payment_status`), `Bugs.md` (Assign dropped the room; "2th Floor"; "Four-01"; the room sheet's stale snapshot), `Changelog.md`.
- [ ] Update the spec where the build differs (the `+ Add` button opens Add room directly; the floor picker inside already offers "+ New").
- [ ] Commit `docs(rooms): ADR-199 and the vault pages for the building`.
