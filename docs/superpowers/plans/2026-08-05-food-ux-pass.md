# Food UX pass — hostel picker, drag-to-swap week, voting management

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the overflowing hostel picker, collapse the 28-card weekly editor into one compact row per day with drag-to-swap, and close the three voting gaps — tenants are never told voting opened, the owner can't edit an open window, and turnout is invisible.

**Architecture:** Frontend-heavy. One new backend endpoint (an **atomic** meal swap — a swap done as two sequential PATCHes can duplicate one meal and lose another) and two small extensions to existing routes. Drag follows the house idiom established by `PropertyList.tsx`/ADR-042: `motion/react` with `dragListener={false}` + `useDragControls`, so drag starts only from a handle and the page keeps its scroll. No new dependency.

**Tech Stack:** Next.js 14 + Prisma (backend) · Vite + React 19 + TanStack Query (frontend) · `motion/react` v12 (already a dependency) · `vaul` BottomSheet · Vitest (node env, both) · Tailwind · lucide-react

## Global Constraints

- **No schema changes. No Prisma migrations.** Standing rule: structural migrations wait for `DATABASE_URL_TEST`, which does not exist. Additive non-schema work ships on pure tests.
- **Drag must never capture the page scroll or the chip's tap.** Use `dragListener={false}` + `useDragControls` and start drag from a handle/long-press only — the lesson `PropertyList.tsx:111-118` records from ADR-042.
- **Swaps are same-meal-type only.** `PATCH .../meals/[mealId]` validates `meal_type` matches the item; a breakfast item can never occupy a dinner slot. The UI must not offer an invalid drop.
- **A swap must be atomic.** Two sequential PATCHes are not acceptable — a failure between them corrupts the week.
- **Checks inform, never block** — unchanged from Phase 1; `buildPublishChecks` may return only `PASS`/`WARN`.
- **Never fall back to `hostels[0]`** on a multi-hostel screen.
- No raw `fetch()`/`axios` in `features/`, `platforms/`, `shared/ui`, `app/`, `portal/`, `context/` — all through `@lib/api-client`.
- **Frontend tests are node-environment only** (`include: ['src/**/*.test.ts']`, note `.ts`) — no jsdom, no component tests. Logic goes in pure `.ts` with colocated `.test.ts`; components stay thin renderers.
- **Backend pure tests**: `npm run test:pure`, config `vitest.pure.config.ts`, which uses an **explicit include allowlist** — a new test file silently never runs unless added to it.
- Minimum 44px touch targets. `lucide-react` icons only, no emoji.
- `docs/obsidian/` updated in the same change — see Task 8.

**Baselines** (must rise, never fall): backend **176** pure tests / 10 files, 9/9 invariants. Frontend **225** tests / 10 files, `tsc` **40** pre-existing errors.

**Verification commands:**
```bash
cd apps/backend  && npm run test:pure && npm run check:invariants && npx tsc --noEmit
cd apps/frontend && npm test && npx tsc --noEmit && npm run check:architecture && npm run build
```

---

### Task 1: Hostel picker stops overflowing the screen

A native `<select>` sizes itself to its longest `<option>`. `HostelSwitcher` sets no `max-width` and no truncation, so "Stayo Residency — MG Road" pushes the control past the viewport in a `justify-between` row — visibly clipped. Replace it with the app's own BottomSheet idiom, which also shows full names instead of truncating them.

**Files:**
- Modify: `apps/frontend/src/features/owner-food/components/HostelSwitcher.tsx`

**Interfaces:**
- Consumes: `BottomSheet` from `@shared/ui-patterns/BottomSheet`, `OwnerSessionHostel` from `@features/owner-session/types`
- Produces: unchanged public props — `{ hostels, selectedId, onSelect }`

- [ ] **Step 1: Replace the component**

```tsx
import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import type { OwnerSessionHostel } from '@features/owner-session/types';

interface HostelSwitcherProps {
  hostels: OwnerSessionHostel[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

/**
 * Renders nothing for a single-hostel owner — zero friction where there is no
 * choice to make. For everyone else it is mandatory: this screen once read
 * `hostels[0]` with no way to reach any other property's food.
 *
 * A native `<select>` was the first attempt and overflowed the viewport: it
 * sizes itself to its longest option, so a real hostel name pushed the control
 * off-screen. A trigger with a fixed max width plus the app's BottomSheet keeps
 * the header stable at any name length, and shows names in full rather than
 * truncating the one thing the control exists to disambiguate.
 */
export function HostelSwitcher({ hostels, selectedId, onSelect }: HostelSwitcherProps) {
  const [open, setOpen] = useState(false);
  if (hostels.length < 2) return null;

  const selected = hostels.find((h) => h.id === selectedId);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Choose hostel"
        className="flex min-h-[44px] max-w-[46vw] flex-none items-center gap-1.5 rounded-xl border border-border bg-card py-2.5 pl-3.5 pr-2.5 text-left"
      >
        <span className="truncate text-[12.5px] font-semibold text-foreground">
          {selected?.name ?? 'Choose hostel'}
        </span>
        <ChevronDown className="h-4 w-4 flex-none text-muted-foreground" />
      </button>

      <BottomSheet open={open} onOpenChange={setOpen} title="Choose hostel">
        <div className="flex flex-col gap-1.5 pb-2">
          {hostels.map((h) => {
            const isSelected = h.id === selectedId;
            return (
              <button
                key={h.id}
                type="button"
                onClick={() => {
                  onSelect(h.id);
                  setOpen(false);
                }}
                className={`flex min-h-[44px] items-center gap-2.5 rounded-xl border px-3.5 py-3 text-left ${
                  isSelected ? 'border-primary bg-secondary/40' : 'border-border bg-card'
                }`}
              >
                <span className="flex-1 text-[13.5px] font-semibold text-foreground">{h.name}</span>
                {isSelected && <Check className="h-4 w-4 flex-none text-primary" strokeWidth={2.5} />}
              </button>
            );
          })}
        </div>
      </BottomSheet>
    </>
  );
}
```

- [ ] **Step 2: Verify the header no longer overflows**

`FoodPage.tsx` and `KitchenSheetPage.tsx` both render this in a `justify-between` row. Confirm the title block can shrink: the title's wrapping `<div>` needs `min-w-0` so the truncation actually engages rather than the flex row growing. Add `min-w-0` to that div in both files if absent.

- [ ] **Step 3: Verify**

```
cd /home/sp/Desktop/stayo/apps/frontend
npx tsc --noEmit && npm test && npm run check:architecture && npm run build
```
Expected: pass, 225 tests unchanged (no new logic).

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/features/owner-food/components/HostelSwitcher.tsx \
        apps/frontend/src/features/owner-food/pages/FoodPage.tsx \
        apps/frontend/src/features/owner-food/pages/KitchenSheetPage.tsx
git commit -m "fix(food): hostel picker no longer overflows the screen

A native <select> sizes to its longest option, so a real hostel name
('Stayo Residency — MG Road') pushed the control past the viewport and it
rendered clipped. Replaced with a max-width trigger plus the app's BottomSheet,
which also shows names in full rather than truncating the one thing the
control exists to disambiguate.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Atomic meal swap endpoint

Drag-to-swap needs one write, not two. Two sequential PATCHes can leave the week with one meal duplicated and another lost if the second fails.

**Files:**
- Create: `apps/backend/lib/services/food/meal-swap.ts`
- Create: `apps/backend/tests/food-meal-swap.test.ts`
- Create: `apps/backend/app/api/food/schedules/[id]/meals/swap/route.ts`
- Modify: `apps/backend/vitest.pure.config.ts`

**Interfaces:**
- Produces: `canSwap(a, b): SwapVerdict` from `lib/services/food/meal-swap.ts`; `POST /api/food/schedules/[id]/meals/swap` with body `{ aMealId, bMealId }`

```ts
export interface SwapCell { id: string; schedule_id: string; meal_type: string; }
export interface SwapVerdict { ok: boolean; reason: string; }
export function canSwap(a: SwapCell | null, b: SwapCell | null, scheduleId: string): SwapVerdict;
```

- [ ] **Step 1: Write the failing test**

Create `apps/backend/tests/food-meal-swap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canSwap, type SwapCell } from "@/lib/services/food/meal-swap";

/** Pure — no database. Runs under `npm run test:pure`. */
const SCHEDULE = "sched-1";
const cell = (id: string, meal_type: string, schedule_id = SCHEDULE): SwapCell => ({ id, schedule_id, meal_type });

describe("canSwap", () => {
  it("allows two cells of the same meal type in the same schedule", () => {
    expect(canSwap(cell("a", "BREAKFAST"), cell("b", "BREAKFAST"), SCHEDULE)).toEqual({ ok: true, reason: "" });
  });

  it("refuses a missing first cell", () => {
    const v = canSwap(null, cell("b", "BREAKFAST"), SCHEDULE);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/not found/i);
  });

  it("refuses a missing second cell", () => {
    expect(canSwap(cell("a", "BREAKFAST"), null, SCHEDULE).ok).toBe(false);
  });

  it("refuses swapping a cell with itself", () => {
    const v = canSwap(cell("a", "BREAKFAST"), cell("a", "BREAKFAST"), SCHEDULE);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/same cell/i);
  });

  it("refuses different meal types — a breakfast item can never be dinner", () => {
    const v = canSwap(cell("a", "BREAKFAST"), cell("b", "DINNER"), SCHEDULE);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/same meal/i);
  });

  it("refuses a cell belonging to a different schedule", () => {
    const v = canSwap(cell("a", "BREAKFAST"), cell("b", "BREAKFAST", "other-sched"), SCHEDULE);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/schedule/i);
  });

  it("refuses when the first cell belongs to a different schedule", () => {
    expect(canSwap(cell("a", "BREAKFAST", "other"), cell("b", "BREAKFAST"), SCHEDULE).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/food-meal-swap.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `apps/backend/lib/services/food/meal-swap.ts`:

```ts
export interface SwapCell {
  id: string;
  schedule_id: string;
  meal_type: string;
}

export interface SwapVerdict {
  ok: boolean;
  reason: string;
}

/**
 * Whether two schedule cells may exchange their items.
 *
 * Same-meal-type only, and deliberately so: every cell write validates that the
 * item belongs to that meal type, so a breakfast item can never legally occupy
 * a dinner slot. Refusing the swap here keeps that rule in one place rather
 * than letting the UI discover it as a 400 halfway through a drag.
 */
export function canSwap(a: SwapCell | null, b: SwapCell | null, scheduleId: string): SwapVerdict {
  if (!a || !b) return { ok: false, reason: "Meal cell not found" };
  if (a.id === b.id) return { ok: false, reason: "Cannot swap a cell with the same cell" };
  if (a.schedule_id !== scheduleId || b.schedule_id !== scheduleId) {
    return { ok: false, reason: "Both meals must belong to this schedule" };
  }
  if (a.meal_type !== b.meal_type) {
    return { ok: false, reason: "Meals can only be swapped within the same meal type" };
  }
  return { ok: true, reason: "" };
}
```

- [ ] **Step 4: Add the test to the pure-config allowlist**

In `apps/backend/vitest.pure.config.ts`, add `'tests/food-meal-swap.test.ts'` to the `include` array, beside the other `food-*` entries. **Without this the file silently never runs.**

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/backend && npm run test:pure`
Expected: PASS, total rises from 176 to 183 (7 new).

- [ ] **Step 6: Write the route**

Create `apps/backend/app/api/food/schedules/[id]/meals/swap/route.ts`:

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { prisma } from "@/lib/db";
import { canSwap } from "@/lib/services/food/meal-swap";

/**
 * POST /api/food/schedules/[id]/meals/swap
 * Body: { aMealId, bMealId }
 *
 * Exchanges the items of two cells in ONE transaction. Doing this as two
 * sequential PATCHes is not equivalent: a failure between them leaves one meal
 * duplicated and the other lost, on a schedule tenants may already be reading.
 *
 * Same blast radius as a single-cell edit — a cell is keyed by weekday, so a
 * swap moves both meals for the whole month, not one date.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  const { id: scheduleId } = await params;

  try {
    const scope = resolveOwnerScope(session);
    const body = await req.json().catch(() => ({}));
    const { aMealId, bMealId } = body;
    if (typeof aMealId !== "string" || typeof bMealId !== "string") {
      return apiError("aMealId and bMealId are required", "VALIDATION_ERROR", 400);
    }

    const schedule = await prisma.food_schedules.findFirst({
      where: { id: scheduleId, owner_id: scope.owner_id },
      select: { id: true },
    });
    if (!schedule) return apiError("Schedule not found", "NOT_FOUND", 404);

    const updated = await prisma.$transaction(async (tx) => {
      const cells = await tx.food_schedule_meals.findMany({
        where: { id: { in: [aMealId, bMealId] } },
        select: { id: true, schedule_id: true, meal_type: true, menu_item_id: true, item_name: true },
      });
      const a = cells.find((c) => c.id === aMealId) ?? null;
      const b = cells.find((c) => c.id === bMealId) ?? null;

      const verdict = canSwap(a, b, scheduleId);
      if (!verdict.ok) throw new Error(`SWAP_REFUSED: ${verdict.reason}`);

      const now = new Date();
      await tx.food_schedule_meals.update({
        where: { id: a!.id },
        data: { menu_item_id: b!.menu_item_id, item_name: b!.item_name, updated_at: now },
      });
      await tx.food_schedule_meals.update({
        where: { id: b!.id },
        data: { menu_item_id: a!.menu_item_id, item_name: a!.item_name, updated_at: now },
      });

      await tx.food_schedules.update({
        where: { id: scheduleId },
        data: { source: "MANUAL", updated_at: now },
      });

      return tx.food_schedule_meals.findMany({
        where: { id: { in: [aMealId, bMealId] } },
      });
    });

    return apiResponse({ meals: updated });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to swap meals");
    if (msg.startsWith("SWAP_REFUSED")) return apiError(msg.split(": ")[1] ?? msg, "VALIDATION_ERROR", 400);
    return apiError(msg);
  }
}
```

- [ ] **Step 7: Verify**

```
cd /home/sp/Desktop/stayo/apps/backend
npm run test:pure && npm run check:invariants && npx tsc --noEmit
```
Expected: 183 pure tests, 9/9 invariants, no new tsc errors.

- [ ] **Step 8: Commit**

```bash
git add apps/backend/lib/services/food/meal-swap.ts \
        apps/backend/tests/food-meal-swap.test.ts \
        "apps/backend/app/api/food/schedules/[id]/meals/swap/route.ts" \
        apps/backend/vitest.pure.config.ts
git commit -m "feat(food): atomic meal swap endpoint

Drag-to-swap needs one write. Two sequential PATCHes are not equivalent — a
failure between them leaves one meal duplicated and the other lost, on a
schedule tenants may already be reading.

canSwap is pure and enforces same-meal-type only, matching the rule every
cell write already applies: a breakfast item can never occupy a dinner slot.
Keeping it in one place stops the UI discovering it as a 400 mid-drag.

7 pure tests. Added to the pure-config allowlist, which is an explicit list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Wire the swap through the API layer and hook

**Files:**
- Modify: `apps/frontend/src/features/food/api/index.ts`
- Modify: `apps/frontend/src/features/owner-food/hooks/useFoodSchedule.ts`

- [ ] **Step 1: Add the API wrapper**

In `apps/frontend/src/features/food/api/index.ts`, beside `updateScheduleMeal`:

```ts
  swapScheduleMeals: async (scheduleId: string, aMealId: string, bMealId: string) => {
    const response = await api.post(`/food/schedules/${scheduleId}/meals/swap`, { aMealId, bMealId });
    return unwrap(response);
  },
```

- [ ] **Step 2: Add the mutation to the hook**

In `useFoodSchedule.ts`, beside `updateMealMutation`:

```ts
  const swapMealsMutation = useMutation({
    mutationFn: ({ aMealId, bMealId }: { aMealId: string; bMealId: string }) =>
      foodService.swapScheduleMeals(schedule!.id, aMealId, bMealId),
    onSuccess: invalidate,
    onError: () => {
      invalidate();
      stayoToast.error("Could not move that meal");
    },
  });
```

and expose on the returned object:

```ts
    swapMeals: (aMealId: string, bMealId: string) => swapMealsMutation.mutate({ aMealId, bMealId }),
    isSwapping: swapMealsMutation.isPending,
```

> `onError` re-invalidates so an optimistic-looking UI cannot keep a swap the server rejected.

- [ ] **Step 3: Verify**

```
cd /home/sp/Desktop/stayo/apps/frontend
npx tsc --noEmit && npm test && npm run check:architecture
```

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/features/food/api/index.ts \
        apps/frontend/src/features/owner-food/hooks/useFoodSchedule.ts
git commit -m "feat(food): expose the atomic meal swap to the client

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Compact week — one row per day

Replace the 28-card, ~7-screen editor with one line per day and four meal chips, the shape `MonthHistoryList` already uses in this module. Drag comes in Task 5; this task is layout only, so the two are separately reviewable.

**Files:**
- Create: `apps/frontend/src/features/owner-food/components/schedule/DayRow.tsx`
- Modify: `apps/frontend/src/features/owner-food/components/schedule/WeeklyScheduleGrid.tsx`

**Interfaces:**
- Consumes: `cellAt`, `isFilled`, `SLOT_ORDER`, `DAY_ORDER`, types `DayKey`/`WeekGrid`/`WeekGridCell` from `../../weekGrid`; `MEAL_CATEGORY_META` from `@shared/mocks/food`; `mealIcon` from `../../mealIcons`
- Produces: `<DayRow day grid onPick isToday />` where `onPick(cell: WeekGridCell) => void`

- [ ] **Step 1: Write `DayRow`**

Create `apps/frontend/src/features/owner-food/components/schedule/DayRow.tsx`:

```tsx
import { MEAL_CATEGORY_META, type MealSlotKey } from '@shared/mocks/food';
import { mealIcon } from '../../mealIcons';
import { cellAt, isFilled, SLOT_ORDER, type DayKey, type WeekGrid, type WeekGridCell } from '../../weekGrid';

const DAY_LABEL: Record<DayKey, string> = {
  MONDAY: 'Mon', TUESDAY: 'Tue', WEDNESDAY: 'Wed', THURSDAY: 'Thu',
  FRIDAY: 'Fri', SATURDAY: 'Sat', SUNDAY: 'Sun',
};

interface DayRowProps {
  day: DayKey;
  grid: WeekGrid;
  isToday: boolean;
  onPick: (cell: WeekGridCell) => void;
}

/**
 * One day of the week as a single row of four meal chips.
 *
 * Replaces a 2x2 card block per day — 28 cards over roughly seven screens of
 * scrolling — with the shape `MonthHistoryList` already uses for a published
 * month. The whole week now fits in about one screen, which is what makes
 * dragging a chip to another day practical on a phone at all.
 */
export function DayRow({ day, grid, isToday, onPick }: DayRowProps) {
  return (
    <div className={`flex items-start gap-2 rounded-xl px-1.5 py-1.5 ${isToday ? 'bg-secondary/40' : ''}`}>
      <span className={`w-9 flex-none pt-2.5 text-[11px] font-bold uppercase tracking-wide ${isToday ? 'text-primary' : 'text-muted-foreground'}`}>
        {DAY_LABEL[day]}
      </span>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
        {SLOT_ORDER.map((slot) => {
          const cell = cellAt(grid, day, slot);
          const filled = isFilled(cell);
          const Icon = mealIcon(slot);
          return (
            <button
              key={slot}
              type="button"
              disabled={!cell}
              onClick={() => cell && onPick(cell)}
              aria-label={`${MEAL_CATEGORY_META[slot].label} on ${DAY_LABEL[day]}: ${filled ? cell!.item_name : 'not set'}`}
              className={`flex min-h-[44px] min-w-0 flex-1 basis-[calc(50%-0.375rem)] items-center gap-1.5 rounded-xl border px-2.5 py-2 text-left disabled:opacity-50 ${
                filled ? 'border-border bg-card' : 'border-dashed border-border bg-transparent'
              }`}
            >
              <Icon className="h-3.5 w-3.5 flex-none text-muted-foreground" strokeWidth={1.75} />
              <span className={`truncate text-[12px] ${filled ? 'font-semibold text-foreground' : 'italic text-muted-foreground/60'}`}>
                {filled ? cell!.item_name : MEAL_CATEGORY_META[slot].label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

> Chips are `basis-[calc(50%-0.375rem)]`, so four chips wrap 2×2 within the row at phone width and sit on one line on a wider screen — without a media query.

- [ ] **Step 2: Render `DayRow` from `WeeklyScheduleGrid`**

In `WeeklyScheduleGrid.tsx`, import `DayRow`, `dayKeyFor`, and `toWeekGrid`, then replace the `DAY_ORDER.map(...)` block that renders the 2×2 card grid with:

```tsx
      <div className="flex flex-col gap-1">
        {DAY_ORDER.map((day) => (
          <DayRow
            key={day}
            day={day}
            grid={weekGrid}
            isToday={day === dayKeyFor(new Date())}
            onPick={(cell) => schedule.openPicker({ mealId: cell.id!, slot: cell.meal_type })}
          />
        ))}
      </div>
```

where `weekGrid` is the value already computed for `buildPublishChecks` in this component. Reuse it — do not call `toWeekGrid` twice.

Delete the now-unused `DAY_LABEL` map and `SLOT_ORDER` const from `WeeklyScheduleGrid.tsx` if nothing else in the file uses them.

- [ ] **Step 3: Verify**

```
cd /home/sp/Desktop/stayo/apps/frontend
npx tsc --noEmit && npm test && npm run check:architecture && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add apps/frontend/src/features/owner-food/components/schedule/DayRow.tsx \
        apps/frontend/src/features/owner-food/components/schedule/WeeklyScheduleGrid.tsx
git commit -m "refactor(food): collapse the weekly editor to one row per day

28 cards over roughly seven screens became seven rows of four chips — the
shape MonthHistoryList already uses for a published month, so this reuses a
pattern in the module rather than inventing one. Today's row is tinted.

This is also what makes drag practical: with the week on one screen, moving a
meal to another day is a short drag instead of a drag that fights the page
scroll.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Drag a meal onto another day to swap

**Files:**
- Create: `apps/frontend/src/features/owner-food/dragSwap.ts`
- Create: `apps/frontend/src/features/owner-food/dragSwap.test.ts`
- Modify: `apps/frontend/src/features/owner-food/components/schedule/DayRow.tsx`
- Modify: `apps/frontend/src/features/owner-food/components/schedule/WeeklyScheduleGrid.tsx`

**Interfaces:**
- Produces: `findDropTarget(point, candidates): string | null` and `isValidDrop(source, target): boolean` from `dragSwap.ts`

```ts
export interface DropCandidate { mealId: string; mealType: string; rect: { left: number; top: number; right: number; bottom: number }; }
export interface DragSource { mealId: string; mealType: string; }
```

- [ ] **Step 1: Write the failing test**

Create `apps/frontend/src/features/owner-food/dragSwap.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { findDropTarget, isValidDrop, type DropCandidate } from './dragSwap';

const rect = (left: number, top: number) => ({ left, top, right: left + 100, bottom: top + 44 });
const candidates: DropCandidate[] = [
  { mealId: 'mon-b', mealType: 'breakfast', rect: rect(0, 0) },
  { mealId: 'tue-b', mealType: 'breakfast', rect: rect(0, 60) },
  { mealId: 'tue-d', mealType: 'dinner', rect: rect(120, 60) },
];

describe('findDropTarget', () => {
  it('finds the candidate whose rect contains the point', () => {
    expect(findDropTarget({ x: 50, y: 80 }, candidates)).toBe('tue-b');
  });

  it('returns null when the point is over nothing', () => {
    expect(findDropTarget({ x: 500, y: 500 }, candidates)).toBeNull();
  });

  it('is inclusive of the rect edges', () => {
    expect(findDropTarget({ x: 0, y: 0 }, candidates)).toBe('mon-b');
  });

  it('returns null for an empty candidate list', () => {
    expect(findDropTarget({ x: 10, y: 10 }, [])).toBeNull();
  });
});

describe('isValidDrop', () => {
  it('allows the same meal type on a different day', () => {
    expect(isValidDrop({ mealId: 'mon-b', mealType: 'breakfast' }, { mealId: 'tue-b', mealType: 'breakfast' })).toBe(true);
  });

  it('refuses a different meal type — breakfast can never become dinner', () => {
    expect(isValidDrop({ mealId: 'mon-b', mealType: 'breakfast' }, { mealId: 'tue-d', mealType: 'dinner' })).toBe(false);
  });

  it('refuses dropping onto itself', () => {
    expect(isValidDrop({ mealId: 'mon-b', mealType: 'breakfast' }, { mealId: 'mon-b', mealType: 'breakfast' })).toBe(false);
  });

  it('refuses a null target', () => {
    expect(isValidDrop({ mealId: 'mon-b', mealType: 'breakfast' }, null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/owner-food/dragSwap.test.ts`
Expected: FAIL — cannot resolve `./dragSwap`

- [ ] **Step 3: Write the implementation**

Create `apps/frontend/src/features/owner-food/dragSwap.ts`:

```ts
export interface DragSource {
  mealId: string;
  mealType: string;
}

export interface DropCandidate {
  mealId: string;
  mealType: string;
  rect: { left: number; top: number; right: number; bottom: number };
}

/**
 * Which chip the finger was over when it lifted.
 *
 * Hit-testing is done against measured rects rather than DOM events because the
 * dragged chip sits above the pointer for the whole gesture — `elementFromPoint`
 * would return the chip being dragged, not the one underneath it.
 */
export function findDropTarget(
  point: { x: number; y: number },
  candidates: DropCandidate[],
): string | null {
  for (const c of candidates) {
    if (point.x >= c.rect.left && point.x <= c.rect.right && point.y >= c.rect.top && point.y <= c.rect.bottom) {
      return c.mealId;
    }
  }
  return null;
}

/**
 * Same meal type, different cell.
 *
 * Mirrors `canSwap` on the server, which mirrors the rule every cell write
 * applies: an item belongs to exactly one meal type, so a breakfast item can
 * never occupy a dinner slot. Checking here means an invalid drag is refused
 * silently at the drop instead of surfacing as a 400.
 */
export function isValidDrop(source: DragSource, target: DragSource | null): boolean {
  if (!target) return false;
  if (source.mealId === target.mealId) return false;
  return source.mealType === target.mealType;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/frontend && npx vitest run src/features/owner-food/dragSwap.test.ts`
Expected: PASS (8 tests). Frontend total rises 225 → 233.

- [ ] **Step 5: Make chips draggable from a handle**

Extend `DayRowProps` with:

```tsx
  onSwap: (aMealId: string, bMealId: string) => void;
  registerChip: (mealId: string, mealType: string, el: HTMLElement | null) => void;
  dragDisabled: boolean;
```

Wrap each filled chip in a `motion.div` and add a grip handle. Follow `PropertyList.tsx` exactly: `dragListener={false}` plus `useDragControls`, drag started only from the handle. **This is the constraint that keeps the page scrollable and the chip tappable** — see the doc comment at `PropertyList.tsx:111-118` and ADR-042.

```tsx
import { motion, useDragControls } from 'motion/react';
import { GripVertical } from 'lucide-react';
```

Each chip becomes:

```tsx
<motion.div
  ref={(el) => registerChip(cell.id!, slot, el)}
  drag={!dragDisabled && filled}
  dragListener={false}
  dragControls={controls}
  dragSnapToOrigin
  whileDrag={{ scale: 1.06, zIndex: 30, boxShadow: '0 12px 28px rgba(0,0,0,0.18)' }}
  onDragEnd={(_, info) => onDragEnd(cell.id!, slot, info.point)}
  className="flex min-w-0 flex-1 basis-[calc(50%-0.375rem)]"
>
  {/* the existing button, plus the handle when `filled` */}
</motion.div>
```

with the handle inside the chip, before the icon:

```tsx
{filled && !dragDisabled && (
  <span
    onPointerDown={(e) => { e.stopPropagation(); controls.start(e); }}
    aria-label={`Move ${cell!.item_name}`}
    className="flex h-11 w-6 flex-none cursor-grab touch-none items-center justify-center text-muted-foreground"
  >
    <GripVertical className="h-3.5 w-3.5" />
  </span>
)}
```

`dragSnapToOrigin` returns the chip to its slot on release — the grid is authoritative and re-renders from the server response, so the chip must not keep a stray offset.

- [ ] **Step 6: Own the chip registry and drop resolution in `WeeklyScheduleGrid`**

Keep a `useRef<Map<string, DropCandidate>>`. `registerChip` measures with `getBoundingClientRect()` on register. On drag end, call `findDropTarget(point, [...map.values()])`, look up the target's `mealType`, and if `isValidDrop(source, target)` call `schedule.swapMeals(sourceId, targetId)`.

Re-measure on drag start rather than only on mount — the page may have scrolled since. Pass `dragDisabled={schedule.isSwapping}` so a second drag cannot start mid-write.

- [ ] **Step 7: Add a discoverability hint**

Under the day rows, when the week has 2+ filled cells of any one meal type:

```tsx
<p className="px-1.5 text-[11px] text-muted-foreground">
  Drag <GripVertical className="inline h-3 w-3 align-[-2px]" /> to move a meal to another day. Tap to change it.
</p>
```

- [ ] **Step 8: Verify**

```
cd /home/sp/Desktop/stayo/apps/frontend
npm test && npx tsc --noEmit && npm run check:architecture && npm run build
```
Expected: 233 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/frontend/src/features/owner-food/dragSwap.ts \
        apps/frontend/src/features/owner-food/dragSwap.test.ts \
        apps/frontend/src/features/owner-food/components/schedule/DayRow.tsx \
        apps/frontend/src/features/owner-food/components/schedule/WeeklyScheduleGrid.tsx
git commit -m "feat(food): drag a meal onto another day to swap

Drag starts only from the grip handle (dragListener=false + useDragControls),
the combination PropertyList/ADR-042 established for this app: the page keeps
its scroll and the chip keeps its tap-to-edit everywhere except the handle.

Same-meal-type only, mirroring canSwap on the server and the rule every cell
write already applies. Invalid drags are refused at the drop rather than
surfacing as a 400 mid-gesture.

Hit-testing uses measured rects, not elementFromPoint — the dragged chip sits
above the pointer the whole gesture and would always hit-test itself.

8 pure tests.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Tell tenants when voting opens

Publishing a schedule notifies every active tenant. Opening voting notifies **nobody** — there is no notification call in the route at all. That is the likeliest reason live data shows one voting period and two votes ever: the feature works and is invisible.

**Files:**
- Modify: `apps/backend/app/api/food/voting-periods/route.ts`

- [ ] **Step 1: Fan out on open**

Import the notification service, matching `publish/route.ts`:

```ts
import { notificationService } from "@/lib/services/notification-service";
```

After the `upsert`, before the response, add — and note the guard, which mirrors publish's `wasAlreadyPublished`:

```ts
    // Only announce a genuinely new round. This route is an upsert, so it is
    // also how the owner edits an open window — re-notifying on every date
    // tweak would train tenants to ignore it.
    const isNewRound = !existing || existing.status !== "OPEN";
    if (isNewRound) {
      const tenants = await prisma.tenants.findMany({
        where: { owner_id: scope.owner_id, hostel_id: hostelId, status: "ACTIVE", profile_id: { not: null } },
        select: { profile_id: true },
      });
      await Promise.allSettled(
        tenants
          .filter((t): t is { profile_id: string } => Boolean(t.profile_id))
          .map((t) =>
            notificationService.createNotification(
              t.profile_id,
              "Vote on next month's menu",
              "Your hostel owner opened food voting — pick what you'd like to eat.",
              "food_voting_opened",
            ),
          ),
      );
    }
```

This needs `existing` read before the upsert:

```ts
    const existing = await prisma.food_voting_periods.findUnique({
      where: { hostel_id_month: { hostel_id: hostelId, month } },
      select: { status: true },
    });
```

- [ ] **Step 2: Return whether tenants were notified**

Change the response so the client can confirm it:

```ts
    return apiResponse({ ...period, notified: isNewRound ? notifiedCount : 0 }, 201);
```

capturing `notifiedCount` from the `tenants.length` above (0 when not a new round).

- [ ] **Step 3: Verify**

```
cd /home/sp/Desktop/stayo/apps/backend
npm run test:pure && npm run check:invariants && npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add apps/backend/app/api/food/voting-periods/route.ts
git commit -m "fix(food): tell tenants when voting opens

Publishing a schedule fanned out a notification to every active tenant.
Opening voting fanned out nothing — there was no notification call in the
route at all, so students were never told voting existed. Live data showed
one voting period and two votes in the product's lifetime; this is the most
likely reason.

Guarded on a genuinely new round, mirroring publish's wasAlreadyPublished:
this route is an upsert and is also how the owner edits an open window, and
re-notifying on every date tweak would train tenants to ignore it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Turnout, and editing an open voting window

Two gaps: once open the only action is "Close Voting" — the window can't be changed, though the backend upsert already supports it — and turnout is invisible. Note the audit finding that `totalVotes` counts vote **rows**, not students; turnout needs a distinct count.

**Files:**
- Modify: `apps/backend/app/api/food/voting-periods/[id]/results/route.ts`
- Modify: `apps/frontend/src/features/food/api/index.ts`
- Modify: `apps/frontend/src/features/owner-food/hooks/useFoodVoting.ts`
- Modify: `apps/frontend/src/features/owner-food/components/voting/VotingPanel.tsx`

- [ ] **Step 1: Add distinct turnout to the results route**

After the existing `tally`, add:

```ts
    const voters = await prisma.food_votes.findMany({
      where: { voting_period_id: id },
      select: { tenant_id: true },
      distinct: ["tenant_id"],
    });
    const eligible = await prisma.tenants.count({
      where: { hostel_id: period.hostel_id, status: "ACTIVE", profile_id: { not: null } },
    });
```

and extend the response:

```ts
    return apiResponse({ votingPeriod: period, totalVotes, voterCount: voters.length, eligibleCount: eligible, byMealType });
```

> `voterCount` is **distinct tenants**; `totalVotes` remains the row count. They are different numbers and both are meaningful — a tenant may pick several items per meal type.

- [ ] **Step 2: Widen the client types**

In `features/food/api/index.ts`, extend `getVotingResults`'s return type with `voterCount: number; eligibleCount: number;`. In `useFoodVoting.ts` no change is needed beyond passing it through.

- [ ] **Step 3: Show turnout and allow editing the window**

In `VotingPanel.tsx`, in the branch where a period exists:

```tsx
        <div className="flex items-baseline gap-1.5 text-[12px] text-muted-foreground">
          <span className="font-display text-[15px] font-bold tabular-nums text-foreground">
            {voting.results?.voterCount ?? 0}
          </span>
          of {voting.results?.eligibleCount ?? 0} students voted
        </div>
```

and, when `isOpen`, an **Edit window** control beside **Close Voting** that reveals the two existing `datetime-local` inputs pre-filled from `voting.period`, with a Save that calls the same `voting.openVoting(startsAt, endsAt)` — the route is an upsert, so this needs no new endpoint.

Keep both controls ≥44px and keep "Close Voting" visually secondary to nothing — it is the destructive one, so give it the outline treatment it already has.

- [ ] **Step 4: Verify**

```
cd /home/sp/Desktop/stayo/apps/backend  && npx tsc --noEmit
cd /home/sp/Desktop/stayo/apps/frontend && npm test && npx tsc --noEmit && npm run check:architecture && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add apps/backend/app/api/food/voting-periods/\[id\]/results/route.ts \
        apps/frontend/src/features/food/api/index.ts \
        apps/frontend/src/features/owner-food/hooks/useFoodVoting.ts \
        apps/frontend/src/features/owner-food/components/voting/VotingPanel.tsx
git commit -m "feat(food): voting turnout, and let the owner edit an open window

Once voting opened the only available action was Close Voting — the window
could not be changed, even though POST /api/food/voting-periods is an upsert
that already supported it. Fourth built-but-unreachable capability in this
module.

Turnout is a DISTINCT tenant count, not the vote-row count: the audit found
totalVotes counts rows, and one tenant may pick several items per meal type,
so the row count overstates participation. Both numbers are returned; they
mean different things.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Documentation

**Files:**
- Modify: `docs/obsidian/Food.md`, `APIs.md`, `Features.md`, `Changelog.md`, `Decisions.md`

- [ ] **Step 1: Update the vault**

- [[APIs]] — the new `POST /api/food/schedules/[id]/meals/swap`, the `notified` field on `POST /api/food/voting-periods`, and `voterCount`/`eligibleCount` on the results route.
- [[Food]] — the compact week + drag interaction, the same-meal-type rule and where it is enforced (three places: cell PATCH, `canSwap`, `isValidDrop`), and the voting-notification fix. Update the test counts.
- [[Features]] and [[Changelog]] — one consolidated entry in the established voice: what was broken, what was verified, what was reused rather than rebuilt.
- [[Decisions]] — an ADR only if warranted. The drag interaction reuses ADR-042's handle-only rule rather than setting new policy; judge whether the same-meal-type swap constraint deserves recording, and say which you chose and why.

- [ ] **Step 2: Verify wiki links resolve**

```
cd /home/sp/Desktop/stayo && grep -o "\[\[[^]]*\]\]" docs/obsidian/Food.md | sort -u
```

- [ ] **Step 3: Commit**

---

### Task 9: Full verification

- [ ] **Step 1: Both apps**

```
cd /home/sp/Desktop/stayo/apps/backend  && npm run test:pure && npm run check:invariants && npx tsc --noEmit
cd /home/sp/Desktop/stayo/apps/frontend && npm test && npx tsc --noEmit && npm run check:architecture && npm run build
```
Expected: backend **183** pure / 11 files, 9/9 invariants. Frontend **233** / 11 files, tsc 40, build + branding pass.

- [ ] **Step 2: Report honestly**

State test counts, what was verified, and what was **not**: nothing here was exercised against a live database, and **the drag gesture itself has no automated coverage** — the node-only test config cannot render components, so `findDropTarget`/`isValidDrop` are tested as pure functions while the gesture wiring is not. Say so plainly rather than implying the interaction is tested.

---

## Self-review notes

**Coverage.** Hostel overflow → Task 1. Drag-and-drop → Tasks 2–5 (endpoint, wiring, layout, gesture). Voting: notify-on-open → Task 6; edit window + turnout → Task 7. Reopen/new-round was **not** selected and is deliberately absent.

**Known limits, stated rather than hidden.**
- The gesture wiring is untestable under the current node-only config; only its two pure decisions are covered.
- A swap carries the same blast radius as any cell edit — it moves both meals for **every** such weekday in the month, not one date. Task 5 does not add a second warning because the picker sheet already says this; revisit if user testing shows the drag reads as a single-day move.
- `dragSnapToOrigin` means the chip animates home and the true position arrives from the refetch. On a slow connection the chip returns before the data updates. Acceptable; a full optimistic swap is more machinery than this earns.

**Type consistency.** `mealType` is the lowercase `MealSlotKey` on the client (`breakfast`) and the uppercase Prisma enum on the server (`BREAKFAST`). `dragSwap.ts` compares client-side values only and never crosses that boundary; the server compares its own. No conversion is introduced.
