# Meal Forecast (Stay Status Phase 2a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the user prefers inline execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tell the kitchen how many to cook for, learned from what that hostel actually served rather than guessed from a headcount.

**Architecture:** One new table (`meal_service_logs`) records what was served plus the headcount frozen at entry. A pure module turns those logs into a per-meal ratio (median of the last 14 logged days, minimum 3), and the forecast is `headcount(date) × ratio`. Until a meal has 3 samples it shows the plain headcount, labelled. Nothing about `stay_events` or its reducer changes: this is a new read model beside it.

**Tech stack:** Next.js 14 App Router, Prisma (typed `any`), Postgres (Supabase), vitest; Vite + React 19, TanStack Query, Tailwind, node-only vitest.

**Spec:** `docs/superpowers/specs/2026-09-14-meal-forecast-design.md` — read it alongside this plan.

## Global Constraints

- **New table only.** No column is added to `hostels`, `tenants`, `rooms` or any existing model (the 2026-08-22 outage rule).
- **`stay_events` is untouched.** No new event type, no reducer change. Served counts are a hostel-and-date measurement, and re-entering one **corrects** it — that is the deliberate difference from the event stream.
- **`headcount_at_log` is frozen at entry.** Never recompute a past day's denominator from the live projection.
- **Ratio rules, exact:** median (not mean) over the last **14** logged days, at least **3** samples, excluding rows where `headcount_at_log = 0`. Ratios above 1 are **kept, not clamped**.
- **A resident is counted on their return date** (`start_date <= date AND expected_return_date > date` means away), matching Phase 1's `isHereTonight`.
- **"Today" is IST** via `istToday`/`istDateOf` from `lib/timezone.ts`. Never `hostels.timezone`.
- **Honesty copy is fixed:** learning → `still learning what people actually eat`; learned → `from the last 2 weeks`.
- **Owner scope:** `resolveOwnerScope` → `requireHostelBelongsToOwner`, `hostelId` always required. New folders go in `architectural-invariants-check.ts`'s scan roots.
- **Meal keys:** the API speaks uppercase `FoodMealTypeKey` (`BREAKFAST|LUNCH|SNACKS|DINNER`); the kitchen sheet iterates lowercase `MealSlotKey`. Map at the edge; do not "fix" the existing mismatch here.
- **Backend pure tests must be added to `vitest.pure.config.ts`'s `include`** or they never run. Frontend tests are `src/**/*.test.ts`, node env, no component rendering.
- **Every commit** ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Never push to `main`.

## File map

**Backend** (`apps/backend`):

| File | Responsibility |
|---|---|
| `src/services/stay/stay-board.ts` (modify) | + `headcountOn(residents, leaves, date)` — pure |
| `src/services/meals/meal-ratio.ts` | `median`, `mealRatio`, `forecastMeal` — pure |
| `src/services/meals/meal-forecast-service.ts` | `getForecast`, `recordServed` (I/O, injectable `db`) |
| `prisma/migrations/20260915090000_meal_service_logs/migration.sql` + `schema.prisma` | the table |
| `app/api/hostels/[id]/meals/forecast/route.ts` (GET), `.../meals/served/route.ts` (PUT) | thin routes |
| `app/api/hostels/[id]/stay/route.ts`, `app/api/owner/stay/summary/route.ts` (modify) | attach the dinner forecast, tolerantly |
| `scripts/architectural-invariants-check.ts` (modify) | scan the new folders |

**Frontend** (`apps/frontend/src`):

| File | Responsibility |
|---|---|
| `features/owner-food/mealForecast.ts` (+ `.test.ts`) | display model + copy; which meals can still be logged |
| `features/food/api/index.ts` (modify) | `getMealForecast`, `recordMealServed` |
| `lib/queryKeys.ts` (modify) | `queryKeys.meals.forecast(hostelId, from, to)` |
| `features/owner-food/hooks/useMealForecast.ts` | query + upsert mutation |
| `features/owner-food/pages/KitchenSheetPage.tsx` (modify) | expected numbers + inline entry |
| `features/stay/stayState.ts`, `features/owner-stay/*`, `features/owner-dashboard/*` (modify) | board headline and Home caption prefer a learned forecast |

---

### Task 0: Branch and baseline

- [ ] **Step 1: Cut the branch from the current tip**

```bash
cd /home/sp/Desktop/stayo/.claude/worktrees/stay-status
git fetch origin
git checkout -b feat/meal-forecast
git log --oneline -1
```

The worktree already has `.env`, `.env.test` and a real `node_modules`. `.env` points at **production** — never run the DB-backed suite here.

- [ ] **Step 2: Record the baseline**

```bash
cd apps/backend && npm run test:pure 2>&1 | tail -3
cd ../frontend && npm test 2>&1 | tail -3
```

Expected, from Phase 1: backend 2318 passing with 3 pre-existing failures (`agreement-requirement` ×2, `whatsapp-guardian-reminders` ×1); frontend 2777 passing. Every later claim is measured against these.

---

### Task 1: `headcountOn` — how many are here on a given date

**Files:**
- Modify: `apps/backend/src/services/stay/stay-board.ts` (append)
- Test: `apps/backend/tests/stay-board.test.ts` (append a describe block)

**Interfaces produced:**
- `interface HeadcountLeave { tenantId: string; startDate: string; expectedReturnDate: string }`
- `headcountOn(residents: Array<{ tenantId: string }>, leaves: HeadcountLeave[], date: string): number`

This is deliberately a **new** input type rather than reusing `BoardLeave`, which has no `startDate` — the board only ever asks about today, and this asks about any date.

- [ ] **Step 1: Write the failing test.** Append to `apps/backend/tests/stay-board.test.ts`:

```ts
import { headcountOn } from "@/src/services/stay/stay-board";

describe("headcountOn — the denominator for a meal forecast", () => {
  const residents = [{ tenantId: "A" }, { tenantId: "B" }, { tenantId: "C" }];
  const leave = (tenantId: string, startDate: string, expectedReturnDate: string) => ({ tenantId, startDate, expectedReturnDate });

  it("counts everyone when nobody is away", () => {
    expect(headcountOn(residents, [], "2026-09-14")).toBe(3);
  });

  it("does not count someone whose leave covers the date", () => {
    expect(headcountOn(residents, [leave("B", "2026-09-12", "2026-09-20")], "2026-09-14")).toBe(2);
  });

  it("counts them again on their return date", () => {
    const away = [leave("B", "2026-09-12", "2026-09-14")];
    expect(headcountOn(residents, away, "2026-09-13")).toBe(2);
    expect(headcountOn(residents, away, "2026-09-14")).toBe(3);
  });

  it("counts them on the day before the leave starts, not on the first day", () => {
    const away = [leave("B", "2026-09-15", "2026-09-18")];
    expect(headcountOn(residents, away, "2026-09-14")).toBe(3);
    expect(headcountOn(residents, away, "2026-09-15")).toBe(2);
  });

  it("answers for tomorrow, which is the point of it", () => {
    const away = [leave("A", "2026-09-10", "2026-09-16"), leave("C", "2026-09-15", "2026-09-17")];
    expect(headcountOn(residents, away, "2026-09-14")).toBe(2);
    expect(headcountOn(residents, away, "2026-09-15")).toBe(1);
  });

  it("ignores a leave belonging to someone who no longer lives here", () => {
    expect(headcountOn(residents, [leave("Z", "2026-09-01", "2026-12-01")], "2026-09-14")).toBe(3);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/stay-board.test.ts`
Expected: FAIL — `headcountOn` is not exported.

- [ ] **Step 3: Implement.** Append to `apps/backend/src/services/stay/stay-board.ts`:

```ts
/** A leave as the headcount needs it: with its start, so any date can be asked about. */
export interface HeadcountLeave {
  tenantId: string;
  startDate: string;
  expectedReturnDate: string;
}

/**
 * How many residents are sleeping here on `date` — the denominator of every
 * meal forecast. A leave covers a date when it started on or before it and
 * the return date is still ahead, so a resident is counted again **on** the
 * day they come back, exactly as `isHereTonight` treats RETURNING_TODAY.
 * Leaves belonging to non-residents are ignored, so a stale row from a
 * departed tenancy cannot bend the number.
 */
export function headcountOn(
  residents: Array<{ tenantId: string }>,
  leaves: HeadcountLeave[],
  date: string,
): number {
  const away = new Set(
    leaves.filter((l) => l.startDate <= date && l.expectedReturnDate > date).map((l) => l.tenantId),
  );
  return residents.filter((r) => !away.has(r.tenantId)).length;
}
```

- [ ] **Step 4: Run it and see it pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/stay/stay-board.ts tests/stay-board.test.ts
git commit -m "feat(meals): headcountOn — residents here on any given date"
```

---

### Task 2: The learned ratio (pure)

**Files:**
- Create: `apps/backend/src/services/meals/meal-ratio.ts`
- Test: `apps/backend/tests/meal-ratio.test.ts` (add to the pure `include`)

**Interfaces produced:**
- `MEAL_TYPES`, `type MealType = "BREAKFAST"|"LUNCH"|"SNACKS"|"DINNER"`, `isMealType(v): v is MealType`
- `RATIO_WINDOW_DAYS = 14`, `MIN_RATIO_SAMPLES = 3`
- `median(values: number[]): number`
- `interface ServedLog { serveDate: string; servedCount: number; headcountAtLog: number }`
- `interface MealRatio { ratio: number; samples: number; confidence: "learning" | "learned" }`
- `mealRatio(logs: ServedLog[]): MealRatio`
- `type MealBasis = "learned" | "headcount"`
- `forecastMeal(headcount: number, ratio: MealRatio): { expected: number; basis: MealBasis; samples: number }`

- [ ] **Step 1: Write the failing test** `apps/backend/tests/meal-ratio.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { forecastMeal, isMealType, mealRatio, median, type ServedLog } from "@/src/services/meals/meal-ratio";

const log = (serveDate: string, servedCount: number, headcountAtLog = 100): ServedLog => ({ serveDate, servedCount, headcountAtLog });
const days = (n: number, servedCount: number) =>
  Array.from({ length: n }, (_, i) => log(`2026-09-${String(i + 1).padStart(2, "0")}`, servedCount));

describe("median", () => {
  it("takes the middle of an odd list and the mean of the middle two of an even one", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
  });
});

describe("mealRatio", () => {
  it("is still learning below three samples, and says so", () => {
    expect(mealRatio([])).toEqual({ ratio: 1, samples: 0, confidence: "learning" });
    expect(mealRatio(days(2, 50))).toMatchObject({ samples: 2, confidence: "learning" });
  });

  it("learns the hostel's own ratio once it has three days", () => {
    expect(mealRatio(days(3, 30))).toEqual({ ratio: 0.3, samples: 3, confidence: "learned" });
  });

  it("shrugs off one festival dinner, which a mean would not", () => {
    const logs = [...days(4, 30), log("2026-09-05", 300)];
    expect(mealRatio(logs).ratio).toBe(0.3);
  });

  it("only looks at the last 14 logged days", () => {
    const old = Array.from({ length: 14 }, (_, i) => log(`2026-08-${String(i + 1).padStart(2, "0")}`, 90));
    const recent = Array.from({ length: 14 }, (_, i) => log(`2026-09-${String(i + 1).padStart(2, "0")}`, 30));
    const r = mealRatio([...old, ...recent]);
    expect(r.samples).toBe(14);
    expect(r.ratio).toBe(0.3);
  });

  it("ignores days nobody lived here, which teach nothing and divide by zero", () => {
    const r = mealRatio([log("2026-09-01", 0, 0), ...days(3, 30)]);
    expect(r.samples).toBe(3);
    expect(Number.isFinite(r.ratio)).toBe(true);
  });

  it("keeps a ratio above 1 — guests and staff eat too", () => {
    expect(mealRatio(days(3, 110)).ratio).toBeCloseTo(1.1, 5);
  });

  it("treats a genuine zero-turnout day as data", () => {
    expect(mealRatio(days(3, 0)).ratio).toBe(0);
  });
});

describe("forecastMeal", () => {
  it("shows the plain headcount while learning", () => {
    expect(forecastMeal(31, mealRatio(days(2, 20)))).toMatchObject({ expected: 31, basis: "headcount", samples: 2 });
  });

  it("applies the learned ratio and rounds to whole people", () => {
    expect(forecastMeal(40, mealRatio(days(3, 30)))).toMatchObject({ expected: 12, basis: "learned" });
    expect(forecastMeal(31, mealRatio(days(3, 85)))).toMatchObject({ expected: 26, basis: "learned" }); // 26.35
  });

  it("never returns a negative or fractional count", () => {
    const r = forecastMeal(0, mealRatio(days(3, 30)));
    expect(r.expected).toBe(0);
    expect(Number.isInteger(r.expected)).toBe(true);
  });
});

describe("isMealType", () => {
  it("knows the four slots", () => {
    expect(isMealType("DINNER")).toBe(true);
    expect(isMealType("BRUNCH")).toBe(false);
  });
});
```

Add `'tests/meal-ratio.test.ts',` to `vitest.pure.config.ts`'s `include`.

- [ ] **Step 2: Run it and see it fail.** Expected: module not found.

- [ ] **Step 3: Implement** `apps/backend/src/services/meals/meal-ratio.ts`

```ts
/**
 * How many people actually eat, learned from what this hostel actually served.
 *
 * A headcount is not a meal count: nearly everyone eats dinner and far fewer
 * eat lunch, so showing occupancy as a meal number overstates lunch every day.
 * The ratio here is measured, never assumed — and while it has too little
 * history to be trusted, the caller is told to show the headcount instead.
 * Pure module: no I/O, runs under vitest.pure.config.ts.
 */

export const MEAL_TYPES = ["BREAKFAST", "LUNCH", "SNACKS", "DINNER"] as const;
export type MealType = (typeof MEAL_TYPES)[number];

export function isMealType(value: unknown): value is MealType {
  return typeof value === "string" && (MEAL_TYPES as readonly string[]).includes(value);
}

/** Two weeks of service — long enough for a hostel's rhythm, short enough to follow it. */
export const RATIO_WINDOW_DAYS = 14;
/** Below this it is a rumour, not a ratio. */
export const MIN_RATIO_SAMPLES = 3;

export interface ServedLog {
  serveDate: string;
  servedCount: number;
  headcountAtLog: number;
}

export interface MealRatio {
  ratio: number;
  samples: number;
  confidence: "learning" | "learned";
}

export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median, not mean: one festival dinner or one exam-week lunch should not
 * move what the kitchen cooks for a fortnight.
 */
export function mealRatio(logs: ServedLog[]): MealRatio {
  const usable = logs
    .filter((l) => l.headcountAtLog > 0)
    .sort((a, b) => b.serveDate.localeCompare(a.serveDate))
    .slice(0, RATIO_WINDOW_DAYS);
  const samples = usable.length;
  if (samples === 0) return { ratio: 1, samples: 0, confidence: "learning" };
  return {
    ratio: median(usable.map((l) => l.servedCount / l.headcountAtLog)),
    samples,
    confidence: samples >= MIN_RATIO_SAMPLES ? "learned" : "learning",
  };
}

export type MealBasis = "learned" | "headcount";

export function forecastMeal(headcount: number, ratio: MealRatio): { expected: number; basis: MealBasis; samples: number } {
  if (ratio.confidence !== "learned") return { expected: headcount, basis: "headcount", samples: ratio.samples };
  return { expected: Math.max(0, Math.round(headcount * ratio.ratio)), basis: "learned", samples: ratio.samples };
}
```

- [ ] **Step 4: Run it and see it pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/meals/meal-ratio.ts tests/meal-ratio.test.ts vitest.pure.config.ts
git commit -m "feat(meals): learn a per-meal ratio from served counts, median over 14 days"
```

---

### Task 3: `meal_service_logs`

**Files:**
- Create: `apps/backend/prisma/migrations/20260915090000_meal_service_logs/migration.sql`
- Modify: `apps/backend/prisma/schema.prisma` (append one model)

**Interfaces produced:** the Prisma delegate `prisma.meal_service_logs`.

- [ ] **Step 1: Write the migration**

```sql
-- Meal forecast (Phase 2a): what the kitchen actually served.
--
-- The ground truth a forecast is learned from. Unlike `stay_events` this is a
-- MEASUREMENT, not an event log: re-entering a number corrects it, because a
-- cook fixing a typo is normal and there is only ever one truth per meal.
--
-- `headcount_at_log` is frozen at entry on purpose — the `stay_leaves`
-- projection keeps moving, and a leave cancelled next week must not silently
-- rewrite last Tuesday's ratio.
--
-- NEW table only; no existing table or column changes. Idempotent.

CREATE TABLE IF NOT EXISTS "meal_service_logs" (
  "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
  "hostel_id"        UUID           NOT NULL REFERENCES "hostels"("id") ON DELETE CASCADE,
  "serve_date"       DATE           NOT NULL,
  "meal_type"        TEXT           NOT NULL,
  "served_count"     INTEGER        NOT NULL,
  "headcount_at_log" INTEGER        NOT NULL,
  "recorded_by"      UUID,
  "created_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"       TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "meal_service_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "meal_service_logs_served_count_check" CHECK ("served_count" >= 0),
  CONSTRAINT "meal_service_logs_headcount_check" CHECK ("headcount_at_log" >= 0)
);

-- One truth per hostel, per date, per meal. This is what makes re-entry a
-- correction rather than a second opinion.
CREATE UNIQUE INDEX IF NOT EXISTS "meal_service_logs_hostel_date_meal_key"
  ON "meal_service_logs" ("hostel_id", "serve_date", "meal_type");
-- The exact shape of the ratio query: newest first, per hostel and meal.
CREATE INDEX IF NOT EXISTS "meal_service_logs_hostel_meal_date_idx"
  ON "meal_service_logs" ("hostel_id", "meal_type", "serve_date" DESC);

-- Backend-only table: RLS on with no policies, like the Stay tables.
ALTER TABLE "meal_service_logs" ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Add the Prisma model.** Append to `apps/backend/prisma/schema.prisma`:

```prisma
/// What the kitchen actually served (meal forecast, Phase 2a). A measurement,
/// not an event: one row per hostel/date/meal, and re-entry corrects it.
/// `headcount_at_log` is the frozen denominator of the learned ratio.
model meal_service_logs {
  id               String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  hostel_id        String   @db.Uuid
  serve_date       DateTime @db.Date
  meal_type        String
  served_count     Int
  headcount_at_log Int
  recorded_by      String?  @db.Uuid
  created_at       DateTime @default(now()) @db.Timestamptz(6)
  updated_at       DateTime @default(now()) @updatedAt @db.Timestamptz(6)

  @@unique([hostel_id, serve_date, meal_type], map: "meal_service_logs_hostel_date_meal_key")
  @@index([hostel_id, meal_type, serve_date(sort: Desc)], map: "meal_service_logs_hostel_meal_date_idx")
}
```

- [ ] **Step 3: Validate and generate**

```bash
cd apps/backend
DATABASE_URL=postgresql://u:p@localhost:5432/d DIRECT_URL=postgresql://u:p@localhost:5432/d npx prisma validate
npm run prisma:generate
node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); console.log(typeof p.meal_service_logs?.upsert)"
```

Expected: `The schema … is valid`, then `function`. The accessor check matters because `prisma` is exported as `any`, so a typo would compile and fail only at runtime.

- [ ] **Step 4: Do NOT apply it yet.** The migration reaches production in Task 10, with the user's go-ahead — `.env` in this worktree points at production, so nothing here may run DDL by accident.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/20260915090000_meal_service_logs prisma/schema.prisma
git commit -m "feat(meals): meal_service_logs — one corrected truth per hostel, date and meal"
```

---

### Task 4: The forecast service

**Files:**
- Create: `apps/backend/src/services/meals/meal-errors.ts`
- Create: `apps/backend/src/services/meals/meal-forecast-service.ts`
- Test: `apps/backend/tests/meal-forecast-service.test.ts` (mock-based; add to the pure `include`)

**Interfaces consumed:** Task 1's `headcountOn`/`HeadcountLeave`; Task 2's `mealRatio`/`forecastMeal`/`MEAL_TYPES`/`isMealType`; `OCCUPYING_ALLOCATION_WHERE`; `toDbDate`/`fromDbDate` from `src/services/stay/stay-rows`; `istDateOf`/`addDaysIso`.

**Interfaces produced:**
- `class MealError { code: "INVALID_REQUEST" | "NOT_FOUND"; status: number }`, `mealErrorResponse(error)`
- `interface ForecastMealEntry { mealType: MealType; expected: number; basis: MealBasis; samples: number; ratio: number; headcount: number; served: number | null }`
- `interface ForecastDay { date: string; meals: ForecastMealEntry[] }`
- `createMealForecastService({ db? })` → `{ getForecast(hostelId, range, now?), recordServed(input, now?) }`
- `getForecast(hostelId: string, range: { from?: string; to?: string }, now?: Date): Promise<{ today: string; days: ForecastDay[] }>`
- `recordServed(input: { hostelId; serveDate: unknown; mealType: unknown; servedCount: unknown; recordedBy: string | null }, now?: Date): Promise<ForecastMealEntry>`
- `mealForecastService` (default instance)

**The subtlety this task exists to get right:** a leave that has already ended is `RETURNED`, not `ACTIVE`. Computing *yesterday's* headcount from active leaves alone would count people who were away. So the service asks for leaves whose **effective** end — `returned_at`'s IST date when present, otherwise `expected_return_date` — is after the date in question. That also makes an early return shorten the leave, which is the truth.

- [ ] **Step 1: Write the failing test** `apps/backend/tests/meal-forecast-service.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { createMealForecastService } from "@/src/services/meals/meal-forecast-service";

const NOW = new Date("2026-09-14T06:30:00.000Z"); // Monday, noon IST
const BASE = { hostelId: "h1", recordedBy: "p1" };

function makeDb({ residents = 3, leaves = [] as any[], logs = [] as any[] } = {}) {
  const db: any = {
    roomAllocation: {
      findMany: vi.fn(async () => Array.from({ length: residents }, (_, i) => ({ tenant_id: `t${i + 1}` }))),
    },
    stay_leaves: { findMany: vi.fn(async () => leaves) },
    meal_service_logs: {
      findMany: vi.fn(async () => logs),
      upsert: vi.fn(async ({ create }: any) => ({ ...create, id: "log-1" })),
    },
  };
  return db;
}
const leaveRow = (tenant: string, start: string, expected: string, returnedAt: string | null = null) => ({
  tenant_id: tenant,
  start_date: new Date(`${start}T00:00:00.000Z`),
  expected_return_date: new Date(`${expected}T00:00:00.000Z`),
  returned_at: returnedAt ? new Date(returnedAt) : null,
});
const logRow = (date: string, mealType: string, served: number, headcount = 100) => ({
  serve_date: new Date(`${date}T00:00:00.000Z`),
  meal_type: mealType,
  served_count: served,
  headcount_at_log: headcount,
});
const dinnerLogs = (n: number, served: number) =>
  Array.from({ length: n }, (_, i) => logRow(`2026-09-${String(i + 1).padStart(2, "0")}`, "DINNER", served));

describe("getForecast", () => {
  it("answers for today and tomorrow by default", async () => {
    const result = await createMealForecastService({ db: makeDb() }).getForecast("h1", {}, NOW);
    expect(result.today).toBe("2026-09-14");
    expect(result.days.map((d) => d.date)).toEqual(["2026-09-14", "2026-09-15"]);
    expect(result.days[0].meals.map((m) => m.mealType)).toEqual(["BREAKFAST", "LUNCH", "SNACKS", "DINNER"]);
  });

  it("shows the headcount, labelled, until a meal has three logged days", async () => {
    const db = makeDb({ logs: dinnerLogs(2, 30) });
    const [today] = (await createMealForecastService({ db }).getForecast("h1", {}, NOW)).days;
    const dinner = today.meals.find((m) => m.mealType === "DINNER")!;
    expect(dinner).toMatchObject({ expected: 3, basis: "headcount", samples: 2, headcount: 3 });
  });

  it("applies a learned ratio once it has three", async () => {
    const db = makeDb({ residents: 40, logs: dinnerLogs(3, 30) });
    const [today] = (await createMealForecastService({ db }).getForecast("h1", {}, NOW)).days;
    expect(today.meals.find((m) => m.mealType === "DINNER")).toMatchObject({ expected: 12, basis: "learned", headcount: 40 });
    // A meal with no logs of its own is untouched by dinner's history.
    expect(today.meals.find((m) => m.mealType === "LUNCH")).toMatchObject({ basis: "headcount", samples: 0 });
  });

  it("subtracts people whose leave covers the day, and counts them again on their return date", async () => {
    const db = makeDb({ residents: 3, leaves: [leaveRow("t2", "2026-09-12", "2026-09-15")] });
    const { days } = await createMealForecastService({ db }).getForecast("h1", { from: "2026-09-14", to: "2026-09-15" }, NOW);
    expect(days[0].meals[0].headcount).toBe(2);
    expect(days[1].meals[0].headcount).toBe(3);
  });

  it("treats an early return as the real end of the leave", async () => {
    const db = makeDb({ residents: 3, leaves: [leaveRow("t2", "2026-09-10", "2026-09-20", "2026-09-13T10:00:00.000Z")] });
    const { days } = await createMealForecastService({ db }).getForecast("h1", { from: "2026-09-14", to: "2026-09-14" }, NOW);
    expect(days[0].meals[0].headcount).toBe(3);
  });

  it("reports what has already been logged, so the kitchen sheet knows what to ask for", async () => {
    const db = makeDb({ logs: [logRow("2026-09-14", "BREAKFAST", 27, 30)] });
    const [today] = (await createMealForecastService({ db }).getForecast("h1", {}, NOW)).days;
    expect(today.meals.find((m) => m.mealType === "BREAKFAST")!.served).toBe(27);
    expect(today.meals.find((m) => m.mealType === "DINNER")!.served).toBeNull();
  });

  it("refuses a nonsense range rather than scanning a year", async () => {
    const service = createMealForecastService({ db: makeDb() });
    await expect(service.getForecast("h1", { from: "nope" }, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.getForecast("h1", { from: "2026-09-14", to: "2026-09-01" }, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.getForecast("h1", { from: "2026-09-01", to: "2026-10-30" }, NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("recordServed", () => {
  const served = (over: Record<string, unknown> = {}) => ({ ...BASE, serveDate: "2026-09-14", mealType: "DINNER", servedCount: 27, ...over });

  it("freezes the headcount of the day it is logging", async () => {
    const db = makeDb({ residents: 3, leaves: [leaveRow("t3", "2026-09-13", "2026-09-16")] });
    const entry = await createMealForecastService({ db }).recordServed(served({ servedCount: 2 }), NOW);
    const call = db.meal_service_logs.upsert.mock.calls[0][0];
    expect(call.where).toEqual({
      hostel_id_serve_date_meal_type: { hostel_id: "h1", serve_date: new Date("2026-09-14T00:00:00.000Z"), meal_type: "DINNER" },
    });
    expect(call.create).toMatchObject({ served_count: 2, headcount_at_log: 2, recorded_by: "p1" });
    expect(call.update).toMatchObject({ served_count: 2, headcount_at_log: 2 });
    expect(entry).toMatchObject({ mealType: "DINNER", served: 2 });
  });

  it("rejects a future date, since nobody has eaten it yet", async () => {
    await expect(createMealForecastService({ db: makeDb() }).recordServed(served({ serveDate: "2026-09-15" }), NOW))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects a count that is obviously a typo", async () => {
    // 3 residents; 200 served is a slipped keypad, not a feast.
    await expect(createMealForecastService({ db: makeDb({ residents: 3 }) }).recordServed(served({ servedCount: 200 }), NOW))
      .rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("rejects a bad meal, a negative count and a fractional count", async () => {
    const service = createMealForecastService({ db: makeDb() });
    await expect(service.recordServed(served({ mealType: "BRUNCH" }), NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.recordServed(served({ servedCount: -1 }), NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service.recordServed(served({ servedCount: 2.5 }), NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("accepts zero — nobody came is a real answer", async () => {
    const db = makeDb();
    await expect(createMealForecastService({ db }).recordServed(served({ servedCount: 0 }), NOW)).resolves.toMatchObject({ served: 0 });
  });
});
```

Add `'tests/meal-forecast-service.test.ts',` to `vitest.pure.config.ts`'s `include`.

- [ ] **Step 2: Run it and see it fail.** Expected: module not found.

- [ ] **Step 3a: Implement** `apps/backend/src/services/meals/meal-errors.ts`

```ts
import { apiError } from "@/lib/utils/api-utils";

export type MealErrorCode = "INVALID_REQUEST" | "NOT_FOUND";

export class MealError extends Error {
  constructor(
    public readonly code: MealErrorCode,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "MealError";
  }
}

export const invalidRequest = (message: string) => new MealError("INVALID_REQUEST", message, 400);

/** Every meals route's catch block: the repo's standard error envelope. */
export function mealErrorResponse(error: any) {
  if (error instanceof MealError) return apiError(error.message, error.code, error.status);
  const code = error?.code;
  const message = String(error?.message || "Meal forecast failed");
  if (code === "HOSTEL_CONTEXT_REQUIRED") return apiError(message, code, 400);
  if (code === "UNAUTHORIZED") return apiError(message, code, 401);
  if (code === "FORBIDDEN") return apiError("Forbidden", code, 403);
  return apiError(message, "ERROR", 500);
}
```

- [ ] **Step 3b: Implement** `apps/backend/src/services/meals/meal-forecast-service.ts`

```ts
import { prisma } from "@/lib/db";
import { addDaysIso, daysBetweenIso, istDateOf } from "@/lib/timezone";
import { OCCUPYING_ALLOCATION_WHERE } from "@/lib/services/room-capacity-service";
import { headcountOn, type HeadcountLeave } from "@/src/services/stay/stay-board";
import { fromDbDate, toDbDate } from "@/src/services/stay/stay-rows";
import {
  forecastMeal, isMealType, mealRatio, MEAL_TYPES, RATIO_WINDOW_DAYS,
  type MealBasis, type MealType, type ServedLog,
} from "./meal-ratio";
import { invalidRequest } from "./meal-errors";

/**
 * The meal forecast (Phase 2a). Composes Stay's residents and leaves with this
 * hostel's own service history; it never recalculates occupancy and never
 * touches `stay_events`. See docs/superpowers/specs/2026-09-14-meal-forecast-design.md.
 */

export interface ForecastMealEntry {
  mealType: MealType;
  expected: number;
  basis: MealBasis;
  samples: number;
  ratio: number;
  headcount: number;
  /** What was actually served that day, once someone has logged it. */
  served: number | null;
}

export interface ForecastDay {
  date: string;
  meals: ForecastMealEntry[];
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
/** Enough to cover the ratio window with room for unlogged days. */
const HISTORY_DAYS = 60;
/** A range longer than this is a mistake, not a question. */
const MAX_RANGE_DAYS = 14;
/** Above this multiple of the headcount, it is a slipped keypad. */
const IMPLAUSIBLE_MULTIPLE = 3;

function requireIsoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00.000Z`))) {
    throw invalidRequest(`${field} must be a date as YYYY-MM-DD`);
  }
  return value;
}

export function createMealForecastService(deps: { db?: any } = {}) {
  const db = deps.db ?? prisma;

  async function residentIds(hostelId: string): Promise<Array<{ tenantId: string }>> {
    const allocations = await db.roomAllocation.findMany({
      where: { hostel_id: hostelId, ...OCCUPYING_ALLOCATION_WHERE },
      select: { tenant_id: true },
    });
    const seen = new Set<string>();
    for (const a of allocations as any[]) seen.add(a.tenant_id);
    return Array.from(seen).map((tenantId) => ({ tenantId }));
  }

  /**
   * Leaves as the headcount needs them. A leave that has ended is RETURNED,
   * not ACTIVE, so yesterday's headcount cannot be computed from active rows
   * alone — and when someone came back early, the day they actually returned
   * is the end of the leave, not the day they had planned.
   */
  async function leavesFrom(hostelId: string, earliest: string): Promise<HeadcountLeave[]> {
    const rows = await db.stay_leaves.findMany({
      where: { hostel_id: hostelId, status: { in: ["ACTIVE", "RETURNED"] }, expected_return_date: { gte: toDbDate(earliest) } },
      select: { tenant_id: true, start_date: true, expected_return_date: true, returned_at: true },
    });
    return (rows as any[]).map((r) => ({
      tenantId: r.tenant_id,
      startDate: fromDbDate(r.start_date),
      expectedReturnDate: r.returned_at ? istDateOf(r.returned_at) : fromDbDate(r.expected_return_date),
    }));
  }

  async function logsSince(hostelId: string, earliest: string) {
    const rows = await db.meal_service_logs.findMany({
      where: { hostel_id: hostelId, serve_date: { gte: toDbDate(earliest) } },
      select: { serve_date: true, meal_type: true, served_count: true, headcount_at_log: true },
    });
    return (rows as any[]).map((r) => ({
      serveDate: fromDbDate(r.serve_date),
      mealType: String(r.meal_type),
      servedCount: r.served_count,
      headcountAtLog: r.headcount_at_log,
    }));
  }

  async function getForecast(hostelId: string, range: { from?: string; to?: string }, now: Date = new Date()) {
    const today = istDateOf(now);
    const from = range.from === undefined ? today : requireIsoDate(range.from, "from");
    const to = range.to === undefined ? addDaysIso(from, 1) : requireIsoDate(range.to, "to");
    const span = daysBetweenIso(from, to);
    if (span < 0) throw invalidRequest("`to` must not be before `from`");
    if (span > MAX_RANGE_DAYS) throw invalidRequest(`Ask for at most ${MAX_RANGE_DAYS} days at a time`);

    const historyStart = addDaysIso(today, -HISTORY_DAYS);
    const [residents, leaves, logs] = await Promise.all([
      residentIds(hostelId),
      leavesFrom(hostelId, historyStart < from ? historyStart : from),
      logsSince(hostelId, historyStart),
    ]);

    const ratios = new Map<MealType, ReturnType<typeof mealRatio>>();
    for (const mealType of MEAL_TYPES) {
      const own: ServedLog[] = logs
        .filter((l) => l.mealType === mealType)
        .map((l) => ({ serveDate: l.serveDate, servedCount: l.servedCount, headcountAtLog: l.headcountAtLog }));
      ratios.set(mealType, mealRatio(own));
    }

    const days: ForecastDay[] = [];
    for (let offset = 0; offset <= span; offset += 1) {
      const date = addDaysIso(from, offset);
      const headcount = headcountOn(residents, leaves, date);
      days.push({
        date,
        meals: MEAL_TYPES.map((mealType) => {
          const ratio = ratios.get(mealType)!;
          const forecast = forecastMeal(headcount, ratio);
          const logged = logs.find((l) => l.serveDate === date && l.mealType === mealType);
          return {
            mealType,
            expected: forecast.expected,
            basis: forecast.basis,
            samples: forecast.samples,
            ratio: ratio.ratio,
            headcount,
            served: logged ? logged.servedCount : null,
          };
        }),
      });
    }
    return { today, days };
  }

  async function recordServed(
    input: { hostelId: string; serveDate: unknown; mealType: unknown; servedCount: unknown; recordedBy: string | null },
    now: Date = new Date(),
  ): Promise<ForecastMealEntry> {
    const today = istDateOf(now);
    const serveDate = requireIsoDate(input.serveDate, "serveDate");
    if (!isMealType(input.mealType)) throw invalidRequest("mealType must be BREAKFAST, LUNCH, SNACKS or DINNER");
    const servedCount = input.servedCount;
    if (typeof servedCount !== "number" || !Number.isInteger(servedCount) || servedCount < 0) {
      throw invalidRequest("servedCount must be a whole number, zero or more");
    }
    if (serveDate > today) throw invalidRequest("That meal has not been served yet");
    if (daysBetweenIso(serveDate, today) > RATIO_WINDOW_DAYS * 2) {
      throw invalidRequest("That day is too long ago to log");
    }

    const [residents, leaves] = await Promise.all([residentIds(input.hostelId), leavesFrom(input.hostelId, serveDate)]);
    const headcount = headcountOn(residents, leaves, serveDate);
    if (servedCount > Math.max(headcount, 1) * IMPLAUSIBLE_MULTIPLE) {
      throw invalidRequest(`That is more than ${IMPLAUSIBLE_MULTIPLE}× the ${headcount} people staying — check the number`);
    }

    const row = {
      hostel_id: input.hostelId,
      serve_date: toDbDate(serveDate),
      meal_type: input.mealType,
      served_count: servedCount,
      headcount_at_log: headcount,
      recorded_by: input.recordedBy,
    };
    await db.meal_service_logs.upsert({
      where: { hostel_id_serve_date_meal_type: { hostel_id: input.hostelId, serve_date: toDbDate(serveDate), meal_type: input.mealType } },
      create: row,
      update: { served_count: servedCount, headcount_at_log: headcount, recorded_by: input.recordedBy, updated_at: new Date() },
    });

    const ratio = mealRatio([]);
    return {
      mealType: input.mealType,
      expected: servedCount,
      basis: "headcount",
      samples: ratio.samples,
      ratio: ratio.ratio,
      headcount,
      served: servedCount,
    };
  }

  return { getForecast, recordServed };
}

export const mealForecastService = createMealForecastService();
```

- [ ] **Step 4: Run the tests and see them pass**

```bash
npx vitest run --config vitest.pure.config.ts tests/meal-forecast-service.test.ts tests/meal-ratio.test.ts tests/stay-board.test.ts
npx tsc --noEmit 2>&1 | grep -E "src/services/meals|stay-board" || echo "clean"
```

- [ ] **Step 5: Commit**

```bash
git add src/services/meals tests/meal-forecast-service.test.ts vitest.pure.config.ts
git commit -m "feat(meals): forecast service — composes residents, leaves and this hostel's own history"
```

---

### Task 5: Routes

**Files:**
- Create: `apps/backend/app/api/hostels/[id]/meals/forecast/route.ts` (GET)
- Create: `apps/backend/app/api/hostels/[id]/meals/served/route.ts` (PUT)
- Modify: `apps/backend/app/api/hostels/[id]/stay/route.ts` and `apps/backend/app/api/owner/stay/summary/route.ts` (attach the dinner forecast, tolerantly)
- Modify: `apps/backend/scripts/architectural-invariants-check.ts` (scan roots)
- Test: `apps/backend/tests/meal-routes.test.ts` (add to the pure `include`)

**Wire contract:**

| Method | Path | 200 body |
|---|---|---|
| GET | `/api/hostels/:id/meals/forecast?from=&to=` | `{ success, today, days: ForecastDay[] }` |
| PUT | `/api/hostels/:id/meals/served` | `{ success, entry: ForecastMealEntry }` |

The Stay board and the owner summary gain `mealForecast` — `{ expected, basis, samples } | null` for **dinner today** — composed **in the route**, exactly as `/api/owner/portfolio/summary` composes `expenseService`. Services stay independent: meals may read Stay, Stay never reads meals. A meals failure resolves to `null` and Home keeps working.

- [ ] **Step 1: Write the failing test** `apps/backend/tests/meal-routes.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, mockMeals, mockAssert } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockMeals: { getForecast: vi.fn(), recordServed: vi.fn() },
  mockAssert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/auth", () => ({
  getSession: mockSession,
  apiError: (message: string, code: string, status = 500) =>
    new Response(JSON.stringify({ success: false, error: { message, code } }), { status }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ success: true, ...data }), { status }),
}));
vi.mock("@/lib/security/scoped-query", () => ({
  assertHostelBelongsToOwner: mockAssert,
  requireHostelBelongsToOwner: mockAssert,
}));
vi.mock("@/src/services/meals/meal-forecast-service", () => ({ mealForecastService: mockMeals }));

import { GET as getForecast } from "../app/api/hostels/[id]/meals/forecast/route";
import { PUT as putServed } from "../app/api/hostels/[id]/meals/served/route";
import { MealError } from "@/src/services/meals/meal-errors";

const HOSTEL = "11111111-1111-4111-8111-111111111111";
const OWNER_SESSION = { sub: "o1", owner_id: "o1", role: "OWNER" };
const req = (body: unknown = {}, url = `http://test/api/hostels/${HOSTEL}/meals/forecast`) =>
  ({ json: async () => body, url }) as any;
const ctx = { params: Promise.resolve({ id: HOSTEL }) } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mockAssert.mockResolvedValue({ id: HOSTEL });
});

describe("meals routes", () => {
  it("keeps tenants out", async () => {
    mockSession.mockResolvedValue({ sub: "p1", role: "TENANT" });
    expect((await getForecast(req(), ctx)).status).toBe(403);
    expect((await putServed(req({}), ctx)).status).toBe(403);
  });

  it("scopes the forecast to a hostel the owner owns, and passes the range through", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockMeals.getForecast.mockResolvedValue({ today: "2026-09-14", days: [] });
    const res = await getForecast(req({}, `http://test/api?from=2026-09-14&to=2026-09-15`), ctx);
    expect(res.status).toBe(200);
    expect(mockAssert).toHaveBeenCalledWith("o1", HOSTEL);
    expect(mockMeals.getForecast).toHaveBeenCalledWith(HOSTEL, { from: "2026-09-14", to: "2026-09-15" });
  });

  it("refuses another owner's hostel", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockAssert.mockRejectedValue(Object.assign(new Error("FORBIDDEN"), { code: "FORBIDDEN" }));
    expect((await getForecast(req(), ctx)).status).toBe(403);
    expect(mockMeals.getForecast).not.toHaveBeenCalled();
  });

  it("records a served count with the session owner as the author", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockMeals.recordServed.mockResolvedValue({ mealType: "DINNER", served: 27 });
    const res = await putServed(req({ serveDate: "2026-09-14", mealType: "DINNER", servedCount: 27 }), ctx);
    expect(res.status).toBe(200);
    expect(mockMeals.recordServed).toHaveBeenCalledWith(expect.objectContaining({
      hostelId: HOSTEL, serveDate: "2026-09-14", mealType: "DINNER", servedCount: 27, recordedBy: "o1",
    }));
  });

  it("carries a MealError's status and code through", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockMeals.recordServed.mockRejectedValue(new MealError("INVALID_REQUEST", "That meal has not been served yet", 400));
    const res = await putServed(req({ serveDate: "2026-09-15", mealType: "DINNER", servedCount: 1 }), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ message: "That meal has not been served yet", code: "INVALID_REQUEST" });
  });
});
```

- [ ] **Step 2: Run it and see it fail.** Expected: route modules not found.

- [ ] **Step 3a:** `apps/backend/app/api/hostels/[id]/meals/forecast/route.ts`

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { mealForecastService } from "@/src/services/meals/meal-forecast-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/**
 * GET /api/hostels/[id]/meals/forecast?from=&to=
 *
 * How many to cook for, per day and meal — learned from what this hostel
 * actually served, or the plain headcount while it is still learning.
 * Defaults to today and tomorrow, which is what the kitchen sheet shows.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const url = new URL(req.url);
    const range: { from?: string; to?: string } = {};
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    if (from) range.from = from;
    if (to) range.to = to;
    return apiResponse(await mealForecastService.getForecast(id, range));
  } catch (error) {
    return mealErrorResponse(error);
  }
}
```

- [ ] **Step 3b:** `apps/backend/app/api/hostels/[id]/meals/served/route.ts`

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { mealForecastService } from "@/src/services/meals/meal-forecast-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/**
 * PUT /api/hostels/[id]/meals/served
 * Body: { serveDate, mealType, servedCount }
 *
 * What the kitchen actually served. PUT, not POST: there is one truth per
 * hostel, date and meal, and re-entering it corrects a typo rather than
 * adding a second opinion.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const entry = await mealForecastService.recordServed({
      hostelId: id,
      serveDate: body?.serveDate,
      mealType: body?.mealType,
      servedCount: body?.servedCount,
      recordedBy: session.sub,
    });
    return apiResponse({ entry });
  } catch (error) {
    return mealErrorResponse(error);
  }
}
```

- [ ] **Step 3c: Attach tonight's dinner to the Stay surfaces.** In `app/api/hostels/[id]/stay/route.ts`, replace the `return apiResponse(...)` line with:

```ts
    // Composed here, not inside either service: meals may read Stay, Stay must
    // never read meals. A meals failure must not cost the owner their board.
    const [board, forecast] = await Promise.all([
      stayService.getHostelBoard(id),
      mealForecastService.getForecast(id, {}).catch(() => null),
    ]);
    const dinner = forecast?.days[0]?.meals.find((m) => m.mealType === "DINNER") ?? null;
    return apiResponse({
      ...board,
      mealForecast: dinner ? { expected: dinner.expected, basis: dinner.basis, samples: dinner.samples } : null,
    });
```

and add `import { mealForecastService } from "@/src/services/meals/meal-forecast-service";`.

In `app/api/owner/stay/summary/route.ts`, replace its `return apiResponse(...)` with:

```ts
    const summary = await stayService.getPortfolioSummary(scope.owner_id);
    // Same tolerance as the portfolio route's expense call: a failure here
    // leaves the Tonight row on its honest headcount rather than blanking it.
    const forecasts = await Promise.all(
      summary.hostels.map((h) =>
        mealForecastService
          .getForecast(h.hostelId, {})
          .then((f) => f.days[0]?.meals.find((m) => m.mealType === "DINNER") ?? null)
          .catch(() => null),
      ),
    );
    const learned = forecasts.filter((f) => f && f.basis === "learned");
    return apiResponse({
      ...summary,
      mealForecast:
        learned.length > 0
          ? { expected: learned.reduce((total, f) => total + (f?.expected ?? 0), 0), basis: "learned" as const }
          : null,
    });
```

with the same import added.

- [ ] **Step 3d: Put the new folders under the invariant checks.** In `scripts/architectural-invariants-check.ts`, append to the `roots` array of **both** hostelId rules:

```ts
"src/services/meals", "app/api/hostels/[id]/meals",
```

- [ ] **Step 4: Run the tests and checks**

```bash
npx vitest run --config vitest.pure.config.ts tests/meal-routes.test.ts tests/stay-routes.test.ts
npm run check:invariants
```

Both stay-route tests must still pass — they assert the board's shape, and it just gained a field.

- [ ] **Step 5: Commit**

```bash
git add "app/api/hostels/[id]/meals" "app/api/hostels/[id]/stay/route.ts" app/api/owner/stay/summary/route.ts scripts/architectural-invariants-check.ts tests/meal-routes.test.ts vitest.pure.config.ts
git commit -m "feat(meals): forecast and served-count routes; Stay surfaces borrow tonight's dinner"
```

---

### Task 6: Frontend contract and the display model

**Files:**
- Create: `apps/frontend/src/features/owner-food/mealForecast.ts`
- Test: `apps/frontend/src/features/owner-food/mealForecast.test.ts`
- Modify: `apps/frontend/src/features/food/api/index.ts` (two methods on `foodService`)
- Modify: `apps/frontend/src/lib/queryKeys.ts`
- Create: `apps/frontend/src/features/owner-food/hooks/useMealForecast.ts`

**Interfaces produced:**
- Types `MealType`, `MealBasis`, `ForecastMealEntry`, `ForecastDay`, `MealForecast` (`{ today: string; days: ForecastDay[] }`)
- `SLOT_TO_MEAL_TYPE: Record<MealSlotKey, MealType>`
- `entryFor(forecast, date, slot): ForecastMealEntry | null`
- `expectedLabel(entry): string`
- `honestyLine(entry): string | null`
- `canLogNow(args: { entry; slot; timings; nowHHmm; isToday }): boolean`
- `foodService.getMealForecast(hostelId, range?)`, `foodService.recordMealServed(hostelId, body)`
- `queryKeys.meals.forecast(hostelId, from, to)`
- `useMealForecast(hostelId)` → `{ forecast, isLoading, logServed, isLogging }`

- [ ] **Step 1: Write the failing test** `apps/frontend/src/features/owner-food/mealForecast.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { canLogNow, entryFor, expectedLabel, honestyLine, SLOT_TO_MEAL_TYPE, type ForecastMealEntry, type MealForecast } from './mealForecast';

const entry = (over: Partial<ForecastMealEntry> = {}): ForecastMealEntry => ({
  mealType: 'DINNER', expected: 31, basis: 'headcount', samples: 0, ratio: 1, headcount: 31, served: null, ...over,
});
const forecast: MealForecast = {
  today: '2026-09-14',
  days: [
    { date: '2026-09-14', meals: [entry({ mealType: 'BREAKFAST', served: 27 }), entry()] },
    { date: '2026-09-15', meals: [entry({ mealType: 'DINNER', expected: 28, basis: 'learned', samples: 9 })] },
  ],
};
const timings = {
  BREAKFAST: { start: '07:00', end: '09:00', enabled: true },
  LUNCH: { start: '12:30', end: '14:00', enabled: true },
  SNACKS: { start: '17:00', end: '18:00', enabled: false },
  DINNER: { start: '20:00', end: '22:00', enabled: true },
};

describe('slot mapping', () => {
  it('bridges the kitchen sheet lowercase keys and the API uppercase ones', () => {
    expect(SLOT_TO_MEAL_TYPE.dinner).toBe('DINNER');
    expect(SLOT_TO_MEAL_TYPE.snacks).toBe('SNACKS');
  });
});

describe('entryFor', () => {
  it('finds a day and meal, or says there is none', () => {
    expect(entryFor(forecast, '2026-09-14', 'breakfast')?.served).toBe(27);
    expect(entryFor(forecast, '2026-09-15', 'dinner')?.expected).toBe(28);
    expect(entryFor(forecast, '2026-09-16', 'dinner')).toBeNull();
    expect(entryFor(undefined, '2026-09-14', 'dinner')).toBeNull();
  });
});

describe('copy', () => {
  it('marks a learned number as an estimate and leaves a headcount bare', () => {
    expect(expectedLabel(entry({ basis: 'learned', expected: 28 }))).toBe('≈ 28');
    expect(expectedLabel(entry({ expected: 31 }))).toBe('31');
  });

  it('always says which of the two it is', () => {
    expect(honestyLine(entry({ basis: 'learned', samples: 9 }))).toBe('from the last 2 weeks');
    expect(honestyLine(entry())).toBe('still learning what people actually eat');
  });
});

describe('canLogNow — ask only for meals that have happened', () => {
  const args = { slot: 'breakfast' as const, timings, isToday: true };
  it('asks once the serving window has closed', () => {
    expect(canLogNow({ ...args, entry: entry({ served: null }), nowHHmm: '09:30' })).toBe(true);
  });
  it('does not ask during or before the meal', () => {
    expect(canLogNow({ ...args, entry: entry({ served: null }), nowHHmm: '08:30' })).toBe(false);
    expect(canLogNow({ ...args, entry: entry({ served: null }), nowHHmm: '06:00' })).toBe(false);
  });
  it('still allows a correction after it has been logged', () => {
    expect(canLogNow({ ...args, entry: entry({ served: 27 }), nowHHmm: '09:30' })).toBe(true);
  });
  it('never asks about a meal the hostel does not serve', () => {
    expect(canLogNow({ ...args, slot: 'snacks', entry: entry(), nowHHmm: '23:00' })).toBe(false);
  });
  it('asks about yesterday whatever the clock says, and never about tomorrow', () => {
    expect(canLogNow({ ...args, isToday: false, entry: entry(), nowHHmm: '01:00' })).toBe(true);
    expect(canLogNow({ ...args, entry: null, nowHHmm: '23:00' })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `cd apps/frontend && npx vitest run src/features/owner-food/mealForecast.test.ts`

- [ ] **Step 3a: Implement** `apps/frontend/src/features/owner-food/mealForecast.ts`

```ts
import type { MealSlotKey } from './weekGrid';
import type { MealTimings } from '@features/food/mealTimings';

/**
 * The kitchen's numbers, as a screen needs them. Pure: the copy rules and the
 * "is this meal loggable yet" decision are tested here, so the page only
 * renders. See docs/superpowers/specs/2026-09-14-meal-forecast-design.md.
 */

export type MealType = 'BREAKFAST' | 'LUNCH' | 'SNACKS' | 'DINNER';
export type MealBasis = 'learned' | 'headcount';

export interface ForecastMealEntry {
  mealType: MealType;
  expected: number;
  basis: MealBasis;
  samples: number;
  ratio: number;
  headcount: number;
  served: number | null;
}

export interface ForecastDay {
  date: string;
  meals: ForecastMealEntry[];
}

export interface MealForecast {
  today: string;
  days: ForecastDay[];
}

/** The kitchen sheet speaks lowercase slots; the API speaks uppercase meal types. */
export const SLOT_TO_MEAL_TYPE: Record<MealSlotKey, MealType> = {
  breakfast: 'BREAKFAST',
  lunch: 'LUNCH',
  snacks: 'SNACKS',
  dinner: 'DINNER',
};

export function entryFor(forecast: MealForecast | undefined, date: string, slot: MealSlotKey): ForecastMealEntry | null {
  const day = forecast?.days.find((d) => d.date === date);
  return day?.meals.find((m) => m.mealType === SLOT_TO_MEAL_TYPE[slot]) ?? null;
}

/** "≈" is the whole honesty of the feature: it marks a number that was inferred. */
export function expectedLabel(entry: ForecastMealEntry): string {
  return entry.basis === 'learned' ? `≈ ${entry.expected}` : String(entry.expected);
}

export function honestyLine(entry: ForecastMealEntry): string {
  return entry.basis === 'learned' ? 'from the last 2 weeks' : 'still learning what people actually eat';
}

/**
 * Ask for a served count only once the meal has actually happened: after its
 * window closed today, or any time for an earlier day. A meal the hostel does
 * not serve is never asked about, and an already-logged number stays editable
 * because correcting a typo is the normal case.
 */
export function canLogNow(args: {
  entry: ForecastMealEntry | null;
  slot: MealSlotKey;
  timings: MealTimings;
  nowHHmm: string;
  isToday: boolean;
}): boolean {
  if (!args.entry) return false;
  const timing = args.timings[SLOT_TO_MEAL_TYPE[args.slot]];
  if (!timing?.enabled) return false;
  if (!args.isToday) return true;
  return args.nowHHmm >= timing.end;
}
```

- [ ] **Step 3b: Add the API methods.** In `apps/frontend/src/features/food/api/index.ts`, add to the `foodService` object:

```ts
  /** Stay Status Phase 2a — how many to cook for, and what was actually served. */
  getMealForecast: async (hostelId: string, range?: { from?: string; to?: string }) => {
    const response = await api.get(`/hostels/${hostelId}/meals/forecast`, { params: range });
    const { success: _success, ...rest } = (response.data ?? {}) as any;
    return rest as { today: string; days: Array<{ date: string; meals: any[] }> };
  },
  recordMealServed: async (hostelId: string, body: { serveDate: string; mealType: string; servedCount: number }) => {
    const response = await api.put(`/hostels/${hostelId}/meals/served`, body);
    return (response.data as any)?.entry;
  },
```

- [ ] **Step 3c: Add the query key.** In `apps/frontend/src/lib/queryKeys.ts`, beside the `stay` member:

```ts
  /** Meal forecast (Phase 2a). Hostel-scoped, as the invariant check requires. */
  meals: {
    forecast: (hostelId: string | null | undefined, from?: string, to?: string) =>
      hostelKey(hostelId, 'meals', 'forecast', from ?? 'today', to ?? 'tomorrow'),
  },
```

- [ ] **Step 3d: Implement** `apps/frontend/src/features/owner-food/hooks/useMealForecast.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { foodService } from '@features/food/api';
import type { MealForecast } from '../mealForecast';

/** Today and tomorrow's numbers, plus the one way to log what was served. */
export function useMealForecast(hostelId: string | null | undefined) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.meals.forecast(hostelId),
    queryFn: () => foodService.getMealForecast(hostelId as string) as Promise<MealForecast>,
    enabled: Boolean(hostelId),
    staleTime: 60_000,
  });
  const mutation = useMutation({
    mutationFn: (body: { serveDate: string; mealType: string; servedCount: number }) =>
      foodService.recordMealServed(hostelId as string, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.meals.forecast(hostelId) });
      // Tonight's dinner rides on the Stay surfaces, so they are now stale too.
      queryClient.invalidateQueries({ queryKey: queryKeys.stay.board(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.stay.summary() });
    },
  });
  return { forecast: query.data, isLoading: query.isLoading, logServed: mutation.mutateAsync, isLogging: mutation.isPending };
}
```

- [ ] **Step 4: Run the tests and the boundary check**

```bash
npx vitest run src/features/owner-food/mealForecast.test.ts
npm run check:architecture
```

- [ ] **Step 5: Commit**

```bash
git add src/features/owner-food/mealForecast.ts src/features/owner-food/mealForecast.test.ts src/features/owner-food/hooks/useMealForecast.ts src/features/food/api/index.ts src/lib/queryKeys.ts
git commit -m "feat(meals): frontend contract, query key and the tested display model"
```

---

### Task 7: The kitchen sheet shows the numbers and asks for the count

**Files:**
- Create: `apps/frontend/src/features/owner-food/components/ServedCountRow.tsx`
- Modify: `apps/frontend/src/features/owner-food/pages/KitchenSheetPage.tsx`

**Interfaces consumed:** Task 6's `useMealForecast`, `entryFor`, `expectedLabel`, `honestyLine`, `canLogNow`, `SLOT_TO_MEAL_TYPE`.

- [ ] **Step 1: Write the component** `apps/frontend/src/features/owner-food/components/ServedCountRow.tsx`

```tsx
import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';

interface ServedCountRowProps {
  label: string;
  served: number | null;
  busy: boolean;
  onSave: (count: number) => Promise<unknown>;
}

/**
 * "How many did you serve?" — one number, entered by the person who served it.
 * Deliberately blunt: a numeric keypad, a wide tap target and nothing else,
 * because this sits on the kitchen wall screen (ADR-144's audience).
 */
export function ServedCountRow({ label, served, busy, onSave }: ServedCountRowProps) {
  const [value, setValue] = useState(served === null ? '' : String(served));
  useEffect(() => setValue(served === null ? '' : String(served)), [served]);

  const parsed = Number(value);
  const valid = value.trim() !== '' && Number.isInteger(parsed) && parsed >= 0;
  const dirty = valid && parsed !== served;

  return (
    <div className="flex items-center gap-2 py-2">
      <span className="flex-1 text-[13px] text-muted-foreground">{label}</span>
      <input
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => setValue(e.target.value.replace(/[^0-9]/g, ''))}
        aria-label={`How many were served — ${label}`}
        className="h-11 w-20 rounded-xl border border-border bg-card px-3 text-center text-[17px] font-bold tabular-nums text-foreground"
      />
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={() => onSave(parsed)}
        className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
        aria-label={`Save served count for ${label}`}
      >
        <Check className="h-5 w-5" strokeWidth={2.5} />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Wire it into the kitchen sheet.** In `KitchenSheetPage.tsx`:

Add the imports:

```tsx
import { stayoToast } from '@shared/ui-patterns/Toast';
import { parseApiError } from '@lib/errors';
import { useMealForecast } from '../hooks/useMealForecast';
import { canLogNow, entryFor, expectedLabel, honestyLine, SLOT_TO_MEAL_TYPE } from '../mealForecast';
import { ServedCountRow } from '../components/ServedCountRow';
```

After the existing hooks, add:

```tsx
  const meals = useMealForecast(hostelId ?? undefined);
  const todayDate = meals.forecast?.today ?? '';
  const tomorrowDate = meals.forecast?.days[1]?.date ?? '';
  const nowHHmm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const logServed = async (slot: (typeof served)[number], count: number) => {
    try {
      await meals.logServed({ serveDate: todayDate, mealType: SLOT_TO_MEAL_TYPE[slot], servedCount: count });
      stayoToast.success('Saved');
    } catch (error) {
      stayoToast.error(parseApiError(error) || 'Could not save that count.');
    }
  };
```

Inside today's `served.map((slot) => {` block, after the `dishes(cell)` span, add the expected number:

```tsx
              {(() => {
                const entry = entryFor(meals.forecast, todayDate, slot);
                if (!entry) return null;
                return (
                  <span className="ml-auto flex-none text-right">
                    <span className="block font-display text-[22px] font-extrabold tabular-nums text-foreground">{expectedLabel(entry)}</span>
                    <span className="block text-[10.5px] text-muted-foreground">{honestyLine(entry)}</span>
                  </span>
                );
              })()}
```

In tomorrow's `served.map(...)` block, after the `<dd>`, add:

```tsx
                {(() => {
                  const entry = entryFor(meals.forecast, tomorrowDate, slot);
                  return entry ? (
                    <dd className="ml-auto text-[13px] font-bold tabular-nums text-muted-foreground">{expectedLabel(entry)}</dd>
                  ) : null;
                })()}
```

Finally, below the "Tomorrow — prep tonight" block, add the logging section:

```tsx
      {/* The measurement the forecast learns from. Only meals that have
          actually been served are asked about — see `canLogNow`. */}
      {(() => {
        const loggable = served.filter((slot) =>
          canLogNow({ entry: entryFor(meals.forecast, todayDate, slot), slot, timings: mealTimings, nowHHmm, isToday: true }),
        );
        if (loggable.length === 0) return null;
        return (
          <div className="rounded-2xl border border-border p-4">
            <span className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">How many did you serve?</span>
            <div className="mt-1 divide-y divide-border">
              {loggable.map((slot) => (
                <ServedCountRow
                  key={slot}
                  label={MEAL_CATEGORY_META[slot].label}
                  served={entryFor(meals.forecast, todayDate, slot)?.served ?? null}
                  busy={meals.isLogging}
                  onSave={(count) => logServed(slot, count)}
                />
              ))}
            </div>
          </div>
        );
      })()}
```

- [ ] **Step 3: Verify**

```bash
npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "owner-food|mealForecast|ServedCountRow" || echo "clean"
npm run build 2>&1 | tail -3
npm test 2>&1 | tail -3
```

`vite build` does not typecheck, so the filtered `tsc` is the real gate.

- [ ] **Step 4: Commit**

```bash
git add src/features/owner-food
git commit -m "feat(meals): kitchen sheet shows expected counts and asks what was served"
```

---

### Task 8: The Stay surfaces prefer a learned number

**Files:**
- Modify: `apps/frontend/src/features/stay/types.ts` (`StayBoard` + `StaySummary` gain `mealForecast`)
- Modify: `apps/frontend/src/features/stay/stayState.ts` (`boardHeadline`, `tonightCards`)
- Test: `apps/frontend/src/features/stay/stayState.test.ts` (append cases)

- [ ] **Step 1: Write the failing test.** Append to `stayState.test.ts`:

```ts
describe('a learned meal forecast replaces the headcount', () => {
  it('uses it in the board headline, and says where it came from', () => {
    const learned = { ...board, mealForecast: { expected: 26, basis: 'learned' as const, samples: 9 } };
    expect(boardHeadline(learned).meals).toBe('≈ 26 for dinner · from the last 2 weeks');
  });

  it('keeps the honest headcount while a hostel is still learning', () => {
    expect(boardHeadline({ ...board, mealForecast: { expected: 3, basis: 'headcount' as const, samples: 1 } }).meals)
      .toBe('≈ 3 for dinner & breakfast · +1 late may turn up');
    expect(boardHeadline(board).meals).toBe('≈ 3 for dinner & breakfast · +1 late may turn up');
  });

  it('does the same on Home', () => {
    const summary = {
      totals: { residents: 6, hereTonight: 3, backToday: 2, late: 0, roomsToCheck: 2, mealsExpected: 3 },
      hostels: [],
      mealForecast: { expected: 26, basis: 'learned' as const },
    };
    expect(tonightCards(summary)?.hereTonight.caption).toBe('≈ 26 meals');
  });
});
```

- [ ] **Step 2: Run it and see it fail.**

- [ ] **Step 3: Implement.** In `types.ts` add to both interfaces:

```ts
  /** Tonight's dinner, learned from served counts (Phase 2a). Null until it is. */
  mealForecast?: { expected: number; basis: 'learned' | 'headcount'; samples?: number } | null;
```

In `stayState.ts`, replace the `meals` line of `boardHeadline`:

```ts
  // A learned number is the better answer and replaces the headcount outright;
  // the late note only belongs on the headcount, which cannot know about them.
  const meals =
    board.mealForecast && board.mealForecast.basis === 'learned'
      ? `≈ ${board.mealForecast.expected} for dinner · from the last 2 weeks`
      : `≈ ${board.meals.expected} for dinner & breakfast${lateNote}`;
```

and return `meals` in place of the old expression. In `tonightCards`, replace the `hereTonight` caption:

```ts
    hereTonight: {
      value: t.hereTonight,
      caption: summary.mealForecast?.basis === 'learned' ? `≈ ${summary.mealForecast.expected} meals` : `≈ ${t.mealsExpected} meals`,
    },
```

- [ ] **Step 4: Run the tests.** `npx vitest run src/features/stay/stayState.test.ts` — all previous cases must still pass.

- [ ] **Step 5: Commit**

```bash
git add src/features/stay
git commit -m "feat(meals): Stay board and Home show the learned dinner count when there is one"
```

---

### Task 9: Documentation

- [ ] **Step 1: Claim the ADR number against `origin/main`**

```bash
git fetch origin && git show origin/main:docs/obsidian/Decisions.md | grep -oE '^#+ ADR-[0-9]+' | sed 's/#* ADR-//' | sort -n | tail -1
```

Use the next free number (194 as of 2026-09-14). Follow the `### ADR-NNN — title (date)` format of the entries at the end of the file.

- [ ] **Step 2: Write ADR-194**, covering:
  - **Context:** a headcount is not a meal count; nothing recorded what was eaten.
  - **Decision:** learn a per-meal ratio from served counts; median of the last 14 logged days, minimum 3; ratios above 1 kept.
  - **Decision:** `headcount_at_log` is frozen at entry, so editing a leave cannot rewrite a past ratio.
  - **Decision:** a measurement table, not an event — re-entry corrects; `stay_events` stays untouched.
  - **Decision:** **Away Today dropped** rather than deferred a third time, and why the learned ratio makes it unnecessary.
  - **Decision:** composition happens in the routes — meals may read Stay, Stay never reads meals.
  - **Decision:** entry lives on the kitchen sheet, and a leave's effective end is the actual return when someone came back early.
  - **Consequences:** honest headcount until 3 samples; one ratio per meal, not per weekday; accuracy still rests on tenants reporting leave, which has never happened in production.
  - **Rejected:** owner-set ratios (go stale), tenant-declared skips (a daily decision for everyone), per-weekday buckets (28 buckets, far too little data).

- [ ] **Step 3: Update the vault** — each page links `[[Decisions#ADR-194|ADR-194]] plus one other note:
  - `Features.md`: a "Meal forecast" section — what the kitchen sheet now shows and asks, and that tenants see nothing new.
  - `APIs.md`: the two endpoints, and the `mealForecast` field added to the two Stay responses.
  - `Database.md`: `meal_service_logs` column by column, the unique index, the frozen denominator, RLS, and **where it is applied**.
  - `Business-Rules.md`: median-of-14/min-3, ratios above 1 kept, zero is data, a resident counted on their return date, an early return shortening a leave, the implausible-count guard.
  - `Food.md`: that the module now has a headcount-derived forecast and a served-count measurement — its §2 "no dated menu" ceiling is unchanged.
  - `Backend.md` / `Frontend.md`: the new `src/services/meals` and `features/owner-food` files.
  - `Changelog.md`: a dated entry under `[Unreleased]`.
- [ ] **Step 4: Commit**

```bash
git add docs
git commit -m "docs(meals): ADR-194 and the vault pages for the learned meal forecast"
```

---

### Task 10: Verify, migrate, ship

- [ ] **Step 1: Every gate, against the Task 0 baseline**

```bash
cd apps/backend && npm run test:pure 2>&1 | grep -E "Test Files|Tests "
npm run check:invariants 2>&1 | tail -1
npx tsc --noEmit 2>&1 | grep -E "src/services/meals|stay-board|app/api/hostels/\[id\]/meals" || echo "clean"
cd ../frontend && npm test 2>&1 | grep -E "Test Files|Tests "
npm run build 2>&1 | tail -2
npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "owner-food|features/stay|queryKeys" || echo "clean"
```

Expected: backend 3 pre-existing failures and no others; frontend all green. Report real numbers.

- [ ] **Step 2: Apply the migration to production — only with the user's explicit go-ahead.** `.env` in this worktree points at production (`qgfyfbdccjnibdhhvnsr`). Confirm the target, then apply with a raw `pg` client over the pooled URL — `prisma db execute` dials `DIRECT_URL`, which is IPv6-only and unreachable from this machine:

```bash
curl -s https://yourstayo.com/api/health | head -c 200   # project_ref must be qgfyfbdccjnibdhhvnsr
cd apps/backend && node -e "
require('dotenv').config({path:'../../.env'});
const fs=require('fs');const {Client}=require('pg');
if(!/qgfyfbdccjnibdhhvnsr/.test(process.env.DATABASE_URL||'')) throw new Error('not production');
const sql=fs.readFileSync('prisma/migrations/20260915090000_meal_service_logs/migration.sql','utf8');
(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:30000});
await c.connect(); await c.query(sql); console.log('APPLIED');
const t=await c.query(\"select count(*)::int cols from information_schema.columns where table_name='meal_service_logs'\");
const i=await c.query(\"select count(*)::int n from pg_indexes where tablename='meal_service_logs'\");
console.log('columns',t.rows[0].cols,'indexes',i.rows[0].n); await c.end();})();
"
```

Expected: 9 columns and 3 indexes (pkey, the unique key, the ratio index). **Write no rows.** Record the date in `Database.md`.

- [ ] **Step 3: Merge to `dev`**

```bash
git fetch origin
git merge origin/main                      # resolve, then re-run Step 1 if anything moved
git log --oneline origin/dev..HEAD | cat   # every commit should be this feature's or main's
git push origin HEAD:dev
```

Never push to `main`.

---

## Self-review (run while writing)

- **Spec coverage:** §4 table → Task 3; §5 model → Tasks 1–2; §6 surfaces → Tasks 7–8; §7 API → Task 5; §8 layout → Tasks 4–6; §9 testing → each task plus Task 10; §10 limits → Task 9's ADR consequences.
- **Placeholders:** none — every step carries its code or its exact command.
- **Type consistency:** `ForecastMealEntry`/`ForecastDay` are named identically in `meal-forecast-service.ts` (Task 4) and `mealForecast.ts` (Task 6); `mealRatio`/`forecastMeal` signatures match their callers; `headcountOn(residents, leaves, date)` has one argument order everywhere; `SLOT_TO_MEAL_TYPE` is the only place the case mismatch is bridged.
- **Known gap, stated rather than hidden:** the DB-backed uniqueness test from spec §9 has **no task** — the test project is gone and Prisma cannot reach a pooler from this machine, so writing a test that cannot run would be theatre. The unique index is enforced by the database and verified by `pg_indexes` in Task 10 Step 2.
