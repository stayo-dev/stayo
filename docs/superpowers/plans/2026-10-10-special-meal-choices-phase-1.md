# Special-meal choices — Phase 1 (Collect) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the warden's door-to-door veg/non-veg round with a WhatsApp question (Veg · Non-veg · I'm away). Tenants on leave or moving out are never asked or counted, the answers become a per-occasion count the owner can correct, and the count locks at a cutoff.

**Architecture:**
- **Data:** two new tables (`special_meal_occasions`, `special_meal_answers`), both without relations to existing models.
- **Logic:** a pure rules module decides presence, the audience and the count. It composes Stay's resident/leave data, the way the ADR-195 forecast does, and adds no presence formula of its own.
- **Service:** one service (DB composition + WhatsApp) behind thin owner routes and two daily crons.
- **Replies:** tenant answers arrive through a new `MEAL_CHOICE` intent at the front of the existing WhatsApp router.

**Tech Stack:** Next.js 14 route handlers, Prisma (`prisma` is typed `any`), raw SQL migration in root `migrations/`, Meta WhatsApp Cloud API templates, vitest (pure + mocked), React 19 + TanStack Query.

**Spec:** `docs/superpowers/specs/2026-10-10-special-meal-choices-design.md`. **Audit:** `docs/audits/special-meal-choices-audit.md`. Read both before starting.

## Global Constraints

- Answers are exactly `VEG | NON_VEG | AWAY | SKIP`. The buttons are **Veg · Non-veg · I'm away**. `SKIP` is only reachable by typing "skip" or by an owner edit.
- "I'm away" is meal-specific. It **never** writes `stay_leaves` or `stay_events`.
- Absence wins. A tenant on a leave covering the serve date is never messaged and never counted, even if they answered.
- Moving out wins. A tenant with `exit_date <= serveDate` is not listed, messaged or counted.
- A resident is a live room allocation: `OCCUPYING_ALLOCATION_WHERE` from `lib/services/room-capacity-service.ts`. A leave covers a date when `startDate <= date && expectedReturnDate > date`. Do not write another occupancy formula.
- The cook's numbers are confirmed answers plus, under the `LAST_CHOICE` policy, the tenant's last explicit veg/non-veg for that occasion. Every person row carries its basis (`CONFIRMED | LAST_CHOICE | NO_ANSWER | ON_LEAVE`). Nothing is ever guessed beyond that.
- **Owner edits are allowed after the cutoff. WhatsApp answers are not.**
- Scheduled sends use fixed daily slots: asks at `30 12 * * *` UTC (18:00 IST) for **tomorrow's** occasions, reminders at `30 2 * * *` UTC (08:00 IST) for **today's**. Each fires anywhere in its hour. The cutoff is checked when a reply arrives.
- `STOP` is untouched. This phase adds no WhatsApp command words. `MEALS` and `ASK ME` are Phase 2.
- One Meta template, `stayo_special_meal_question` (category UTILITY), with three quick replies carrying per-send payloads `MEAL:<occasionId>:<YYYY-MM-DD>:<tenantId>:<CHOICE>`. Name and language are hard-coded, with no env fallback (ADR-196).
- Migration file `migrations/096_special_meals.sql`. Re-check the number against `git ls-tree --name-only origin/main migrations/` before committing. RLS enabled, plus `REVOKE ALL … FROM anon, authenticated`, in the same file.
- New Prisma models only. No field is added to any existing model (2026-08-22 outage rule).
- Owner routes: `getSession` → `session.role === "OWNER"` → `resolveOwnerScope` → `requireHostelBelongsToOwner`. Routes live under `app/api/hostels/[id]/meals/` and services under `src/services/meals/`. Both are already in `architectural-invariants-check.ts`'s scan roots.
- Backend pure tests must be added to `vitest.pure.config.ts`'s explicit `include` list, or they silently never run.
- Frontend tests are `.test.ts` only, node environment, no component rendering.
- Run vitest with Node 24: `export PATH=~/.nvm/versions/node/v24.14.0/bin:$PATH`. System Node 18 fails with `ERR_REQUIRE_ESM`.
- IST is UTC+05:30 with no DST. Use fixed-offset arithmetic, as `lib/timezone.ts` does.

## Review Focus

1. **A tap on last week's message** must answer last week's occasion. Once that cutoff has passed, it gets the "closed" reply and never writes this week's row. The test lives in Task 6.
2. **A phone shared by two residents** (sibling roommates, or a guardian number) must never let one resident's tap write the other's answer. A payload naming a tenant who isn't this phone's *own* resident must be refused. The test lives in Task 6.
3. **A guardian typing "veg"** must not get a permission-denied reply. The meal intent must decline (`handled: false`) and fall through. The test lives in Task 6.
4. **The cron firing late (±59 min) past the cutoff** must send nothing for that occasion, rather than a question that is already closed. The test lives in Task 7.
5. **A tenant who answered and then started a leave** must drop out of the cook numbers and appear under "On leave". The test lives in Task 2.

---

## File map

**Backend (`apps/backend`)**

| File | Responsibility |
|---|---|
| `../../migrations/096_special_meals.sql` | the two tables, constraints, RLS, revokes |
| `prisma/schema.prisma` | + `special_meal_occasions`, `special_meal_answers` (no relations) |
| `src/services/meals/special-meal-rules.ts` | PURE: choices, presence, audience, count, serve date, cutoff |
| `lib/services/notifications/providers/whatsapp/special-meal-template-contract.ts` | PURE: template contract, payload encode/decode, typed-reply parsing, copy |
| `lib/services/notifications/providers/whatsapp/template-components.ts` | PURE: Meta template `components` builder, extracted from `sendTemplate` and extended with quick-reply payloads |
| `lib/services/notifications/providers/whatsapp/meta-provider.ts`, `types.ts`, `../../whatsapp-template-delivery.ts` | pass `quickReplyPayloads` through |
| `src/services/meals/special-meal-service.ts` | occasions, count, owner answers, WhatsApp replies, ask/remind rounds |
| `app/api/hostels/[id]/meals/special/route.ts` | GET list, POST create |
| `app/api/hostels/[id]/meals/special/[occasionId]/route.ts` | PATCH occasion |
| `app/api/hostels/[id]/meals/special/[occasionId]/count/route.ts` | GET count |
| `app/api/hostels/[id]/meals/special/[occasionId]/answers/route.ts` | PUT owner answer |
| `app/api/cron/special-meal-asks/route.ts`, `app/api/cron/special-meal-reminders/route.ts` | daily rounds |
| `vercel.json` | + two crons |
| `lib/services/notifications/routing/intent-resolvers.ts`, `whatsapp-webhook-event-service.ts` | `MEAL_CHOICE` intent + registry entry |
| `tests/special-meal-*.test.ts` | see each task |

**Frontend (`apps/frontend/src`)**

| File | Responsibility |
|---|---|
| `features/food/api/index.ts` | + 5 special-meal calls |
| `lib/queryKeys.ts` | + `meals.special.*` |
| `features/owner-food/specialMeals.ts` (+ `.test.ts`) | PURE: titles, headline, breakdown, lock line, drill-down groups |
| `features/owner-food/hooks/useSpecialMeals.ts` | queries + mutations |
| `features/owner-food/pages/SpecialMealsPage.tsx` | setup + count + per-tenant edit |
| `features/owner-food/components/SpecialMealKitchenLine.tsx` | the kitchen-sheet line |
| `platforms/owner/router/OwnerRoutes.tsx`, `features/owner-food/pages/FoodPage.tsx`, `features/owner-food/pages/KitchenSheetPage.tsx` | route, entry link, line |

---

### Task 1: Tables, Prisma models, schema guard

**Files:**
- Create: `migrations/096_special_meals.sql` (repo root)
- Modify: `apps/backend/prisma/schema.prisma` (append after `model meal_service_logs`)
- Test: `apps/backend/tests/special-meal-schema.test.ts`
- Modify: `apps/backend/vitest.pure.config.ts` (include)

**Interfaces:**
- Produces: Prisma delegates `prisma.special_meal_occasions` and `prisma.special_meal_answers`. The compound unique key for answers is `occasion_id_serve_date_tenant_id`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/special-meal-schema.test.ts
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SCHEMA = readFileSync(join(__dirname, "../prisma/schema.prisma"), "utf8");
const MIGRATION = readFileSync(join(__dirname, "../../../migrations/096_special_meals.sql"), "utf8");

const modelOf = (name: string) => SCHEMA.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? "";

/**
 * Guards the ways these tables can ship broken: a Prisma field the database
 * lacks, a table the public anon key can read (dietary choice is sensitive),
 * and a second answer row for the same tenant, meal and date.
 */
describe("special meal schema", () => {
  it("declares both models with exactly the migration's columns", () => {
    const occasions = modelOf("special_meal_occasions");
    const answers = modelOf("special_meal_answers");
    for (const c of ["hostel_id", "owner_id", "weekday", "meal_type", "veg_dish", "non_veg_dish", "cutoff_minutes_before", "no_answer_policy", "is_active"]) {
      expect(occasions).toContain(` ${c} `);
      expect(MIGRATION).toContain(c);
    }
    for (const c of ["occasion_id", "hostel_id", "tenant_id", "serve_date", "choice", "source", "recorded_by"]) {
      expect(answers).toContain(` ${c} `);
      expect(MIGRATION).toContain(c);
    }
  });

  it("adds no relation fields, so no existing model changes", () => {
    expect(modelOf("special_meal_occasions")).not.toContain("@relation");
    expect(modelOf("special_meal_answers")).not.toContain("@relation");
  });

  it("keeps one answer per occasion, date and tenant", () => {
    expect(MIGRATION).toMatch(/UNIQUE \(occasion_id, serve_date, tenant_id\)/);
    expect(modelOf("special_meal_answers")).toContain("@@unique([occasion_id, serve_date, tenant_id]");
  });

  it("constrains choice and source to the known values", () => {
    expect(MIGRATION).toContain("CHECK (choice IN ('VEG', 'NON_VEG', 'AWAY', 'SKIP'))");
    expect(MIGRATION).toContain("CHECK (source IN ('WHATSAPP', 'OWNER'))");
  });

  it("locks both tables away from the public API", () => {
    for (const t of ["special_meal_occasions", "special_meal_answers"]) {
      expect(MIGRATION).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${t} FROM anon, authenticated`);
    }
  });
});
```

Add `'tests/special-meal-schema.test.ts',` to the `include` array in `vitest.pure.config.ts`, under a comment `// Special-meal choices (Phase 1).`

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd apps/backend && npx vitest run -c vitest.pure.config.ts tests/special-meal-schema.test.ts`
Expected: FAIL with `ENOENT … 096_special_meals.sql`

- [ ] **Step 3: Write the migration and models**

```sql
-- 096_special_meals.sql
--
-- Special-meal choices, Phase 1 (spec: docs/superpowers/specs/2026-10-10-special-meal-choices-design.md).
-- A hostel's recurring special meal (e.g. Sunday lunch, cooked veg and non-veg)
-- and each resident's answer for one dated serving of it.
--
-- NEW TABLES ONLY, with no foreign key *declared in Prisma*: adding a relation
-- field to tenants/hostels would change existing models, which is the
-- deploy-before-migrate hazard of 2026-08-22. The database still enforces the
-- references below.
--
-- Dietary choice can reveal religion or caste, so both tables are closed to the
-- anon/authenticated roles outright; only the backend's service connection reads them.
--
-- Apply via the Supabase SQL editor or psql, per migrations/README.md.

CREATE TABLE IF NOT EXISTS public.special_meal_occasions (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostel_id             uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  owner_id              uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  -- 0 = Sunday … 6 = Saturday, the same as lib/timezone.ts weekdayOfIso().
  weekday               smallint NOT NULL CHECK (weekday BETWEEN 0 AND 6),
  meal_type             text NOT NULL CHECK (meal_type IN ('BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER')),
  -- Optional dish names for the question ("Chicken Biryani or Veg Biryani").
  veg_dish              text CHECK (veg_dish IS NULL OR char_length(veg_dish) <= 60),
  non_veg_dish          text CHECK (non_veg_dish IS NULL OR char_length(non_veg_dish) <= 60),
  -- Answers close this many minutes before the meal's serving window opens.
  cutoff_minutes_before integer NOT NULL DEFAULT 180 CHECK (cutoff_minutes_before BETWEEN 0 AND 1440),
  -- LAST_CHOICE: a silent tenant is cooked for as their last explicit veg/non-veg.
  -- LEAVE_OUT: a silent tenant is not cooked for.
  no_answer_policy      text NOT NULL DEFAULT 'LAST_CHOICE' CHECK (no_answer_policy IN ('LAST_CHOICE', 'LEAVE_OUT')),
  is_active             boolean NOT NULL DEFAULT true,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT special_meal_occasions_hostel_day_meal_key UNIQUE (hostel_id, weekday, meal_type)
);

CREATE INDEX IF NOT EXISTS special_meal_occasions_weekday_active_idx
  ON public.special_meal_occasions (weekday) WHERE is_active;

CREATE TABLE IF NOT EXISTS public.special_meal_answers (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  occasion_id  uuid NOT NULL REFERENCES public.special_meal_occasions(id) ON DELETE CASCADE,
  hostel_id    uuid NOT NULL REFERENCES public.hostels(id) ON DELETE CASCADE,
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- The IST calendar date of the serving.
  serve_date   date NOT NULL,
  choice       text NOT NULL CHECK (choice IN ('VEG', 'NON_VEG', 'AWAY', 'SKIP')),
  source       text NOT NULL CHECK (source IN ('WHATSAPP', 'OWNER')),
  -- The owner profile for an OWNER edit; null for the tenant's own tap.
  recorded_by  uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- The latest answer replaces the earlier one: one truth per tenant per serving.
  CONSTRAINT special_meal_answers_occasion_date_tenant_key UNIQUE (occasion_id, serve_date, tenant_id)
);

CREATE INDEX IF NOT EXISTS special_meal_answers_history_idx
  ON public.special_meal_answers (occasion_id, tenant_id, serve_date DESC);

ALTER TABLE public.special_meal_occasions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.special_meal_answers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.special_meal_occasions FROM anon, authenticated;
REVOKE ALL ON public.special_meal_answers FROM anon, authenticated;
```

Append to `schema.prisma` after `model meal_service_logs { … }`:

```prisma
/// Special-meal choices (Phase 1). A hostel's recurring special meal. No
/// relation fields on purpose — see migrations/096_special_meals.sql.
model special_meal_occasions {
  id                    String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  hostel_id             String   @db.Uuid
  owner_id              String   @db.Uuid
  weekday               Int      @db.SmallInt
  meal_type             String
  veg_dish              String?
  non_veg_dish          String?
  cutoff_minutes_before Int      @default(180)
  no_answer_policy      String   @default("LAST_CHOICE")
  is_active             Boolean  @default(true)
  created_at            DateTime @default(now()) @db.Timestamptz(6)
  updated_at            DateTime @default(now()) @updatedAt @db.Timestamptz(6)

  @@unique([hostel_id, weekday, meal_type], map: "special_meal_occasions_hostel_day_meal_key")
}

/// One resident's answer for one dated serving. Latest answer wins (upsert).
model special_meal_answers {
  id          String   @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  occasion_id String   @db.Uuid
  hostel_id   String   @db.Uuid
  tenant_id   String   @db.Uuid
  serve_date  DateTime @db.Date
  choice      String
  source      String
  recorded_by String?  @db.Uuid
  created_at  DateTime @default(now()) @db.Timestamptz(6)
  updated_at  DateTime @default(now()) @updatedAt @db.Timestamptz(6)

  @@unique([occasion_id, serve_date, tenant_id], map: "special_meal_answers_occasion_date_tenant_key")
  @@index([occasion_id, tenant_id, serve_date(sort: Desc)], map: "special_meal_answers_history_idx")
}
```

- [ ] **Step 4: Run the test and regenerate the client**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-schema.test.ts && npm run prisma:generate`
Expected: 5 passed. The client generates without error.

- [ ] **Step 5: Commit**

```bash
git add ../../migrations/096_special_meals.sql prisma/schema.prisma tests/special-meal-schema.test.ts vitest.pure.config.ts
git commit -m "feat(meals): special-meal tables (migration 096, not applied)"
```

---

### Task 2: Pure rules — presence, audience, count, serve date, cutoff

**Files:**
- Create: `apps/backend/src/services/meals/special-meal-rules.ts`
- Test: `apps/backend/tests/special-meal-rules.test.ts` (add to the pure include list)

**Interfaces:**
- Consumes: `HeadcountLeave` (`{ tenantId; startDate; expectedReturnDate }`) from `@/src/services/stay/stay-board`; `addDaysIso`, `weekdayOfIso` from `@/lib/timezone`.
- Produces (exact names used by Tasks 5–7):
  - `type MealChoice = "VEG" | "NON_VEG" | "AWAY" | "SKIP"`; `MEAL_CHOICES`; `isMealChoice(v)`
  - `type NoAnswerPolicy = "LAST_CHOICE" | "LEAVE_OUT"`; `isNoAnswerPolicy(v)`
  - `type Presence = "MOVED_OUT" | "ON_LEAVE" | "RETURNING" | "HERE"`; `presenceOn({ tenantId, exitDate, leaves, serveDate })`
  - `interface MealResident { tenantId: string; name: string; roomNo: string; exitDate: string | null; phone: string | null }`
  - `askAudience({ serveDate, residents, leaves, answered: Set<string> }): Array<{ tenantId; name; phone; returning: boolean }>`
  - `type PersonBasis = "CONFIRMED" | "LAST_CHOICE" | "NO_ANSWER" | "ON_LEAVE"`
  - `interface CountPerson { tenantId; name; roomNo; choice: MealChoice | null; basis: PersonBasis; source: "WHATSAPP" | "OWNER" | null }`
  - `interface MealCount { cook: { veg: number; nonVeg: number }; confirmed: number; lastChoice: number; noAnswer: number; skipping: number; awaySaid: number; onLeave: number; people: CountPerson[] }`
  - `buildMealCount({ serveDate, policy, residents, leaves, answers: Map<string, { choice: MealChoice; source: "WHATSAPP" | "OWNER" }>, lastChoices: Map<string, "VEG" | "NON_VEG"> }): MealCount`
  - `nextServeDate(weekday: number, today: string): string`
  - `cutoffInstant(serveDate: string, mealStart: string, minutesBefore: number): Date`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/special-meal-rules.test.ts
import { describe, expect, it } from "vitest";
import {
  askAudience,
  buildMealCount,
  cutoffInstant,
  nextServeDate,
  presenceOn,
  type MealResident,
} from "@/src/services/meals/special-meal-rules";

const SUN = "2026-10-11"; // a Sunday
const r = (tenantId: string, extra: Partial<MealResident> = {}): MealResident => ({
  tenantId, name: tenantId.toUpperCase(), roomNo: "101", exitDate: null, phone: "9000000000", ...extra,
});

describe("presenceOn", () => {
  it("is HERE with no leave and no exit", () => {
    expect(presenceOn({ tenantId: "a", exitDate: null, leaves: [], serveDate: SUN })).toBe("HERE");
  });
  it("is ON_LEAVE when a leave covers the date", () => {
    const leaves = [{ tenantId: "a", startDate: "2026-10-10", expectedReturnDate: "2026-10-17" }];
    expect(presenceOn({ tenantId: "a", exitDate: null, leaves, serveDate: SUN })).toBe("ON_LEAVE");
  });
  it("is RETURNING on the return date itself", () => {
    const leaves = [{ tenantId: "a", startDate: "2026-10-05", expectedReturnDate: SUN }];
    expect(presenceOn({ tenantId: "a", exitDate: null, leaves, serveDate: SUN })).toBe("RETURNING");
  });
  it("ignores other tenants' leaves", () => {
    const leaves = [{ tenantId: "b", startDate: "2026-10-10", expectedReturnDate: "2026-10-17" }];
    expect(presenceOn({ tenantId: "a", exitDate: null, leaves, serveDate: SUN })).toBe("HERE");
  });
  it("is MOVED_OUT on or after the exit date", () => {
    expect(presenceOn({ tenantId: "a", exitDate: SUN, leaves: [], serveDate: SUN })).toBe("MOVED_OUT");
    expect(presenceOn({ tenantId: "a", exitDate: "2026-10-12", leaves: [], serveDate: SUN })).toBe("HERE");
  });
});

describe("askAudience", () => {
  it("skips the away, the moved out, the unreachable and the already answered", () => {
    const residents = [r("here"), r("leave"), r("gone", { exitDate: "2026-10-01" }), r("nophone", { phone: null }), r("done"), r("back")];
    const leaves = [
      { tenantId: "leave", startDate: "2026-10-09", expectedReturnDate: "2026-10-20" },
      { tenantId: "back", startDate: "2026-10-01", expectedReturnDate: SUN },
    ];
    const out = askAudience({ serveDate: SUN, residents, leaves, answered: new Set(["done"]) });
    expect(out.map((p) => p.tenantId)).toEqual(["here", "back"]);
    expect(out.find((p) => p.tenantId === "back")?.returning).toBe(true);
  });
});

describe("buildMealCount", () => {
  const base = { serveDate: SUN, leaves: [] as any[], lastChoices: new Map<string, "VEG" | "NON_VEG">() };

  it("cooks only confirmed veg/non-veg under LEAVE_OUT", () => {
    const answers = new Map([
      ["a", { choice: "VEG" as const, source: "WHATSAPP" as const }],
      ["b", { choice: "NON_VEG" as const, source: "WHATSAPP" as const }],
      ["c", { choice: "AWAY" as const, source: "WHATSAPP" as const }],
      ["d", { choice: "SKIP" as const, source: "OWNER" as const }],
    ]);
    const count = buildMealCount({ ...base, policy: "LEAVE_OUT", residents: [r("a"), r("b"), r("c"), r("d"), r("e")], answers });
    expect(count.cook).toEqual({ veg: 1, nonVeg: 1 });
    expect(count).toMatchObject({ confirmed: 4, lastChoice: 0, noAnswer: 1, awaySaid: 1, skipping: 1, onLeave: 0 });
  });

  it("cooks a silent tenant as their last choice under LAST_CHOICE, labelled as such", () => {
    const count = buildMealCount({
      ...base, policy: "LAST_CHOICE", residents: [r("a"), r("b")], answers: new Map(),
      lastChoices: new Map([["a", "NON_VEG"]]),
    });
    expect(count.cook).toEqual({ veg: 0, nonVeg: 1 });
    expect(count.people.find((p) => p.tenantId === "a")).toMatchObject({ choice: "NON_VEG", basis: "LAST_CHOICE" });
    expect(count.people.find((p) => p.tenantId === "b")).toMatchObject({ choice: null, basis: "NO_ANSWER" });
  });

  it("lets absence win over an answer given before the leave started", () => {
    const count = buildMealCount({
      ...base, policy: "LAST_CHOICE", residents: [r("a")],
      leaves: [{ tenantId: "a", startDate: "2026-10-10", expectedReturnDate: "2026-10-15" }],
      answers: new Map([["a", { choice: "NON_VEG" as const, source: "WHATSAPP" as const }]]),
    });
    expect(count.cook).toEqual({ veg: 0, nonVeg: 0 });
    expect(count.onLeave).toBe(1);
    expect(count.people[0]).toMatchObject({ basis: "ON_LEAVE", choice: null });
  });

  it("drops moved-out residents entirely", () => {
    const count = buildMealCount({ ...base, policy: "LAST_CHOICE", residents: [r("a", { exitDate: "2026-10-01" })], answers: new Map() });
    expect(count.people).toEqual([]);
  });

  it("sorts people by room, then name", () => {
    const count = buildMealCount({
      ...base, policy: "LEAVE_OUT", answers: new Map(),
      residents: [r("z", { roomNo: "102" }), r("b", { roomNo: "101" }), r("a", { roomNo: "101" })],
    });
    expect(count.people.map((p) => p.tenantId)).toEqual(["a", "b", "z"]);
  });
});

describe("nextServeDate", () => {
  it("is today when today is the weekday", () => {
    expect(nextServeDate(0, SUN)).toBe(SUN);
  });
  it("is the coming weekday otherwise", () => {
    expect(nextServeDate(3, SUN)).toBe("2026-10-14"); // Wednesday
    expect(nextServeDate(0, "2026-10-12")).toBe("2026-10-18");
  });
});

describe("cutoffInstant", () => {
  it("is the IST meal start minus the cutoff, as a UTC instant", () => {
    // 12:30 IST = 07:00 UTC; minus 180 min = 04:00 UTC.
    expect(cutoffInstant(SUN, "12:30", 180).toISOString()).toBe("2026-10-11T04:00:00.000Z");
  });
  it("can fall on the previous UTC day", () => {
    expect(cutoffInstant(SUN, "07:00", 180).toISOString()).toBe("2026-10-10T22:30:00.000Z");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-rules.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/backend/src/services/meals/special-meal-rules.ts
import { addDaysIso, weekdayOfIso } from "@/lib/timezone";
import type { HeadcountLeave } from "@/src/services/stay/stay-board";

/**
 * Special-meal choices — the rules, with no I/O (spec 2026-10-10).
 *
 * Two facts decide everything, in this order: is the resident here for this
 * serving (Stay's leaves and the move-out date), and what did they say. A
 * preference never overrides absence, and nothing is guessed — a silent
 * resident is cooked for only under LAST_CHOICE, and is labelled so.
 */

export type MealChoice = "VEG" | "NON_VEG" | "AWAY" | "SKIP";
export const MEAL_CHOICES: readonly MealChoice[] = ["VEG", "NON_VEG", "AWAY", "SKIP"];
export const isMealChoice = (v: unknown): v is MealChoice => MEAL_CHOICES.includes(v as MealChoice);

export type NoAnswerPolicy = "LAST_CHOICE" | "LEAVE_OUT";
export const isNoAnswerPolicy = (v: unknown): v is NoAnswerPolicy => v === "LAST_CHOICE" || v === "LEAVE_OUT";

export type Presence = "MOVED_OUT" | "ON_LEAVE" | "RETURNING" | "HERE";

export interface MealResident {
  tenantId: string;
  name: string;
  roomNo: string;
  /** `tenants.exit_date` as YYYY-MM-DD: the move-out day. Gone on and after it. */
  exitDate: string | null;
  phone: string | null;
}

/**
 * Where a resident is for one serving. Same leave convention as `headcountOn`:
 * covered while `start <= date < return`, and back (RETURNING) on the return date.
 */
export function presenceOn(input: {
  tenantId: string;
  exitDate: string | null;
  leaves: HeadcountLeave[];
  serveDate: string;
}): Presence {
  const { tenantId, exitDate, leaves, serveDate } = input;
  if (exitDate && exitDate <= serveDate) return "MOVED_OUT";
  const own = leaves.filter((l) => l.tenantId === tenantId);
  if (own.some((l) => l.startDate <= serveDate && l.expectedReturnDate > serveDate)) return "ON_LEAVE";
  if (own.some((l) => l.startDate < serveDate && l.expectedReturnDate === serveDate)) return "RETURNING";
  return "HERE";
}

/** Who gets the question (or the reminder): here or returning, reachable, not yet answered. */
export function askAudience(input: {
  serveDate: string;
  residents: MealResident[];
  leaves: HeadcountLeave[];
  answered: Set<string>;
}): Array<{ tenantId: string; name: string; phone: string; returning: boolean }> {
  const out: Array<{ tenantId: string; name: string; phone: string; returning: boolean }> = [];
  for (const r of input.residents) {
    if (input.answered.has(r.tenantId)) continue;
    const phone = (r.phone || "").trim();
    if (!phone) continue;
    const presence = presenceOn({ tenantId: r.tenantId, exitDate: r.exitDate, leaves: input.leaves, serveDate: input.serveDate });
    if (presence === "MOVED_OUT" || presence === "ON_LEAVE") continue;
    out.push({ tenantId: r.tenantId, name: r.name, phone, returning: presence === "RETURNING" });
  }
  return out;
}

export type PersonBasis = "CONFIRMED" | "LAST_CHOICE" | "NO_ANSWER" | "ON_LEAVE";

export interface CountPerson {
  tenantId: string;
  name: string;
  roomNo: string;
  choice: MealChoice | null;
  basis: PersonBasis;
  source: "WHATSAPP" | "OWNER" | null;
}

export interface MealCount {
  cook: { veg: number; nonVeg: number };
  confirmed: number;
  lastChoice: number;
  noAnswer: number;
  skipping: number;
  awaySaid: number;
  onLeave: number;
  people: CountPerson[];
}

export function buildMealCount(input: {
  serveDate: string;
  policy: NoAnswerPolicy;
  residents: MealResident[];
  leaves: HeadcountLeave[];
  answers: Map<string, { choice: MealChoice; source: "WHATSAPP" | "OWNER" }>;
  lastChoices: Map<string, "VEG" | "NON_VEG">;
}): MealCount {
  const count: MealCount = {
    cook: { veg: 0, nonVeg: 0 },
    confirmed: 0, lastChoice: 0, noAnswer: 0, skipping: 0, awaySaid: 0, onLeave: 0,
    people: [],
  };
  const add = (choice: MealChoice | null) => {
    if (choice === "VEG") count.cook.veg += 1;
    if (choice === "NON_VEG") count.cook.nonVeg += 1;
  };

  for (const r of input.residents) {
    const presence = presenceOn({ tenantId: r.tenantId, exitDate: r.exitDate, leaves: input.leaves, serveDate: input.serveDate });
    if (presence === "MOVED_OUT") continue;
    const person = { tenantId: r.tenantId, name: r.name, roomNo: r.roomNo };

    if (presence === "ON_LEAVE") {
      count.onLeave += 1;
      count.people.push({ ...person, choice: null, basis: "ON_LEAVE", source: null });
      continue;
    }

    const answer = input.answers.get(r.tenantId);
    if (answer) {
      count.confirmed += 1;
      if (answer.choice === "AWAY") count.awaySaid += 1;
      if (answer.choice === "SKIP") count.skipping += 1;
      add(answer.choice);
      count.people.push({ ...person, choice: answer.choice, basis: "CONFIRMED", source: answer.source });
      continue;
    }

    const last = input.policy === "LAST_CHOICE" ? input.lastChoices.get(r.tenantId) : undefined;
    if (last) {
      count.lastChoice += 1;
      add(last);
      count.people.push({ ...person, choice: last, basis: "LAST_CHOICE", source: null });
      continue;
    }

    count.noAnswer += 1;
    count.people.push({ ...person, choice: null, basis: "NO_ANSWER", source: null });
  }

  count.people.sort((a, b) => a.roomNo.localeCompare(b.roomNo, "en", { numeric: true }) || a.name.localeCompare(b.name));
  return count;
}

/** The next date (today included) that falls on `weekday` (0 = Sunday). */
export function nextServeDate(weekday: number, today: string): string {
  const delta = (weekday - weekdayOfIso(today) + 7) % 7;
  return addDaysIso(today, delta);
}

const IST_OFFSET_MINUTES = 330;

/** When answers close: the meal's IST start time minus `minutesBefore`, as an instant. */
export function cutoffInstant(serveDate: string, mealStart: string, minutesBefore: number): Date {
  const [y, m, d] = serveDate.split("-").map(Number);
  const [hh, mm] = mealStart.split(":").map(Number);
  const utcMs = Date.UTC(y, m - 1, d, hh, mm) - IST_OFFSET_MINUTES * 60_000 - minutesBefore * 60_000;
  return new Date(utcMs);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-rules.test.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/meals/special-meal-rules.ts tests/special-meal-rules.test.ts vitest.pure.config.ts
git commit -m "feat(meals): special-meal rules — presence, audience, count, cutoff"
```

---

### Task 3: Template contract, payloads, typed replies, copy

**Files:**
- Create: `apps/backend/lib/services/notifications/providers/whatsapp/special-meal-template-contract.ts`
- Test: `apps/backend/tests/special-meal-template.test.ts` (pure include list)

**Interfaces:**
- Consumes: `MealChoice` from Task 2. (Do **not** reuse `tenantDisplayName` from the guardian contract: it returns "your ward" for an empty name, which is guardian copy.)
- Produces:
  - `SPECIAL_MEAL_QUESTION_TEMPLATE: { name: "stayo_special_meal_question"; language: "en"; parameters: readonly string[]; quickReplies: readonly { text: string; choice: MealChoice }[]; body: string }`
  - `encodeMealPayload({ occasionId, serveDate, tenantId, choice }): string`
  - `decodeMealPayload(raw: string): { occasionId: string; serveDate: string; tenantId: string; choice: MealChoice } | null`
  - `parseTypedChoice(body: string): MealChoice | null`
  - `occasionLabel(serveDate: string, mealType: string): string`, e.g. `"Sunday lunch, 11 Oct"`
  - `formatCutoff(instant: Date): string`, e.g. `"9:30 AM"`
  - `dishLine(vegDish: string | null, nonVegDish: string | null): string`
  - `buildQuestionParameters({ tenantName, serveDate, mealType, vegDish, nonVegDish, cutoffAt }): string[]`
  - `answeredReply({ choice, serveDate, mealType, cutoffAt }): string` and `closedReply({ serveDate, mealType, cutoffAt }): string`

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/special-meal-template.test.ts
import { describe, expect, it } from "vitest";
import {
  SPECIAL_MEAL_QUESTION_TEMPLATE as T,
  answeredReply,
  buildQuestionParameters,
  closedReply,
  decodeMealPayload,
  dishLine,
  encodeMealPayload,
  formatCutoff,
  occasionLabel,
  parseTypedChoice,
} from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";

const OCC = "11111111-1111-4111-8111-111111111111";
const TEN = "22222222-2222-4222-8222-222222222222";

describe("template contract", () => {
  it("numbers every parameter in the body, in order", () => {
    T.parameters.forEach((_, i) => expect(T.body).toContain(`{{${i + 1}}}`));
    expect(T.body).not.toContain(`{{${T.parameters.length + 1}}}`);
  });
  it("neither starts nor ends the body with a variable (Meta rejects that)", () => {
    expect(T.body.trim().startsWith("{{")).toBe(false);
    expect(T.body.trim().endsWith("}}")).toBe(false);
  });
  it("offers Veg, Non-veg, I'm away in that order", () => {
    expect(T.quickReplies.map((q) => q.choice)).toEqual(["VEG", "NON_VEG", "AWAY"]);
  });
});

describe("payloads", () => {
  it("round-trips and stays under Meta's 128-character limit", () => {
    const raw = encodeMealPayload({ occasionId: OCC, serveDate: "2026-10-11", tenantId: TEN, choice: "NON_VEG" });
    expect(raw.length).toBeLessThanOrEqual(128);
    expect(decodeMealPayload(raw)).toEqual({ occasionId: OCC, serveDate: "2026-10-11", tenantId: TEN, choice: "NON_VEG" });
  });
  it("rejects anything malformed", () => {
    for (const bad of ["", "veg", "CC:RENT", `MEAL:${OCC}:2026-10-11:${TEN}:FISH`, `MEAL:nope:2026-10-11:${TEN}:VEG`, `MEAL:${OCC}:11-10-2026:${TEN}:VEG`]) {
      expect(decodeMealPayload(bad)).toBeNull();
    }
  });
});

describe("parseTypedChoice", () => {
  it.each([
    ["veg", "VEG"], ["Veg 🙂", "VEG"], ["VEG.", "VEG"],
    ["non veg", "NON_VEG"], ["Non-veg", "NON_VEG"], ["nonveg", "NON_VEG"], ["nv", "NON_VEG"],
    ["skip", "SKIP"], ["away", "AWAY"], ["I'm away", "AWAY"], ["i am away", "AWAY"], ["im away", "AWAY"],
  ])("%s → %s", (input, expected) => expect(parseTypedChoice(input)).toBe(expected));
  it.each(["rent", "veg biryani was great", "hello", "", "123456"])("ignores %s", (input) => {
    expect(parseTypedChoice(input)).toBeNull();
  });
});

describe("copy", () => {
  const cutoffAt = new Date("2026-10-11T04:00:00.000Z"); // 9:30 AM IST
  it("labels the occasion with its own date", () => {
    expect(occasionLabel("2026-10-11", "LUNCH")).toBe("Sunday lunch, 11 Oct");
  });
  it("formats the cutoff in IST", () => {
    expect(formatCutoff(cutoffAt)).toBe("9:30 AM");
  });
  it("names dishes when the owner gave them, and falls back otherwise", () => {
    expect(dishLine("Veg Biryani", "Chicken Biryani")).toBe("Chicken Biryani or Veg Biryani");
    expect(dishLine(null, null)).toBe("veg or non-veg");
  });
  it("builds the four parameters, never empty", () => {
    expect(buildQuestionParameters({ tenantName: "", serveDate: "2026-10-11", mealType: "LUNCH", vegDish: null, nonVegDish: null, cutoffAt }))
      .toEqual(["there", "Sunday lunch, 11 Oct", "veg or non-veg", "9:30 AM"]);
  });
  it("confirms each answer and states the change window", () => {
    expect(answeredReply({ choice: "NON_VEG", serveDate: "2026-10-11", mealType: "LUNCH", cutoffAt })).toContain("Non-veg");
    expect(answeredReply({ choice: "NON_VEG", serveDate: "2026-10-11", mealType: "LUNCH", cutoffAt })).toContain("9:30 AM");
    expect(answeredReply({ choice: "AWAY", serveDate: "2026-10-11", mealType: "LUNCH", cutoffAt })).toContain("won't cook for you");
    expect(closedReply({ serveDate: "2026-10-11", mealType: "LUNCH", cutoffAt })).toContain("warden");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-template.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
// apps/backend/lib/services/notifications/providers/whatsapp/special-meal-template-contract.ts
import type { MealChoice } from "@/src/services/meals/special-meal-rules";

/**
 * The special-meal question (spec 2026-10-10). One template, also used as the
 * reminder. Self-dating, because the daily crons fire anywhere in their hour.
 *
 * The three quick replies carry a PER-SEND payload naming the occasion, the
 * serving date and the resident, so a tap on last week's message answers last
 * week (and is refused as closed) and a shared phone cannot answer for the
 * wrong person. Unlike the guardian [Help] button, these payloads are ids, not
 * keywords: they are routed by the MEAL_CHOICE intent before the text vocabulary.
 *
 * Name and language are hard-coded, with no env fallback (ADR-196).
 *
 * PURE MODULE. Imports nothing with I/O.
 */
export const SPECIAL_MEAL_QUESTION_TEMPLATE = {
  name: "stayo_special_meal_question",
  language: "en",
  parameters: ["tenant_first_name", "occasion_label", "dishes", "cutoff_time"] as const,
  quickReplies: [
    { text: "Veg", choice: "VEG" },
    { text: "Non-veg", choice: "NON_VEG" },
    { text: "I'm away", choice: "AWAY" },
  ] as const satisfies readonly { text: string; choice: MealChoice }[],
  body:
    "Hi {{1}}! {{2}} is a special meal: {{3}}.\n" +
    "What would you like? Please answer by {{4}}.\n\n" +
    "If you won't be at the hostel for this meal, tap I'm away and we won't cook for you.",
};

const PREFIX = "MEAL";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CHOICES: readonly MealChoice[] = ["VEG", "NON_VEG", "AWAY", "SKIP"];

export function encodeMealPayload(p: { occasionId: string; serveDate: string; tenantId: string; choice: MealChoice }): string {
  return [PREFIX, p.occasionId, p.serveDate, p.tenantId, p.choice].join(":");
}

export function decodeMealPayload(raw: string) {
  const parts = String(raw || "").trim().split(":");
  if (parts.length !== 5 || parts[0] !== PREFIX) return null;
  const [, occasionId, serveDate, tenantId, choice] = parts;
  if (!UUID.test(occasionId) || !UUID.test(tenantId) || !ISO_DATE.test(serveDate)) return null;
  if (!CHOICES.includes(choice as MealChoice)) return null;
  return { occasionId, serveDate, tenantId, choice: choice as MealChoice };
}

const TYPED: Record<string, MealChoice> = {
  veg: "VEG",
  "non veg": "NON_VEG", nonveg: "NON_VEG", nv: "NON_VEG",
  skip: "SKIP",
  away: "AWAY", "im away": "AWAY", "i am away": "AWAY",
};

/** A typed answer, only when the whole message is the answer ("veg biryani was great" is not). */
export function parseTypedChoice(body: string): MealChoice | null {
  const key = String(body || "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return TYPED[key] ?? null;
}

function plainSpaces(value: string): string {
  return value.replace(/[  ]/g, " ");
}

const MEAL_WORD: Record<string, string> = { BREAKFAST: "breakfast", LUNCH: "lunch", SNACKS: "snacks", DINNER: "dinner" };

/** "Sunday lunch, 11 Oct". The serve date is already an IST calendar date, so format it in UTC. */
export function occasionLabel(serveDate: string, mealType: string): string {
  const date = new Date(`${serveDate}T00:00:00.000Z`);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" }).format(date);
  const day = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", day: "numeric" }).format(date);
  const month = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short" }).format(date);
  return plainSpaces(`${weekday} ${MEAL_WORD[mealType] ?? "meal"}, ${day} ${month}`);
}

/** "9:30 AM", in IST. */
export function formatCutoff(instant: Date): string {
  return plainSpaces(
    new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", minute: "2-digit", hour12: true }).format(instant),
  );
}

export function dishLine(vegDish: string | null, nonVegDish: string | null): string {
  const veg = (vegDish || "").trim();
  const nonVeg = (nonVegDish || "").trim();
  if (veg && nonVeg) return `${nonVeg} or ${veg}`;
  return "veg or non-veg";
}

export function buildQuestionParameters(input: {
  tenantName: string | null | undefined;
  serveDate: string;
  mealType: string;
  vegDish: string | null;
  nonVegDish: string | null;
  cutoffAt: Date;
}): string[] {
  const first = String(input.tenantName || "").trim().split(/\s+/)[0];
  return [
    first || "there",
    occasionLabel(input.serveDate, input.mealType),
    dishLine(input.vegDish, input.nonVegDish),
    formatCutoff(input.cutoffAt),
  ];
}

const CHOICE_WORD: Record<MealChoice, string> = { VEG: "Veg", NON_VEG: "Non-veg", AWAY: "away", SKIP: "skipping" };

/** Sent inside the 24-hour window after a tap or typed answer. */
export function answeredReply(input: { choice: MealChoice; serveDate: string; mealType: string; cutoffAt: Date }): string {
  const label = occasionLabel(input.serveDate, input.mealType);
  const until = `You can change it until ${formatCutoff(input.cutoffAt)}.`;
  if (input.choice === "AWAY") return `✓ Noted, you're away for ${label}. We won't cook for you. ${until}`;
  if (input.choice === "SKIP") return `✓ Noted, you're skipping ${label}. ${until}`;
  return `✓ Got it: ${CHOICE_WORD[input.choice]} for ${label}. ${until}`;
}

export function closedReply(input: { serveDate: string; mealType: string; cutoffAt: Date }): string {
  return `Answers for ${occasionLabel(input.serveDate, input.mealType)} closed at ${formatCutoff(input.cutoffAt)}. Please tell the warden.`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-template.test.ts`
Expected: all pass. If `formatCutoff` yields `9:30 AM` with a narrow no-break space on this ICU, `plainSpaces` covers it. Never loosen the assertion.

- [ ] **Step 5: Commit**

```bash
git add lib/services/notifications/providers/whatsapp/special-meal-template-contract.ts tests/special-meal-template.test.ts vitest.pure.config.ts
git commit -m "feat(meals): special-meal WhatsApp template contract, payloads and copy"
```

---

### Task 4: Quick-reply payloads in template sends

**Files:**
- Create: `apps/backend/lib/services/notifications/providers/whatsapp/template-components.ts`
- Modify: `lib/services/notifications/providers/whatsapp/meta-provider.ts` (`sendTemplate`, ~lines 304–342), `providers/whatsapp/types.ts` (`WhatsAppTemplateMessage`), `lib/services/notifications/whatsapp-template-delivery.ts` (input type + the `sendTemplate` call)
- Test: `apps/backend/tests/whatsapp-template-components.test.ts` (pure include list)

**Interfaces:**
- Produces: `buildTemplateComponents(message: Pick<WhatsAppTemplateMessage, "headerDocument" | "bodyParameters" | "buttonParameters" | "quickReplyPayloads">): any[]`; new optional field `quickReplyPayloads?: string[]` on both `WhatsAppTemplateMessage` and `WhatsAppTemplateDeliveryInput`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/whatsapp-template-components.test.ts
import { describe, expect, it } from "vitest";
import { buildTemplateComponents } from "@/lib/services/notifications/providers/whatsapp/template-components";

describe("buildTemplateComponents", () => {
  it("keeps the existing body + URL-button shape byte for byte", () => {
    expect(buildTemplateComponents({ bodyParameters: ["a", "b"], buttonParameters: ["tok"] })).toEqual([
      { type: "body", parameters: [{ type: "text", text: "a" }, { type: "text", text: "b" }] },
      { type: "button", sub_type: "url", index: 0, parameters: [{ type: "text", text: "tok" }] },
    ]);
  });

  it("adds one quick_reply component per payload, indexed in button order", () => {
    expect(buildTemplateComponents({ quickReplyPayloads: ["P0", "P1"] })).toEqual([
      { type: "button", sub_type: "quick_reply", index: 0, parameters: [{ type: "payload", payload: "P0" }] },
      { type: "button", sub_type: "quick_reply", index: 1, parameters: [{ type: "payload", payload: "P1" }] },
    ]);
  });

  it("emits nothing for an empty message", () => {
    expect(buildTemplateComponents({})).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run -c vitest.pure.config.ts tests/whatsapp-template-components.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement and wire through**

```ts
// apps/backend/lib/services/notifications/providers/whatsapp/template-components.ts
import type { WhatsAppTemplateMessage } from "./types";

/**
 * Meta's template `components` array, extracted from `sendTemplate` so it can
 * be tested without a network. Quick-reply payloads (special-meal choices) sit
 * alongside the long-standing URL-button suffixes. A template has one or the
 * other, never both, so their indexes never collide.
 *
 * PURE MODULE.
 */
export function buildTemplateComponents(
  message: Pick<WhatsAppTemplateMessage, "headerDocument" | "bodyParameters" | "buttonParameters" | "quickReplyPayloads">,
): any[] {
  const components: any[] = [];
  if (message.headerDocument) {
    const docObj: Record<string, string> = {};
    if (message.headerDocument.mediaId) docObj.id = message.headerDocument.mediaId;
    else if (message.headerDocument.link) docObj.link = message.headerDocument.link;
    if (message.headerDocument.filename) docObj.filename = message.headerDocument.filename;
    components.push({ type: "header", parameters: [{ type: "document", document: docObj }] });
  }
  if (message.bodyParameters?.length) {
    components.push({ type: "body", parameters: message.bodyParameters.map((text) => ({ type: "text", text: String(text) })) });
  }
  message.buttonParameters?.forEach((suffix, index) => {
    components.push({ type: "button", sub_type: "url", index, parameters: [{ type: "text", text: String(suffix) }] });
  });
  message.quickReplyPayloads?.forEach((payload, index) => {
    components.push({ type: "button", sub_type: "quick_reply", index, parameters: [{ type: "payload", payload: String(payload) }] });
  });
  return components;
}
```

In `types.ts`, add to `WhatsAppTemplateMessage`:

```ts
  /** Per-send quick-reply payloads, in button order (special-meal choices). */
  quickReplyPayloads?: string[];
```

In `meta-provider.ts` `sendTemplate`, replace everything from `const components: any[] = [];` through the `buttonParameters` `forEach` block with:

```ts
    const components = buildTemplateComponents(message);
```

and add `import { buildTemplateComponents } from "./template-components";` at the top.

In `whatsapp-template-delivery.ts`, add to `WhatsAppTemplateDeliveryInput`:

```ts
  /** Per-send quick-reply payloads, in button order. Passed straight to the provider. */
  quickReplyPayloads?: string[];
```

and in `send()`'s `this.provider.sendTemplate({ … })` call add `quickReplyPayloads: input.quickReplyPayloads,`.

- [ ] **Step 4: Run it, plus the existing provider tests**

Run: `npx vitest run -c vitest.pure.config.ts tests/whatsapp-template-components.test.ts && npm run test:pure`
Expected: the new file passes, and `test:pure` has no new failures compared with `git stash` on the same command.

- [ ] **Step 5: Commit**

```bash
git add lib/services/notifications/providers/whatsapp/template-components.ts lib/services/notifications/providers/whatsapp/types.ts lib/services/notifications/providers/whatsapp/meta-provider.ts lib/services/notifications/whatsapp-template-delivery.ts tests/whatsapp-template-components.test.ts vitest.pure.config.ts
git commit -m "feat(whatsapp): per-send quick-reply payloads on template sends"
```

---

### Task 5: Service — occasions, count, owner answers + owner routes

**Files:**
- Create: `apps/backend/src/services/meals/special-meal-service.ts`
- Create: the four route files listed in the file map
- Test: `apps/backend/tests/special-meal-service.test.ts` (pure include list; it mocks `@/lib/db`)

**Interfaces:**
- Consumes: Task 2 (`buildMealCount`, `askAudience`, `nextServeDate`, `cutoffInstant`, `isMealChoice`, `isNoAnswerPolicy`, `MealResident`); Task 3 (`buildQuestionParameters`, `encodeMealPayload`, `SPECIAL_MEAL_QUESTION_TEMPLATE`); `invalidRequest`, `MealError`, `mealErrorResponse` from `src/services/meals/meal-errors.ts`; `normalizeMealTimings` from `lib/services/food/meal-timings.ts`; `toDbDate`, `fromDbDate` from `src/services/stay/stay-rows.ts`; `istDateOf`, `addDaysIso`, `weekdayOfIso` from `lib/timezone.ts`; `OCCUPYING_ALLOCATION_WHERE`.
- Produces: `createSpecialMealService(deps?: { db?: any; sendTemplate?: (input: WhatsAppTemplateDeliveryInput) => Promise<{ sent: boolean; skipped: boolean }>; sendText?: (phone: string, text: string) => Promise<unknown> })` returning `{ listOccasions, createOccasion, updateOccasion, getCount, setOwnerAnswer, handleWhatsAppReply, runRound }`, and the singleton `specialMealService`.
  - `OccasionView = { id; weekday; mealType; vegDish; nonVegDish; cutoffMinutesBefore; noAnswerPolicy; isActive; nextServeDate }`
  - `getCount(hostelId, occasionId, date?: string, now?: Date) → { occasion: OccasionView; serveDate; cutoffAt: string; isOpen: boolean; count: MealCount }`
  - `setOwnerAnswer({ hostelId, occasionId, tenantId, serveDate, choice: MealChoice | null, recordedBy })`, where `null` clears the answer
  - Tasks 6 and 7 add `handleWhatsAppReply` and `runRound`. Write them in those tasks, in this same file.

This step expands `meal-errors.ts`'s `MealErrorCode` to include `"CONFLICT"`, and adds `export const notFound = (m: string) => new MealError("NOT_FOUND", m, 404);` and `export const conflict = (m: string) => new MealError("CONFLICT", m, 409);`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/special-meal-service.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  special_meal_occasions: { findMany: vi.fn(), findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  special_meal_answers: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
  roomAllocation: { findMany: vi.fn() },
  stay_leaves: { findMany: vi.fn() },
  hostels: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { createSpecialMealService } from "@/src/services/meals/special-meal-service";

const HOSTEL = "h1";
const OCC = { id: "o1", hostel_id: HOSTEL, owner_id: "own", weekday: 0, meal_type: "LUNCH", veg_dish: null, non_veg_dish: null, cutoff_minutes_before: 180, no_answer_policy: "LAST_CHOICE", is_active: true };
const NOW = new Date("2026-10-10T12:00:00.000Z"); // Saturday 17:30 IST
const alloc = (tenantId: string, room = "101") => ({
  tenant_id: tenantId, room: { room_no: room },
  tenant: { display_name: null, exit_date: null, phone_1: "9000000000", profiles: { name: tenantId.toUpperCase(), phone: null } },
});

beforeEach(() => {
  vi.resetAllMocks();
  db.hostels.findUnique.mockResolvedValue({ name: "Sri", preferences_config: null }); // default LUNCH 12:30
  db.stay_leaves.findMany.mockResolvedValue([]);
});

describe("getCount", () => {
  it("defaults to the next serving, composes residents, leaves and answers", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.roomAllocation.findMany.mockResolvedValue([alloc("a"), alloc("b"), alloc("c")]);
    db.special_meal_answers.findMany
      .mockResolvedValueOnce([{ tenant_id: "a", choice: "VEG", source: "WHATSAPP" }]) // this serving
      .mockResolvedValueOnce([{ tenant_id: "b", choice: "NON_VEG" }]); // history
    const svc = createSpecialMealService();
    const out = await svc.getCount(HOSTEL, "o1", undefined, NOW);
    expect(out.serveDate).toBe("2026-10-11");
    expect(out.isOpen).toBe(true);
    expect(out.cutoffAt).toBe("2026-10-11T04:00:00.000Z");
    expect(out.count.cook).toEqual({ veg: 1, nonVeg: 1 });
    expect(out.count.noAnswer).toBe(1);
  });

  it("refuses an occasion from another hostel", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(null);
    await expect(createSpecialMealService().getCount(HOSTEL, "o1", undefined, NOW)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("refuses a date that is not the occasion's weekday", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    await expect(createSpecialMealService().getCount(HOSTEL, "o1", "2026-10-12", NOW)).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });
});

describe("createOccasion", () => {
  it("validates weekday, meal and cutoff", async () => {
    const svc = createSpecialMealService();
    await expect(svc.createOccasion(HOSTEL, "own", { weekday: 7, mealType: "LUNCH" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(svc.createOccasion(HOSTEL, "own", { weekday: 0, mealType: "BRUNCH" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(svc.createOccasion(HOSTEL, "own", { weekday: 0, mealType: "LUNCH", cutoffMinutesBefore: -5 })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
  });

  it("turns the unique violation into a 409", async () => {
    db.special_meal_occasions.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    await expect(createSpecialMealService().createOccasion(HOSTEL, "own", { weekday: 0, mealType: "LUNCH" }, NOW))
      .rejects.toMatchObject({ code: "CONFLICT" });
  });
});

describe("setOwnerAnswer", () => {
  it("upserts an OWNER answer even after the cutoff", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.roomAllocation.findMany.mockResolvedValue([alloc("a")]);
    const late = new Date("2026-10-11T06:00:00.000Z");
    await createSpecialMealService().setOwnerAnswer({ hostelId: HOSTEL, occasionId: "o1", tenantId: "a", serveDate: "2026-10-11", choice: "SKIP", recordedBy: "own" }, late);
    expect(db.special_meal_answers.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { occasion_id_serve_date_tenant_id: { occasion_id: "o1", serve_date: new Date("2026-10-11T00:00:00.000Z"), tenant_id: "a" } },
      create: expect.objectContaining({ choice: "SKIP", source: "OWNER", recorded_by: "own" }),
    }));
  });

  it("clears with null", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.roomAllocation.findMany.mockResolvedValue([alloc("a")]);
    await createSpecialMealService().setOwnerAnswer({ hostelId: HOSTEL, occasionId: "o1", tenantId: "a", serveDate: "2026-10-11", choice: null, recordedBy: "own" }, NOW);
    expect(db.special_meal_answers.deleteMany).toHaveBeenCalled();
  });

  it("refuses a tenant who does not live in this hostel", async () => {
    db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
    db.roomAllocation.findMany.mockResolvedValue([alloc("a")]);
    await expect(createSpecialMealService().setOwnerAnswer({ hostelId: HOSTEL, occasionId: "o1", tenantId: "zz", serveDate: "2026-10-11", choice: "VEG", recordedBy: "own" }, NOW))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
```

Check that `toDbDate("2026-10-11")` returns `new Date("2026-10-11T00:00:00.000Z")` (`src/services/stay/stay-rows.ts:4`). If it differs, assert with `toDbDate(...)` in the test instead.

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-service.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the service (this task's functions)**

```ts
// apps/backend/src/services/meals/special-meal-service.ts
import { prisma } from "@/lib/db";
import { getLogger } from "@/lib/logger";
import { addDaysIso, istDateOf, weekdayOfIso } from "@/lib/timezone";
import { OCCUPYING_ALLOCATION_WHERE } from "@/lib/services/room-capacity-service";
import { normalizeMealTimings } from "@/lib/services/food/meal-timings";
import { whatsAppTemplateDeliveryService, type WhatsAppTemplateDeliveryInput } from "@/lib/services/notifications/whatsapp-template-delivery";
import { MetaWhatsAppProvider } from "@/lib/services/notifications/providers/whatsapp";
import type { HeadcountLeave } from "@/src/services/stay/stay-board";
import { fromDbDate, toDbDate } from "@/src/services/stay/stay-rows";
import { isMealType, type MealType } from "./meal-ratio";
import { conflict, invalidRequest, notFound } from "./meal-errors";
import {
  buildMealCount,
  cutoffInstant,
  isMealChoice,
  isNoAnswerPolicy,
  nextServeDate,
  type MealChoice,
  type MealResident,
  type NoAnswerPolicy,
} from "./special-meal-rules";

const logger = getLogger("meals.special");

/**
 * Special-meal choices, Phase 1 (spec 2026-10-10). Composes Stay's residents
 * and leaves exactly as the ADR-195 forecast does: it reads Stay and never
 * writes it. "I'm away" stays a meal answer and never becomes a leave.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const DISH_MAX = 60;

export interface OccasionView {
  id: string;
  weekday: number;
  mealType: MealType;
  vegDish: string | null;
  nonVegDish: string | null;
  cutoffMinutesBefore: number;
  noAnswerPolicy: NoAnswerPolicy;
  isActive: boolean;
  nextServeDate: string;
}

function viewOf(row: any, today: string): OccasionView {
  return {
    id: row.id,
    weekday: row.weekday,
    mealType: row.meal_type,
    vegDish: row.veg_dish ?? null,
    nonVegDish: row.non_veg_dish ?? null,
    cutoffMinutesBefore: row.cutoff_minutes_before,
    noAnswerPolicy: row.no_answer_policy,
    isActive: row.is_active,
    nextServeDate: nextServeDate(row.weekday, today),
  };
}

function cleanDish(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw invalidRequest(`${field} must be text`);
  const v = value.trim();
  if (v.length > DISH_MAX) throw invalidRequest(`${field} must be ${DISH_MAX} characters or fewer`);
  return v || null;
}

function cleanCutoff(value: unknown): number {
  if (value === undefined) return 180;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 1440) {
    throw invalidRequest("cutoffMinutesBefore must be a whole number of minutes between 0 and 1440");
  }
  return value;
}

export function createSpecialMealService(deps: {
  db?: any;
  sendTemplate?: (input: WhatsAppTemplateDeliveryInput) => Promise<{ sent: boolean; skipped: boolean }>;
  sendText?: (phone: string, text: string) => Promise<unknown>;
} = {}) {
  const db = deps.db ?? prisma;
  const sendTemplate = deps.sendTemplate ?? ((input) => whatsAppTemplateDeliveryService.send(input));
  const sendText = deps.sendText ?? ((phone, text) => new MetaWhatsAppProvider().sendTextMessage(phone, text));

  async function occasionOf(hostelId: string, occasionId: string) {
    const row = await db.special_meal_occasions.findFirst({ where: { id: occasionId, hostel_id: hostelId } });
    if (!row) throw notFound("Special meal not found");
    return row;
  }

  async function residentsOf(hostelId: string): Promise<MealResident[]> {
    const rows = await db.roomAllocation.findMany({
      where: { hostel_id: hostelId, ...OCCUPYING_ALLOCATION_WHERE },
      select: {
        tenant_id: true,
        room: { select: { room_no: true } },
        tenant: { select: { display_name: true, exit_date: true, phone_1: true, profiles: { select: { name: true, phone: true } } } },
      },
    });
    const seen = new Set<string>();
    const out: MealResident[] = [];
    for (const a of rows as any[]) {
      if (seen.has(a.tenant_id)) continue;
      seen.add(a.tenant_id);
      out.push({
        tenantId: a.tenant_id,
        name: a.tenant?.display_name || a.tenant?.profiles?.name || "Resident",
        roomNo: a.room?.room_no ?? "—",
        exitDate: a.tenant?.exit_date ? fromDbDate(a.tenant.exit_date) : null,
        phone: (a.tenant?.phone_1 || a.tenant?.profiles?.phone || "").trim() || null,
      });
    }
    return out;
  }

  /** Leaves that can touch `serveDate`. A returned leave ends on the day they came back. */
  async function leavesAround(hostelId: string, serveDate: string): Promise<HeadcountLeave[]> {
    const rows = await db.stay_leaves.findMany({
      where: { hostel_id: hostelId, status: { in: ["ACTIVE", "RETURNED"] }, expected_return_date: { gte: toDbDate(serveDate) } },
      select: { tenant_id: true, start_date: true, expected_return_date: true, returned_at: true },
    });
    return (rows as any[]).map((r) => ({
      tenantId: r.tenant_id,
      startDate: fromDbDate(r.start_date),
      expectedReturnDate: r.returned_at ? istDateOf(r.returned_at) : fromDbDate(r.expected_return_date),
    }));
  }

  async function cutoffFor(occasion: any, serveDate: string): Promise<Date> {
    const hostel = await db.hostels.findUnique({ where: { id: occasion.hostel_id }, select: { name: true, preferences_config: true } });
    const timings = normalizeMealTimings(hostel?.preferences_config);
    return cutoffInstant(serveDate, timings[occasion.meal_type as MealType].start, occasion.cutoff_minutes_before);
  }

  async function answersFor(occasionId: string, serveDate: string) {
    const rows = await db.special_meal_answers.findMany({
      where: { occasion_id: occasionId, serve_date: toDbDate(serveDate) },
      select: { tenant_id: true, choice: true, source: true },
    });
    return new Map<string, { choice: MealChoice; source: "WHATSAPP" | "OWNER" }>(
      (rows as any[]).map((r) => [r.tenant_id, { choice: r.choice, source: r.source }]),
    );
  }

  async function lastChoicesBefore(occasionId: string, serveDate: string) {
    const rows = await db.special_meal_answers.findMany({
      where: { occasion_id: occasionId, serve_date: { lt: toDbDate(serveDate) }, choice: { in: ["VEG", "NON_VEG"] } },
      orderBy: { serve_date: "desc" },
      select: { tenant_id: true, choice: true },
    });
    const out = new Map<string, "VEG" | "NON_VEG">();
    for (const r of rows as any[]) if (!out.has(r.tenant_id)) out.set(r.tenant_id, r.choice);
    return out;
  }

  function requireServeDate(occasion: any, value: unknown, today: string): string {
    if (value === undefined || value === null || value === "") return nextServeDate(occasion.weekday, today);
    if (typeof value !== "string" || !ISO_DATE.test(value)) throw invalidRequest("date must be YYYY-MM-DD");
    if (weekdayOfIso(value) !== occasion.weekday) throw invalidRequest("That date is not this special meal's day");
    return value;
  }

  async function listOccasions(hostelId: string, now: Date = new Date()): Promise<OccasionView[]> {
    const rows = await db.special_meal_occasions.findMany({ where: { hostel_id: hostelId }, orderBy: [{ weekday: "asc" }, { meal_type: "asc" }] });
    const today = istDateOf(now);
    return (rows as any[]).map((r) => viewOf(r, today));
  }

  async function createOccasion(hostelId: string, ownerId: string, input: any, now: Date = new Date()): Promise<OccasionView> {
    const weekday = input?.weekday;
    if (typeof weekday !== "number" || !Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw invalidRequest("weekday must be 0 (Sunday) to 6 (Saturday)");
    if (!isMealType(input?.mealType)) throw invalidRequest("mealType must be BREAKFAST, LUNCH, SNACKS or DINNER");
    const policy = input?.noAnswerPolicy ?? "LAST_CHOICE";
    if (!isNoAnswerPolicy(policy)) throw invalidRequest("noAnswerPolicy must be LAST_CHOICE or LEAVE_OUT");
    try {
      const row = await db.special_meal_occasions.create({
        data: {
          hostel_id: hostelId,
          owner_id: ownerId,
          weekday,
          meal_type: input.mealType,
          veg_dish: cleanDish(input.vegDish, "vegDish"),
          non_veg_dish: cleanDish(input.nonVegDish, "nonVegDish"),
          cutoff_minutes_before: cleanCutoff(input.cutoffMinutesBefore),
          no_answer_policy: policy,
        },
      });
      return viewOf(row, istDateOf(now));
    } catch (error: any) {
      if (error?.code === "P2002") throw conflict("This hostel already has a special meal on that day");
      throw error;
    }
  }

  async function updateOccasion(hostelId: string, occasionId: string, input: any, now: Date = new Date()): Promise<OccasionView> {
    await occasionOf(hostelId, occasionId);
    const data: Record<string, unknown> = { updated_at: new Date() };
    if ("vegDish" in (input ?? {})) data.veg_dish = cleanDish(input.vegDish, "vegDish");
    if ("nonVegDish" in (input ?? {})) data.non_veg_dish = cleanDish(input.nonVegDish, "nonVegDish");
    if ("cutoffMinutesBefore" in (input ?? {})) data.cutoff_minutes_before = cleanCutoff(input.cutoffMinutesBefore);
    if ("noAnswerPolicy" in (input ?? {})) {
      if (!isNoAnswerPolicy(input.noAnswerPolicy)) throw invalidRequest("noAnswerPolicy must be LAST_CHOICE or LEAVE_OUT");
      data.no_answer_policy = input.noAnswerPolicy;
    }
    if ("isActive" in (input ?? {})) {
      if (typeof input.isActive !== "boolean") throw invalidRequest("isActive must be true or false");
      data.is_active = input.isActive;
    }
    const row = await db.special_meal_occasions.update({ where: { id: occasionId }, data });
    return viewOf(row, istDateOf(now));
  }

  async function getCount(hostelId: string, occasionId: string, date?: string, now: Date = new Date()) {
    const occasion = await occasionOf(hostelId, occasionId);
    const today = istDateOf(now);
    const serveDate = requireServeDate(occasion, date, today);
    const [residents, leaves, answers, lastChoices, cutoffAt] = await Promise.all([
      residentsOf(hostelId),
      leavesAround(hostelId, serveDate),
      answersFor(occasionId, serveDate),
      lastChoicesBefore(occasionId, serveDate),
      cutoffFor(occasion, serveDate),
    ]);
    const count = buildMealCount({ serveDate, policy: occasion.no_answer_policy, residents, leaves, answers, lastChoices });
    return { occasion: viewOf(occasion, today), serveDate, cutoffAt: cutoffAt.toISOString(), isOpen: now < cutoffAt, count };
  }

  /** The warden's correction. Allowed after the cutoff, and labelled OWNER. */
  async function setOwnerAnswer(
    input: { hostelId: string; occasionId: string; tenantId: string; serveDate: unknown; choice: unknown; recordedBy: string },
    now: Date = new Date(),
  ) {
    const occasion = await occasionOf(input.hostelId, input.occasionId);
    const serveDate = requireServeDate(occasion, input.serveDate, istDateOf(now));
    if (input.choice !== null && !isMealChoice(input.choice)) throw invalidRequest("choice must be VEG, NON_VEG, AWAY, SKIP or null");
    const residents = await residentsOf(input.hostelId);
    if (!residents.some((r) => r.tenantId === input.tenantId)) throw notFound("That resident does not live in this hostel");

    const key = { occasion_id: input.occasionId, serve_date: toDbDate(serveDate), tenant_id: input.tenantId };
    if (input.choice === null) {
      await db.special_meal_answers.deleteMany({ where: key });
      return;
    }
    await db.special_meal_answers.upsert({
      where: { occasion_id_serve_date_tenant_id: key },
      create: { ...key, hostel_id: input.hostelId, choice: input.choice, source: "OWNER", recorded_by: input.recordedBy },
      update: { choice: input.choice, source: "OWNER", recorded_by: input.recordedBy, updated_at: new Date() },
    });
  }

  // handleWhatsAppReply — Task 6. runRound — Task 7.

  return { listOccasions, createOccasion, updateOccasion, getCount, setOwnerAnswer };
}

export const specialMealService = createSpecialMealService();
```

`isMealType` and `MealType` already exist in `src/services/meals/meal-ratio.ts` (the forecast service imports them). Check the export names before using them. `logger`, `sendTemplate`, `sendText`, `addDaysIso`, `buildQuestionParameters` and friends are used in Tasks 6 and 7. If lint flags them as unused in this commit, leave the warning; Task 6 consumes them.

- [ ] **Step 4: Write the four thin routes**

Every route follows `app/api/hostels/[id]/meals/served/route.ts` exactly: `force-dynamic` and `nodejs` exports; `session.role !== "OWNER"` → 403; `resolveOwnerScope` + `requireHostelBelongsToOwner(scope.owner_id, id)`; `catch (error) { return mealErrorResponse(error); }`.

```ts
// app/api/hostels/[id]/meals/special/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { specialMealService } from "@/src/services/meals/special-meal-service";
import { mealErrorResponse } from "@/src/services/meals/meal-errors";

/** GET — this hostel's special meals. POST { weekday, mealType, vegDish?, nonVegDish?, cutoffMinutesBefore?, noAnswerPolicy? } — add one. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    return apiResponse({ occasions: await specialMealService.listOccasions(id) });
  } catch (error) {
    return mealErrorResponse(error);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    return apiResponse({ occasion: await specialMealService.createOccasion(id, scope.owner_id, body) }, 201);
  } catch (error) {
    return mealErrorResponse(error);
  }
}
```

```ts
// app/api/hostels/[id]/meals/special/[occasionId]/route.ts
// (same imports and preamble)
/** PATCH { vegDish?, nonVegDish?, cutoffMinutesBefore?, noAnswerPolicy?, isActive? } */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; occasionId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, occasionId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    return apiResponse({ occasion: await specialMealService.updateOccasion(id, occasionId, body) });
  } catch (error) {
    return mealErrorResponse(error);
  }
}
```

```ts
// app/api/hostels/[id]/meals/special/[occasionId]/count/route.ts
// (same imports and preamble)
/** GET ?date=YYYY-MM-DD (defaults to the next serving) */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; occasionId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, occasionId } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const date = new URL(req.url).searchParams.get("date") ?? undefined;
    return apiResponse(await specialMealService.getCount(id, occasionId, date));
  } catch (error) {
    return mealErrorResponse(error);
  }
}
```

```ts
// app/api/hostels/[id]/meals/special/[occasionId]/answers/route.ts
// (same imports and preamble)
/** PUT { tenantId, serveDate, choice: VEG|NON_VEG|AWAY|SKIP|null } — the warden's correction, allowed after the cutoff. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string; occasionId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, occasionId } = await params;
  try {
    const body = await req.json().catch(() => ({}));
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    if (typeof body?.tenantId !== "string") return apiError("tenantId is required", "INVALID_REQUEST", 400);
    await specialMealService.setOwnerAnswer({
      hostelId: id, occasionId, tenantId: body.tenantId, serveDate: body.serveDate, choice: body.choice ?? null, recordedBy: session.sub,
    });
    return apiResponse({ count: (await specialMealService.getCount(id, occasionId, body.serveDate)).count });
  } catch (error) {
    return mealErrorResponse(error);
  }
}
```

- [ ] **Step 5: Run the tests and the gates**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-service.test.ts && npm run check:invariants && npx tsc --noEmit 2>&1 | grep -E "special-meal|meals/special" || echo "no new type errors"`
Expected: tests pass, invariants pass, and no type errors in the new files.

- [ ] **Step 6: Commit**

```bash
git add src/services/meals/special-meal-service.ts src/services/meals/meal-errors.ts "app/api/hostels/[id]/meals/special" tests/special-meal-service.test.ts vitest.pure.config.ts
git commit -m "feat(meals): special-meal service and owner routes"
```

---

### Task 6: WhatsApp replies — taps and typed answers

**Files:**
- Modify: `apps/backend/src/services/meals/special-meal-service.ts` (add `handleWhatsAppReply`)
- Modify: `apps/backend/lib/services/notifications/routing/intent-resolvers.ts` (add `INTENTS.MEAL_CHOICE` and `mealChoiceIntentResolver`, first in `defaultIntentResolver`)
- Modify: `apps/backend/lib/services/notifications/whatsapp-webhook-event-service.ts` (`buildIntentRegistry`: add the entry)
- Test: `apps/backend/tests/special-meal-reply.test.ts` (pure include list)

**Interfaces:**
- Consumes: `SenderIdentity` (fields `residents`, `guardianResidents`, each `{ tenantId; hostelId; … }`) from `lib/services/notifications/routing/types.ts`; Task 3's `decodeMealPayload`, `parseTypedChoice`, `answeredReply`, `closedReply`.
- Produces: `handleWhatsAppReply(phone: string, body: string, identity: SenderIdentity, now?: Date): Promise<{ handled: boolean; outcome?: string }>`. Outcomes: `"ANSWERED" | "CLOSED" | "AMBIGUOUS"`.

Rules the handler enforces:
1. "Own" tenants are `identity.residents` minus anyone in `identity.guardianResidents`. If there are none, return `{ handled: false }`. The router then falls through: no denial, no reply.
2. **Payload** (`MEAL:…`): the payload's tenant must be one of the sender's own, otherwise `{ handled: false }` plus a warn log. Load the occasion by id with `hostel_id` = that tenant's hostel. If the cutoff for `payload.serveDate` has passed, send `closedReply` → `CLOSED`. Otherwise upsert `source: "WHATSAPP"` and send `answeredReply` → `ANSWERED`.
3. **Typed** answer: more than one own tenant → reply "Please tap a button in the meal message so we know who it's for." → `AMBIGUOUS`. Otherwise, the candidates are the tenant's hostel's active occasions with a serve date of today or tomorrow (IST). If there are none, return `{ handled: false }`. Pick the open candidate with the earliest cutoff. If all are closed, send `closedReply` for the latest one → `CLOSED`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/special-meal-reply.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  special_meal_occasions: { findMany: vi.fn(), findFirst: vi.fn() },
  special_meal_answers: { upsert: vi.fn() },
  hostels: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { createSpecialMealService } from "@/src/services/meals/special-meal-service";
import { encodeMealPayload } from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";

const OCC_ID = "11111111-1111-4111-8111-111111111111";
const T1 = "22222222-2222-4222-8222-222222222222";
const T2 = "33333333-3333-4333-8333-333333333333";
const OCC = { id: OCC_ID, hostel_id: "h1", weekday: 0, meal_type: "LUNCH", cutoff_minutes_before: 180, is_active: true };
const SAT_EVENING = new Date("2026-10-10T13:00:00.000Z"); // Sat 18:30 IST; Sunday's cutoff is 04:00Z
const identity = (own: string[], guardianOf: string[] = []) =>
  ({
    residents: [...own, ...guardianOf].map((tenantId) => ({ tenantId, hostelId: "h1" })),
    guardianResidents: guardianOf.map((tenantId) => ({ tenantId, hostelId: "h1" })),
  }) as any;

let sendText: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  sendText = vi.fn().mockResolvedValue(undefined);
  db.hostels.findUnique.mockResolvedValue({ preferences_config: null });
  db.special_meal_occasions.findFirst.mockResolvedValue(OCC);
  db.special_meal_occasions.findMany.mockResolvedValue([OCC]);
});
const svc = () => createSpecialMealService({ sendText });

describe("handleWhatsAppReply — taps", () => {
  it("records the tapped choice for the payload's own serving", async () => {
    const body = encodeMealPayload({ occasionId: OCC_ID, serveDate: "2026-10-11", tenantId: T1, choice: "AWAY" });
    const out = await svc().handleWhatsAppReply("91900", body, identity([T1]), SAT_EVENING);
    expect(out).toEqual({ handled: true, outcome: "ANSWERED" });
    expect(db.special_meal_answers.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ tenant_id: T1, choice: "AWAY", source: "WHATSAPP", recorded_by: null }),
    }));
    expect(sendText.mock.calls[0][1]).toContain("won't cook for you");
  });

  it("refuses last week's button once its cutoff has passed, writing nothing", async () => {
    const body = encodeMealPayload({ occasionId: OCC_ID, serveDate: "2026-10-04", tenantId: T1, choice: "VEG" });
    const out = await svc().handleWhatsAppReply("91900", body, identity([T1]), SAT_EVENING);
    expect(out.outcome).toBe("CLOSED");
    expect(db.special_meal_answers.upsert).not.toHaveBeenCalled();
  });

  it("never lets a shared phone answer for someone who is not its own resident", async () => {
    const body = encodeMealPayload({ occasionId: OCC_ID, serveDate: "2026-10-11", tenantId: T2, choice: "VEG" });
    const out = await svc().handleWhatsAppReply("91900", body, identity([T1], [T2]), SAT_EVENING);
    expect(out.handled).toBe(false);
    expect(db.special_meal_answers.upsert).not.toHaveBeenCalled();
  });
});

describe("handleWhatsAppReply — typed", () => {
  it("answers the one open serving", async () => {
    const out = await svc().handleWhatsAppReply("91900", "non veg", identity([T1]), SAT_EVENING);
    expect(out.outcome).toBe("ANSWERED");
    expect(db.special_meal_answers.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ choice: "NON_VEG" }) }));
  });

  it("declines silently for a guardian, so the router falls through", async () => {
    const out = await svc().handleWhatsAppReply("91900", "veg", identity([], [T2]), SAT_EVENING);
    expect(out).toEqual({ handled: false });
    expect(sendText).not.toHaveBeenCalled();
  });

  it("declines when there is no special meal today or tomorrow", async () => {
    db.special_meal_occasions.findMany.mockResolvedValue([]);
    const out = await svc().handleWhatsAppReply("91900", "veg", identity([T1]), SAT_EVENING);
    expect(out).toEqual({ handled: false });
  });

  it("asks a two-resident phone to tap instead of guessing", async () => {
    const out = await svc().handleWhatsAppReply("91900", "veg", identity([T1, T2]), SAT_EVENING);
    expect(out.outcome).toBe("AMBIGUOUS");
    expect(db.special_meal_answers.upsert).not.toHaveBeenCalled();
  });

  it("ignores text that is not an answer", async () => {
    expect(await svc().handleWhatsAppReply("91900", "rent", identity([T1]), SAT_EVENING)).toEqual({ handled: false });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-reply.test.ts`
Expected: FAIL, `handleWhatsAppReply is not a function`.

- [ ] **Step 3: Implement the handler**

Add the imports `decodeMealPayload, parseTypedChoice, answeredReply, closedReply` from the Task 3 contract and `type SenderIdentity` from `@/lib/services/notifications/routing/types` to `special-meal-service.ts`. Then add inside `createSpecialMealService`, before `return`:

```ts
  async function recordWhatsApp(occasion: any, tenantId: string, serveDate: string, choice: MealChoice) {
    const key = { occasion_id: occasion.id, serve_date: toDbDate(serveDate), tenant_id: tenantId };
    await db.special_meal_answers.upsert({
      where: { occasion_id_serve_date_tenant_id: key },
      create: { ...key, hostel_id: occasion.hostel_id, choice, source: "WHATSAPP", recorded_by: null },
      update: { choice, source: "WHATSAPP", recorded_by: null, updated_at: new Date() },
    });
  }

  async function handleWhatsAppReply(phone: string, body: string, identity: SenderIdentity, now: Date = new Date()) {
    const guardianOf = new Set(identity.guardianResidents.map((g) => g.tenantId));
    const own = identity.residents.filter((r) => !guardianOf.has(r.tenantId));
    if (own.length === 0) return { handled: false };

    const decoded = decodeMealPayload(body);
    if (decoded) {
      const mine = own.find((r) => r.tenantId === decoded.tenantId);
      if (!mine) {
        logger.warn("special_meal.payload_tenant_not_own", { tenant_id: decoded.tenantId });
        return { handled: false };
      }
      const occasion = await db.special_meal_occasions.findFirst({ where: { id: decoded.occasionId, hostel_id: mine.hostelId } });
      if (!occasion) return { handled: false };
      const cutoffAt = await cutoffFor(occasion, decoded.serveDate);
      const copy = { serveDate: decoded.serveDate, mealType: occasion.meal_type, cutoffAt };
      if (now >= cutoffAt) {
        await sendText(phone, closedReply(copy));
        return { handled: true, outcome: "CLOSED" };
      }
      await recordWhatsApp(occasion, decoded.tenantId, decoded.serveDate, decoded.choice);
      await sendText(phone, answeredReply({ ...copy, choice: decoded.choice }));
      return { handled: true, outcome: "ANSWERED" };
    }

    const choice = parseTypedChoice(body);
    if (!choice) return { handled: false };

    const today = istDateOf(now);
    const dates = [today, addDaysIso(today, 1)];
    if (own.length > 1) {
      await sendText(phone, "Please tap a button in the meal message so we know who it's for.");
      return { handled: true, outcome: "AMBIGUOUS" };
    }
    const resident = own[0];
    const occasions = await db.special_meal_occasions.findMany({
      where: { hostel_id: resident.hostelId, is_active: true, weekday: { in: dates.map(weekdayOfIso) } },
    });
    const candidates: Array<{ occasion: any; serveDate: string; cutoffAt: Date }> = [];
    for (const occasion of occasions as any[]) {
      for (const serveDate of dates) {
        if (weekdayOfIso(serveDate) !== occasion.weekday) continue;
        candidates.push({ occasion, serveDate, cutoffAt: await cutoffFor(occasion, serveDate) });
      }
    }
    if (candidates.length === 0) return { handled: false };

    const open = candidates.filter((c) => now < c.cutoffAt).sort((a, b) => a.cutoffAt.getTime() - b.cutoffAt.getTime());
    if (open.length === 0) {
      const latest = candidates.sort((a, b) => b.cutoffAt.getTime() - a.cutoffAt.getTime())[0];
      await sendText(phone, closedReply({ serveDate: latest.serveDate, mealType: latest.occasion.meal_type, cutoffAt: latest.cutoffAt }));
      return { handled: true, outcome: "CLOSED" };
    }
    const target = open[0];
    await recordWhatsApp(target.occasion, resident.tenantId, target.serveDate, choice);
    await sendText(phone, answeredReply({ choice, serveDate: target.serveDate, mealType: target.occasion.meal_type, cutoffAt: target.cutoffAt }));
    return { handled: true, outcome: "ANSWERED" };
  }
```

Add `handleWhatsAppReply` to the returned object.

- [ ] **Step 4: Wire the intent**

In `intent-resolvers.ts`, add `MEAL_CHOICE: "MEAL_CHOICE",` to `INTENTS`, import `decodeMealPayload, parseTypedChoice` from `../providers/whatsapp/special-meal-template-contract`, and add:

```ts
/**
 * A special-meal answer: a tapped template button (`MEAL:` payload, which
 * arrives as text) or a whole-message typed answer ("veg", "nv", "skip",
 * "I'm away"). First in the chain because its payloads are ours and exact. The
 * handler declines anything that is not an open serving for the sender's own
 * residency, so a guardian's "veg" falls through untouched.
 */
export const mealChoiceIntentResolver: IntentResolver = {
  name: "meal-choice",
  async resolve({ message }: IntentResolutionInput): Promise<Intent[]> {
    if (!decodeMealPayload(message.body) && !parseTypedChoice(message.body)) return [];
    return [{ name: INTENTS.MEAL_CHOICE, source: "KEYWORD", confidence: 0.9, metadata: { resolver: "meal-choice" } }];
  },
};
```

and put `mealChoiceIntentResolver` **first** in `defaultIntentResolver`'s array. Check the `Intent["source"]` union in `routing/types.ts` accepts `"KEYWORD"` (it does for the command-center resolver).

In `whatsapp-webhook-event-service.ts` `buildIntentRegistry()`, add (with `import { specialMealService } from "@/src/services/meals/special-meal-service";`):

```ts
      [INTENTS.MEAL_CHOICE]: {
        name: INTENTS.MEAL_CHOICE,
        description: "A resident's answer to a special-meal question (Veg / Non-veg / I'm away / skip).",
        // ANY_ROLE on purpose: the handler self-authorises against the sender's
        // own residency and declines otherwise, so a guardian or stranger never
        // receives a permission-denied reply for typing "veg".
        allowedRoles: ANY_ROLE,
        handler: ({ message, identity }) => specialMealService.handleWhatsAppReply(message.from, message.body, identity),
      },
```

Confirm `isHandled` in `message-router.ts` treats `{ handled: false }` as declined (it does for `CommandCenterResult`).

- [ ] **Step 5: Run the tests and the router suite**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-reply.test.ts && npm run test:pure`
Expected: the new file passes, and no new failures in `test:pure` (compare against `git stash`).

- [ ] **Step 6: Commit**

```bash
git add src/services/meals/special-meal-service.ts lib/services/notifications/routing/intent-resolvers.ts lib/services/notifications/whatsapp-webhook-event-service.ts tests/special-meal-reply.test.ts vitest.pure.config.ts
git commit -m "feat(meals): record special-meal answers from WhatsApp taps and typed replies"
```

---

### Task 7: Daily ask and reminder rounds

**Files:**
- Modify: `apps/backend/src/services/meals/special-meal-service.ts` (add `runRound`)
- Create: `apps/backend/app/api/cron/special-meal-asks/route.ts`, `apps/backend/app/api/cron/special-meal-reminders/route.ts`
- Modify: `apps/backend/vercel.json` (two crons)
- Test: `apps/backend/tests/special-meal-rounds.test.ts` (pure include list)

**Interfaces:**
- Produces: `runRound(kind: "ASK" | "REMIND", now?: Date): Promise<{ occasions: number; sent: number; skipped: number; failed: number; closed: number }>`. ASK targets serve date = tomorrow (IST). REMIND targets today. Idempotency key: `special_meal_${kind.toLowerCase()}:${occasionId}:${serveDate}:${tenantId}`.

- [ ] **Step 1: Write the failing test**

```ts
// apps/backend/tests/special-meal-rounds.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  special_meal_occasions: { findMany: vi.fn() },
  special_meal_answers: { findMany: vi.fn() },
  roomAllocation: { findMany: vi.fn() },
  stay_leaves: { findMany: vi.fn() },
  hostels: { findUnique: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma: db }));

import { createSpecialMealService } from "@/src/services/meals/special-meal-service";
import { decodeMealPayload } from "@/lib/services/notifications/providers/whatsapp/special-meal-template-contract";

const OCC = { id: "11111111-1111-4111-8111-111111111111", hostel_id: "h1", owner_id: "own", weekday: 0, meal_type: "LUNCH", veg_dish: "Veg Biryani", non_veg_dish: "Chicken Biryani", cutoff_minutes_before: 180, no_answer_policy: "LAST_CHOICE", is_active: true };
const alloc = (tenantId: string, phone: string | null = "9000000000") => ({
  tenant_id: tenantId, room: { room_no: "101" },
  tenant: { display_name: null, exit_date: null, phone_1: phone, profiles: { name: "Rahul Kumar", phone: null } },
});
const T1 = "22222222-2222-4222-8222-222222222222";
const T2 = "33333333-3333-4333-8333-333333333333";

let sendTemplate: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.resetAllMocks();
  sendTemplate = vi.fn().mockResolvedValue({ sent: true, skipped: false });
  db.special_meal_occasions.findMany.mockResolvedValue([OCC]);
  db.hostels.findUnique.mockResolvedValue({ name: "Sri", preferences_config: null });
  db.stay_leaves.findMany.mockResolvedValue([{ tenant_id: T2, start_date: new Date("2026-10-09T00:00:00Z"), expected_return_date: new Date("2026-10-15T00:00:00Z"), returned_at: null }]);
  db.roomAllocation.findMany.mockResolvedValue([alloc(T1), alloc(T2)]);
  db.special_meal_answers.findMany.mockResolvedValue([]);
});

describe("runRound", () => {
  it("ASK on Saturday evening asks tomorrow's residents who are here, with per-tenant payloads", async () => {
    const svc = createSpecialMealService({ sendTemplate });
    const out = await svc.runRound("ASK", new Date("2026-10-10T12:45:00.000Z"));
    expect(db.special_meal_occasions.findMany).toHaveBeenCalledWith({ where: { weekday: 0, is_active: true } });
    expect(sendTemplate).toHaveBeenCalledTimes(1); // T2 is on leave
    const input = sendTemplate.mock.calls[0][0];
    expect(input.templateName).toBe("stayo_special_meal_question");
    expect(input.bodyParameters).toEqual(["Rahul", "Sunday lunch, 11 Oct", "Chicken Biryani or Veg Biryani", "9:30 AM"]);
    expect(input.quickReplyPayloads.map((p: string) => decodeMealPayload(p)?.choice)).toEqual(["VEG", "NON_VEG", "AWAY"]);
    expect(input.quickReplyPayloads.every((p: string) => decodeMealPayload(p)?.tenantId === T1)).toBe(true);
    expect(input.idempotencyKey).toBe(`special_meal_ask:${OCC.id}:2026-10-11:${T1}`);
    expect(out).toMatchObject({ occasions: 1, sent: 1 });
  });

  it("REMIND skips anyone who already answered", async () => {
    db.special_meal_answers.findMany.mockResolvedValue([{ tenant_id: T1, choice: "VEG", source: "WHATSAPP" }]);
    const out = await createSpecialMealService({ sendTemplate }).runRound("REMIND", new Date("2026-10-11T02:45:00.000Z"));
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(out.sent).toBe(0);
  });

  it("sends nothing for a serving whose cutoff has already passed (late cron)", async () => {
    const out = await createSpecialMealService({ sendTemplate }).runRound("REMIND", new Date("2026-10-11T04:30:00.000Z"));
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(out.closed).toBe(1);
  });

  it("keeps going when one send throws", async () => {
    db.roomAllocation.findMany.mockResolvedValue([alloc(T1), alloc("44444444-4444-4444-8444-444444444444")]);
    db.stay_leaves.findMany.mockResolvedValue([]);
    sendTemplate.mockRejectedValueOnce(new Error("132001")).mockResolvedValueOnce({ sent: true, skipped: false });
    const out = await createSpecialMealService({ sendTemplate }).runRound("ASK", new Date("2026-10-10T12:45:00.000Z"));
    expect(out).toMatchObject({ sent: 1, failed: 1 });
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-rounds.test.ts`
Expected: FAIL, `runRound is not a function`.

- [ ] **Step 3: Implement `runRound`**

Add imports `askAudience` (from rules) and `SPECIAL_MEAL_QUESTION_TEMPLATE, buildQuestionParameters, encodeMealPayload` (from the contract). Then add:

```ts
  /**
   * One daily round. ASK (≈18:00 IST) covers tomorrow's servings, REMIND
   * (≈08:00 IST) covers today's. Vercel Hobby fires each anywhere in its hour,
   * so a serving whose cutoff has already passed is skipped, never asked.
   * Idempotent per tenant per serving per kind via whatsapp_logs.idempotency_key.
   */
  async function runRound(kind: "ASK" | "REMIND", now: Date = new Date()) {
    const today = istDateOf(now);
    const serveDate = kind === "ASK" ? addDaysIso(today, 1) : today;
    const occasions = await db.special_meal_occasions.findMany({ where: { weekday: weekdayOfIso(serveDate), is_active: true } });
    const result = { occasions: (occasions as any[]).length, sent: 0, skipped: 0, failed: 0, closed: 0 };

    for (const occasion of occasions as any[]) {
      const cutoffAt = await cutoffFor(occasion, serveDate);
      if (now >= cutoffAt) {
        result.closed += 1;
        continue;
      }
      const [residents, leaves, answers] = await Promise.all([
        residentsOf(occasion.hostel_id),
        leavesAround(occasion.hostel_id, serveDate),
        answersFor(occasion.id, serveDate),
      ]);
      const audience = askAudience({ serveDate, residents, leaves, answered: new Set(answers.keys()) });
      for (const person of audience) {
        try {
          const outcome = await sendTemplate({
            phone: person.phone,
            templateName: SPECIAL_MEAL_QUESTION_TEMPLATE.name,
            languageCode: SPECIAL_MEAL_QUESTION_TEMPLATE.language,
            bodyParameters: buildQuestionParameters({
              tenantName: person.name, serveDate, mealType: occasion.meal_type,
              vegDish: occasion.veg_dish, nonVegDish: occasion.non_veg_dish, cutoffAt,
            }),
            quickReplyPayloads: SPECIAL_MEAL_QUESTION_TEMPLATE.quickReplies.map((q) =>
              encodeMealPayload({ occasionId: occasion.id, serveDate, tenantId: person.tenantId, choice: q.choice }),
            ),
            idempotencyKey: `special_meal_${kind.toLowerCase()}:${occasion.id}:${serveDate}:${person.tenantId}`,
            tenantId: person.tenantId,
            hostelId: occasion.hostel_id,
            ownerId: occasion.owner_id,
          });
          if (outcome.sent) result.sent += 1;
          else result.skipped += 1;
        } catch (error: any) {
          result.failed += 1;
          logger.warn("special_meal.send_failed", { kind, occasion_id: occasion.id, tenant_id: person.tenantId, error: error?.message || String(error) });
        }
      }
    }
    logger.info("special_meal.round_done", { kind, serve_date: serveDate, ...result });
    return result;
  }
```

Add `runRound` to the returned object.

- [ ] **Step 4: Cron routes and schedule**

```ts
// app/api/cron/special-meal-asks/route.ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { specialMealService } from "@/src/services/meals/special-meal-service";

/**
 * 🕐 CRON — special-meal questions for tomorrow (≈18:00 IST).
 * Daily only: Vercel Hobby rejects sub-daily crons at deploy time. Fails closed
 * on a missing CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || req.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ success: true, ...(await specialMealService.runRound("ASK")) });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || String(error) }, { status: 500 });
  }
}
```

`special-meal-reminders/route.ts` is identical, with `runRound("REMIND")` and the header comment `special-meal reminders for today (≈08:00 IST)`.

In `vercel.json` `crons`, add:

```json
    { "path": "/api/cron/special-meal-asks", "schedule": "30 12 * * *" },
    { "path": "/api/cron/special-meal-reminders", "schedule": "30 2 * * *" }
```

- [ ] **Step 5: Run the tests and the gates**

Run: `npx vitest run -c vitest.pure.config.ts tests/special-meal-rounds.test.ts && npm run check:invariants && node -e "JSON.parse(require('fs').readFileSync('vercel.json','utf8'))"`
Expected: tests pass, invariants pass, and the JSON parses.

- [ ] **Step 6: Commit**

```bash
git add src/services/meals/special-meal-service.ts app/api/cron/special-meal-asks app/api/cron/special-meal-reminders vercel.json tests/special-meal-rounds.test.ts vitest.pure.config.ts
git commit -m "feat(meals): daily special-meal ask and reminder rounds"
```

---

### Task 8: Frontend data layer — API, keys, display model, hooks

**Files:**
- Modify: `apps/frontend/src/features/food/api/index.ts`, `apps/frontend/src/lib/queryKeys.ts`
- Create: `apps/frontend/src/features/owner-food/specialMeals.ts`, `apps/frontend/src/features/owner-food/specialMeals.test.ts`, `apps/frontend/src/features/owner-food/hooks/useSpecialMeals.ts`

**Interfaces:**
- Produces:
  - `foodService.listSpecialMeals(hostelId)`, `createSpecialMeal(hostelId, body)`, `updateSpecialMeal(hostelId, occasionId, body)`, `getSpecialMealCount(hostelId, occasionId, date?)`, `setSpecialMealAnswer(hostelId, occasionId, body)`
  - `queryKeys.meals.special.occasions(hostelId)`, `queryKeys.meals.special.count(hostelId, occasionId, date?)`
  - Types `SpecialOccasion`, `SpecialCount`, `SpecialCountPerson`, `MealChoice`, `PersonBasis`. The functions `occasionTitle`, `cookLine`, `breakdownLine`, `absentLine`, `lockLine`, `peopleGroups`, `choiceLabel`, `WEEKDAYS`, `CUTOFF_OPTIONS`
  - `useSpecialMeals(hostelId)` → `{ occasions, isLoading, create, update }`; `useSpecialMealCount(hostelId, occasionId, date?)` → `{ data, isLoading, setAnswer, isSaving }`

- [ ] **Step 1: Write the failing test**

```ts
// apps/frontend/src/features/owner-food/specialMeals.test.ts
import { describe, expect, it } from 'vitest';
import { absentLine, breakdownLine, cookLine, lockLine, occasionTitle, peopleGroups, type SpecialCount } from './specialMeals';

const count: SpecialCount['count'] = {
  cook: { veg: 28, nonVeg: 57 },
  confirmed: 61, lastChoice: 20, noAnswer: 4, skipping: 6, awaySaid: 4, onLeave: 11,
  people: [
    { tenantId: 'a', name: 'Asha', roomNo: '101', choice: 'VEG', basis: 'CONFIRMED', source: 'WHATSAPP' },
    { tenantId: 'b', name: 'Bala', roomNo: '101', choice: 'NON_VEG', basis: 'LAST_CHOICE', source: null },
    { tenantId: 'c', name: 'Chetan', roomNo: '102', choice: null, basis: 'NO_ANSWER', source: null },
    { tenantId: 'd', name: 'Dev', roomNo: '103', choice: null, basis: 'ON_LEAVE', source: null },
    { tenantId: 'e', name: 'Esha', roomNo: '104', choice: 'AWAY', basis: 'CONFIRMED', source: 'WHATSAPP' },
    { tenantId: 'f', name: 'Faiz', roomNo: '105', choice: 'SKIP', basis: 'CONFIRMED', source: 'OWNER' },
  ],
};

describe('special meal display', () => {
  it('titles an occasion', () => {
    expect(occasionTitle({ weekday: 0, mealType: 'LUNCH' })).toBe('Sunday lunch');
  });
  it('puts the cook numbers first, non-veg first', () => {
    expect(cookLine(count)).toEqual([{ label: 'Non-veg', value: 57 }, { label: 'Veg', value: 28 }]);
  });
  it('explains where the numbers came from, naming the no-answer policy', () => {
    expect(breakdownLine(count, 'LAST_CHOICE')).toBe('Confirmed 61 · Last choice 20 · No answer 4');
    expect(breakdownLine({ ...count, lastChoice: 0 }, 'LEAVE_OUT')).toBe('Confirmed 61 · No answer 4 (not cooked for)');
  });
  it('splits away into on-leave and said-so', () => {
    expect(absentLine(count)).toBe('Skipping 6 · Away 15 (11 on leave · 4 said "I\'m away")');
  });
  it('says when answers lock or locked', () => {
    const cutoff = '2026-10-11T04:00:00.000Z';
    expect(lockLine(cutoff, true)).toBe('Answers close at 9:30 AM');
    expect(lockLine(cutoff, false)).toBe('Closed at 9:30 AM · you can still edit');
  });
  it('groups people for the drill-down, keeping room order', () => {
    const groups = peopleGroups(count.people);
    expect(groups.map((g) => [g.key, g.people.map((p) => p.tenantId)])).toEqual([
      ['NON_VEG', ['b']], ['VEG', ['a']], ['NO_ANSWER', ['c']], ['SKIP', ['f']], ['AWAY', ['e']], ['ON_LEAVE', ['d']],
    ]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd apps/frontend && npx vitest run src/features/owner-food/specialMeals.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the model, API and keys**

```ts
// apps/frontend/src/features/owner-food/specialMeals.ts
/** Special-meal choices (Phase 1) — the owner screen's words and groupings. Pure. */

export type MealChoice = 'VEG' | 'NON_VEG' | 'AWAY' | 'SKIP';
export type PersonBasis = 'CONFIRMED' | 'LAST_CHOICE' | 'NO_ANSWER' | 'ON_LEAVE';
export type NoAnswerPolicy = 'LAST_CHOICE' | 'LEAVE_OUT';

export interface SpecialOccasion {
  id: string;
  weekday: number;
  mealType: 'BREAKFAST' | 'LUNCH' | 'SNACKS' | 'DINNER';
  vegDish: string | null;
  nonVegDish: string | null;
  cutoffMinutesBefore: number;
  noAnswerPolicy: NoAnswerPolicy;
  isActive: boolean;
  nextServeDate: string;
}

export interface SpecialCountPerson {
  tenantId: string;
  name: string;
  roomNo: string;
  choice: MealChoice | null;
  basis: PersonBasis;
  source: 'WHATSAPP' | 'OWNER' | null;
}

export interface SpecialCount {
  occasion: SpecialOccasion;
  serveDate: string;
  cutoffAt: string;
  isOpen: boolean;
  count: {
    cook: { veg: number; nonVeg: number };
    confirmed: number; lastChoice: number; noAnswer: number; skipping: number; awaySaid: number; onLeave: number;
    people: SpecialCountPerson[];
  };
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export const CUTOFF_OPTIONS = [
  { minutes: 60, label: '1 hour before' },
  { minutes: 120, label: '2 hours before' },
  { minutes: 180, label: '3 hours before' },
  { minutes: 360, label: '6 hours before' },
  { minutes: 720, label: '12 hours before' },
] as const;

const MEAL_WORD = { BREAKFAST: 'breakfast', LUNCH: 'lunch', SNACKS: 'snacks', DINNER: 'dinner' } as const;

export function occasionTitle(o: Pick<SpecialOccasion, 'weekday' | 'mealType'>): string {
  return `${WEEKDAYS[o.weekday]} ${MEAL_WORD[o.mealType]}`;
}

export function choiceLabel(choice: MealChoice | null): string {
  return choice === 'VEG' ? 'Veg' : choice === 'NON_VEG' ? 'Non-veg' : choice === 'AWAY' ? "I'm away" : choice === 'SKIP' ? 'Skipping' : 'No answer';
}

export function cookLine(c: SpecialCount['count']) {
  return [{ label: 'Non-veg', value: c.cook.nonVeg }, { label: 'Veg', value: c.cook.veg }];
}

export function breakdownLine(c: SpecialCount['count'], policy: NoAnswerPolicy): string {
  const parts = [`Confirmed ${c.confirmed}`];
  if (c.lastChoice > 0) parts.push(`Last choice ${c.lastChoice}`);
  parts.push(policy === 'LEAVE_OUT' ? `No answer ${c.noAnswer} (not cooked for)` : `No answer ${c.noAnswer}`);
  return parts.join(' · ');
}

export function absentLine(c: SpecialCount['count']): string {
  const away = c.onLeave + c.awaySaid;
  return `Skipping ${c.skipping} · Away ${away} (${c.onLeave} on leave · ${c.awaySaid} said "I'm away")`;
}

function istTime(iso: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })
    .format(new Date(iso))
    .replace(/[  ]/g, ' ');
}

export function lockLine(cutoffAt: string, isOpen: boolean): string {
  return isOpen ? `Answers close at ${istTime(cutoffAt)}` : `Closed at ${istTime(cutoffAt)} · you can still edit`;
}

const GROUPS: Array<{ key: string; label: string; match: (p: SpecialCountPerson) => boolean }> = [
  { key: 'NON_VEG', label: 'Non-veg', match: (p) => p.choice === 'NON_VEG' && p.basis !== 'ON_LEAVE' },
  { key: 'VEG', label: 'Veg', match: (p) => p.choice === 'VEG' && p.basis !== 'ON_LEAVE' },
  { key: 'NO_ANSWER', label: 'No answer', match: (p) => p.basis === 'NO_ANSWER' },
  { key: 'SKIP', label: 'Skipping', match: (p) => p.choice === 'SKIP' },
  { key: 'AWAY', label: "Said I'm away", match: (p) => p.choice === 'AWAY' },
  { key: 'ON_LEAVE', label: 'On leave', match: (p) => p.basis === 'ON_LEAVE' },
];

/** Drill-down groups, in the order the owner needs them. People keep the server's room order. */
export function peopleGroups(people: SpecialCountPerson[]) {
  return GROUPS.map((g) => ({ key: g.key, label: g.label, people: people.filter(g.match) })).filter((g) => g.people.length > 0);
}
```

Add to `foodService` in `features/food/api/index.ts`, following `getMealForecast`'s style:

```ts
  listSpecialMeals: async (hostelId: string) => {
    const response = await api.get(`/hostels/${hostelId}/meals/special`);
    return (unwrap(response).occasions ?? []) as SpecialOccasion[];
  },
  createSpecialMeal: async (hostelId: string, body: { weekday: number; mealType: string; vegDish?: string | null; nonVegDish?: string | null; cutoffMinutesBefore?: number }) => {
    const response = await api.post(`/hostels/${hostelId}/meals/special`, body);
    return unwrap(response).occasion as SpecialOccasion;
  },
  updateSpecialMeal: async (hostelId: string, occasionId: string, body: Partial<Pick<SpecialOccasion, 'vegDish' | 'nonVegDish' | 'cutoffMinutesBefore' | 'noAnswerPolicy' | 'isActive'>>) => {
    const response = await api.patch(`/hostels/${hostelId}/meals/special/${occasionId}`, body);
    return unwrap(response).occasion as SpecialOccasion;
  },
  getSpecialMealCount: async (hostelId: string, occasionId: string, date?: string) => {
    const response = await api.get(`/hostels/${hostelId}/meals/special/${occasionId}/count`, { params: date ? { date } : undefined });
    const { success: _success, ...rest } = (response.data ?? {}) as any;
    return rest as SpecialCount;
  },
  setSpecialMealAnswer: async (hostelId: string, occasionId: string, body: { tenantId: string; serveDate: string; choice: MealChoice | null }) => {
    await api.put(`/hostels/${hostelId}/meals/special/${occasionId}/answers`, body);
  },
```

with `import type { MealChoice, SpecialCount, SpecialOccasion } from '@features/owner-food/specialMeals';` at the top. If `features/food` importing from `owner-food` breaks the architecture check, move the four types into `features/food/specialMealTypes.ts` and re-export them from `specialMeals.ts`.

In `lib/queryKeys.ts`, inside `meals: { … }`, add:

```ts
    special: {
      occasions: (hostelId: string | null | undefined) => hostelKey(hostelId, 'meals', 'special'),
      count: (hostelId: string | null | undefined, occasionId: string, date?: string) =>
        hostelKey(hostelId, 'meals', 'special', occasionId, 'count', date ?? 'next'),
    },
```

```ts
// apps/frontend/src/features/owner-food/hooks/useSpecialMeals.ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { foodService } from '@features/food/api';
import type { MealChoice } from '../specialMeals';

export function useSpecialMeals(hostelId: string | null | undefined) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.meals.special.occasions(hostelId),
    queryFn: () => foodService.listSpecialMeals(hostelId as string),
    enabled: Boolean(hostelId),
  });
  const invalidate = () => qc.invalidateQueries({ queryKey: queryKeys.meals.special.occasions(hostelId) });
  const create = useMutation({ mutationFn: (body: Parameters<typeof foodService.createSpecialMeal>[1]) => foodService.createSpecialMeal(hostelId as string, body), onSuccess: invalidate });
  const update = useMutation({
    mutationFn: ({ occasionId, body }: { occasionId: string; body: Parameters<typeof foodService.updateSpecialMeal>[2] }) =>
      foodService.updateSpecialMeal(hostelId as string, occasionId, body),
    onSuccess: () => {
      invalidate();
      // Policy changes move the cook numbers.
      qc.invalidateQueries({ queryKey: ['hostel', hostelId, 'meals', 'special'] });
    },
  });
  return { occasions: query.data ?? [], isLoading: query.isLoading, create: create.mutateAsync, update: update.mutateAsync };
}

export function useSpecialMealCount(hostelId: string | null | undefined, occasionId: string | null | undefined, date?: string) {
  const qc = useQueryClient();
  const key = queryKeys.meals.special.count(hostelId, occasionId ?? '', date);
  const query = useQuery({
    queryKey: key,
    queryFn: () => foodService.getSpecialMealCount(hostelId as string, occasionId as string, date),
    enabled: Boolean(hostelId && occasionId),
    staleTime: 30_000,
  });
  const mutation = useMutation({
    mutationFn: (body: { tenantId: string; serveDate: string; choice: MealChoice | null }) =>
      foodService.setSpecialMealAnswer(hostelId as string, occasionId as string, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  return { data: query.data, isLoading: query.isLoading, setAnswer: mutation.mutateAsync, isSaving: mutation.isPending };
}
```

- [ ] **Step 4: Run the test and the checks**

Run: `npx vitest run src/features/owner-food/specialMeals.test.ts && npm run check:architecture`
Expected: test passes, and the architecture check passes.

- [ ] **Step 5: Commit**

```bash
git add src/features/food/api/index.ts src/lib/queryKeys.ts src/features/owner-food/specialMeals.ts src/features/owner-food/specialMeals.test.ts src/features/owner-food/hooks/useSpecialMeals.ts
git commit -m "feat(meals): special-meal API wrapper, keys, display model and hooks"
```

---

### Task 9: Owner screen, entry link, kitchen-sheet line

**Files:**
- Create: `apps/frontend/src/features/owner-food/pages/SpecialMealsPage.tsx`, `apps/frontend/src/features/owner-food/components/SpecialMealKitchenLine.tsx`
- Modify: `apps/frontend/src/platforms/owner/router/OwnerRoutes.tsx` (lazy import + `<Route path="/owner/food/special-meals" …>` next to `/owner/food/polls`), `features/owner-food/pages/FoodPage.tsx` (a second round link beside the polls `<Link>`, around line 61), `features/owner-food/pages/KitchenSheetPage.tsx` (render the line above the served-meals list, around line 133)

**Interfaces:**
- Consumes: Task 8's hooks and model.

The page has one job ("how much do I cook?"), and decision logic stays in `specialMeals.ts`. Match `FoodPollsPage`'s layout classes (back chevron to `/owner/food?hostelId=…`, `HostelSwitcher` hidden at `lg+`). Hostel on `?hostelId=`, falling back to `session.primaryHostelId`.

- [ ] **Step 1: Build the page**

```tsx
// apps/frontend/src/features/owner-food/pages/SpecialMealsPage.tsx
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ChevronLeft, Plus } from 'lucide-react';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { useIsDesktop } from '@/app/components/ui/use-desktop';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { parseApiError } from '@lib/errors';
import { HostelSwitcher } from '../components/HostelSwitcher';
import { useSpecialMealCount, useSpecialMeals } from '../hooks/useSpecialMeals';
import {
  absentLine, breakdownLine, choiceLabel, cookLine, CUTOFF_OPTIONS, lockLine, occasionTitle, peopleGroups, WEEKDAYS,
  type MealChoice, type SpecialCountPerson, type SpecialOccasion,
} from '../specialMeals';

/**
 * Special meals (spec 2026-10-10, Phase 1). Route `/owner/food/special-meals`,
 * hostel on `?hostelId=`. Answers one question: how many veg and non-veg to cook
 * for the next special meal, and who is behind each number.
 */
export function SpecialMealsPage() {
  const session = useOwnerSession();
  const isDesktop = useIsDesktop();
  const [params, setParams] = useSearchParams();
  const hostelId = params.get('hostelId') ?? session.primaryHostelId ?? undefined;
  const meals = useSpecialMeals(hostelId);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const active = meals.occasions.find((o) => o.id === selectedId) ?? meals.occasions[0] ?? null;

  return (
    <div className="flex flex-col gap-3.5 px-4 pb-8 pt-6 sm:px-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <Link to={hostelId ? `/owner/food?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food'} className="flex h-8 w-8 flex-none items-center justify-center rounded-lg text-muted-foreground hover:bg-muted">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">Special meals</h1>
            <p className="text-[12.5px] font-medium text-muted-foreground">Veg and non-veg counts, collected on WhatsApp</p>
          </div>
        </div>
        {!isDesktop && <HostelSwitcher hostels={session.hostels} selectedId={hostelId} onSelect={(id) => setParams({ hostelId: id }, { replace: true })} />}
      </div>

      {meals.occasions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {meals.occasions.map((o) => (
            <button key={o.id} onClick={() => setSelectedId(o.id)}
              className={`rounded-full px-3 py-1.5 text-[13px] font-semibold ${active?.id === o.id ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'}`}>
              {occasionTitle(o)}{o.isActive ? '' : ' · paused'}
            </button>
          ))}
          <button onClick={() => setAdding(true)} className="flex items-center gap-1 rounded-full bg-muted px-3 py-1.5 text-[13px] font-semibold">
            <Plus className="h-4 w-4" /> Add
          </button>
        </div>
      )}

      {(adding || (!meals.isLoading && meals.occasions.length === 0)) && hostelId && (
        <AddOccasionForm
          onCancel={meals.occasions.length > 0 ? () => setAdding(false) : undefined}
          onSave={async (body) => {
            try {
              const created = await meals.create(body);
              setSelectedId(created.id);
              setAdding(false);
              stayoToast.success(`${occasionTitle(created)} added · residents are asked the evening before`);
            } catch (e) {
              stayoToast.error(parseApiError(e) || 'Could not add that special meal.');
            }
          }}
        />
      )}

      {active && hostelId && <OccasionCount hostelId={hostelId} occasion={active} onUpdate={(body) => meals.update({ occasionId: active.id, body })} />}
    </div>
  );
}

/** Mirrors the backend's DEFAULT_MEAL_TIMINGS starts. Audit §7: no hostel has set its own timings yet. */
const DEFAULT_START: Record<string, string> = { BREAKFAST: '7:00 AM', LUNCH: '12:30 PM', SNACKS: '5:00 PM', DINNER: '7:00 PM' };

function AddOccasionForm({ onSave, onCancel }: { onSave: (b: { weekday: number; mealType: string; vegDish: string | null; nonVegDish: string | null; cutoffMinutesBefore: number }) => void; onCancel?: () => void }) {
  const [weekday, setWeekday] = useState(0);
  const [mealType, setMealType] = useState('LUNCH');
  const [vegDish, setVegDish] = useState('');
  const [nonVegDish, setNonVegDish] = useState('');
  const [cutoff, setCutoff] = useState(180);
  const field = 'w-full rounded-lg border border-border bg-background px-3 py-2 text-[14px]';
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border p-4">
      <p className="text-[14px] font-bold">Add a special meal</p>
      <div className="grid grid-cols-2 gap-2">
        <select className={field} value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
          {WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
        </select>
        <select className={field} value={mealType} onChange={(e) => setMealType(e.target.value)}>
          {['BREAKFAST', 'LUNCH', 'SNACKS', 'DINNER'].map((m) => <option key={m} value={m}>{m[0] + m.slice(1).toLowerCase()}</option>)}
        </select>
      </div>
      <input className={field} placeholder="Non-veg dish (optional), e.g. Chicken Biryani" maxLength={60} value={nonVegDish} onChange={(e) => setNonVegDish(e.target.value)} />
      <input className={field} placeholder="Veg dish (optional), e.g. Veg Biryani" maxLength={60} value={vegDish} onChange={(e) => setVegDish(e.target.value)} />
      <p className="text-[12.5px] text-muted-foreground">
        Counted from the hostel's {mealType.toLowerCase()} time in Meal Plan (default {DEFAULT_START[mealType]} if never set).
      </p>
      <label className="text-[12.5px] font-medium text-muted-foreground">
        Answers close
        <select className={`${field} mt-1`} value={cutoff} onChange={(e) => setCutoff(Number(e.target.value))}>
          {CUTOFF_OPTIONS.map((o) => <option key={o.minutes} value={o.minutes}>{o.label} the meal starts</option>)}
        </select>
      </label>
      <div className="flex gap-2">
        <button className="flex-1 rounded-xl bg-primary py-2.5 text-[14px] font-bold text-primary-foreground"
          onClick={() => onSave({ weekday, mealType, vegDish: vegDish.trim() || null, nonVegDish: nonVegDish.trim() || null, cutoffMinutesBefore: cutoff })}>
          Save
        </button>
        {onCancel && <button className="rounded-xl bg-muted px-4 text-[14px] font-semibold" onClick={onCancel}>Cancel</button>}
      </div>
    </div>
  );
}

function OccasionCount({ hostelId, occasion, onUpdate }: { hostelId: string; occasion: SpecialOccasion; onUpdate: (b: Partial<SpecialOccasion>) => Promise<unknown> }) {
  const { data, isLoading, setAnswer, isSaving } = useSpecialMealCount(hostelId, occasion.id);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<SpecialCountPerson | null>(null);
  if (isLoading || !data) return <p className="text-[13px] text-muted-foreground">Loading…</p>;
  const c = data.count;
  const day = new Date(`${data.serveDate}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'UTC' });

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-2xl border border-border p-4">
        <p className="text-[13px] font-semibold text-muted-foreground">{day} · {lockLine(data.cutoffAt, data.isOpen)}</p>
        <div className="mt-2 flex gap-6">
          {cookLine(c).map((n) => (
            <div key={n.label}>
              <p className="font-display text-[34px] font-extrabold leading-none">{n.value}</p>
              <p className="text-[13px] font-semibold">{n.label}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[12.5px] text-muted-foreground">{breakdownLine(c, occasion.noAnswerPolicy)}</p>
        <p className="text-[12.5px] text-muted-foreground">{absentLine(c)}</p>
      </div>

      {peopleGroups(c.people).map((g) => (
        <div key={g.key} className="rounded-xl border border-border">
          <button className="flex w-full items-center justify-between px-4 py-3 text-[14px] font-semibold" onClick={() => setOpen(open === g.key ? null : g.key)}>
            <span>{g.label}</span><span>{g.people.length}</span>
          </button>
          {open === g.key && (
            <ul className="divide-y divide-border border-t border-border">
              {g.people.map((p) => (
                <li key={p.tenantId}>
                  <button disabled={p.basis === 'ON_LEAVE'} onClick={() => setEditing(p)} className="flex w-full items-center justify-between px-4 py-2.5 text-left text-[13.5px] disabled:opacity-60">
                    <span>{p.name} <span className="text-muted-foreground">· Room {p.roomNo}</span></span>
                    <span className="text-muted-foreground">{p.basis === 'LAST_CHOICE' ? 'last time' : p.source === 'OWNER' ? 'edited' : ''}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {editing && (
        <div className="rounded-2xl border border-primary p-4">
          <p className="text-[14px] font-bold">{editing.name} · Room {editing.roomNo}</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(['NON_VEG', 'VEG', 'AWAY', 'SKIP'] as MealChoice[]).map((choice) => (
              <button key={choice} disabled={isSaving} className="rounded-xl bg-muted py-2 text-[13.5px] font-semibold"
                onClick={async () => { await setAnswer({ tenantId: editing.tenantId, serveDate: data.serveDate, choice }); setEditing(null); }}>
                {choiceLabel(choice)}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button className="flex-1 rounded-xl py-2 text-[13px] text-muted-foreground" onClick={async () => { await setAnswer({ tenantId: editing.tenantId, serveDate: data.serveDate, choice: null }); setEditing(null); }}>Clear answer</button>
            <button className="flex-1 rounded-xl py-2 text-[13px]" onClick={() => setEditing(null)}>Cancel</button>
          </div>
        </div>
      )}

      <details className="rounded-xl border border-border px-4 py-3 text-[13.5px]">
        <summary className="font-semibold">Settings</summary>
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex items-center justify-between gap-2">
            Silent residents
            <select value={occasion.noAnswerPolicy} onChange={(e) => onUpdate({ noAnswerPolicy: e.target.value as SpecialOccasion['noAnswerPolicy'] })} className="rounded-lg border border-border bg-background px-2 py-1">
              <option value="LAST_CHOICE">Cook their last choice</option>
              <option value="LEAVE_OUT">Don't cook for them</option>
            </select>
          </label>
          <button className="self-start text-[13px] font-semibold text-primary" onClick={() => onUpdate({ isActive: !occasion.isActive })}>
            {occasion.isActive ? 'Pause this special meal' : 'Resume this special meal'}
          </button>
        </div>
      </details>
    </div>
  );
}
```

```tsx
// apps/frontend/src/features/owner-food/components/SpecialMealKitchenLine.tsx
import { useSpecialMealCount } from '../hooks/useSpecialMeals';
import { cookLine, occasionTitle, type SpecialOccasion } from '../specialMeals';

/** One line on the kitchen sheet for a special meal served today or tomorrow. */
export function SpecialMealKitchenLine({ hostelId, occasion }: { hostelId: string; occasion: SpecialOccasion }) {
  const { data } = useSpecialMealCount(hostelId, occasion.id);
  if (!data) return null;
  const [nonVeg, veg] = cookLine(data.count);
  return (
    <p className="rounded-xl bg-muted px-4 py-3 text-[15px] font-bold">
      {occasionTitle(occasion)} special: {nonVeg.value} non-veg · {veg.value} veg
    </p>
  );
}
```

In `KitchenSheetPage.tsx`, add `const special = useSpecialMeals(hostelId ?? undefined);` next to the other hooks. Compute the IST today/tomorrow strings with `new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now)` (YYYY-MM-DD) and the same for `now + 86_400_000`. Then render, just before `<div className="flex flex-col divide-y …">`:

```tsx
      {hostelId && special.occasions
        .filter((o) => o.isActive && (o.nextServeDate === todayIst || o.nextServeDate === tomorrowIst))
        .map((o) => <SpecialMealKitchenLine key={o.id} hostelId={hostelId} occasion={o} />)}
```

In `FoodPage.tsx`, add beside the polls link (with `UtensilsCrossed` from lucide-react):

```tsx
          <Link
            to={hostelId ? `/owner/food/special-meals?hostelId=${encodeURIComponent(hostelId)}` : '/owner/food/special-meals'}
            aria-label="Special meals"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-foreground"
          >
            <UtensilsCrossed className="h-6 w-6" />
          </Link>
```

In `OwnerRoutes.tsx`:

```tsx
const SpecialMealsPage = lazy(() => import('@features/owner-food/pages/SpecialMealsPage').then((m) => ({ default: m.SpecialMealsPage })));
// …
        <Route path="/owner/food/special-meals" element={<SpecialMealsPage />} />
```

- [ ] **Step 2: Typecheck, build, and the full frontend suite**

Run: `npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "SpecialMeal|specialMeals|KitchenSheetPage|FoodPage|OwnerRoutes" || echo "clean"; npm test; npm run build`
Expected: `clean`, all tests pass, and the build succeeds (it also runs `check:architecture`). `vite build` does not typecheck; the `tsc` line is the real gate.

- [ ] **Step 3: Commit**

```bash
git add src/features/owner-food/pages/SpecialMealsPage.tsx src/features/owner-food/components/SpecialMealKitchenLine.tsx src/features/owner-food/pages/KitchenSheetPage.tsx src/features/owner-food/pages/FoodPage.tsx src/platforms/owner/router/OwnerRoutes.tsx
git commit -m "feat(meals): special-meals owner screen and kitchen-sheet line"
```

---

### Task 10: Documentation, ADR, template submission brief

**Files:**
- Modify: `docs/obsidian/Food.md` (replace the "Proposed" section with a built section), `Features.md`, `APIs.md` (4 owner routes + 2 crons), `Database.md` (2 tables, migration 096 **not applied**), `Business-Rules.md` (the Global Constraints rules), `Decisions.md` (new ADR), `Changelog.md`, `TODO.md`
- Modify: `docs/superpowers/specs/2026-10-10-special-meal-choices-design.md` (status line, plus "Built differently" notes)
- Create: `docs/marketing/whatsapp-templates/stayo_special_meal_question.md` (the exact submission text). If that directory doesn't exist, use `docs/design/` and say so in the commit.

- [ ] **Step 1: Claim the ADR number against origin/main**

Run: `git fetch origin && git show origin/main:docs/obsidian/Decisions.md | grep -oE '^#+ ADR-[0-9]+' | tail -1`
Use the next number. Re-check it at merge time ([[stayo-git-workflow]]).

- [ ] **Step 2: Write the ADR**

Title: "Special-meal choices collected on WhatsApp — a narrow exception to ADR-195 D1". Context: the warden's door-to-door round. Decision: the Global Constraints above, in prose. Explicitly:
- why this does not reverse ADR-195 D1 (two meals a week, the choice changes cost, and it replaces a round that already happens)
- "I'm away" never writes a leave
- the no-answer policy is labelled, never silent
- quick-reply payloads are per send

Consequences:
- nothing works until the template is approved and migration 096 is applied
- the count depends on leave reporting
- Phase 2 (standing orders, heads-up template, `MEALS` / `ASK ME`) is not built

- [ ] **Step 3: Record the spec's "built differently" notes**

Add under the spec header:
1. Option labels are fixed button texts ("Veg", "Non-veg", "I'm away"), because Meta locks button text at approval. The owner sets **dish names** shown in the body instead.
2. Dish names are typed per occasion rather than read from the Food schedule, because schedule dishes carry no veg/non-veg flag.
3. No-answer policy: `LAST_CHOICE` or `LEAVE_OUT`. The "hostel's usual split" option was dropped as it produces fractional people.
4. The "Welcome back" copy for returning residents is not in Phase 1. They get the ordinary question, because the template is fixed.
5. There is no manual "Remind the 4" button. The 08:00 reminder covers it.
6. There is no "skip this week" control. Pausing the occasion covers it.
7. The served-count per option (Phase 3) is not built.

- [ ] **Step 4: Write the template submission brief**

The doc holds:
- name `stayo_special_meal_question`
- category UTILITY, language `en`
- the exact body from Task 3
- footer `Stayo Property Management` (matches `STAY_GUARDIAN_FOOTER`)
- three quick-reply buttons, `Veg` / `Non-veg` / `I'm away`, in that order
- one sample value per variable: `Rahul` / `Sunday lunch, 11 Oct` / `Chicken Biryani or Veg Biryani` / `9:30 AM`

It must also note that the code sends per-send payloads, so the buttons must be **quick replies** (not URL / call buttons).

- [ ] **Step 5: Commit**

```bash
git add docs/
git commit -m "docs(meals): special-meal choices Phase 1 — ADR, vault, template brief"
```

---

## Before merging (not tasks; all need the user)

1. Run the audit's §6 one-paste SQL and record the answers in the audit. If phones are rare, the warden-entry screen is the primary path. Say so in the vault.
2. Submit `stayo_special_meal_question` to Meta. Nothing sends until it is approved.
3. Apply `migrations/096_special_meals.sql` to production **after** the code deploys (deploy-before-migrate holds trivially here: no existing model changed).
4. A real test before announcing it: one occasion on a hostel with one consenting phone. Tap each button, type "veg", tap after the cutoff, and check the owner screen.
