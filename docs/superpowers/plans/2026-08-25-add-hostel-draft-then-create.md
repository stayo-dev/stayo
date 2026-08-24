# Add Hostel: draft locally, validate at every stage, create once — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Add Hostel builder writing to the server as it walks. Hold the whole build in a local draft, validate at every stage, and create the hostel once — after a preview and an explicit confirmation.

**Architecture:** The builder's three write calls (`POST /api/owner/hostels`, `POST /api/floors`, `POST /api/floors/:id/rooms`) are replaced by one transactional `POST /api/owner/hostels/build` called only from the confirm step. Everything before that lives in a schema-versioned `localStorage` draft. Validation rules move into two pure modules — one per side — so they are testable without a browser or a database.

**Tech Stack:** React 19 + Vite (`apps/frontend`), Next.js 14 App Router + Prisma (`apps/backend`), vitest on both sides (node environment only — **no jsdom, no component rendering**).

**Spec:** `docs/superpowers/specs/2026-08-24-add-hostel-draft-then-create-design.md`

## Global Constraints

- **No component tests.** `apps/frontend` vitest is node-only and matches `src/**/*.test.ts` — never `.test.tsx`. Put decision logic in pure `.ts` modules and test those.
- **Backend pure tests must be registered** in `apps/backend/vitest.pure.config.ts`'s explicit `include` array or they do not run.
- **Never invent money or occupancy figures.** The preview shows rooms, beds, sharing mix and rent range only — no projected revenue. `base_rent` is an invite default, not a price.
- **The draft is cleared only after a confirmed successful create.** A failed create that also loses the building is the worst outcome this change can produce.
- **Draft schema mismatch discards, never migrates.**
- **No step-up password anywhere in hostel creation.** Removed from both the new endpoint and the existing `POST /api/owner/hostels`. If a task's snippet still mentions `identity_token`, `needsPassword` or `CREATE_HOSTEL`, that snippet is stale — drop it.
- **Frontend compiles with `strict: false`** — TypeScript will not narrow a discriminated union on a boolean tag. Use flat `{ ok: boolean; reason: string | null }` shapes, as `propertyRemoval.ts` already does.
- **Run `npm run check:architecture` in `apps/frontend` before every commit** — no raw `fetch`/`axios` outside `@lib/api-client`.
- Backend `npx tsc --noEmit` has a large pre-existing error backlog. Judge your own work with `npx tsc --noEmit 2>&1 | grep -E '<your files>'`.

---

### Task 1: The draft module

**Files:**
- Create: `apps/frontend/src/features/owner-hostel-builder/hostelDraft.ts`
- Test: `apps/frontend/src/features/owner-hostel-builder/hostelDraft.test.ts`

**Interfaces:**
- Consumes: `DraftFloor`, `NumberingPattern` from `./hostelBuilder`.
- Produces:
  - `HOSTEL_DRAFT_KEY = 'stayo.hostelBuilder.draft'`
  - `HOSTEL_DRAFT_VERSION = 1`
  - `type HostelDraft = { version: number; name: string; city: string; numbering: NumberingPattern; floorNames: string[]; floors: DraftFloor[]; activeIndex: number; savedAt: number }`
  - `serializeHostelDraft(input: Omit<HostelDraft, 'version' | 'savedAt'>): string`
  - `parseHostelDraft(raw: string | null): HostelDraft | null`
  - `isHostelDraftResumable(draft: HostelDraft | null): boolean`
  - `describeHostelDraft(draft: HostelDraft): string`
  - `readHostelDraft(): HostelDraft | null`, `writeHostelDraft(input): void`, `clearHostelDraft(): void`

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/features/owner-hostel-builder/hostelDraft.test.ts
import { describe, it, expect } from 'vitest';
import {
  HOSTEL_DRAFT_VERSION,
  describeHostelDraft,
  isHostelDraftResumable,
  parseHostelDraft,
  serializeHostelDraft,
} from './hostelDraft';

const floor = (name: string, roomCount: number) => ({
  id: `local-${name}`,
  name,
  defaultCapacity: 4,
  defaultRent: 6000,
  saved: false,
  rooms: Array.from({ length: roomCount }, (_, i) => ({
    key: `${name}-${i}`,
    roomNo: `10${i + 1}`,
    capacity: 4,
    rent: 6000,
    customised: false,
  })),
});

const input = {
  name: 'Sunrise Residency',
  city: 'Hyderabad',
  numbering: 'NUMERIC' as const,
  floorNames: ['Ground floor', 'First floor'],
  floors: [floor('Ground floor', 3), floor('First floor', 0)],
  activeIndex: 1,
};

describe('hostel draft round trip', () => {
  it('survives serialize then parse', () => {
    const draft = parseHostelDraft(serializeHostelDraft(input));
    expect(draft).not.toBeNull();
    expect(draft!.name).toBe('Sunrise Residency');
    expect(draft!.floors[0].rooms).toHaveLength(3);
    expect(draft!.activeIndex).toBe(1);
  });

  it('stamps the current version and a timestamp', () => {
    const draft = parseHostelDraft(serializeHostelDraft(input))!;
    expect(draft.version).toBe(HOSTEL_DRAFT_VERSION);
    expect(draft.savedAt).toBeGreaterThan(0);
  });
});

describe('hostel draft refuses what it cannot trust', () => {
  it('returns null for nothing', () => {
    expect(parseHostelDraft(null)).toBeNull();
    expect(parseHostelDraft('')).toBeNull();
  });

  // Corrupt or hand-edited storage must not white-screen the builder.
  it('returns null for unparseable JSON rather than throwing', () => {
    expect(parseHostelDraft('{ not json')).toBeNull();
    expect(parseHostelDraft('null')).toBeNull();
    expect(parseHostelDraft('[]')).toBeNull();
  });

  // Half-parsing an unknown shape into a building is worse than starting over.
  it('discards a draft written by another version', () => {
    const raw = JSON.parse(serializeHostelDraft(input));
    raw.version = HOSTEL_DRAFT_VERSION + 1;
    expect(parseHostelDraft(JSON.stringify(raw))).toBeNull();
  });

  it('discards a draft whose floors are not an array', () => {
    const raw = JSON.parse(serializeHostelDraft(input));
    raw.floors = 'three';
    expect(parseHostelDraft(JSON.stringify(raw))).toBeNull();
  });

  it('clamps an activeIndex that points past the floors it has', () => {
    const raw = JSON.parse(serializeHostelDraft(input));
    raw.activeIndex = 99;
    expect(parseHostelDraft(JSON.stringify(raw))!.activeIndex).toBe(1);
  });

  it('recovers from a missing activeIndex rather than discarding the build', () => {
    const raw = JSON.parse(serializeHostelDraft(input));
    delete raw.activeIndex;
    expect(parseHostelDraft(JSON.stringify(raw))!.activeIndex).toBe(0);
  });
});

describe('isHostelDraftResumable', () => {
  it('is false for nothing and for an untouched draft', () => {
    expect(isHostelDraftResumable(null)).toBe(false);
    const blank = parseHostelDraft(
      serializeHostelDraft({ ...input, name: '', city: '', floors: [], floorNames: [] }),
    );
    expect(isHostelDraftResumable(blank)).toBe(false);
  });

  it('is true once the owner has typed a name or added a room', () => {
    const named = parseHostelDraft(serializeHostelDraft({ ...input, floors: [] }));
    expect(isHostelDraftResumable(named)).toBe(true);
  });
});

describe('describeHostelDraft', () => {
  // Shown on the resume prompt, so the owner knows what they are being offered.
  it('says what the draft holds', () => {
    const draft = parseHostelDraft(serializeHostelDraft(input))!;
    expect(describeHostelDraft(draft)).toBe('Sunrise Residency · 2 floors · 3 rooms');
  });

  it('handles singulars and an unnamed build', () => {
    const one = parseHostelDraft(
      serializeHostelDraft({ ...input, name: '', floors: [floor('Ground floor', 1)], floorNames: ['Ground floor'] }),
    )!;
    expect(describeHostelDraft(one)).toBe('Unnamed hostel · 1 floor · 1 room');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/owner-hostel-builder/hostelDraft.test.ts`
Expected: FAIL — `Failed to resolve import "./hostelDraft"`.

- [ ] **Step 3: Write the implementation**

```ts
// apps/frontend/src/features/owner-hostel-builder/hostelDraft.ts
import type { DraftFloor, NumberingPattern } from './hostelBuilder';

/**
 * Draft persistence for the Add Hostel builder.
 *
 * The builder used to write as it walked — naming created the hostel, the
 * floor count created the floors — so an owner who opened it to look around
 * left a real hostel behind. Everything now lives here until they confirm.
 *
 * localStorage rather than a server draft, for the reason `onboardingDraft.ts`
 * already gives: it covers the loss that actually happens (reload, tab close,
 * browser restart on the same device). Switching device mid-build loses it, an
 * accepted limitation rather than an oversight — and a server-side draft would
 * reintroduce, in weaker form, the very thing this change removes.
 */

export const HOSTEL_DRAFT_KEY = 'stayo.hostelBuilder.draft';

/** Bump when the draft's shape changes; older drafts are discarded, never migrated. */
export const HOSTEL_DRAFT_VERSION = 1;

export interface HostelDraft {
  version: number;
  name: string;
  city: string;
  numbering: NumberingPattern;
  floorNames: string[];
  floors: DraftFloor[];
  activeIndex: number;
  savedAt: number;
}

export type HostelDraftInput = Omit<HostelDraft, 'version' | 'savedAt'>;

export function serializeHostelDraft(input: HostelDraftInput): string {
  return JSON.stringify({
    version: HOSTEL_DRAFT_VERSION,
    savedAt: Date.now(),
    name: input.name,
    city: input.city,
    numbering: input.numbering,
    floorNames: input.floorNames,
    floors: input.floors,
    activeIndex: input.activeIndex,
  });
}

export function parseHostelDraft(raw: string | null): HostelDraft | null {
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt or hand-edited storage must not white-screen the builder.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  const c = parsed as Partial<HostelDraft>;
  if (c.version !== HOSTEL_DRAFT_VERSION) return null;
  if (!Array.isArray(c.floors)) return null;

  const floors = c.floors as DraftFloor[];
  const index = Number(c.activeIndex);
  const activeIndex = Number.isFinite(index)
    ? Math.min(Math.max(0, Math.trunc(index)), Math.max(0, floors.length - 1))
    : 0;

  return {
    version: HOSTEL_DRAFT_VERSION,
    name: String(c.name ?? ''),
    city: String(c.city ?? ''),
    numbering: (c.numbering ?? 'NUMERIC') as NumberingPattern,
    floorNames: Array.isArray(c.floorNames) ? (c.floorNames as string[]) : [],
    floors,
    activeIndex,
    savedAt: Number.isFinite(Number(c.savedAt)) ? Number(c.savedAt) : 0,
  };
}

/**
 * Worth offering to restore?
 *
 * Dropping someone back onto an empty build is not resuming anything, and the
 * prompt would be asking about nothing.
 */
export function isHostelDraftResumable(draft: HostelDraft | null): boolean {
  if (!draft) return false;
  if (draft.floors.some((floor) => floor.rooms.length > 0)) return true;
  return Boolean(String(draft.name || '').trim());
}

/** One line for the resume prompt, so the owner knows what they are being offered. */
export function describeHostelDraft(draft: HostelDraft): string {
  const name = String(draft.name || '').trim() || 'Unnamed hostel';
  const floors = draft.floors.length;
  const rooms = draft.floors.reduce((sum, floor) => sum + floor.rooms.length, 0);
  return `${name} · ${floors} ${floors === 1 ? 'floor' : 'floors'} · ${rooms} ${rooms === 1 ? 'room' : 'rooms'}`;
}

/**
 * Storage wrappers. Every access is guarded: Safari private mode throws on
 * write, and a storage failure must never take the builder down with it.
 */
export function readHostelDraft(): HostelDraft | null {
  try {
    return parseHostelDraft(window.localStorage.getItem(HOSTEL_DRAFT_KEY));
  } catch {
    return null;
  }
}

export function writeHostelDraft(input: HostelDraftInput): void {
  try {
    window.localStorage.setItem(HOSTEL_DRAFT_KEY, serializeHostelDraft(input));
  } catch {
    // Losing the draft is bad; taking the builder down is worse.
  }
}

export function clearHostelDraft(): void {
  try {
    window.localStorage.removeItem(HOSTEL_DRAFT_KEY);
  } catch {
    /* nothing to do */
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/features/owner-hostel-builder/hostelDraft.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/owner-hostel-builder/hostelDraft.ts apps/frontend/src/features/owner-hostel-builder/hostelDraft.test.ts
git commit -m "feat(hostel-builder): schema-versioned local draft for an in-progress build"
```

---

### Task 2: The build planner (backend, pure)

**Files:**
- Create: `apps/backend/lib/services/property/build-hostel-plan.ts`
- Test: `apps/backend/tests/build-hostel-plan.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` — add `'tests/build-hostel-plan.test.ts'` to `include`

**Interfaces:**
- Produces:
  - `interface BuildRoomInput { room_no: string; capacity: number; base_rent?: number | null; room_type?: string | null }`
  - `interface BuildFloorInput { name: string; rooms: BuildRoomInput[] }`
  - `interface BuildHostelInput { name: string; city?: string | null; floors: BuildFloorInput[] }`
  - `type BuildHostelPlan = { ok: false; code: 'VALIDATION'; reason: string } | { ok: true; name: string; city: string | null; floors: Array<{ name: string; sort_order: number; rooms: Array<{ room_no: string; capacity: number; base_rent: number | null; room_type: string; sort_order: number }> }> }`
  - `planHostelBuild(input: BuildHostelInput): BuildHostelPlan`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/build-hostel-plan.test.ts
import { describe, it, expect } from 'vitest';
import { planHostelBuild, type BuildHostelInput } from '@/lib/services/property/build-hostel-plan';

const room = (room_no: string, capacity = 4, base_rent: number | null = 6000) => ({
  room_no,
  capacity,
  base_rent,
});

const input = (over: Partial<BuildHostelInput> = {}): BuildHostelInput => ({
  name: 'Sunrise Residency',
  city: 'Hyderabad',
  floors: [
    { name: 'Ground floor', rooms: [room('101'), room('102')] },
    { name: 'First floor', rooms: [room('201', 2, 9000)] },
  ],
  ...over,
});

const ok = (plan: ReturnType<typeof planHostelBuild>) => {
  if (!plan.ok) throw new Error(`expected a plan, got: ${plan.reason}`);
  return plan;
};

describe('planHostelBuild — a complete building', () => {
  it('plans every floor and room in order', () => {
    const plan = ok(planHostelBuild(input()));
    expect(plan.floors.map((f) => f.name)).toEqual(['Ground floor', 'First floor']);
    expect(plan.floors.map((f) => f.sort_order)).toEqual([1, 2]);
    expect(plan.floors[0].rooms.map((r) => r.room_no)).toEqual(['101', '102']);
    expect(plan.floors[0].rooms.map((r) => r.sort_order)).toEqual([0, 1]);
  });

  it('trims the hostel name and normalises a blank city to null', () => {
    const plan = ok(planHostelBuild(input({ name: '  Sunrise Residency  ', city: '   ' })));
    expect(plan.name).toBe('Sunrise Residency');
    expect(plan.city).toBeNull();
  });

  it('derives room_type from capacity, as the per-floor save already did', () => {
    const plan = ok(planHostelBuild(input()));
    expect(plan.floors[1].rooms[0].room_type).toBe('2-sharing');
  });

  // An unpriced room is a real state: base_rent is nullable and the listing
  // shows "Price on request" rather than zero.
  it('carries an unset rent through as null rather than zero', () => {
    const plan = ok(
      planHostelBuild(input({ floors: [{ name: 'Ground floor', rooms: [room('101', 4, null)] }] })),
    );
    expect(plan.floors[0].rooms[0].base_rent).toBeNull();
  });

  it('drops a rent of zero or less rather than storing it', () => {
    const plan = ok(
      planHostelBuild(input({ floors: [{ name: 'Ground floor', rooms: [room('101', 4, 0)] }] })),
    );
    expect(plan.floors[0].rooms[0].base_rent).toBeNull();
  });
});

describe('planHostelBuild — refusals', () => {
  const refusal = (over: Partial<BuildHostelInput>) => {
    const plan = planHostelBuild(input(over));
    expect(plan.ok).toBe(false);
    return (plan as { reason: string }).reason;
  };

  it('refuses a hostel with no name', () => {
    expect(refusal({ name: '   ' })).toMatch(/name/i);
  });

  it('refuses a building with no floors', () => {
    expect(refusal({ floors: [] })).toMatch(/at least one floor/i);
  });

  it('refuses a floor with no name', () => {
    expect(refusal({ floors: [{ name: '  ', rooms: [room('101')] }] })).toMatch(/floor .*name/i);
  });

  // "First floor" twice in one building is a data problem, not a preference.
  it('refuses two floors sharing a name, case-insensitively', () => {
    expect(
      refusal({
        floors: [
          { name: 'Ground floor', rooms: [room('101')] },
          { name: 'ground FLOOR', rooms: [room('201')] },
        ],
      }),
    ).toMatch(/Ground floor.*twice|two floors/i);
  });

  it('refuses a floor with no rooms', () => {
    expect(refusal({ floors: [{ name: 'Ground floor', rooms: [] }] })).toMatch(/Ground floor.*at least one room/i);
  });

  it('refuses a room with no number, naming its floor', () => {
    expect(refusal({ floors: [{ name: 'Ground floor', rooms: [room('  ')] }] })).toMatch(/Ground floor/);
  });

  it('refuses a room with no sharing size', () => {
    expect(refusal({ floors: [{ name: 'Ground floor', rooms: [room('101', 0)] }] })).toMatch(/sharing/i);
  });

  it('refuses a duplicate room number within one floor', () => {
    expect(
      refusal({ floors: [{ name: 'Ground floor', rooms: [room('101'), room('101')] }] }),
    ).toMatch(/101/);
  });

  // The check the per-floor save could never make: it only ever saw one floor,
  // so the server caught this as a CONFLICT on whichever floor saved second.
  it('refuses a duplicate room number BETWEEN floors, naming both', () => {
    const reason = refusal({
      floors: [
        { name: 'Ground floor', rooms: [room('101')] },
        { name: 'First floor', rooms: [room('101')] },
      ],
    });
    expect(reason).toMatch(/101/);
    expect(reason).toMatch(/Ground floor/);
    expect(reason).toMatch(/First floor/);
  });

  it('compares room numbers case-insensitively', () => {
    expect(
      refusal({
        floors: [
          { name: 'Ground floor', rooms: [room('g-01')] },
          { name: 'First floor', rooms: [room('G-01')] },
        ],
      }),
    ).toMatch(/G-01|g-01/);
  });

  // Nothing is written when the plan is refused.
  it('returns no writes at all when it refuses', () => {
    const plan = planHostelBuild(input({ floors: [] }));
    expect(plan).not.toHaveProperty('floors');
  });

  it('survives junk input without throwing', () => {
    expect(() => planHostelBuild({ name: 'x', floors: null as any })).not.toThrow();
    expect(planHostelBuild({ name: 'x', floors: null as any }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run tests/build-hostel-plan.test.ts --config vitest.pure.config.ts`
Expected: FAIL — `No test files found` (not yet in the `include` array). Add `'tests/build-hostel-plan.test.ts'` to `apps/backend/vitest.pure.config.ts`, re-run, then expect FAIL on the missing module.

- [ ] **Step 3: Write the implementation**

```ts
// apps/backend/lib/services/property/build-hostel-plan.ts
/**
 * What creating a whole hostel in one go should write.
 *
 * The builder used to write as it walked — a hostel row on naming, floors on
 * the count, rooms on leaving each floor — so an owner who opened Add Hostel
 * to look around left a real hostel behind. The whole building now arrives at
 * once, which makes a check possible that no single write could ever perform:
 * a room number duplicated **between** floors. The per-floor save only ever
 * saw one floor, and the server caught that as a CONFLICT on whichever floor
 * happened to save second.
 *
 * Pure and separate from the writes for the usual reason: this repo has no
 * provisioned test database, so rules living only inside a Prisma transaction
 * cannot be tested at all. Same shape as `planFloorRoomSave`.
 */

export interface BuildRoomInput {
  room_no: string;
  capacity: number;
  base_rent?: number | null;
  room_type?: string | null;
}

export interface BuildFloorInput {
  name: string;
  rooms: BuildRoomInput[];
}

export interface BuildHostelInput {
  name: string;
  city?: string | null;
  floors: BuildFloorInput[];
}

export interface PlannedBuildRoom {
  room_no: string;
  capacity: number;
  base_rent: number | null;
  room_type: string;
  sort_order: number;
}

export interface PlannedBuildFloor {
  name: string;
  sort_order: number;
  rooms: PlannedBuildRoom[];
}

export type BuildHostelPlan =
  | { ok: false; code: 'VALIDATION'; reason: string }
  | { ok: true; name: string; city: string | null; floors: PlannedBuildFloor[] };

const refuse = (reason: string): BuildHostelPlan => ({ ok: false, code: 'VALIDATION', reason });

export function planHostelBuild(input: BuildHostelInput): BuildHostelPlan {
  const name = String(input?.name ?? '').trim();
  if (!name) return refuse('This hostel needs a name.');

  const floorsIn = Array.isArray(input?.floors) ? input.floors : [];
  if (floorsIn.length === 0) return refuse('A hostel needs at least one floor.');

  const seenFloorNames = new Map<string, string>();
  /** room number (lowercased) -> the floor that already claimed it */
  const seenRoomNumbers = new Map<string, string>();
  const floors: PlannedBuildFloor[] = [];

  for (let f = 0; f < floorsIn.length; f += 1) {
    const floorName = String(floorsIn[f]?.name ?? '').trim();
    if (!floorName) return refuse(`Floor ${f + 1} needs a name.`);

    const floorKey = floorName.toLowerCase();
    if (seenFloorNames.has(floorKey)) {
      return refuse(`Two floors are both called ${floorName}. Rename one of them.`);
    }
    seenFloorNames.set(floorKey, floorName);

    const roomsIn = Array.isArray(floorsIn[f]?.rooms) ? floorsIn[f].rooms : [];
    if (roomsIn.length === 0) return refuse(`${floorName} needs at least one room.`);

    const rooms: PlannedBuildRoom[] = [];
    for (let r = 0; r < roomsIn.length; r += 1) {
      const roomNo = String(roomsIn[r]?.room_no ?? '').trim();
      if (!roomNo) return refuse(`${floorName}: room ${r + 1} needs a number.`);

      const capacity = Number(roomsIn[r]?.capacity ?? 0);
      if (!(capacity > 0)) return refuse(`${floorName}: room ${roomNo} needs a sharing size.`);

      const key = roomNo.toLowerCase();
      const claimedBy = seenRoomNumbers.get(key);
      if (claimedBy) {
        return claimedBy === floorName
          ? refuse(`${floorName}: room ${roomNo} is used twice.`)
          : refuse(`Room ${roomNo} is on both ${claimedBy} and ${floorName}. Room numbers must be unique.`);
      }
      seenRoomNumbers.set(key, floorName);

      const rent = Number(roomsIn[r]?.base_rent ?? 0);
      rooms.push({
        room_no: roomNo,
        capacity,
        // A room nobody priced is a real state; storing 0 would be a claim.
        base_rent: Number.isFinite(rent) && rent > 0 ? rent : null,
        room_type: String(roomsIn[r]?.room_type ?? '').trim() || `${capacity}-sharing`,
        sort_order: r,
      });
    }

    floors.push({ name: floorName, sort_order: f + 1, rooms });
  }

  const city = String(input?.city ?? '').trim();
  return { ok: true, name, city: city || null, floors };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/backend && npx vitest run tests/build-hostel-plan.test.ts --config vitest.pure.config.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/backend/lib/services/property/build-hostel-plan.ts apps/backend/tests/build-hostel-plan.test.ts apps/backend/vitest.pure.config.ts
git commit -m "feat(hostels): pure planner for creating a whole building at once"
```

---

### Task 3: The build endpoint

**Files:**
- Modify: `apps/backend/lib/services/property-service.ts` — add `buildHostel`
- Create: `apps/backend/app/api/owner/hostels/build/route.ts`

**Interfaces:**
- Consumes: `planHostelBuild` (Task 2).
- Produces: `propertyService.buildHostel(ownerId, input: BuildHostelInput)` returning `{ id: string; name: string; floors_created: number; rooms_created: number }`. Throws `Error("VALIDATION: …")` or `Error("CONFLICT: …")`.
- Produces: `POST /api/owner/hostels/build`, body `{ name, city?, floors: [{ name, rooms: [{ room_no, capacity, base_rent? }] }] }`. No `identity_token` — see Step 3.

- [ ] **Step 1: Add the service method**

Insert into `apps/backend/lib/services/property-service.ts`, immediately before `async getFloorsWithRooms(`:

```ts
  /**
   * Create a hostel, its floors and its rooms in one transaction.
   *
   * The builder used to do this in three calls as the owner walked — hostel on
   * naming, floors on the count, rooms per floor — so abandoning the wizard
   * left a real hostel behind. Nothing is written until the owner confirms,
   * and then it is written all at once or not at all.
   *
   * The decision is `planHostelBuild`, pure and tested without a database;
   * this only executes it. The duplicate-name check stays inside the
   * transaction, where a concurrent create cannot slip past it.
   */
  async buildHostel(
    ownerId: string,
    input: { name: string; city?: string | null; floors: Array<{ name: string; rooms: Array<{ room_no: string; capacity: number; base_rent?: number | null }> }> },
  ) {
    const plan = planHostelBuild(input);
    if (!plan.ok) throw new Error(`${plan.code}: ${plan.reason}`);

    const created = await prisma.$transaction(async (tx: any) => {
      const clash = await tx.hostels.findFirst({
        where: {
          owner_id: ownerId,
          status: { in: ["ACTIVE", "INACTIVE"] },
          name: { equals: plan.name, mode: "insensitive" },
        },
        select: { id: true },
      });
      if (clash) throw new Error("CONFLICT: A hostel with this name already exists");

      const hostel = await tx.hostels.create({
        data: {
          owner_id: ownerId,
          name: plan.name,
          city: plan.city,
          address: "",
          phone: "",
          status: "ACTIVE",
          is_active: true,
        },
      });

      let roomsCreated = 0;
      for (const floor of plan.floors) {
        const row = await tx.floors.create({
          data: { hostel_id: hostel.id, owner_id: ownerId, name: floor.name, sort_order: floor.sort_order },
        });
        await tx.rooms.createMany({
          data: floor.rooms.map((room) => ({
            id: crypto.randomUUID(),
            hostel_id: hostel.id,
            floor_id: row.id,
            // The legacy Int column is kept in step with floor_id — parts of
            // the read path still order and group by it.
            floor: floor.sort_order,
            room_no: room.room_no,
            capacity: room.capacity,
            base_rent: room.base_rent,
            room_type: room.room_type,
            sort_order: room.sort_order,
          })),
        });
        roomsCreated += floor.rooms.length;
      }

      return { id: hostel.id, name: hostel.name, floors_created: plan.floors.length, rooms_created: roomsCreated };
    });

    await eventLog
      .log("HOSTEL_BUILT", ownerId, {
        hostel_id: created.id,
        floors_created: created.floors_created,
        rooms_created: created.rooms_created,
      })
      .catch(() => undefined);

    return created;
  }

```

Add the import beside the existing planner import at the top of the file:

```ts
import { planHostelBuild } from "./property/build-hostel-plan";
```

- [ ] **Step 2: Create the route**

```ts
// apps/backend/app/api/owner/hostels/build/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { propertyService } from "@/lib/services/property-service";

/**
 * 🏢 BUILD A HOSTEL — one confirmed create
 * POST /api/owner/hostels/build
 *
 * Replaces the Add Hostel builder's three incremental writes. Nothing exists
 * on the server until the owner confirms; then the hostel, its floors and its
 * rooms are written in one transaction or not at all.
 *
 * **No step-up password.** Creating a hostel is additive: it moves no money
 * and exposes no data. The step-up exists for actions where a hijacked session
 * could do damage — the payout account, settlements — and those keep it. See
 * ADR-110, which narrows ADR-066's rule rather than deleting the mechanism.
 *
 * `POST /api/owner/hostels` stays for its other callers, but loses its own
 * step-up for the same reason (Step 3 below).
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const body = await req.json().catch(() => ({}));

    const built = await propertyService.buildHostel(session.sub, {
      name: body.name,
      city: body.city ?? null,
      floors: Array.isArray(body.floors) ? body.floors : [],
    });

    // Both funnel facts become true at the same instant here: a hostel exists,
    // and it has rooms. `markLiveForOwner` also still fires from the per-floor
    // rooms endpoint, which serves the Rooms tab — removing it there would
    // strip the transition from every hostel not built through this flow.
    const { leadInvitationService } = await import("@/src/services/platform-leads/lead-invitation-service");
    await leadInvitationService.markHostelCreated(session.sub);
    await leadInvitationService.markLiveForOwner(session.sub);

    return apiResponse(built, undefined, { status: 201 });
  } catch (error: any) {
    const msg = typeof error?.message === "string" ? error.message : String(error);
    if (msg.startsWith("CONFLICT")) return apiError(msg.split(": ")[1] ?? msg, "ALREADY_EXISTS", 409);
    if (msg.startsWith("VALIDATION")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    console.error("[owner.hostels.build] Failed:", error);
    return apiError("Could not create this hostel", "INTERNAL_ERROR", 500);
  }
}
```

**Before writing this**, confirm `apiResponse`'s third argument by reading `apps/backend/app/api/owner/hostels/route.ts`. If `apiResponse` takes no status argument, return `apiResponse(built)`.

- [ ] **Step 3: Remove the step-up from `POST /api/owner/hostels` too**

In `apps/backend/app/api/owner/hostels/route.ts`, delete the `existingHostelCount` count, the
`verifyIdentityConfirmation` call, the `identity` variable and the `consumeIdentityTokenInTx(tx,
identity.jti)` line inside the transaction, plus the now-unused imports.

Creating a hostel is additive — it moves no money and exposes no data — so a re-entered password
buys nothing there either. The mechanism stays for the actions where a hijacked session could
actually do damage; only this purpose leaves.

Then check whether `CREATE_HOSTEL` still has any consumer:

```bash
grep -rn "CREATE_HOSTEL" apps/backend apps/frontend --include=*.ts --include=*.tsx --include=*.js
```

If nothing outside the `ALLOWED_PURPOSES` whitelist references it, remove it from that whitelist as
well — a purpose nobody mints a token for is dead surface. If something else does use it, leave the
whitelist alone and say so in the commit.

- [ ] **Step 4: Typecheck your own files**

Run: `cd apps/backend && npx tsc --noEmit 2>&1 | grep -E "build-hostel-plan|hostels/build|property-service"`
Expected: no lines beyond the pre-existing `property-service.ts` implicit-`any` noise. Compare against a `git stash` baseline if unsure.

- [ ] **Step 5: Re-run the pure suite**

Run: `cd apps/backend && npm run test:pure`
Expected: the documented 2 pre-existing failures and nothing new.

- [ ] **Step 6: Commit**

```bash
git add apps/backend/lib/services/property-service.ts apps/backend/app/api/owner/hostels/build/route.ts apps/backend/app/api/owner/hostels/route.ts
git commit -m "feat(hostels): create a whole hostel in one transaction, with no step-up password"
```

---

### Task 4: Name availability check

**Files:**
- Create: `apps/backend/app/api/owner/hostels/name-available/route.ts`
- Modify: `apps/frontend/src/features/owners/api/index.js` — add `checkHostelNameAvailable`

**Interfaces:**
- Produces: `GET /api/owner/hostels/name-available?name=<string>` → `{ available: boolean }`.
- Produces: `ownerService.checkHostelNameAvailable(name)` → `Promise<{ available: boolean }>`.

This exists so the duplicate-name failure stays where it is today — at the naming step — instead of arriving at the very end after four floors of rooms. It **creates nothing**.

- [ ] **Step 1: Create the route**

```ts
// apps/backend/app/api/owner/hostels/name-available/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

/**
 * GET /api/owner/hostels/name-available?name=Sunrise
 *
 * Read-only. Exists so the Add Hostel builder can fail a duplicate name at the
 * naming step, where the field is, rather than at the confirm step after the
 * owner has entered every floor. Advisory only — `buildHostel` re-checks
 * inside its transaction, which is the check that actually protects the data.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const name = (new URL(req.url).searchParams.get("name") || "").trim();
    if (!name) return apiResponse({ available: false });

    const clash = await prisma.hostels.findFirst({
      where: {
        owner_id: session.sub,
        status: { in: ["ACTIVE", "INACTIVE"] },
        name: { equals: name, mode: "insensitive" },
      },
      select: { id: true },
    });
    return apiResponse({ available: !clash });
  } catch (error: any) {
    return apiError(error?.message || "Could not check that name");
  }
}
```

- [ ] **Step 2: Add the frontend wrapper**

In `apps/frontend/src/features/owners/api/index.js`, beside `createHostel`:

```js
    /**
     * Is this hostel name free? Read-only — creates nothing.
     *
     * Lets the Add Hostel builder fail a duplicate name at the naming step
     * rather than at the confirm, after every floor has been entered.
     */
    checkHostelNameAvailable: async (name) => {
        const response = await api.get('/owner/hostels/name-available', { params: { name } });
        return response.data.success ? response.data.data : response.data;
    },
    /**
     * Create a whole hostel — floors and rooms included — in one transaction.
     * The confirm step of the Add Hostel builder is its only caller.
     */
    buildHostel: async (payload) => {
        const response = await api.post('/owner/hostels/build', payload);
        return response.data.success ? response.data.data : response.data;
    },
```

- [ ] **Step 3: Verify the architecture boundary**

Run: `cd apps/frontend && npm run check:architecture`
Expected: `Architecture boundary check passed`.

- [ ] **Step 4: Commit**

```bash
git add apps/backend/app/api/owner/hostels/name-available/route.ts apps/frontend/src/features/owners/api/index.js
git commit -m "feat(hostels): read-only name-availability check, so a duplicate fails at the naming step"
```

---

### Task 5: Rewire the builder to the draft

**Files:**
- Modify: `apps/frontend/src/features/owner-hostel-builder/useHostelBuilder.ts`

**Interfaces:**
- Consumes: Task 1's draft API, Task 4's `ownerService.buildHostel`.
- Produces: the hook's return gains `draftDescription: string | null`, `hasResumableDraft: boolean`, `resumeDraft(): void`, `discardDraft(): void`, `buildHostel` (a `useMutation`), and `nameAvailability: { checking: boolean; reason: string | null }`. It **loses** `createHostel`, `createFloors`, `saveFloor`, `hostelId`, `isRestoring`.

This is the largest task. Work through it in this order and run the suite after each bullet.

- [ ] **Step 1: Delete the three write mutations**

Remove `createHostel`, `createFloors` and `saveFloor` entirely, along with the `existing` resume `useQuery` and its hydration `useEffect`. Remove `existingHostelId` from the hook's parameters. Remove them from the return object.

- [ ] **Step 2: Replace server floor ids with local keys**

`createFloors` previously supplied `floors[].id` from the server. Add a local generator beside `nextKey` in `hostelBuilder.ts`:

```ts
/** Local floor identity for a draft. Only becomes a server id after the build. */
export function nextFloorKey(): string {
  keyCounter += 1;
  return `f${keyCounter}`;
}
```

Then, where `createFloors` used to build floors, build them locally:

```ts
  const setFloorPlan = useCallback((names: string[]) => {
    setFloors((prev) =>
      names.map((name, i) => prev[i] ?? {
        id: nextFloorKey(),
        name,
        defaultCapacity: 4,
        defaultRent: null,
        rooms: [],
        saved: false,
      }),
    );
    setStage('fill');
    setActiveIndex(0);
  }, []);
```

- [ ] **Step 3: Persist on every change**

```ts
  // Written on every change rather than debounced: localStorage is synchronous
  // and a build is a few KB, and the loss this protects against — a reload
  // mid-build — can happen between any two keystrokes.
  useEffect(() => {
    writeHostelDraft({ name: hostelName, city, numbering: pattern, floorNames, floors, activeIndex });
  }, [hostelName, city, pattern, floorNames, floors, activeIndex]);
```

`city` and `floorNames` currently live in `HostelBuilderPage`. Move both into the hook so the draft has one owner; update the page to read them from the hook.

- [ ] **Step 4: Add the confirmed build**

```ts
  const buildHostel = useMutation({
    mutationFn: () =>
      ownerService.buildHostel({
        name: hostelName.trim(),
        city: city.trim() || undefined,
        floors: floors.map((floor) => ({
          name: floor.name,
          rooms: floor.rooms.map((room) => ({
            room_no: room.roomNo.trim(),
            capacity: room.capacity,
            ...(room.rent !== null && room.rent > 0 ? { base_rent: room.rent } : {}),
          })),
        })),
      }),
    onSuccess: () => {
      // Only after a confirmed success. A failed create that also lost the
      // building would be the worst outcome this design can produce.
      clearHostelDraft();
      invalidate();
    },
  });
```

**No password anywhere in this flow.** While deleting `createHostel`, also delete the `needsPassword` state, the `identityService.confirmIdentity` call, and the `password`/`onPasswordChange` props threaded from `HostelBuilderPage` into `NameStep` — including `NameStep`'s password field and its explanatory line. Creating a hostel no longer asks for one.

- [ ] **Step 5: Run the suite and commit**

Run: `cd apps/frontend && npm test && npm run check:architecture && npm run build`
Expected: all pass. Existing `floorStrip`/`builderJourney`/`hostelBuilder` tests must still pass; if `floorStrip`'s `saved` assertions fail, that is Task 7's job — leave them until then only if the suite is still green, otherwise do Task 7 first.

```bash
git add apps/frontend/src/features/owner-hostel-builder/
git commit -m "refactor(hostel-builder): hold the build in a local draft instead of writing as it walks"
```

---

### Task 6: Per-stage validation

**Files:**
- Modify: `apps/frontend/src/features/owner-hostel-builder/builderJourney.ts` — extend `continueBlocker`
- Modify: `apps/frontend/src/features/owner-hostel-builder/builderJourney.test.ts`
- Modify: `apps/frontend/src/features/owner-hostel-builder/steps/NameStep.tsx` — show the name error
- Modify: `apps/frontend/src/features/owner-hostel-builder/steps/FloorsStep.tsx` — show duplicate floor names

**Interfaces:**
- Produces: `duplicateFloorNames(names: string[]): string | null` and `crossFloorDuplicate(floors: DraftFloor[]): { floorIndex: number; roomNo: string } | null`, both exported from `builderJourney.ts`.

- [ ] **Step 1: Write the failing tests**

```ts
// append to apps/frontend/src/features/owner-hostel-builder/builderJourney.test.ts
import { crossFloorDuplicate, duplicateFloorNames } from './builderJourney';

describe('duplicateFloorNames', () => {
  it('passes a building with distinct floor names', () => {
    expect(duplicateFloorNames(['Ground floor', 'First floor'])).toBeNull();
  });

  it('names the floor that repeats, ignoring case and padding', () => {
    expect(duplicateFloorNames(['Ground floor', ' ground FLOOR '])).toMatch(/Ground floor/);
  });

  it('ignores blank names, which the floors step fills with a default', () => {
    expect(duplicateFloorNames(['', ''])).toBeNull();
  });
});

describe('crossFloorDuplicate', () => {
  const floor = (name: string, roomNos: string[]) => ({
    id: name,
    name,
    defaultCapacity: 4,
    defaultRent: 6000,
    saved: false,
    rooms: roomNos.map((roomNo, i) => ({ key: `${name}${i}`, roomNo, capacity: 4, rent: 6000, customised: false })),
  });

  it('passes when every room number is unique across the building', () => {
    expect(crossFloorDuplicate([floor('G', ['101']), floor('F', ['201'])])).toBeNull();
  });

  // The check the per-floor save could never make.
  it('points at the second floor holding a number the first already used', () => {
    const hit = crossFloorDuplicate([floor('G', ['101']), floor('F', ['101'])]);
    expect(hit).toEqual({ floorIndex: 1, roomNo: '101' });
  });

  it('ignores duplicates within one floor, which floorBlocker already catches', () => {
    expect(crossFloorDuplicate([floor('G', ['101', '101'])])).toBeNull();
  });

  it('compares case-insensitively and ignores blanks', () => {
    expect(crossFloorDuplicate([floor('G', ['g-01']), floor('F', ['G-01'])])?.floorIndex).toBe(1);
    expect(crossFloorDuplicate([floor('G', ['  ']), floor('F', ['  '])])).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/owner-hostel-builder/builderJourney.test.ts`
Expected: FAIL — `duplicateFloorNames is not a function`.

- [ ] **Step 3: Implement both, and wire them into `continueBlocker`**

```ts
/**
 * Two floors sharing a name, or null.
 *
 * "First floor" twice in one building is a data problem the owner should hear
 * about while they are looking at the list, not at the confirm step. Blank
 * names are ignored — the floors step fills them with `defaultFloorName`.
 */
export function duplicateFloorNames(names: string[]): string | null {
  const seen = new Set<string>();
  for (const raw of names ?? []) {
    const name = String(raw ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) return name;
    seen.add(key);
  }
  return null;
}

/**
 * A room number used on more than one floor.
 *
 * Only possible now that the whole building is held at once — the per-floor
 * save saw one floor at a time, so the server caught this as a CONFLICT on
 * whichever floor happened to be written second. Duplicates *within* a floor
 * are `floorBlocker`'s job and are skipped here.
 */
export function crossFloorDuplicate(
  floors: Array<{ rooms: Array<{ roomNo: string }> }>,
): { floorIndex: number; roomNo: string } | null {
  const claimed = new Map<string, number>();
  for (let f = 0; f < (floors ?? []).length; f += 1) {
    const seenHere = new Set<string>();
    for (const room of floors[f].rooms ?? []) {
      const roomNo = String(room?.roomNo ?? '').trim();
      if (!roomNo) continue;
      const key = roomNo.toLowerCase();
      if (seenHere.has(key)) continue;
      seenHere.add(key);
      const owner = claimed.get(key);
      if (owner !== undefined && owner !== f) return { floorIndex: f, roomNo };
      if (owner === undefined) claimed.set(key, f);
    }
  }
  return null;
}
```

Extend `continueBlocker`'s `floors` stage to return `duplicateFloorNames(...)`'s message, and its `fill` stage to return the cross-floor message when `floorBlocker` is clear.

- [ ] **Step 4: Run tests, then wire the UI**

`NameStep` shows a `nameError` prop under the name field. `FloorsStep` marks the repeated chip. Both are thin renderers — no new logic.

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/owner-hostel-builder/
git commit -m "feat(hostel-builder): validate at every stage, including duplicates across floors"
```

---

### Task 7: Preview, confirm, and the trimmed strip

**Files:**
- Modify: `apps/frontend/src/features/owner-hostel-builder/steps/ReviewStep.tsx`
- Modify: `apps/frontend/src/features/owner-hostel-builder/floorStrip.ts` + its test
- Modify: `apps/frontend/src/features/owner-hostel-builder/pages/HostelBuilderPage.tsx`

- [ ] **Step 1: Collapse the chip states**

`floorChipState` returns `'draft' | 'empty'` only — `'saved'` has no meaning before anything exists. Update `floorStrip.test.ts`'s `floorChipState` and `unsavedFloorIndexes` blocks accordingly; `sweepBlocker`'s tests carry over unchanged, since it becomes the confirm step's pre-flight validation.

- [ ] **Step 2: Make Review the preview**

Add to `ReviewStep`: the hostel name, city, per-floor room and bed counts, the distinct sharing sizes, and the rent range (`min`–`max` of non-null `rent`, or "Price on request" when none is set). **No revenue figure** — same rule the current Review already follows.

- [ ] **Step 3: Add the confirm**

The footer's primary button on `review` becomes **Create hostel** and calls `buildHostel.mutateAsync`. No password: the step-up is gone from hostel creation entirely (Task 3, Step 3). On failure, stay on the review with the server's message and the draft intact. On success, navigate to `/owner/hostels/:id/rooms`.

- [ ] **Step 4: Run everything**

Run: `cd apps/frontend && npm test && npm run build && npm run check:architecture`

- [ ] **Step 5: Commit**

```bash
git add apps/frontend/src/features/owner-hostel-builder/
git commit -m "feat(hostel-builder): preview the building, then create it on confirmation"
```

---

### Task 8: Resume prompt, and retiring the old resume route

**Files:**
- Modify: `apps/frontend/src/features/owner-hostel-builder/pages/HostelBuilderPage.tsx` — resume prompt
- Modify: `apps/frontend/src/platforms/owner/router/OwnerRoutes.tsx` — delete the `:hostelId/build` route
- Modify: `apps/frontend/src/features/owner-onboarding/pages/OwnerDashboardPreviewPage.tsx:132` — getting-started "hostel" step → `/owner/hostels/:id/rooms`

- [ ] **Step 1: Prompt on resume**

On mount, if `isHostelDraftResumable(readHostelDraft())`, show a sheet before the wizard: *"Continue this build?"* with `describeHostelDraft(draft)` and the saved-at date. **Continue** loads the draft; **Start fresh** clears it after a confirmation, since that is destructive.

- [ ] **Step 2: Point resume at the Rooms tab**

`/owner/hostels/:hostelId/build` is deleted. The getting-started "hostel" step navigates to `/owner/hostels/${hostelInProgress.id}/rooms`, which already has working Add Floor and Add Room.

- [ ] **Step 3: Decide the dead prop**

`hostelInProgress` is declared and destructured in `OwnerHomeDashboard` and never rendered. Either delete it from both files, or render a real "continue building" row linking to that hostel's Rooms tab. **Ask the user which** — do not choose silently.

- [ ] **Step 4: Run everything and commit**

```bash
git add apps/frontend/src
git commit -m "feat(hostel-builder): prompt before resuming a draft; retire the server-resume route"
```

---

### Task 9: Documentation

**Files:**
- Modify: `docs/obsidian/Decisions.md` (ADR-110), `Features.md`, `APIs.md`, `Bugs.md`, `Changelog.md`

- [ ] **Step 1: Check the next free ADR number against `origin/main`, not just locally**

Run: `git fetch origin && git show origin/main:docs/obsidian/Decisions.md | grep -oE '^#+ ADR-[0-9]+' | sort -u | tail -3`

- [ ] **Step 2: Write ADR-110**

Cover: why incremental writes were chosen and what replaces each thing they bought; defer-the-write-not-the-feedback; the cross-floor check that only becomes possible now; why localStorage over a server draft; why `markLiveForOwner` is added rather than moved; and that the draft is cleared only after a confirmed success.

**Also record the step-up removal**, which narrows [[Decisions]] ADR-066 rather than reversing it. ADR-066 already cut the prompt back to the second hostel onward on the grounds that it guarded an account with something in it. The remaining case does not hold up either: creating a hostel is **additive** — it moves no money and exposes no data — so a re-entered password buys nothing an attacker would care about, while costing every legitimate owner a prompt. The mechanism stays for the six financially-sensitive routes where a hijacked session could actually do damage; only `CREATE_HOSTEL` leaves. State plainly that this is a deliberate loosening, not an oversight.

- [ ] **Step 3: Update the rest**

`APIs.md`: the two new endpoints. `Features.md`: the new flow. `Bugs.md`: link the 2026-08-25 "+ Add hostel" entry to its real cure. `Changelog.md`: one entry.

- [ ] **Step 4: Commit**

```bash
git add docs/obsidian/
git commit -m "docs: ADR-110 — Add Hostel drafts locally and creates once"
```

---

## Self-Review

**Spec coverage.** §3 per-stage validation → Tasks 4 and 6. §4 draft → Task 1. §5 create → Tasks 2 and 3. §6 preview and confirm → Task 7. §7 deletions and `sweepBlocker` repurposed → Tasks 5 and 7. §8 existing half-built hostels → Task 8. §10 testing → folded into each task. §11 resume prompt → Task 8 Step 1. No gaps.

**Known soft spots, stated rather than hidden:**

- **Task 5 is large.** It deletes three mutations, moves two pieces of state out of the page, and adds persistence. If it will not go green in one pass, split it: delete-and-localise first, then persistence, then the build mutation.
- **Task 3's route snippet was written from the pattern in `apps/backend/app/api/owner/hostels/route.ts`, not from reading `apiResponse`'s signature.** Step 2 says so explicitly — confirm the real argument order rather than trusting the snippet.
- **Task 3 Step 3 removes a security control**, deliberately and on the user's instruction. It is a one-way change in practice: reinstating it later means owners who have grown used to no prompt suddenly meeting one. The reasoning — creating a hostel is additive, moving no money and exposing no data — is recorded in ADR-110 so a future reader finds an argument rather than an omission.
- **The transaction is untestable here.** No test database is provisioned, so Tasks 2 and 6 carry the rules and Task 3 only executes them. Nothing in this plan proves the transaction works; that needs a real database.
- **Task 8 Step 3 is a genuine open choice** and is marked as one. Do not decide it silently.
