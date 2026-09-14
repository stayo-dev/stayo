# Stay Status Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (the user prefers inline execution) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A live stay engine. Tenants say "I'm back" or "Going home" in ≤2 seconds from a hostel QR or the app. Owners get answers ("31 here tonight", "Rahul is a day late", "Room 102 is empty tonight"), not database states.

**Architecture:**
- `stay_events` is an append-only event store and the permanent truth.
- `stay_leaves` is a projection maintained by one pure reducer (`applyStayEvent`), which both the write path and `replayStayEvents` use.
- Owner and tenant surfaces are read models over those two tables. Residents and vacancy come from the existing `roomCapacityService` predicate.

**Tech stack:**
- Backend: Next.js 14 App Router, Prisma (`prisma` typed `any`), Postgres (Supabase), vitest, `pdf-lib` + `qrcode`
- Frontend: Vite + React 19, TanStack Query, Tailwind, vitest (node env, pure `.ts` only)

**Spec:** `docs/superpowers/specs/2026-09-14-stay-status-design.md`. **Audit:** `docs/audits/stay-status-audit.md`.

## Global Constraints

- **`stay_events` is append-only.** No application code issues UPDATE or DELETE on it; a DB trigger rejects UPDATE.
- **New tables only.** Add no column to `tenants`, `hostels`, `rooms` or any existing model (the 2026-08-22 outage rule).
- **"Today" is always IST** via `istToday()` / `istDateOf()` in `apps/backend/lib/timezone.ts`. Never read `hostels.timezone`; it is `UTC` in production.
- **A resident** is an allocation matching `OCCUPYING_ALLOCATION_WHERE` (`is_active: true, end_date: null, tenant: { status: "ACTIVE" }`). There is no other definition.
- **Owner routes:** `resolveOwnerScope(session)`, then `assertHostelBelongsToOwner` / `requireHostelBelongsToOwner`. `hostelId` is always required, with no first-hostel fallback.
- **Screens reduce decisions.** At most one primary button per state, and everything else goes behind **More**. Owner copy answers questions ("here tonight", "back today", "late", "rooms to check"). The word "overdue" is reserved for rent.
- **Dates on the wire** are `YYYY-MM-DD` strings. Return date: ≥ tomorrow (IST) and ≤ today + `MAX_RETURN_DAYS` (90).
- **Sources:** `QR | APP | OWNER | WHATSAPP`. **Leave types:** `GOING_HOME | VACATION`.
- **Pure tests:** backend pure test files must be added to `apps/backend/vitest.pure.config.ts`'s `include` list or they never run. Frontend tests are `src/**/*.test.ts`, node env, and never render components.
- **Every commit** ends with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`. Work on branch `feat/stay-status` in worktree `.claude/worktrees/stay-status`, and never push to `main`.

## File map

**Backend** (`apps/backend`):

| File | Responsibility |
|---|---|
| `lib/timezone.ts` (modify) | + `istDateOf`, `istToday`, `addDaysIso`, `daysBetweenIso`, `weekdayOfIso` |
| `src/services/settlements/payout-promise.ts` (modify) | re-export `istDateOf` from `lib/timezone` |
| `lib/services/room-capacity-service.ts` (modify) | + exported `OCCUPYING_ALLOCATION_WHERE`, used by both occupancy queries |
| `src/services/stay/stay-status.ts` | pure rules: status, date validation, smart default |
| `src/services/stay/stay-events.ts` | pure event types, reducer, replay |
| `src/services/stay/stay-board.ts` | pure owner read model + portfolio summary |
| `src/services/stay/stay-rows.ts` | pure row ↔ domain mappers |
| `src/services/stay/stay-errors.ts` | `StayError` + HTTP mapping |
| `src/services/stay/stay-service.ts` | I/O: `recordStayEvent`, `getMyStay`, `getHostelBoard`, `getPortfolioSummary` |
| `lib/pdf/stay-poster-pdf-lib.ts` | A4 QR poster |
| `prisma/schema.prisma` (modify) | + `stay_events`, `stay_leaves` models |
| `prisma/migrations/20260914100000_stay_status_events/migration.sql` | tables, indexes, append-only trigger, RLS |
| `app/api/tenant/stay/route.ts`, `app/api/tenant/stay/events/route.ts` | tenant |
| `app/api/hostels/[id]/stay/route.ts`, `…/stay/tenants/[tenantId]/events/route.ts`, `…/stay/poster/route.ts` | owner, per hostel |
| `app/api/owner/stay/summary/route.ts` | owner, portfolio |
| `scripts/architectural-invariants-check.ts` (modify) | scan the new folders |

**Frontend** (`apps/frontend/src`):

| File | Responsibility |
|---|---|
| `features/stay/types.ts` | wire types |
| `features/stay/api/index.ts` | endpoint wrappers |
| `features/stay/stayState.ts` (+ `.test.ts`) | pure screen and board models, copy |
| `features/stay/hooks/useMyStay.ts` | tenant query + mutation |
| `features/stay/components/StayActionPanel.tsx`, `ReturnDateSheet.tsx` | thin renderers |
| `platforms/tenant/pages/StayScanPage.tsx` | `/stay/:hostelId` |
| `features/owner-stay/hooks/useStay.ts` | owner queries + mutation |
| `features/owner-stay/components/TonightSection.tsx` | Home answers |
| `features/owner-stay/pages/StayBoardPage.tsx` | `/owner/stay` |
| modify: `lib/queryKeys.ts`, `platforms/tenant/router/TenantRoutes.tsx`, `platforms/tenant/pages/TenantHomePage.tsx`, `platforms/owner/router/OwnerRoutes.tsx`, `features/owner-dashboard/hooks/useOwnerDashboard.ts`, `features/owner-dashboard/components/OwnerHomeDashboard.tsx`, `features/owner-onboarding/pages/OwnerDashboardPreviewPage.tsx` | wiring |

---

### Task 0: Worktree environment and baseline

A fresh worktree has no `.env` files (gitignored) and no `apps/backend/node_modules`.

- [ ] **Step 1: Link env and dependencies**

```bash
cd /home/sp/Desktop/stayo/.claude/worktrees/stay-status
cp ../../../.env .env && cp ../../../.env.test .env.test
cp ../../../apps/frontend/.env apps/frontend/.env 2>/dev/null || true
[ -e apps/backend/node_modules ] || ln -s /home/sp/Desktop/stayo/apps/backend/node_modules apps/backend/node_modules
ls -la apps/frontend/node_modules | head -1   # committed symlink; must resolve
```

- [ ] **Step 2: Baseline the suites before touching anything**

```bash
cd apps/backend && npm run test:pure 2>&1 | tail -5
cd ../frontend && npm test 2>&1 | tail -5
cd ../backend && npm run check:invariants 2>&1 | tail -3
```

Record pass/fail counts in the progress ledger. Every later "no regressions" claim is measured against these numbers.

---

### Task 1: IST date helpers and the one resident predicate

**Files:**
- Modify: `apps/backend/lib/timezone.ts` (append)
- Modify: `apps/backend/src/services/settlements/payout-promise.ts:26-33`
- Modify: `apps/backend/lib/services/room-capacity-service.ts` (two `roomAllocation.findMany` `where` blocks, ~:51 and ~:112)
- Test: `apps/backend/tests/timezone-ist.test.ts` (new, pure)

**Interfaces produced:**
- `istDateOf(instant: Date | string): string`
- `istToday(now?: Date): string`
- `addDaysIso(iso: string, days: number): string`
- `daysBetweenIso(from: string, to: string): number`
- `weekdayOfIso(iso: string): number` (0 = Sunday)
- `OCCUPYING_ALLOCATION_WHERE`

- [ ] **Step 1: Write the failing test** `apps/backend/tests/timezone-ist.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { addDaysIso, daysBetweenIso, istDateOf, istToday, weekdayOfIso } from "@/lib/timezone";
import { istDateOf as payoutIstDateOf } from "@/src/services/settlements/payout-promise";

describe("IST calendar dates", () => {
  it("rolls over at IST midnight, not UTC midnight", () => {
    expect(istDateOf("2026-09-14T18:29:59.000Z")).toBe("2026-09-14");
    expect(istDateOf("2026-09-14T18:30:00.000Z")).toBe("2026-09-15");
    expect(istToday(new Date("2026-09-14T18:30:00.000Z"))).toBe("2026-09-15");
  });

  it("is the same function the payout promise has always used", () => {
    expect(payoutIstDateOf).toBe(istDateOf);
  });

  it("does calendar arithmetic across month and year ends", () => {
    expect(addDaysIso("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDaysIso("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetweenIso("2026-09-14", "2026-09-16")).toBe(2);
    expect(daysBetweenIso("2026-09-16", "2026-09-14")).toBe(-2);
  });

  it("knows the weekday of a date", () => {
    expect(weekdayOfIso("2026-09-14")).toBe(1); // Monday
    expect(weekdayOfIso("2026-09-20")).toBe(0); // Sunday
  });
});
```

Add `'tests/timezone-ist.test.ts',` to the `include` array in `apps/backend/vitest.pure.config.ts`.

- [ ] **Step 2: Run it and see it fail**

Run: `cd apps/backend && npx vitest run --config vitest.pure.config.ts tests/timezone-ist.test.ts`
Expected: FAIL — `istToday` / `addDaysIso` are not exported.

- [ ] **Step 3: Implement.** Append to `apps/backend/lib/timezone.ts`:

```ts
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The IST calendar date of an instant, as YYYY-MM-DD. */
export function istDateOf(instant: Date | string): string {
  const ms = new Date(instant).getTime();
  if (!Number.isFinite(ms)) throw new Error("istDateOf: invalid instant");
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * Today's IST calendar date. Stay Status's only "today" — it never reads
 * `hostels.timezone`, which defaults to `UTC` and is `UTC` in production.
 */
export function istToday(now: Date = new Date()): string {
  return istDateOf(now);
}

/** Whole-day arithmetic on YYYY-MM-DD, done in UTC so no DST can shift it. */
export function addDaysIso(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Days from `from` to `to` (YYYY-MM-DD); negative when `to` is earlier. */
export function daysBetweenIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOfIso(isoDate: string): number {
  return new Date(`${isoDate}T00:00:00.000Z`).getUTCDay();
}
```

In `payout-promise.ts`, delete the local `IST_OFFSET_MS` constant and the `istDateOf` function (lines 26-33) and put these at the top of the file's imports:

```ts
import { istDateOf } from "@/lib/timezone";
export { istDateOf };
```

In `room-capacity-service.ts`, add above `export class RoomCapacityService`:

```ts
/**
 * "This allocation occupies a bed" — the one predicate for who lives in a room.
 * Stay Status counts residents with exactly this, so its here-tonight + away
 * always equals `occupied` here. Change it here or nowhere.
 */
export const OCCUPYING_ALLOCATION_WHERE = {
  is_active: true,
  end_date: null,
  tenant: { status: "ACTIVE" },
};
```

Replace the `is_active: true, end_date: null, tenant: { status: "ACTIVE" },` lines in **both** `db.roomAllocation.findMany` calls with `...OCCUPYING_ALLOCATION_WHERE,`.

- [ ] **Step 4: Run the tests and see them pass**

```bash
npx vitest run --config vitest.pure.config.ts tests/timezone-ist.test.ts tests/owner-payout-promise.test.ts
npx vitest run tests/room-capacity-service.test.ts   # mock-based; must stay green unchanged
```

- [ ] **Step 5: Commit**

```bash
git add lib/timezone.ts src/services/settlements/payout-promise.ts lib/services/room-capacity-service.ts tests/timezone-ist.test.ts vitest.pure.config.ts
git commit -m "feat(stay): shared IST date helpers and one exported resident predicate"
```

---

### Task 2: Stay rules (pure)

**Files:**
- Create: `apps/backend/src/services/stay/stay-status.ts`
- Test: `apps/backend/tests/stay-status.test.ts` (add to the pure `include`)

**Interfaces produced:**
- `type StayStatus = "PRESENT" | "ON_LEAVE" | "RETURNING_TODAY" | "LATE"`
- `LEAVE_TYPES`, `type LeaveType`, `STAY_SOURCES`, `type StaySource`, `MAX_RETURN_DAYS`
- `deriveStayStatus(leave: { expectedReturnDate: string } | null, today: string): StayStatus`
- `isHereTonight(status: StayStatus): boolean`
- `validateReturnDate(date: unknown, today: string): ReturnDateProblem | null`
- `smartReturnDate(today: string): SuggestedReturn` where `SuggestedReturn = { date: string; label: "tomorrow" | "sunday" }`
- `isLeaveType(v: unknown): v is LeaveType`, `isStaySource(v: unknown): v is StaySource`

- [ ] **Step 1: Write the failing test** `apps/backend/tests/stay-status.test.ts`

```ts
import { describe, expect, it } from "vitest";
import {
  deriveStayStatus, isHereTonight, isLeaveType, isStaySource, smartReturnDate, validateReturnDate,
} from "@/src/services/stay/stay-status";

const TODAY = "2026-09-14"; // Monday

describe("deriveStayStatus", () => {
  it("treats silence as present", () => expect(deriveStayStatus(null, TODAY)).toBe("PRESENT"));
  it("is on leave before the return date", () =>
    expect(deriveStayStatus({ expectedReturnDate: "2026-09-15" }, TODAY)).toBe("ON_LEAVE"));
  it("is returning today on the return date", () =>
    expect(deriveStayStatus({ expectedReturnDate: TODAY }, TODAY)).toBe("RETURNING_TODAY"));
  it("is late once the return date has passed", () =>
    expect(deriveStayStatus({ expectedReturnDate: "2026-09-13" }, TODAY)).toBe("LATE"));
});

describe("isHereTonight", () => {
  it("counts present and due-back-today, not away or late", () => {
    expect(isHereTonight("PRESENT")).toBe(true);
    expect(isHereTonight("RETURNING_TODAY")).toBe(true);
    expect(isHereTonight("ON_LEAVE")).toBe(false);
    expect(isHereTonight("LATE")).toBe(false);
  });
});

describe("validateReturnDate", () => {
  it("accepts tomorrow through 90 days out", () => {
    expect(validateReturnDate("2026-09-15", TODAY)).toBeNull();
    expect(validateReturnDate("2026-12-13", TODAY)).toBeNull(); // +90
  });
  it("rejects today, the past and beyond 90 days", () => {
    expect(validateReturnDate(TODAY, TODAY)).toBe("TOO_SOON");
    expect(validateReturnDate("2026-09-01", TODAY)).toBe("TOO_SOON");
    expect(validateReturnDate("2026-12-14", TODAY)).toBe("TOO_FAR"); // +91
  });
  it("rejects anything that is not a real YYYY-MM-DD", () => {
    expect(validateReturnDate("2026-02-30", TODAY)).toBe("INVALID_DATE");
    expect(validateReturnDate("15-09-2026", TODAY)).toBe("INVALID_DATE");
    expect(validateReturnDate(20260915, TODAY)).toBe("INVALID_DATE");
    expect(validateReturnDate(null, TODAY)).toBe("INVALID_DATE");
  });
});

describe("smartReturnDate — the one date Going Home offers", () => {
  it.each([
    ["2026-09-14", "2026-09-15", "tomorrow"], // Mon
    ["2026-09-15", "2026-09-16", "tomorrow"], // Tue
    ["2026-09-16", "2026-09-17", "tomorrow"], // Wed
    ["2026-09-17", "2026-09-20", "sunday"],   // Thu → weekend trip
    ["2026-09-18", "2026-09-20", "sunday"],   // Fri → weekend trip
    ["2026-09-19", "2026-09-20", "tomorrow"], // Sat: Sunday *is* tomorrow
    ["2026-09-20", "2026-09-21", "tomorrow"], // Sun
  ])("on %s suggests %s (%s)", (today, date, label) => {
    expect(smartReturnDate(today)).toEqual({ date, label });
  });
});

describe("guards", () => {
  it("knows the leave types and sources", () => {
    expect(isLeaveType("GOING_HOME")).toBe(true);
    expect(isLeaveType("AWAY_TODAY")).toBe(false);
    expect(isStaySource("QR")).toBe(true);
    expect(isStaySource("SMS")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run --config vitest.pure.config.ts tests/stay-status.test.ts`
Expected: FAIL — the module is not found.

- [ ] **Step 3: Implement** `apps/backend/src/services/stay/stay-status.ts`

```ts
import { addDaysIso, daysBetweenIso, weekdayOfIso } from "@/lib/timezone";

/**
 * Stay Status rules — pure. Status is never stored: it is derived from the
 * tenant's active leave (or its absence) and IST today. Silence = Present.
 * See ADR-194 and docs/superpowers/specs/2026-09-14-stay-status-design.md.
 */

export const LEAVE_TYPES = ["GOING_HOME", "VACATION"] as const;
export type LeaveType = (typeof LEAVE_TYPES)[number];

export const STAY_SOURCES = ["QR", "APP", "OWNER", "WHATSAPP"] as const;
export type StaySource = (typeof STAY_SOURCES)[number];

export type StayStatus = "PRESENT" | "ON_LEAVE" | "RETURNING_TODAY" | "LATE";

/** Long enough for a semester break; short enough that a typo'd year is caught. */
export const MAX_RETURN_DAYS = 90;

export function deriveStayStatus(leave: { expectedReturnDate: string } | null, today: string): StayStatus {
  if (!leave) return "PRESENT";
  const days = daysBetweenIso(today, leave.expectedReturnDate);
  if (days === 0) return "RETURNING_TODAY";
  if (days < 0) return "LATE";
  return "ON_LEAVE";
}

/**
 * Sleeping here tonight. Due back today counts; late does not — they said
 * they would be back and are not, so the kitchen should not cook for them.
 */
export function isHereTonight(status: StayStatus): boolean {
  return status === "PRESENT" || status === "RETURNING_TODAY";
}

export type ReturnDateProblem = "INVALID_DATE" | "TOO_SOON" | "TOO_FAR";

export function validateReturnDate(date: unknown, today: string): ReturnDateProblem | null {
  if (typeof date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return "INVALID_DATE";
  if (Number.isNaN(Date.parse(`${date}T00:00:00.000Z`))) return "INVALID_DATE";
  if (addDaysIso(date, 0) !== date) return "INVALID_DATE"; // 2026-02-30 rolls to March
  const days = daysBetweenIso(today, date);
  if (days < 1) return "TOO_SOON";
  if (days > MAX_RETURN_DAYS) return "TOO_FAR";
  return null;
}

export interface SuggestedReturn {
  date: string;
  label: "tomorrow" | "sunday";
}

/**
 * The single date Going Home offers, so the common path is two taps.
 * Thursday and Friday → this Sunday (the weekend trip home); any other day →
 * tomorrow. Saturday's Sunday is tomorrow, and it says so.
 */
export function smartReturnDate(today: string): SuggestedReturn {
  const weekday = weekdayOfIso(today);
  if (weekday === 4 || weekday === 5) return { date: addDaysIso(today, 7 - weekday), label: "sunday" };
  return { date: addDaysIso(today, 1), label: "tomorrow" };
}

export function isLeaveType(value: unknown): value is LeaveType {
  return typeof value === "string" && (LEAVE_TYPES as readonly string[]).includes(value);
}

export function isStaySource(value: unknown): value is StaySource {
  return typeof value === "string" && (STAY_SOURCES as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Run the test and see it pass.** Same command. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/stay/stay-status.ts tests/stay-status.test.ts vitest.pure.config.ts
git commit -m "feat(stay): pure stay rules — derived status, return-date bounds, smart default"
```

---

### Task 3: The event reducer and replay (pure)

**Files:**
- Create: `apps/backend/src/services/stay/stay-events.ts`
- Test: `apps/backend/tests/stay-events.test.ts` (add to the pure `include`)

**Interfaces consumed:** Task 2's `validateReturnDate`, `isLeaveType`, `LeaveType`, `StaySource`.

**Interfaces produced:**
- `STAY_EVENT_TYPES`, `type StayEventType`, `type ActorRole = "TENANT" | "OWNER" | "SYSTEM"`
- `interface StayEvent { id; tenantId; hostelId; roomId: string | null; type; effectiveDate; occurredAt; leaveType: LeaveType | null; expectedReturnDate: string | null; source; actorProfileId: string | null; actorRole; idempotencyKey }`
- `interface LeaveState { id; tenantId; hostelId; leaveType; startDate; expectedReturnDate; status: "ACTIVE" | "RETURNED" | "CANCELLED"; returnedAt: string | null; lastEventId }`
- `type StayRejectReason = "NO_ACTIVE_LEAVE" | "ON_LEAVE" | "INVALID_LEAVE_TYPE" | "INVALID_DATE" | "TOO_SOON" | "TOO_FAR" | "UNKNOWN_TYPE"`
- `type ApplyResult = { kind: "record"; before: LeaveState | null; after: LeaveState | null } | { kind: "noop" } | { kind: "reject"; reason: StayRejectReason }`
- `applyStayEvent(active: LeaveState | null, event: StayEvent): ApplyResult`
- `replayStayEvents(events: StayEvent[]): LeaveState[]` (events in `seq` order)
- `isStayEventType(v: unknown): v is StayEventType`

**Semantics (the design deltas are deliberate and get written into the spec in Task 13):**

| Event | No active leave | Active leave |
|---|---|---|
| `LEAVE_STARTED` | validate → record a new ACTIVE leave (id = event id, start = effectiveDate) | **noop** (double tap, second device) |
| `RETURN_DATE_CHANGED` | reject `NO_ACTIVE_LEAVE` | validate; same date → noop; else record |
| `RETURNED` | **noop** (I'm Back twice is still back) | record: RETURNED, `returnedAt = occurredAt` |
| `LEAVE_CANCELLED` | reject `NO_ACTIVE_LEAVE` | record: CANCELLED |
| `PRESENCE_CONFIRMED` | record, projection unchanged | reject `ON_LEAVE` |

- [ ] **Step 1: Write the failing test** `apps/backend/tests/stay-events.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { applyStayEvent, replayStayEvents, type LeaveState, type StayEvent } from "@/src/services/stay/stay-events";

let n = 0;
function ev(partial: Partial<StayEvent> & Pick<StayEvent, "type">): StayEvent {
  n += 1;
  return {
    id: `e${n}`,
    tenantId: "t1",
    hostelId: "h1",
    roomId: "r1",
    effectiveDate: "2026-09-14",
    occurredAt: `2026-09-14T06:${String(n).padStart(2, "0")}:00.000Z`,
    leaveType: null,
    expectedReturnDate: null,
    source: "APP",
    actorProfileId: "p1",
    actorRole: "TENANT",
    idempotencyKey: `k${n}`,
    ...partial,
  };
}
const start = (p: Partial<StayEvent> = {}) =>
  ev({ type: "LEAVE_STARTED", leaveType: "GOING_HOME", expectedReturnDate: "2026-09-16", ...p });

function activeFrom(event: StayEvent): LeaveState {
  const r = applyStayEvent(null, event);
  if (r.kind !== "record" || !r.after) throw new Error("expected a leave");
  return r.after;
}

describe("applyStayEvent", () => {
  it("starts a leave whose id is the event id", () => {
    const e = start();
    expect(applyStayEvent(null, e)).toEqual({
      kind: "record",
      before: null,
      after: {
        id: e.id, tenantId: "t1", hostelId: "h1", leaveType: "GOING_HOME",
        startDate: "2026-09-14", expectedReturnDate: "2026-09-16",
        status: "ACTIVE", returnedAt: null, lastEventId: e.id,
      },
    });
  });

  it("treats a second Going Home as a no-op, not an error", () => {
    expect(applyStayEvent(activeFrom(start()), start())).toEqual({ kind: "noop" });
  });

  it("rejects a leave without a valid type or date", () => {
    expect(applyStayEvent(null, start({ leaveType: null }))).toEqual({ kind: "reject", reason: "INVALID_LEAVE_TYPE" });
    expect(applyStayEvent(null, start({ expectedReturnDate: "2026-09-14" }))).toEqual({ kind: "reject", reason: "TOO_SOON" });
    expect(applyStayEvent(null, start({ expectedReturnDate: null }))).toEqual({ kind: "reject", reason: "INVALID_DATE" });
  });

  it("changes the return date of an active leave, and no-ops on the same date", () => {
    const active = activeFrom(start());
    const change = ev({ type: "RETURN_DATE_CHANGED", expectedReturnDate: "2026-09-20" });
    const r = applyStayEvent(active, change);
    expect(r).toMatchObject({ kind: "record", after: { expectedReturnDate: "2026-09-20", lastEventId: change.id, status: "ACTIVE" } });
    expect(applyStayEvent(active, ev({ type: "RETURN_DATE_CHANGED", expectedReturnDate: "2026-09-16" }))).toEqual({ kind: "noop" });
    expect(applyStayEvent(null, change)).toEqual({ kind: "reject", reason: "NO_ACTIVE_LEAVE" });
  });

  it("closes a leave on RETURNED and no-ops when already back", () => {
    const active = activeFrom(start());
    const back = ev({ type: "RETURNED" });
    expect(applyStayEvent(active, back)).toMatchObject({
      kind: "record", after: { status: "RETURNED", returnedAt: back.occurredAt, lastEventId: back.id },
    });
    expect(applyStayEvent(null, ev({ type: "RETURNED" }))).toEqual({ kind: "noop" });
  });

  it("cancels only an active leave", () => {
    expect(applyStayEvent(activeFrom(start()), ev({ type: "LEAVE_CANCELLED" }))).toMatchObject({ kind: "record", after: { status: "CANCELLED" } });
    expect(applyStayEvent(null, ev({ type: "LEAVE_CANCELLED" }))).toEqual({ kind: "reject", reason: "NO_ACTIVE_LEAVE" });
  });

  it("records a presence confirmation without touching the projection", () => {
    expect(applyStayEvent(null, ev({ type: "PRESENCE_CONFIRMED" }))).toEqual({ kind: "record", before: null, after: null });
    expect(applyStayEvent(activeFrom(start()), ev({ type: "PRESENCE_CONFIRMED" }))).toEqual({ kind: "reject", reason: "ON_LEAVE" });
  });

  it("rejects an unknown type", () => {
    expect(applyStayEvent(null, ev({ type: "AWAY_TODAY" as any }))).toEqual({ kind: "reject", reason: "UNKNOWN_TYPE" });
  });
});

describe("replayStayEvents", () => {
  it("rebuilds each leave from the stream", () => {
    const s1 = start();
    const c1 = ev({ type: "RETURN_DATE_CHANGED", expectedReturnDate: "2026-09-18" });
    const b1 = ev({ type: "RETURNED" });
    const s2 = start({ expectedReturnDate: "2026-09-21" });
    const x2 = ev({ type: "LEAVE_CANCELLED" });
    const leaves = replayStayEvents([s1, c1, b1, s2, x2]);
    expect(leaves).toHaveLength(2);
    expect(leaves[0]).toMatchObject({ id: s1.id, status: "RETURNED", expectedReturnDate: "2026-09-18", lastEventId: b1.id });
    expect(leaves[1]).toMatchObject({ id: s2.id, status: "CANCELLED", lastEventId: x2.id });
  });

  it("skips events the reducer would not have recorded", () => {
    const s1 = start();
    const dup = start(); // noop
    const bad = ev({ type: "LEAVE_CANCELLED", tenantId: "t2" }); // reject
    expect(replayStayEvents([s1, dup, bad])).toEqual([activeFrom(s1)]);
  });

  it("keeps tenants independent", () => {
    const a = start({ tenantId: "tA" });
    const b = start({ tenantId: "tB" });
    const backA = ev({ type: "RETURNED", tenantId: "tA" });
    const leaves = replayStayEvents([a, b, backA]);
    expect(leaves.find((l) => l.tenantId === "tA")?.status).toBe("RETURNED");
    expect(leaves.find((l) => l.tenantId === "tB")?.status).toBe("ACTIVE");
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run --config vitest.pure.config.ts tests/stay-events.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `apps/backend/src/services/stay/stay-events.ts`

```ts
import { isLeaveType, validateReturnDate, type LeaveType, type StaySource } from "./stay-status";

/**
 * The Stay Status core (ADR-194). `stay_events` is the permanent truth; the
 * `stay_leaves` projection and every screen are derived from it. This reducer
 * is the only place stay semantics live — the write path and replay both call
 * it, so the projection can always be rebuilt and can never disagree.
 *
 * Future modules add event types and read models; they do not change this.
 */

export const STAY_EVENT_TYPES = [
  "LEAVE_STARTED",
  "RETURN_DATE_CHANGED",
  "RETURNED",
  "LEAVE_CANCELLED",
  "PRESENCE_CONFIRMED",
] as const;
export type StayEventType = (typeof STAY_EVENT_TYPES)[number];
export type ActorRole = "TENANT" | "OWNER" | "SYSTEM";

export interface StayEvent {
  id: string;
  tenantId: string;
  hostelId: string;
  /** The resident's room when the event happened — survives room transfers. */
  roomId: string | null;
  type: StayEventType;
  /** IST calendar date the event applies to. */
  effectiveDate: string;
  occurredAt: string;
  leaveType: LeaveType | null;
  expectedReturnDate: string | null;
  source: StaySource;
  actorProfileId: string | null;
  actorRole: ActorRole;
  idempotencyKey: string;
}

export interface LeaveState {
  /** = the id of the LEAVE_STARTED event that opened it. */
  id: string;
  tenantId: string;
  hostelId: string;
  leaveType: LeaveType;
  startDate: string;
  expectedReturnDate: string;
  status: "ACTIVE" | "RETURNED" | "CANCELLED";
  returnedAt: string | null;
  lastEventId: string;
}

export type StayRejectReason =
  | "NO_ACTIVE_LEAVE"
  | "ON_LEAVE"
  | "INVALID_LEAVE_TYPE"
  | "INVALID_DATE"
  | "TOO_SOON"
  | "TOO_FAR"
  | "UNKNOWN_TYPE";

export type ApplyResult =
  | { kind: "record"; before: LeaveState | null; after: LeaveState | null }
  | { kind: "noop" }
  | { kind: "reject"; reason: StayRejectReason };

export function isStayEventType(value: unknown): value is StayEventType {
  return typeof value === "string" && (STAY_EVENT_TYPES as readonly string[]).includes(value);
}

export function applyStayEvent(active: LeaveState | null, event: StayEvent): ApplyResult {
  switch (event.type) {
    case "LEAVE_STARTED": {
      if (active) return { kind: "noop" };
      if (!isLeaveType(event.leaveType)) return { kind: "reject", reason: "INVALID_LEAVE_TYPE" };
      const problem = validateReturnDate(event.expectedReturnDate, event.effectiveDate);
      if (problem) return { kind: "reject", reason: problem };
      return {
        kind: "record",
        before: null,
        after: {
          id: event.id,
          tenantId: event.tenantId,
          hostelId: event.hostelId,
          leaveType: event.leaveType,
          startDate: event.effectiveDate,
          expectedReturnDate: event.expectedReturnDate as string,
          status: "ACTIVE",
          returnedAt: null,
          lastEventId: event.id,
        },
      };
    }
    case "RETURN_DATE_CHANGED": {
      if (!active) return { kind: "reject", reason: "NO_ACTIVE_LEAVE" };
      const problem = validateReturnDate(event.expectedReturnDate, event.effectiveDate);
      if (problem) return { kind: "reject", reason: problem };
      if (event.expectedReturnDate === active.expectedReturnDate) return { kind: "noop" };
      return {
        kind: "record",
        before: active,
        after: { ...active, expectedReturnDate: event.expectedReturnDate as string, lastEventId: event.id },
      };
    }
    case "RETURNED": {
      if (!active) return { kind: "noop" };
      return {
        kind: "record",
        before: active,
        after: { ...active, status: "RETURNED", returnedAt: event.occurredAt, lastEventId: event.id },
      };
    }
    case "LEAVE_CANCELLED": {
      if (!active) return { kind: "reject", reason: "NO_ACTIVE_LEAVE" };
      return { kind: "record", before: active, after: { ...active, status: "CANCELLED", lastEventId: event.id } };
    }
    case "PRESENCE_CONFIRMED": {
      if (active) return { kind: "reject", reason: "ON_LEAVE" };
      return { kind: "record", before: null, after: null };
    }
    default:
      return { kind: "reject", reason: "UNKNOWN_TYPE" };
  }
}

/** Every leave, rebuilt from the stream. `events` must be in `seq` order. */
export function replayStayEvents(events: StayEvent[]): LeaveState[] {
  const activeByTenant = new Map<string, LeaveState>();
  const leavesById = new Map<string, LeaveState>();
  for (const event of events) {
    const result = applyStayEvent(activeByTenant.get(event.tenantId) ?? null, event);
    if (result.kind !== "record" || !result.after) continue;
    leavesById.set(result.after.id, result.after);
    if (result.after.status === "ACTIVE") activeByTenant.set(event.tenantId, result.after);
    else activeByTenant.delete(event.tenantId);
  }
  return [...leavesById.values()];
}
```

- [ ] **Step 4: Run the test and see it pass.** Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/stay/stay-events.ts tests/stay-events.test.ts vitest.pure.config.ts
git commit -m "feat(stay): event reducer and replay — one semantics for writes and rebuilds"
```

---

### Task 4: The owner's answers (pure read model)

**Files:**
- Create: `apps/backend/src/services/stay/stay-board.ts`
- Test: `apps/backend/tests/stay-board.test.ts` (add to the pure `include`)

**Interfaces consumed:** Task 2's `deriveStayStatus`, `isHereTonight`, `LeaveType`; Task 1's `daysBetweenIso`.

**Interfaces produced:**

```ts
interface BoardResident { tenantId: string; name: string; roomId: string; roomNo: string }
interface BoardLeave { tenantId: string; leaveType: LeaveType; expectedReturnDate: string }
interface BoardRoom { roomId: string; capacity: number; occupied: number; available: number }
interface BoardPerson { tenantId: string; name: string; roomNo: string }
interface StayBoard {
  today: string;
  residents: number; hereTonight: number; away: number; late: number;
  beds: { capacity: number; occupied: number; free: number };
  meals: { expected: number; lateMayTurnUp: number };
  backToday: Array<BoardPerson & { arrived: boolean }>;
  lateList: Array<BoardPerson & { expectedReturnDate: string; daysLate: number }>;
  awayList: Array<BoardPerson & { leaveType: LeaveType; expectedReturnDate: string }>;
  roomsToCheck: Array<{ roomId: string; roomNo: string; reason: "EMPTY_TONIGHT" | "BACK_TODAY"; names: string[] }>;
  here: BoardPerson[];
}
buildStayBoard(input: { residents: BoardResident[]; activeLeaves: BoardLeave[]; returnedTodayTenantIds: string[]; rooms: BoardRoom[]; today: string }): StayBoard
interface StayHostelSummary { hostelId: string; hostelName: string; residents: number; hereTonight: number; backToday: number; late: number; roomsToCheck: number; mealsExpected: number }
summarizeHostel(hostelId: string, hostelName: string, board: StayBoard): StayHostelSummary
summarizePortfolio(hostels: StayHostelSummary[]): { totals: Omit<StayHostelSummary, "hostelId" | "hostelName">; hostels: StayHostelSummary[] }
```

- [ ] **Step 1: Write the failing test** `apps/backend/tests/stay-board.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { buildStayBoard, summarizeHostel, summarizePortfolio, type BoardResident } from "@/src/services/stay/stay-board";

const TODAY = "2026-09-14";
const R = (tenantId: string, roomNo: string, name = tenantId): BoardResident => ({ tenantId, name, roomId: `room-${roomNo}`, roomNo });

// 101: A here, B away           → not empty
// 102: C away, D late (2 days)  → EMPTY_TONIGHT
// 103: E due back today         → BACK_TODAY
// 104: F here, tapped I'm Back today
const residents = [R("A", "101"), R("B", "101"), R("C", "102"), R("D", "102"), R("E", "103"), R("F", "104")];
const activeLeaves = [
  { tenantId: "B", leaveType: "GOING_HOME" as const, expectedReturnDate: "2026-09-16" },
  { tenantId: "C", leaveType: "VACATION" as const, expectedReturnDate: "2026-09-30" },
  { tenantId: "D", leaveType: "GOING_HOME" as const, expectedReturnDate: "2026-09-12" },
  { tenantId: "E", leaveType: "GOING_HOME" as const, expectedReturnDate: TODAY },
];
const rooms = [
  { roomId: "room-101", capacity: 3, occupied: 2, available: 1 },
  { roomId: "room-102", capacity: 2, occupied: 2, available: 0 },
  { roomId: "room-103", capacity: 2, occupied: 1, available: 1 },
  { roomId: "room-104", capacity: 1, occupied: 1, available: 0 },
];
const board = buildStayBoard({ residents, activeLeaves, returnedTodayTenantIds: ["F"], rooms, today: TODAY });

describe("buildStayBoard answers the owner's questions", () => {
  it("how many here tonight — present plus due back today", () => {
    expect(board.hereTonight).toBe(3); // A, E, F
    expect(board.here.map((p) => p.tenantId)).toEqual(["A", "E", "F"]);
  });

  it("holds here + away = residents = occupied beds", () => {
    expect(board.hereTonight + board.away).toBe(board.residents);
    expect(board.residents).toBe(board.beds.occupied);
  });

  it("how many meals — here tonight, with late tenants called out separately", () => {
    expect(board.meals).toEqual({ expected: 3, lateMayTurnUp: 1 });
  });

  it("who is back today — not yet arrived first, then arrived", () => {
    expect(board.backToday).toEqual([
      { tenantId: "E", name: "E", roomNo: "103", arrived: false },
      { tenantId: "F", name: "F", roomNo: "104", arrived: true },
    ]);
  });

  it("who is late — oldest first, with days late", () => {
    expect(board.lateList).toEqual([{ tenantId: "D", name: "D", roomNo: "102", expectedReturnDate: "2026-09-12", daysLate: 2 }]);
    expect(board.late).toBe(1);
  });

  it("who is away — soonest back first", () => {
    expect(board.awayList.map((p) => p.tenantId)).toEqual(["B", "C"]);
  });

  it("which rooms need attention", () => {
    expect(board.roomsToCheck).toEqual([
      { roomId: "room-102", roomNo: "102", reason: "EMPTY_TONIGHT", names: ["C", "D"] },
      { roomId: "room-103", roomNo: "103", reason: "BACK_TODAY", names: ["E"] },
    ]);
  });

  it("beds free comes from capacity, not from stay", () => {
    expect(board.beds).toEqual({ capacity: 8, occupied: 6, free: 2 });
  });

  it("the identity holds for every combination of statuses", () => {
    const dates = [null, "2026-09-12", TODAY, "2026-09-20"];
    for (const a of dates) for (const b of dates) {
      const leaves = [
        ...(a ? [{ tenantId: "X", leaveType: "GOING_HOME" as const, expectedReturnDate: a }] : []),
        ...(b ? [{ tenantId: "Y", leaveType: "VACATION" as const, expectedReturnDate: b }] : []),
      ];
      const bd = buildStayBoard({ residents: [R("X", "1"), R("Y", "1")], activeLeaves: leaves, returnedTodayTenantIds: [], rooms: [], today: TODAY });
      expect(bd.hereTonight + bd.away).toBe(2);
    }
  });
});

describe("portfolio summary", () => {
  it("adds hostels up", () => {
    const one = summarizeHostel("h1", "Sri Adithya", board);
    expect(one).toEqual({ hostelId: "h1", hostelName: "Sri Adithya", residents: 6, hereTonight: 3, backToday: 2, late: 1, roomsToCheck: 2, mealsExpected: 3 });
    const { totals, hostels } = summarizePortfolio([one, { ...one, hostelId: "h2" }]);
    expect(totals).toEqual({ residents: 12, hereTonight: 6, backToday: 4, late: 2, roomsToCheck: 4, mealsExpected: 6 });
    expect(hostels).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run --config vitest.pure.config.ts tests/stay-board.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `apps/backend/src/services/stay/stay-board.ts`

```ts
import { daysBetweenIso } from "@/lib/timezone";
import { deriveStayStatus, isHereTonight, type LeaveType, type StayStatus } from "./stay-status";

/**
 * The owner's Stay board — a read model over residents + active leaves.
 * Every field answers a question an owner asks ("how many for dinner?",
 * "who is late?", "which rooms need attention?"); none is a raw status.
 * Beds come from `roomCapacityService` (passed in as `rooms`), never recomputed.
 */

export interface BoardResident { tenantId: string; name: string; roomId: string; roomNo: string }
export interface BoardLeave { tenantId: string; leaveType: LeaveType; expectedReturnDate: string }
export interface BoardRoom { roomId: string; capacity: number; occupied: number; available: number }
export interface BoardPerson { tenantId: string; name: string; roomNo: string }

export interface StayBoard {
  today: string;
  residents: number;
  hereTonight: number;
  away: number;
  late: number;
  beds: { capacity: number; occupied: number; free: number };
  meals: { expected: number; lateMayTurnUp: number };
  backToday: Array<BoardPerson & { arrived: boolean }>;
  lateList: Array<BoardPerson & { expectedReturnDate: string; daysLate: number }>;
  awayList: Array<BoardPerson & { leaveType: LeaveType; expectedReturnDate: string }>;
  roomsToCheck: Array<{ roomId: string; roomNo: string; reason: "EMPTY_TONIGHT" | "BACK_TODAY"; names: string[] }>;
  here: BoardPerson[];
}

const byRoom = (a: BoardPerson, b: BoardPerson) =>
  a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }) || a.name.localeCompare(b.name);

export function buildStayBoard(input: {
  residents: BoardResident[];
  activeLeaves: BoardLeave[];
  returnedTodayTenantIds: string[];
  rooms: BoardRoom[];
  today: string;
}): StayBoard {
  const { today } = input;
  const leaveByTenant = new Map(input.activeLeaves.map((l) => [l.tenantId, l]));
  const returnedToday = new Set(input.returnedTodayTenantIds);
  const people = input.residents.map((r) => {
    const leave = leaveByTenant.get(r.tenantId) ?? null;
    return { r, leave, status: deriveStayStatus(leave, today) as StayStatus };
  });
  const person = (r: BoardResident): BoardPerson => ({ tenantId: r.tenantId, name: r.name, roomNo: r.roomNo });

  const here = people.filter((p) => isHereTonight(p.status)).map((p) => person(p.r)).sort(byRoom);
  const late = people.filter((p) => p.status === "LATE");
  const onLeave = people.filter((p) => p.status === "ON_LEAVE");

  const backToday = [
    ...people.filter((p) => p.status === "RETURNING_TODAY").map((p) => ({ ...person(p.r), arrived: false })).sort(byRoom),
    ...people
      .filter((p) => p.status === "PRESENT" && returnedToday.has(p.r.tenantId))
      .map((p) => ({ ...person(p.r), arrived: true }))
      .sort(byRoom),
  ];

  const lateList = late
    .map((p) => ({
      ...person(p.r),
      expectedReturnDate: p.leave!.expectedReturnDate,
      daysLate: daysBetweenIso(p.leave!.expectedReturnDate, today),
    }))
    .sort((a, b) => a.expectedReturnDate.localeCompare(b.expectedReturnDate) || byRoom(a, b));

  const awayList = onLeave
    .map((p) => ({ ...person(p.r), leaveType: p.leave!.leaveType, expectedReturnDate: p.leave!.expectedReturnDate }))
    .sort((a, b) => a.expectedReturnDate.localeCompare(b.expectedReturnDate) || byRoom(a, b));

  const byRoomId = new Map<string, typeof people>();
  for (const p of people) byRoomId.set(p.r.roomId, [...(byRoomId.get(p.r.roomId) ?? []), p]);
  const roomsToCheck: StayBoard["roomsToCheck"] = [];
  for (const [roomId, members] of byRoomId) {
    const roomNo = members[0].r.roomNo;
    const names = (list: typeof people) => list.map((p) => p.r.name).sort();
    if (members.every((p) => !isHereTonight(p.status))) {
      roomsToCheck.push({ roomId, roomNo, reason: "EMPTY_TONIGHT", names: names(members) });
    } else {
      const due = members.filter((p) => p.status === "RETURNING_TODAY");
      if (due.length > 0) roomsToCheck.push({ roomId, roomNo, reason: "BACK_TODAY", names: names(due) });
    }
  }
  roomsToCheck.sort((a, b) => a.roomNo.localeCompare(b.roomNo, undefined, { numeric: true }));

  const sum = (pick: (r: BoardRoom) => number) => input.rooms.reduce((total, r) => total + pick(r), 0);

  return {
    today,
    residents: people.length,
    hereTonight: here.length,
    away: late.length + onLeave.length,
    late: late.length,
    beds: { capacity: sum((r) => r.capacity), occupied: sum((r) => r.occupied), free: sum((r) => r.available) },
    meals: { expected: here.length, lateMayTurnUp: late.length },
    backToday,
    lateList,
    awayList,
    roomsToCheck,
    here,
  };
}

export interface StayHostelSummary {
  hostelId: string;
  hostelName: string;
  residents: number;
  hereTonight: number;
  backToday: number;
  late: number;
  roomsToCheck: number;
  mealsExpected: number;
}

export function summarizeHostel(hostelId: string, hostelName: string, board: StayBoard): StayHostelSummary {
  return {
    hostelId,
    hostelName,
    residents: board.residents,
    hereTonight: board.hereTonight,
    backToday: board.backToday.length,
    late: board.late,
    roomsToCheck: board.roomsToCheck.length,
    mealsExpected: board.meals.expected,
  };
}

export function summarizePortfolio(hostels: StayHostelSummary[]) {
  const add = (key: keyof Omit<StayHostelSummary, "hostelId" | "hostelName">) =>
    hostels.reduce((total, h) => total + h[key], 0);
  return {
    totals: {
      residents: add("residents"),
      hereTonight: add("hereTonight"),
      backToday: add("backToday"),
      late: add("late"),
      roomsToCheck: add("roomsToCheck"),
      mealsExpected: add("mealsExpected"),
    },
    hostels,
  };
}
```

- [ ] **Step 4: Run the test and see it pass.** Expected: PASS. Then run the whole pure suite, `npm run test:pure`, and compare against the Task 0 baseline.

- [ ] **Step 5: Commit**

```bash
git add src/services/stay/stay-board.ts tests/stay-board.test.ts vitest.pure.config.ts
git commit -m "feat(stay): owner board read model — answers, not states"
```

---

### Task 5: Event store schema (migration + Prisma models)

**Files:**
- Create: `apps/backend/prisma/migrations/20260914100000_stay_status_events/migration.sql`
- Modify: `apps/backend/prisma/schema.prisma` (append two models at the end)

**Interfaces produced:** Prisma delegates `prisma.stay_events` and `prisma.stay_leaves`. Column names are exactly as below; later tasks write them.

- [ ] **Step 1: Write the migration** `apps/backend/prisma/migrations/20260914100000_stay_status_events/migration.sql`

```sql
-- Stay Status (ADR-194): the event store and its one projection.
--
-- `stay_events` is the permanent truth — every stay update is appended here
-- and never edited. `stay_leaves` is a projection of it (who is on leave now),
-- rebuildable at any time by replaying events through the one reducer in
-- `src/services/stay/stay-events.ts`.
--
-- NEW tables only — no existing table or column changes, so no read of any
-- other model is affected by deploy/migrate order (see the 2026-08-22 outage).
-- The Stay routes read these tables: APPLY THIS BEFORE DEPLOYING that code.
--
-- Idempotent: safe to run twice.

CREATE TABLE IF NOT EXISTS "stay_events" (
  "id"                   UUID           NOT NULL DEFAULT gen_random_uuid(),
  -- Total order of the stream. Replay folds in `seq` order, never by time.
  "seq"                  BIGSERIAL      NOT NULL,
  "tenant_id"            UUID           NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "hostel_id"            UUID           NOT NULL REFERENCES "hostels"("id") ON DELETE CASCADE,
  -- The resident's room at the time, so housekeeping and trends survive transfers.
  "room_id"              UUID           REFERENCES "rooms"("id") ON DELETE SET NULL,
  "type"                 TEXT           NOT NULL,
  "effective_date"       DATE           NOT NULL,
  "occurred_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "leave_type"           TEXT,
  "expected_return_date" DATE,
  "source"               TEXT           NOT NULL,
  "actor_profile_id"     UUID,
  "actor_role"           TEXT           NOT NULL,
  "idempotency_key"      TEXT           NOT NULL,
  "schema_version"       INTEGER        NOT NULL DEFAULT 1,
  "payload"              JSONB          NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT "stay_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "stay_events_seq_key" ON "stay_events" ("seq");
CREATE UNIQUE INDEX IF NOT EXISTS "stay_events_idempotency_key_key" ON "stay_events" ("idempotency_key");
CREATE INDEX IF NOT EXISTS "stay_events_hostel_occurred_idx" ON "stay_events" ("hostel_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "stay_events_tenant_seq_idx" ON "stay_events" ("tenant_id", "seq");
CREATE INDEX IF NOT EXISTS "stay_events_hostel_date_type_idx" ON "stay_events" ("hostel_id", "effective_date", "type");

CREATE TABLE IF NOT EXISTS "stay_leaves" (
  -- = the id of the LEAVE_STARTED event that opened it.
  "id"                   UUID           NOT NULL,
  "tenant_id"            UUID           NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
  "hostel_id"            UUID           NOT NULL REFERENCES "hostels"("id") ON DELETE CASCADE,
  "leave_type"           TEXT           NOT NULL,
  "start_date"           DATE           NOT NULL,
  "expected_return_date" DATE           NOT NULL,
  "status"               TEXT           NOT NULL DEFAULT 'ACTIVE',
  "returned_at"          TIMESTAMPTZ(6),
  "last_event_id"        UUID           NOT NULL,
  "created_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"           TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "stay_leaves_pkey" PRIMARY KEY ("id")
);

-- One active leave per tenant: the concurrency guard behind a double tap.
CREATE UNIQUE INDEX IF NOT EXISTS "stay_leaves_one_active_per_tenant"
  ON "stay_leaves" ("tenant_id") WHERE "status" = 'ACTIVE';
CREATE INDEX IF NOT EXISTS "stay_leaves_hostel_status_return_idx"
  ON "stay_leaves" ("hostel_id", "status", "expected_return_date");

-- Append-only, enforced by the database. UPDATE is refused; DELETE is left to
-- the tenant/hostel ON DELETE CASCADE, so erasing a tenancy still works.
CREATE OR REPLACE FUNCTION "stay_events_refuse_update"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'stay_events is append-only (ADR-194)';
END;
$$;
DROP TRIGGER IF EXISTS "stay_events_no_update" ON "stay_events";
CREATE TRIGGER "stay_events_no_update" BEFORE UPDATE ON "stay_events"
  FOR EACH ROW EXECUTE FUNCTION "stay_events_refuse_update"();

-- Backend-only tables: RLS on with no policies, so PostgREST's anon and
-- authenticated roles see nothing. The backend's connection bypasses RLS.
ALTER TABLE "stay_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stay_leaves" ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Add the Prisma models.** Append to `apps/backend/prisma/schema.prisma`:

```prisma
/// Stay Status event store (ADR-194). Append-only — the permanent truth;
/// every stay surface is a projection of it. A DB trigger refuses UPDATE.
/// No Prisma relations on purpose: nothing else reads through them, and
/// adding back-relations to `tenants`/`hostels` buys nothing.
model stay_events {
  id                   String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  seq                  BigInt    @unique @default(autoincrement())
  tenant_id            String    @db.Uuid
  hostel_id            String    @db.Uuid
  room_id              String?   @db.Uuid
  type                 String
  effective_date       DateTime  @db.Date
  occurred_at          DateTime  @default(now()) @db.Timestamptz(6)
  leave_type           String?
  expected_return_date DateTime? @db.Date
  source               String
  actor_profile_id     String?   @db.Uuid
  actor_role           String
  idempotency_key      String    @unique
  schema_version       Int       @default(1)
  payload              Json      @default("{}")

  @@index([hostel_id, occurred_at], map: "stay_events_hostel_occurred_idx")
  @@index([tenant_id, seq], map: "stay_events_tenant_seq_idx")
  @@index([hostel_id, effective_date, type], map: "stay_events_hostel_date_type_idx")
}

/// Projection of `stay_events`: one row per leave. Rebuildable by replay.
/// "One ACTIVE leave per tenant" is a partial unique index in the migration
/// (`stay_leaves_one_active_per_tenant`) — Prisma cannot express it.
model stay_leaves {
  id                   String    @id @db.Uuid
  tenant_id            String    @db.Uuid
  hostel_id            String    @db.Uuid
  leave_type           String
  start_date           DateTime  @db.Date
  expected_return_date DateTime  @db.Date
  status               String    @default("ACTIVE")
  returned_at          DateTime? @db.Timestamptz(6)
  last_event_id        String    @db.Uuid
  created_at           DateTime  @default(now()) @db.Timestamptz(6)
  updated_at           DateTime  @default(now()) @updatedAt @db.Timestamptz(6)

  @@index([hostel_id, status, expected_return_date], map: "stay_leaves_hostel_status_return_idx")
}
```

- [ ] **Step 3: Validate and generate**

```bash
cd apps/backend
DATABASE_URL=postgresql://u:p@localhost:5432/d DIRECT_URL=postgresql://u:p@localhost:5432/d npx prisma validate
npm run prisma:generate
node -e "const {PrismaClient}=require('@prisma/client'); const p=new PrismaClient(); console.log(typeof p.stay_events?.create, typeof p.stay_leaves?.updateMany)"
```

Expected: `function function`. The accessor check matters because `prisma` is typed `any`, so a typo would compile.

- [ ] **Step 4: Apply to the TEST database only, and verify**

```bash
cd apps/backend
TEST_DB=$(grep -o 'DATABASE_URL="[^"]*"' ../../.env.test | sed 's/DATABASE_URL="//;s/"$//')
TEST_DIRECT=$(grep -o 'DIRECT_URL="[^"]*"' ../../.env.test | sed 's/DIRECT_URL="//;s/"$//')
DATABASE_URL="$TEST_DB" DIRECT_URL="${TEST_DIRECT:-$TEST_DB}" \
  npx prisma db execute --file prisma/migrations/20260914100000_stay_status_events/migration.sql --schema prisma/schema.prisma
psql "$(echo $TEST_DB | sed 's/:5432/:6543/')" -c "select table_name, count(*) from information_schema.columns where table_name in ('stay_events','stay_leaves') group by 1;" \
  -c "select indexname from pg_indexes where tablename in ('stay_events','stay_leaves') order by 1;"
```

Expected: `stay_events | 16` and `stay_leaves | 11`, plus 9 indexes (6 on events, 3 on leaves) including `stay_leaves_one_active_per_tenant`. Run it twice to prove it's idempotent. **Do not apply to production here.** That's Task 14, and it needs the user's go-ahead.

- [ ] **Step 5: Commit**

```bash
git add prisma/migrations/20260914100000_stay_status_events prisma/schema.prisma
git commit -m "feat(stay): stay_events store and stay_leaves projection (new tables only)"
```

---

### Task 6: Stay service — the one write path and the read models

**Files:**
- Create: `apps/backend/src/services/stay/stay-rows.ts`
- Create: `apps/backend/src/services/stay/stay-errors.ts`
- Create: `apps/backend/src/services/stay/stay-service.ts`
- Test: `apps/backend/tests/stay-service.test.ts` (mock-based; add to the pure `include`)

**Interfaces consumed:**
- Tasks 1–4
- `liveTenancyWhere(profileId)` from `@/lib/tenancy/active-tenancy`
- `roomCapacityService.getHostelCapacityMap(hostelId): Promise<Map<string, { room_id; capacity; occupied; available; … }>>`
- Relations `roomAllocation.room` / `roomAllocation.tenant`, `tenants.hostels` / `tenants.profiles`

**Interfaces produced:**
- `class StayError { code: StayErrorCode; status: number; message }`
- `stayErrorResponse(error): Response`
- `interface TenantStay { status; leave: { leaveType; startDate; expectedReturnDate } | null; today; suggestedReturn; minReturnDate; maxReturnDate }`
- `interface MyStay { tenantId: string | null; hostel: { id; name } | null; resident: boolean; stay: TenantStay | null }`
- `type StayBoardView = StayBoard & { suggestedReturn; minReturnDate; maxReturnDate }`
- `createStayService({ db?, capacity? })` returning:
  - `recordStayEvent(input: RecordStayEventInput): Promise<TenantStay>`
  - `getMyStay(profileId, now?): Promise<MyStay>`
  - `getHostelBoard(hostelId, now?): Promise<StayBoardView>`
  - `getPortfolioSummary(ownerId, now?)`
- `stayService` (default instance)
- `RecordStayEventInput`: `{ tenantId; hostelId; type: unknown; leaveType?: unknown; expectedReturnDate?: unknown; source: unknown; actorProfileId: string | null; actorRole: ActorRole; idempotencyKey?: unknown; now?: Date }`. Inputs are `unknown` because routes pass request bodies straight through; the service is the single validator.

- [ ] **Step 1: Write the failing test** `apps/backend/tests/stay-service.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { createStayService } from "@/src/services/stay/stay-service";
import { eventFromRow, eventToRow, leaveFromRow, leaveToRow } from "@/src/services/stay/stay-rows";
import type { StayEvent } from "@/src/services/stay/stay-events";

const NOW = new Date("2026-09-14T06:30:00.000Z"); // Monday, noon IST
const KEY = "tap-0001-abcd";
const BASE = { tenantId: "t1", hostelId: "h1", source: "QR", actorProfileId: "p1", actorRole: "TENANT" as const, idempotencyKey: KEY, now: NOW };

function leaveRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "leave-1", tenant_id: "t1", hostel_id: "h1", leave_type: "GOING_HOME",
    start_date: new Date("2026-09-13T00:00:00.000Z"), expected_return_date: new Date("2026-09-16T00:00:00.000Z"),
    status: "ACTIVE", returned_at: null, last_event_id: "leave-1", ...overrides,
  };
}

function makeDb({ resident = true, active = null as any } = {}) {
  let current = active;
  const db: any = {
    roomAllocation: {
      findFirst: vi.fn(async () => (resident ? { room_id: "r1" } : null)),
      findMany: vi.fn(async () => []),
    },
    stay_leaves: {
      findFirst: vi.fn(async () => current),
      findMany: vi.fn(async () => []),
      create: vi.fn(async ({ data }: any) => (current = data)),
      updateMany: vi.fn(async ({ data }: any) => {
        current = data.status === "ACTIVE" ? { ...current, ...data } : null;
        return { count: 1 };
      }),
    },
    stay_events: { create: vi.fn(async ({ data }: any) => data), findMany: vi.fn(async () => []) },
    tenants: { findFirst: vi.fn(async () => null) },
    hostels: { findMany: vi.fn(async () => []) },
    $transaction: vi.fn(async (fn: any) => fn(db)),
  };
  return db;
}
const capacity = { getHostelCapacityMap: vi.fn(async () => new Map()) } as any;
const service = (db: any, cap = capacity) => createStayService({ db, capacity: cap });

describe("recordStayEvent", () => {
  it("refuses anyone who is not a current resident", async () => {
    const db = makeDb({ resident: false });
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED" })).rejects.toMatchObject({ code: "STAY_INELIGIBLE", status: 409 });
    expect(db.stay_events.create).not.toHaveBeenCalled();
  });

  it("records Going Home as one event plus one leave, in one transaction", async () => {
    const db = makeDb();
    const stay = await service(db).recordStayEvent({ ...BASE, type: "LEAVE_STARTED", leaveType: "GOING_HOME", expectedReturnDate: "2026-09-15" });
    expect(db.$transaction).toHaveBeenCalledTimes(1);
    const event = db.stay_events.create.mock.calls[0][0].data;
    expect(event).toMatchObject({ type: "LEAVE_STARTED", tenant_id: "t1", hostel_id: "h1", room_id: "r1", source: "QR", actor_role: "TENANT", idempotency_key: `t1:${KEY}` });
    expect(event.effective_date.toISOString()).toBe("2026-09-14T00:00:00.000Z");
    expect(db.stay_leaves.create.mock.calls[0][0].data).toMatchObject({ id: event.id, status: "ACTIVE", last_event_id: event.id });
    expect(stay).toMatchObject({
      status: "ON_LEAVE", leave: { leaveType: "GOING_HOME", expectedReturnDate: "2026-09-15" },
      today: "2026-09-14", minReturnDate: "2026-09-15", maxReturnDate: "2026-12-13",
      suggestedReturn: { date: "2026-09-15", label: "tomorrow" },
    });
  });

  it("keys a presence confirmation per tenant per IST day and writes no leave", async () => {
    const db = makeDb();
    await service(db).recordStayEvent({ ...BASE, type: "PRESENCE_CONFIRMED", idempotencyKey: undefined });
    expect(db.stay_events.create.mock.calls[0][0].data.idempotency_key).toBe("presence:t1:2026-09-14");
    expect(db.stay_leaves.create).not.toHaveBeenCalled();
  });

  it("treats a replayed tap (key already used) as success", async () => {
    const db = makeDb();
    db.stay_events.create.mockRejectedValueOnce(Object.assign(new Error("unique"), { code: "P2002" }));
    await expect(
      service(db).recordStayEvent({ ...BASE, type: "LEAVE_STARTED", leaveType: "GOING_HOME", expectedReturnDate: "2026-09-15" }),
    ).resolves.toMatchObject({ status: "PRESENT" });
  });

  it("rolls back quietly when a concurrent write moved the leave first", async () => {
    const db = makeDb({ active: leaveRow() });
    db.stay_leaves.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED" })).resolves.toBeDefined();
    expect(db.stay_leaves.updateMany.mock.calls[0][0].where).toEqual({ id: "leave-1", last_event_id: "leave-1" });
  });

  it("writes nothing for I'm Back when already back", async () => {
    const db = makeDb();
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED" })).resolves.toMatchObject({ status: "PRESENT" });
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it("turns a reducer rejection into a readable 400", async () => {
    const db = makeDb({ active: leaveRow() });
    await expect(
      service(db).recordStayEvent({ ...BASE, type: "RETURN_DATE_CHANGED", expectedReturnDate: "2026-09-14" }),
    ).rejects.toMatchObject({ code: "TOO_SOON", status: 400 });
  });

  it("validates type, source and the client key before touching the database", async () => {
    const db = makeDb();
    await expect(service(db).recordStayEvent({ ...BASE, type: "AWAY_TODAY" })).rejects.toMatchObject({ code: "UNKNOWN_TYPE" });
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED", source: "SMS" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(service(db).recordStayEvent({ ...BASE, type: "RETURNED", idempotencyKey: "x" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    expect(db.roomAllocation.findFirst).not.toHaveBeenCalled();
  });
});

describe("getMyStay", () => {
  it("says someone with no live tenancy is not a resident", async () => {
    expect(await service(makeDb()).getMyStay("p1", NOW)).toEqual({ tenantId: null, hostel: null, resident: false, stay: null });
  });

  it("gives a resident their stay and hostel", async () => {
    const db = makeDb();
    db.tenants.findFirst.mockResolvedValueOnce({ id: "t1", hostel_id: "h1", hostels: { id: "h1", name: "Sri Adithya" } });
    expect(await service(db).getMyStay("p1", NOW)).toMatchObject({ tenantId: "t1", hostel: { id: "h1", name: "Sri Adithya" }, resident: true, stay: { status: "PRESENT" } });
  });
});

describe("getHostelBoard", () => {
  it("composes residents, active leaves and roomCapacityService", async () => {
    const db = makeDb();
    db.roomAllocation.findMany.mockResolvedValueOnce([
      { tenant_id: "t1", room_id: "r1", room: { room_no: "101" }, tenant: { display_name: null, profiles: { name: "Asha" } } },
      { tenant_id: "t2", room_id: "r1", room: { room_no: "101" }, tenant: { display_name: "Ravi", profiles: { name: "R" } } },
    ]);
    db.stay_leaves.findMany.mockResolvedValueOnce([leaveRow({ tenant_id: "t2", expected_return_date: new Date("2026-09-14T00:00:00.000Z") })]);
    const cap = { getHostelCapacityMap: vi.fn(async () => new Map([["r1", { room_id: "r1", capacity: 3, occupied: 2, available: 1 }]])) } as any;
    const board = await service(db, cap).getHostelBoard("h1", NOW);
    expect(cap.getHostelCapacityMap).toHaveBeenCalledWith("h1");
    expect(board).toMatchObject({
      hereTonight: 2, beds: { capacity: 3, occupied: 2, free: 1 },
      backToday: [{ name: "Ravi", roomNo: "101", arrived: false }],
      suggestedReturn: { date: "2026-09-15", label: "tomorrow" },
    });
    expect(db.stay_events.findMany.mock.calls[0][0].where).toMatchObject({ hostel_id: "h1", type: "RETURNED" });
  });
});

describe("row mappers", () => {
  it("round-trip events and leaves losslessly", () => {
    const event: StayEvent = {
      id: "e1", tenantId: "t1", hostelId: "h1", roomId: "r1", type: "LEAVE_STARTED", effectiveDate: "2026-09-14",
      occurredAt: "2026-09-14T06:30:00.000Z", leaveType: "VACATION", expectedReturnDate: "2026-09-30",
      source: "APP", actorProfileId: "p1", actorRole: "TENANT", idempotencyKey: "t1:k",
    };
    expect(eventFromRow(eventToRow(event))).toEqual(event);
    const leave = leaveFromRow(leaveRow());
    expect(leaveFromRow(leaveToRow(leave))).toEqual(leave);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run --config vitest.pure.config.ts tests/stay-service.test.ts`. Expected: FAIL (modules not found).

- [ ] **Step 3a: Implement** `apps/backend/src/services/stay/stay-rows.ts`

```ts
import type { LeaveState, StayEvent } from "./stay-events";

/** `@db.Date` columns travel as UTC-midnight Dates; the domain uses YYYY-MM-DD. */
export function toDbDate(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00.000Z`);
}
export function fromDbDate(value: Date | string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function eventToRow(e: StayEvent) {
  return {
    id: e.id,
    tenant_id: e.tenantId,
    hostel_id: e.hostelId,
    room_id: e.roomId,
    type: e.type,
    effective_date: toDbDate(e.effectiveDate),
    occurred_at: new Date(e.occurredAt),
    leave_type: e.leaveType,
    expected_return_date: e.expectedReturnDate ? toDbDate(e.expectedReturnDate) : null,
    source: e.source,
    actor_profile_id: e.actorProfileId,
    actor_role: e.actorRole,
    idempotency_key: e.idempotencyKey,
  };
}

export function eventFromRow(r: any): StayEvent {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    hostelId: r.hostel_id,
    roomId: r.room_id ?? null,
    type: r.type,
    effectiveDate: fromDbDate(r.effective_date),
    occurredAt: new Date(r.occurred_at).toISOString(),
    leaveType: r.leave_type ?? null,
    expectedReturnDate: r.expected_return_date ? fromDbDate(r.expected_return_date) : null,
    source: r.source,
    actorProfileId: r.actor_profile_id ?? null,
    actorRole: r.actor_role,
    idempotencyKey: r.idempotency_key,
  };
}

export function leaveToRow(l: LeaveState) {
  return {
    id: l.id,
    tenant_id: l.tenantId,
    hostel_id: l.hostelId,
    leave_type: l.leaveType,
    start_date: toDbDate(l.startDate),
    expected_return_date: toDbDate(l.expectedReturnDate),
    status: l.status,
    returned_at: l.returnedAt ? new Date(l.returnedAt) : null,
    last_event_id: l.lastEventId,
  };
}

export function leaveFromRow(r: any): LeaveState {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    hostelId: r.hostel_id,
    leaveType: r.leave_type,
    startDate: fromDbDate(r.start_date),
    expectedReturnDate: fromDbDate(r.expected_return_date),
    status: r.status,
    returnedAt: r.returned_at ? new Date(r.returned_at).toISOString() : null,
    lastEventId: r.last_event_id,
  };
}
```

- [ ] **Step 3b: Implement** `apps/backend/src/services/stay/stay-errors.ts`

```ts
import { apiError } from "@/lib/utils/api-utils";
import { MAX_RETURN_DAYS } from "./stay-status";
import type { StayRejectReason } from "./stay-events";

export type StayErrorCode = StayRejectReason | "STAY_INELIGIBLE" | "INVALID_REQUEST";

export class StayError extends Error {
  constructor(public readonly code: StayErrorCode, message: string, public readonly status: number) {
    super(message);
    this.name = "StayError";
  }
}

/** Tenant-facing words — these reach the screen verbatim via parseApiError. */
const REJECTIONS: Record<StayRejectReason, [number, string]> = {
  NO_ACTIVE_LEAVE: [409, "You're not on leave right now."],
  ON_LEAVE: [409, "You're on leave — tap I'm back first."],
  INVALID_LEAVE_TYPE: [400, "Choose Going home or Vacation."],
  INVALID_DATE: [400, "That isn't a valid date."],
  TOO_SOON: [400, "Pick a return date from tomorrow onwards."],
  TOO_FAR: [400, `Pick a return date within ${MAX_RETURN_DAYS} days.`],
  UNKNOWN_TYPE: [400, "That isn't a stay update we know."],
};

export function rejection(reason: StayRejectReason): StayError {
  const [status, message] = REJECTIONS[reason];
  return new StayError(reason, message, status);
}

export const ineligible = () => new StayError("STAY_INELIGIBLE", "Only a current resident can update their stay.", 409);
export const invalidRequest = (message: string) => new StayError("INVALID_REQUEST", message, 400);

/** Every Stay route's catch block: the repo's standard error envelope. */
export function stayErrorResponse(error: any) {
  if (error instanceof StayError) return apiError(error.message, error.code, error.status);
  const code = error?.code;
  const message = String(error?.message || "Stay update failed");
  if (code === "HOSTEL_CONTEXT_REQUIRED") return apiError(message, code, 400);
  if (code === "UNAUTHORIZED") return apiError(message, code, 401);
  if (code === "FORBIDDEN") return apiError("Forbidden", code, 403);
  return apiError(message, "ERROR", 500);
}
```

- [ ] **Step 3c: Implement** `apps/backend/src/services/stay/stay-service.ts`

```ts
import { randomUUID } from "crypto";
import { prisma } from "@/lib/db";
import { addDaysIso, istDateOf } from "@/lib/timezone";
import { OCCUPYING_ALLOCATION_WHERE, roomCapacityService } from "@/lib/services/room-capacity-service";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";
import { applyStayEvent, isStayEventType, type ActorRole, type LeaveState, type StayEvent } from "./stay-events";
import {
  deriveStayStatus, isStaySource, MAX_RETURN_DAYS, smartReturnDate,
  type LeaveType, type StayStatus, type SuggestedReturn,
} from "./stay-status";
import { buildStayBoard, summarizeHostel, summarizePortfolio, type BoardResident, type StayBoard } from "./stay-board";
import { eventToRow, leaveFromRow, leaveToRow, toDbDate } from "./stay-rows";
import { ineligible, invalidRequest, rejection } from "./stay-errors";

/**
 * Stay Status I/O (ADR-194). `recordStayEvent` is the ONE write path — app,
 * QR, owner and (later) WhatsApp all call it. It appends to `stay_events` and
 * moves the `stay_leaves` projection in one transaction, using the pure
 * reducer. Reads compose the existing resident predicate and
 * `roomCapacityService`; nothing here recalculates occupancy.
 */

export interface DateWindow {
  today: string;
  suggestedReturn: SuggestedReturn;
  minReturnDate: string;
  maxReturnDate: string;
}

export interface TenantStay extends DateWindow {
  status: StayStatus;
  leave: { leaveType: LeaveType; startDate: string; expectedReturnDate: string } | null;
}

export interface MyStay {
  tenantId: string | null;
  hostel: { id: string; name: string } | null;
  resident: boolean;
  stay: TenantStay | null;
}

export type StayBoardView = StayBoard & DateWindow;

export interface RecordStayEventInput {
  tenantId: string;
  hostelId: string;
  type: unknown;
  leaveType?: unknown;
  expectedReturnDate?: unknown;
  source: unknown;
  actorProfileId: string | null;
  actorRole: ActorRole;
  idempotencyKey?: unknown;
  now?: Date;
}

const CLIENT_KEY = /^[A-Za-z0-9_-]{8,100}$/;

/** Thrown inside the write transaction so it rolls back when another write moved the leave first. */
class LostRace extends Error {}

function dateWindow(today: string): DateWindow {
  return {
    today,
    suggestedReturn: smartReturnDate(today),
    minReturnDate: addDaysIso(today, 1),
    maxReturnDate: addDaysIso(today, MAX_RETURN_DAYS),
  };
}

export function createStayService(deps: { db?: any; capacity?: typeof roomCapacityService } = {}) {
  const db = deps.db ?? prisma;
  const capacity = deps.capacity ?? roomCapacityService;

  /** The tenant's occupying allocation in this hostel — i.e. "is a resident here". */
  function findResidency(tenantId: string, hostelId: string) {
    return db.roomAllocation.findFirst({
      where: { tenant_id: tenantId, hostel_id: hostelId, ...OCCUPYING_ALLOCATION_WHERE },
      select: { room_id: true },
    });
  }

  async function activeLeave(tenantId: string): Promise<LeaveState | null> {
    const row = await db.stay_leaves.findFirst({ where: { tenant_id: tenantId, status: "ACTIVE" } });
    return row ? leaveFromRow(row) : null;
  }

  async function tenantStay(tenantId: string, today: string): Promise<TenantStay> {
    const leave = await activeLeave(tenantId);
    return {
      status: deriveStayStatus(leave, today),
      leave: leave
        ? { leaveType: leave.leaveType, startDate: leave.startDate, expectedReturnDate: leave.expectedReturnDate }
        : null,
      ...dateWindow(today),
    };
  }

  async function recordStayEvent(input: RecordStayEventInput): Promise<TenantStay> {
    if (!isStayEventType(input.type)) throw rejection("UNKNOWN_TYPE");
    if (!isStaySource(input.source)) throw invalidRequest("source must be one of QR, APP, OWNER, WHATSAPP");
    const now = input.now ?? new Date();
    const effectiveDate = istDateOf(now);

    let idempotencyKey: string;
    if (input.type === "PRESENCE_CONFIRMED") {
      idempotencyKey = `presence:${input.tenantId}:${effectiveDate}`;
    } else {
      if (typeof input.idempotencyKey !== "string" || !CLIENT_KEY.test(input.idempotencyKey)) {
        throw invalidRequest("idempotencyKey must be 8–100 letters, digits, - or _");
      }
      idempotencyKey = `${input.tenantId}:${input.idempotencyKey}`;
    }

    const residency = await findResidency(input.tenantId, input.hostelId);
    if (!residency) throw ineligible();

    const event: StayEvent = {
      id: randomUUID(),
      tenantId: input.tenantId,
      hostelId: input.hostelId,
      roomId: residency.room_id ?? null,
      type: input.type,
      effectiveDate,
      occurredAt: now.toISOString(),
      // Passed through unvalidated on purpose: the reducer is the validator.
      leaveType: (input.leaveType ?? null) as LeaveType | null,
      expectedReturnDate: typeof input.expectedReturnDate === "string" ? input.expectedReturnDate : null,
      source: input.source,
      actorProfileId: input.actorProfileId,
      actorRole: input.actorRole,
      idempotencyKey,
    };

    const result = applyStayEvent(await activeLeave(input.tenantId), event);
    if (result.kind === "reject") throw rejection(result.reason);

    if (result.kind === "record") {
      try {
        await db.$transaction(async (tx: any) => {
          await tx.stay_events.create({ data: eventToRow(event) });
          if (result.after && !result.before) {
            await tx.stay_leaves.create({ data: leaveToRow(result.after) });
          } else if (result.after && result.before) {
            const { id: _id, tenant_id: _t, hostel_id: _h, ...changes } = leaveToRow(result.after);
            const moved = await tx.stay_leaves.updateMany({
              where: { id: result.before.id, last_event_id: result.before.lastEventId },
              data: { ...changes, updated_at: now },
            });
            if (moved.count !== 1) throw new LostRace();
          }
        });
      } catch (error: any) {
        // The same tap arriving twice (idempotency key), or a concurrent write that won
        // the one-active-leave index or moved the leave first. Either way the tenant's
        // intent is already recorded by the other write; this one rolled back whole,
        // so the stream and the projection still agree.
        if (!(error instanceof LostRace) && error?.code !== "P2002") throw error;
      }
    }

    return tenantStay(input.tenantId, effectiveDate);
  }

  async function getMyStay(profileId: string, now: Date = new Date()): Promise<MyStay> {
    const tenancy = await db.tenants.findFirst({
      where: liveTenancyWhere(profileId),
      select: { id: true, hostel_id: true, hostels: { select: { id: true, name: true } } },
    });
    if (!tenancy?.hostel_id || !tenancy.hostels) return { tenantId: null, hostel: null, resident: false, stay: null };
    const hostel = { id: tenancy.hostels.id, name: tenancy.hostels.name };
    const residency = await findResidency(tenancy.id, tenancy.hostel_id);
    if (!residency) return { tenantId: tenancy.id, hostel, resident: false, stay: null };
    return { tenantId: tenancy.id, hostel, resident: true, stay: await tenantStay(tenancy.id, istDateOf(now)) };
  }

  async function getHostelBoard(hostelId: string, now: Date = new Date()): Promise<StayBoardView> {
    const today = istDateOf(now);
    const [allocations, leaves, returnedToday, capacityMap] = await Promise.all([
      db.roomAllocation.findMany({
        where: { hostel_id: hostelId, ...OCCUPYING_ALLOCATION_WHERE },
        select: {
          tenant_id: true,
          room_id: true,
          room: { select: { room_no: true } },
          tenant: { select: { display_name: true, profiles: { select: { name: true } } } },
        },
      }),
      db.stay_leaves.findMany({ where: { hostel_id: hostelId, status: "ACTIVE" } }),
      db.stay_events.findMany({
        where: { hostel_id: hostelId, type: "RETURNED", effective_date: toDbDate(today) },
        select: { tenant_id: true },
      }),
      capacity.getHostelCapacityMap(hostelId),
    ]);

    // One resident per tenant even if data ever holds two open allocations.
    const residents: BoardResident[] = [];
    const seen = new Set<string>();
    for (const a of allocations as any[]) {
      if (seen.has(a.tenant_id)) continue;
      seen.add(a.tenant_id);
      residents.push({
        tenantId: a.tenant_id,
        roomId: a.room_id,
        roomNo: String(a.room?.room_no ?? "—"),
        name: String(a.tenant?.display_name || a.tenant?.profiles?.name || "Resident"),
      });
    }

    const board = buildStayBoard({
      residents,
      activeLeaves: (leaves as any[]).map(leaveFromRow).map((l) => ({
        tenantId: l.tenantId,
        leaveType: l.leaveType,
        expectedReturnDate: l.expectedReturnDate,
      })),
      returnedTodayTenantIds: (returnedToday as any[]).map((e) => e.tenant_id),
      rooms: [...capacityMap.values()].map((s: any) => ({
        roomId: s.room_id,
        capacity: s.capacity,
        occupied: s.occupied,
        available: s.available,
      })),
      today,
    });
    return { ...board, ...dateWindow(today) };
  }

  /** Portfolio scope: every live hostel of this owner. No hostelId by design, like /api/owner/portfolio/summary. */
  async function getPortfolioSummary(ownerId: string, now: Date = new Date()) {
    const hostels = await db.hostels.findMany({
      where: { owner_id: ownerId, status: "ACTIVE", archived_at: null },
      select: { id: true, name: true },
      orderBy: { created_at: "asc" },
    });
    const summaries = await Promise.all(
      (hostels as Array<{ id: string; name: string }>).map(async (h) =>
        summarizeHostel(h.id, h.name, await getHostelBoard(h.id, now)),
      ),
    );
    return summarizePortfolio(summaries);
  }

  return { recordStayEvent, getMyStay, getHostelBoard, getPortfolioSummary };
}

export type StayService = ReturnType<typeof createStayService>;
export const stayService = createStayService();
```

- [ ] **Step 4: Run the tests and see them pass**

```bash
npx vitest run --config vitest.pure.config.ts tests/stay-service.test.ts
npm run test:pure 2>&1 | tail -5     # compare against the Task 0 baseline
npx tsc --noEmit 2>&1 | grep -E "src/services/stay|lib/timezone|room-capacity" || echo "no type errors in stay files"
```

- [ ] **Step 5: Commit**

```bash
git add src/services/stay tests/stay-service.test.ts vitest.pure.config.ts
git commit -m "feat(stay): stay service — one channel-agnostic write path, composed read models"
```

---

### Task 7: The hostel QR poster (PDF)

This is a designed A4 PDF, **not** a print page, following the kitchen sheet's precedent (ADR-144: phone print dialogs are unreliable for these owners). It reuses the menu sheet's fonts and brand mark, and the installed `qrcode` package. The external `api.qrserver.com` route is not used.

**Files:**
- Modify: `apps/backend/lib/pdf/menu-template-pdf-lib.ts`: add `export` to `interface Fonts` and `async function loadFonts` (no other change)
- Create: `apps/backend/lib/pdf/stay-poster-pdf-lib.ts`
- Test: `apps/backend/tests/stay-poster-pdf.test.ts` (add to the pure `include`; it reads font files but no DB)

**Interfaces produced:**
- `stayPosterLines(hostelName: string): { title; headline; subline; footnote }`
- `renderStayPosterPdf({ hostelName, url }): Promise<Uint8Array>`

- [ ] **Step 1: Write the failing test** `apps/backend/tests/stay-poster-pdf.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { renderStayPosterPdf, stayPosterLines } from "@/lib/pdf/stay-poster-pdf-lib";

describe("stay QR poster", () => {
  it("leads with the hostel and the one action", () => {
    expect(stayPosterLines("Sri Adithya Hostel")).toEqual({
      title: "Sri Adithya Hostel",
      headline: "Back? Scan me.",
      subline: "One tap tells the hostel you're here.",
      footnote: "Going home? Scan, then tap More.",
    });
  });

  it("renders a one-page A4 PDF, even for a very long hostel name", async () => {
    const bytes = await renderStayPosterPdf({
      hostelName: "Sri Venkateswara Luxury Boys Hostel and Paying Guest Accommodation",
      url: "https://yourstayo.com/stay/7b0c5f5e-0000-4000-8000-000000000000",
    });
    expect(Buffer.from(bytes.slice(0, 4)).toString()).toBe("%PDF");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const { width, height } = doc.getPage(0).getSize();
    expect([Math.round(width), Math.round(height)]).toEqual([595, 842]);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run --config vitest.pure.config.ts tests/stay-poster-pdf.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 3: Implement.** Export `Fonts` and `loadFonts` in `menu-template-pdf-lib.ts`, then create `apps/backend/lib/pdf/stay-poster-pdf-lib.ts`:

```ts
import fs from "fs/promises";
import path from "path";
import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import QRCode from "qrcode";
import { loadFonts } from "./menu-template-pdf-lib";

/**
 * The hostel's Stay QR, for a wall by the entrance. Laminated once, scanned
 * hundreds of times a day, read from arm's length by someone walking in with
 * a bag — so: one hostel name, one instruction, one very large code. The QR
 * encodes `/stay/<hostelId>` and never changes. See ADR-194.
 */

const PAGE_W = 595.28; // A4 portrait
const PAGE_H = 841.89;
const INK = rgb(0.184, 0.184, 0.184); // Charcoal #2F2F2F
const MUTED = rgb(0.42, 0.42, 0.42);
const ACCENT = rgb(0.706, 0.416, 0.333); // Warm Clay #B46A55
const PAPER = rgb(1, 1, 1);
const BRAND_MARK = path.join(process.cwd(), "lib", "pdf", "brand", "stayo-mark.png");
const QR_SIZE = 340;

export function stayPosterLines(hostelName: string) {
  return {
    title: hostelName,
    headline: "Back? Scan me.",
    subline: "One tap tells the hostel you're here.",
    footnote: "Going home? Scan, then tap More.",
  };
}

function centred(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color: RGB) {
  page.drawText(text, { x: (PAGE_W - font.widthOfTextAtSize(text, size)) / 2, y, size, font, color });
}

export async function renderStayPosterPdf(content: { hostelName: string; url: string }): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const fonts = await loadFonts(pdfDoc);
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  page.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: PAGE_H, color: PAPER });

  const lines = stayPosterLines(content.hostelName);
  // A long hostel name shrinks to fit rather than running off the sheet.
  let titleSize = 34;
  while (titleSize > 14 && fonts.display.widthOfTextAtSize(lines.title, titleSize) > PAGE_W - 96) titleSize -= 2;
  centred(page, lines.title, PAGE_H - 120, titleSize, fonts.display, INK);
  centred(page, lines.headline, PAGE_H - 196, 44, fonts.display, ACCENT);

  const qrPng = await QRCode.toDataURL(content.url, {
    margin: 1,
    width: 1200,
    errorCorrectionLevel: "M",
    color: { dark: "#1A1A1C", light: "#FFFFFF" },
  });
  const qr = await pdfDoc.embedPng(qrPng);
  const qrTop = PAGE_H - 240;
  page.drawImage(qr, { x: (PAGE_W - QR_SIZE) / 2, y: qrTop - QR_SIZE, width: QR_SIZE, height: QR_SIZE });

  centred(page, lines.subline, qrTop - QR_SIZE - 44, 16, fonts.medium, INK);
  centred(page, lines.footnote, qrTop - QR_SIZE - 70, 13, fonts.regular, MUTED);

  try {
    const mark = await pdfDoc.embedPng(await fs.readFile(BRAND_MARK));
    const h = 18;
    const w = (mark.width / mark.height) * h;
    page.drawImage(mark, { x: (PAGE_W - w) / 2, y: 48, width: w, height: h });
  } catch {
    // The mark is decoration; the code is the point of the page.
  }

  return pdfDoc.save();
}
```

- [ ] **Step 4: Run the tests and see them pass.** Run the poster test and the menu PDF's existing tests (`ls tests | grep -i menu`), which must stay green.

- [ ] **Step 5: Commit**

```bash
git add lib/pdf/stay-poster-pdf-lib.ts lib/pdf/menu-template-pdf-lib.ts tests/stay-poster-pdf.test.ts vitest.pure.config.ts
git commit -m "feat(stay): laminate-ready A4 hostel QR poster"
```

---

### Task 8: API routes

All routes are thin: auth, scope, service, and `stayErrorResponse` in the catch.

**Files:**
- Create: `apps/backend/app/api/tenant/stay/route.ts` (GET)
- Create: `apps/backend/app/api/tenant/stay/events/route.ts` (POST)
- Create: `apps/backend/app/api/hostels/[id]/stay/route.ts` (GET)
- Create: `apps/backend/app/api/hostels/[id]/stay/tenants/[tenantId]/events/route.ts` (POST)
- Create: `apps/backend/app/api/hostels/[id]/stay/poster/route.ts` (GET)
- Create: `apps/backend/app/api/owner/stay/summary/route.ts` (GET)
- Modify: `apps/backend/scripts/architectural-invariants-check.ts` (the `roots` of the two hostelId rules)
- Test: `apps/backend/tests/stay-routes.test.ts` (add to the pure `include`)

**Wire contract** (`apiResponse` spreads object payloads at the top level):

| Route | 200 body |
|---|---|
| `GET /api/tenant/stay` | `{ success, tenantId, hostel, resident, stay }` |
| `POST /api/tenant/stay/events` | `{ success, stay }` |
| `GET /api/hostels/:id/stay` | `{ success, ...StayBoardView }` |
| `POST /api/hostels/:id/stay/tenants/:tenantId/events` | `{ success, stay }` |
| `GET /api/owner/stay/summary` | `{ success, totals, hostels }` |
| `GET /api/hostels/:id/stay/poster` | the PDF bytes |

- [ ] **Step 1: Write the failing test** `apps/backend/tests/stay-routes.test.ts`

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSession, mockStay, mockAssert } = vi.hoisted(() => ({
  mockSession: vi.fn(),
  mockStay: { getMyStay: vi.fn(), recordStayEvent: vi.fn(), getHostelBoard: vi.fn(), getPortfolioSummary: vi.fn() },
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
vi.mock("@/src/services/stay/stay-service", () => ({ stayService: mockStay }));

import { GET as getMine } from "../app/api/tenant/stay/route";
import { POST as tenantEvent } from "../app/api/tenant/stay/events/route";
import { GET as getBoard } from "../app/api/hostels/[id]/stay/route";
import { POST as ownerEvent } from "../app/api/hostels/[id]/stay/tenants/[tenantId]/events/route";
import { GET as getSummary } from "../app/api/owner/stay/summary/route";
import { StayError } from "@/src/services/stay/stay-errors";

const HOSTEL = "11111111-1111-4111-8111-111111111111";
const TENANT = "22222222-2222-4222-8222-222222222222";
const TENANT_SESSION = { sub: "p-tenant", role: "TENANT" };
const OWNER_SESSION = { sub: "o1", owner_id: "o1", role: "OWNER" };
const req = (body: unknown = {}) => ({ json: async () => body, url: "http://test/api" }) as any;
const ctx = (params: Record<string, string>) => ({ params: Promise.resolve(params) });
const RESIDENT = { tenantId: TENANT, hostel: { id: HOSTEL, name: "Sri Adithya" }, resident: true, stay: { status: "PRESENT" } };

beforeEach(() => {
  vi.clearAllMocks();
  mockAssert.mockResolvedValue({ id: HOSTEL });
});

describe("tenant routes", () => {
  it("only tenants may read or write their stay", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    expect((await getMine(req())).status).toBe(403);
    expect((await tenantEvent(req({ type: "RETURNED", source: "QR" }))).status).toBe(403);
  });

  it("records for the session's own tenancy — a body tenantId is ignored", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    mockStay.getMyStay.mockResolvedValue(RESIDENT);
    mockStay.recordStayEvent.mockResolvedValue({ status: "PRESENT" });
    const res = await tenantEvent(req({ type: "RETURNED", source: "QR", idempotencyKey: "tap-0001-abcd", tenantId: "someone-else" }));
    expect(res.status).toBe(200);
    expect(mockStay.recordStayEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, hostelId: HOSTEL, type: "RETURNED", source: "QR", actorProfileId: "p-tenant", actorRole: "TENANT",
    }));
  });

  it("refuses a non-resident with STAY_INELIGIBLE", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    mockStay.getMyStay.mockResolvedValue({ ...RESIDENT, resident: false, stay: null });
    const res = await tenantEvent(req({ type: "RETURNED", source: "APP", idempotencyKey: "tap-0001-abcd" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("STAY_INELIGIBLE");
    expect(mockStay.recordStayEvent).not.toHaveBeenCalled();
  });

  it("only accepts QR or APP as a tenant source", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    expect((await tenantEvent(req({ type: "RETURNED", source: "OWNER" }))).status).toBe(400);
  });

  it("carries a StayError's status and code through", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    mockStay.getMyStay.mockResolvedValue(RESIDENT);
    mockStay.recordStayEvent.mockRejectedValue(new StayError("TOO_SOON", "Pick a return date from tomorrow onwards.", 400));
    const res = await tenantEvent(req({ type: "LEAVE_STARTED", source: "APP", idempotencyKey: "tap-0001-abcd" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toEqual({ message: "Pick a return date from tomorrow onwards.", code: "TOO_SOON" });
  });
});

describe("owner routes", () => {
  it("scopes the board to a hostel the owner owns", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockStay.getHostelBoard.mockResolvedValue({ hereTonight: 3 });
    const res = await getBoard(req(), ctx({ id: HOSTEL }));
    expect(res.status).toBe(200);
    expect(mockAssert).toHaveBeenCalledWith("o1", HOSTEL);
  });

  it("refuses another owner's hostel", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockAssert.mockRejectedValue(Object.assign(new Error("FORBIDDEN: not yours"), { code: "FORBIDDEN" }));
    expect((await getBoard(req(), ctx({ id: HOSTEL }))).status).toBe(403);
    expect(mockStay.getHostelBoard).not.toHaveBeenCalled();
  });

  it("records an owner update with source OWNER and the path's hostel", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockStay.recordStayEvent.mockResolvedValue({ status: "PRESENT" });
    const res = await ownerEvent(req({ type: "RETURNED", idempotencyKey: "tap-0001-abcd", source: "QR" }), ctx({ id: HOSTEL, tenantId: TENANT }));
    expect(res.status).toBe(200);
    expect(mockStay.recordStayEvent).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: TENANT, hostelId: HOSTEL, source: "OWNER", actorRole: "OWNER", actorProfileId: "o1",
    }));
  });

  it("does not let an owner confirm presence, and rejects a malformed tenant id", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    expect((await ownerEvent(req({ type: "PRESENCE_CONFIRMED" }), ctx({ id: HOSTEL, tenantId: TENANT }))).status).toBe(400);
    expect((await ownerEvent(req({ type: "RETURNED" }), ctx({ id: HOSTEL, tenantId: "nope" }))).status).toBe(404);
  });

  it("summarises the whole portfolio for the session owner", async () => {
    mockSession.mockResolvedValue(OWNER_SESSION);
    mockStay.getPortfolioSummary.mockResolvedValue({ totals: {}, hostels: [] });
    expect((await getSummary(req())).status).toBe(200);
    expect(mockStay.getPortfolioSummary).toHaveBeenCalledWith("o1");
  });

  it("keeps tenants out of owner routes", async () => {
    mockSession.mockResolvedValue(TENANT_SESSION);
    expect((await getBoard(req(), ctx({ id: HOSTEL }))).status).toBe(403);
    expect((await getSummary(req())).status).toBe(403);
  });
});
```

- [ ] **Step 2: Run it and see it fail.** `npx vitest run --config vitest.pure.config.ts tests/stay-routes.test.ts`. Expected: FAIL (route modules not found).

- [ ] **Step 3a:** `apps/backend/app/api/tenant/stay/route.ts`

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

/**
 * GET /api/tenant/stay — the signed-in tenant's stay: hostel, whether they
 * are a resident, their derived status, and the date window for leave
 * (today, suggested return, min/max). The QR page and Tenant Home render
 * straight from this. See ADR-194.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden: Only tenants can access this endpoint", "FORBIDDEN", 403);
  }
  try {
    return apiResponse(await stayService.getMyStay(session.sub));
  } catch (error) {
    return stayErrorResponse(error);
  }
}
```

- [ ] **Step 3b:** `apps/backend/app/api/tenant/stay/events/route.ts`

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

const TENANT_SOURCES = new Set(["QR", "APP"]);

/**
 * POST /api/tenant/stay/events
 * Body: { type, leaveType?, expectedReturnDate?, source: "QR"|"APP", idempotencyKey }
 *
 * The tenant and hostel come from the session's live tenancy, never the
 * body. A repeated tap is idempotent. Returns { stay }.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Forbidden: Only tenants can access this endpoint", "FORBIDDEN", 403);
  }
  try {
    const body = await req.json().catch(() => ({}));
    if (!TENANT_SOURCES.has(body?.source)) return apiError("source must be QR or APP", "INVALID_REQUEST", 400);

    const me = await stayService.getMyStay(session.sub);
    if (!me.resident || !me.tenantId || !me.hostel) {
      return apiError("Only a current resident can update their stay.", "STAY_INELIGIBLE", 409);
    }

    const stay = await stayService.recordStayEvent({
      tenantId: me.tenantId,
      hostelId: me.hostel.id,
      type: body.type,
      leaveType: body.leaveType,
      expectedReturnDate: body.expectedReturnDate,
      source: body.source,
      actorProfileId: session.sub,
      actorRole: "TENANT",
      idempotencyKey: body.idempotencyKey,
    });
    return apiResponse({ stay });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
```

- [ ] **Step 3c:** `apps/backend/app/api/hostels/[id]/stay/route.ts`

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

/**
 * GET /api/hostels/[id]/stay — the owner's Stay board for one hostel:
 * here tonight, meals, back today, late, rooms to check, beds free.
 * Answers, not states. See ADR-194.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    return apiResponse(await stayService.getHostelBoard(id));
  } catch (error) {
    return stayErrorResponse(error);
  }
}
```

- [ ] **Step 3d:** `apps/backend/app/api/hostels/[id]/stay/tenants/[tenantId]/events/route.ts`

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

const OWNER_TYPES = new Set(["LEAVE_STARTED", "RETURN_DATE_CHANGED", "RETURNED", "LEAVE_CANCELLED"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/hostels/[id]/stay/tenants/[tenantId]/events
 * Body: { type, leaveType?, expectedReturnDate?, idempotencyKey }
 *
 * The owner updating a resident's stay — the only path for owner-managed
 * tenants who cannot sign in. Always recorded with source OWNER. The tenant
 * must be a resident of this hostel (the service checks).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; tenantId: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id, tenantId } = await params;
  if (!UUID.test(tenantId)) return apiError("Resident not found", "NOT_FOUND", 404);
  try {
    const body = await req.json().catch(() => ({}));
    if (!OWNER_TYPES.has(body?.type)) {
      return apiError("An owner can start, change, end or cancel a leave", "INVALID_REQUEST", 400);
    }
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const stay = await stayService.recordStayEvent({
      tenantId,
      hostelId: id,
      type: body.type,
      leaveType: body.leaveType,
      expectedReturnDate: body.expectedReturnDate,
      source: "OWNER",
      actorProfileId: session.sub,
      actorRole: "OWNER",
      idempotencyKey: body.idempotencyKey,
    });
    return apiResponse({ stay });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
```

- [ ] **Step 3e:** `apps/backend/app/api/owner/stay/summary/route.ts`

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { stayService } from "@/src/services/stay/stay-service";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

/**
 * GET /api/owner/stay/summary — Owner Home's "Tonight" answers, portfolio-wide
 * with a per-hostel breakdown. No hostelId: portfolio scope, like
 * /api/owner/portfolio/summary. Composed here, not in portfolio-service
 * (which must not read raw tenant tables).
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  try {
    const scope = resolveOwnerScope(session);
    return apiResponse(await stayService.getPortfolioSummary(scope.owner_id));
  } catch (error) {
    return stayErrorResponse(error);
  }
}
```

- [ ] **Step 3f:** `apps/backend/app/api/hostels/[id]/stay/poster/route.ts`

```ts
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { resolveOwnerScope } from "@/lib/auth/resolve-operational-scope";
import { requireHostelBelongsToOwner } from "@/lib/security/scoped-query";
import { frontendUrl } from "@/lib/config/domains";
import { renderStayPosterPdf } from "@/lib/pdf/stay-poster-pdf-lib";
import { stayErrorResponse } from "@/src/services/stay/stay-errors";

/**
 * GET /api/hostels/[id]/stay/poster — the A4 QR poster for the entrance.
 * Bytes, not a stored file: it encodes /stay/<hostelId>, which never changes.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  if (!session || session.role !== "OWNER") return apiError("Forbidden", "FORBIDDEN", 403);
  const { id } = await params;
  try {
    const scope = resolveOwnerScope(session);
    await requireHostelBelongsToOwner(scope.owner_id, id);
    const hostel = await prisma.hostels.findUnique({ where: { id }, select: { name: true } });
    if (!hostel) return apiError("Hostel not found", "NOT_FOUND", 404);

    const bytes = await renderStayPosterPdf({ hostelName: hostel.name, url: frontendUrl(`/stay/${id}`) });
    const safeName = String(hostel.name || "hostel").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "");
    return new Response(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${safeName}-stay-qr.pdf"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return stayErrorResponse(error);
  }
}
```

Check `frontendUrl`'s join before relying on it: `sed -n 115,125p lib/config/domains.ts`. It must yield `https://yourstayo.com/stay/<id>` with exactly one slash.

- [ ] **Step 3g: Put the new code under the invariant checks.** In `scripts/architectural-invariants-check.ts`, append these four entries to the `roots` array of **both** the "optional hostelId service contracts" rule and the "first hostel as fallback" rule:

```ts
"src/services/stay", "app/api/tenant/stay", "app/api/owner/stay", "app/api/hostels/[id]/stay",
```

- [ ] **Step 4: Run the tests and checks**

```bash
npx vitest run --config vitest.pure.config.ts tests/stay-routes.test.ts
npm run check:invariants
```

Expected: tests pass, and the invariants pass. If rule 4's 220-character regex false-positives inside `stay-service.ts`, **reorder functions** so no `findFirst(` sits within 440 characters before `owner_id` (e.g. keep `getPortfolioSummary` last). Do not add an allowlist entry for new code.

- [ ] **Step 5: Commit**

```bash
git add app/api/tenant/stay app/api/owner/stay "app/api/hostels/[id]/stay" scripts/architectural-invariants-check.ts tests/stay-routes.test.ts vitest.pure.config.ts
git commit -m "feat(stay): tenant, owner and portfolio stay routes under the scope invariants"
```

---

### Task 9: Database-backed integrity test

This test proves what only Postgres can: the partial unique index under a real double tap, idempotency-key dedupe, replay equal to the projection, the append-only trigger, and the resident identity against `roomCapacityService`.

**Files:**
- Test: `apps/backend/tests/stay-service.db.test.ts` (DB suite; **not** in the pure `include`)

**Prerequisites:** Task 5's migration is applied to the test DB, and `.env.test` is present (Task 0).

- [ ] **Step 1: Baseline the DB suite on an untouched spec**

```bash
cd apps/backend && npx vitest run tests/billing-timeline.test.ts 2>&1 | tail -8
```

The test DB has lagged migrations before (e.g. `tenants.access_mode`, 2026-08-29). If `createTestTenant` fails there, Stay's DB test **cannot** run either. Record it in the ledger as *blocked by the test DB, not by this change*, and say so in the final report. Don't mark Task 9 as passing.

- [ ] **Step 2: Write the test** `apps/backend/tests/stay-service.db.test.ts`

```ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createTestHostel, createTestOwner } from "./factories/owner-factory";
import { createTestRoom } from "./factories/room-factory";
import { allocateTestRoom, createTestTenant } from "./factories/tenant-factory";
import { createStayService } from "@/src/services/stay/stay-service";
import { replayStayEvents } from "@/src/services/stay/stay-events";
import { eventFromRow, leaveFromRow } from "@/src/services/stay/stay-rows";
import { roomCapacityService } from "@/lib/services/room-capacity-service";

const NOW = new Date("2026-09-14T06:30:00.000Z"); // Monday, noon IST
const svc = createStayService();
let hostelId: string;
let a: any, b: any, c: any, invited: any, former: any;

const key = () => `k-${Math.random().toString(36).slice(2, 12)}`;
const rec = (tenantId: string, type: string, extra: Record<string, unknown> = {}) =>
  svc.recordStayEvent({
    tenantId, hostelId, type, source: "APP", actorProfileId: null, actorRole: "TENANT",
    idempotencyKey: key(), now: NOW, ...extra,
  });
const home = (expectedReturnDate = "2026-09-16") => ({ leaveType: "GOING_HOME", expectedReturnDate });

beforeAll(async () => {
  const owner = await createTestOwner();
  const hostel = await createTestHostel(owner.id);
  hostelId = hostel.id;
  const room = await createTestRoom(hostel.id, { capacity: 6 });
  const resident = async (overrides: Record<string, unknown> = {}) => {
    const t = await createTestTenant(owner.id, hostel.id, overrides);
    await allocateTestRoom(t.id, room.id, { hostel_id: hostel.id });
    return t;
  };
  a = await resident();
  b = await resident();
  c = await resident();
  invited = await resident({ status: "INVITED" });
  former = await resident({ status: "FORMER_TENANT" });
});

afterAll(async () => {
  await prisma.stay_leaves.deleteMany({ where: { hostel_id: hostelId } });
  await prisma.stay_events.deleteMany({ where: { hostel_id: hostelId } }); // DELETE is allowed; UPDATE is not
});

describe("stay service against Postgres", () => {
  it("a double tap from two devices yields one leave and one event", async () => {
    await Promise.all([rec(a.id, "LEAVE_STARTED", home()), rec(a.id, "LEAVE_STARTED", home())]);
    expect(await prisma.stay_leaves.count({ where: { tenant_id: a.id, status: "ACTIVE" } })).toBe(1);
    expect(await prisma.stay_events.count({ where: { tenant_id: a.id, type: "LEAVE_STARTED" } })).toBe(1);
  });

  it("a reused idempotency key is recorded once, whatever it is reused for", async () => {
    await rec(b.id, "LEAVE_STARTED", { ...home(), idempotencyKey: "reused-key-0001" });
    await rec(b.id, "RETURNED");
    await rec(b.id, "LEAVE_STARTED", { ...home(), idempotencyKey: "reused-key-0001" });
    expect(await prisma.stay_events.count({ where: { tenant_id: b.id, type: "LEAVE_STARTED" } })).toBe(1);
    expect(await prisma.stay_leaves.count({ where: { tenant_id: b.id, status: "ACTIVE" } })).toBe(0);
  });

  it("replaying the stream rebuilds exactly the projection", async () => {
    await rec(c.id, "LEAVE_STARTED", home());
    await rec(c.id, "RETURN_DATE_CHANGED", { expectedReturnDate: "2026-09-18" });
    await rec(c.id, "RETURNED");
    await rec(c.id, "LEAVE_STARTED", { leaveType: "VACATION", expectedReturnDate: "2026-09-30" });
    await rec(c.id, "LEAVE_CANCELLED");

    const events = (await prisma.stay_events.findMany({ where: { hostel_id: hostelId }, orderBy: { seq: "asc" } })).map(eventFromRow);
    const projection = (await prisma.stay_leaves.findMany({ where: { hostel_id: hostelId } })).map(leaveFromRow);
    const byId = (x: { id: string }, y: { id: string }) => x.id.localeCompare(y.id);
    expect(replayStayEvents(events).sort(byId)).toEqual(projection.sort(byId));
  });

  it("only ACTIVE residents may update their stay", async () => {
    await expect(rec(invited.id, "RETURNED")).rejects.toMatchObject({ code: "STAY_INELIGIBLE" });
    await expect(rec(former.id, "RETURNED")).rejects.toMatchObject({ code: "STAY_INELIGIBLE" });
  });

  it("here + away equals roomCapacityService's occupied beds", async () => {
    const board = await svc.getHostelBoard(hostelId, NOW);
    const capacity = await roomCapacityService.getHostelCapacityMap(hostelId);
    const occupied = [...capacity.values()].reduce((total, r) => total + r.occupied, 0);
    expect(board.residents).toBe(3);
    expect(board.hereTonight + board.away).toBe(occupied);
  });

  it("the database refuses to edit an event", async () => {
    const one = await prisma.stay_events.findFirst({ where: { hostel_id: hostelId } });
    await expect(prisma.stay_events.update({ where: { id: one.id }, data: { source: "QR" } })).rejects.toThrow(/append-only/);
  });
});
```

- [ ] **Step 3: Run it**

Run: `npx vitest run tests/stay-service.db.test.ts`
Expected: 6 passing. If "double tap" fails with two ACTIVE leaves, the partial unique index is missing, so re-check Task 5 Step 4. If "replay" fails, **fix the reducer or the write path, never the test's expectation.** The two must agree by construction.

- [ ] **Step 4: Commit**

```bash
git add tests/stay-service.db.test.ts
git commit -m "test(stay): Postgres proves one-active-leave, key dedupe, replay = projection, append-only"
```

---

### Task 10: Frontend contract and pure screen models

**Files:**
- Create: `apps/frontend/src/features/stay/types.ts`
- Create: `apps/frontend/src/features/stay/api/index.ts`
- Create: `apps/frontend/src/features/stay/stayState.ts`
- Test: `apps/frontend/src/features/stay/stayState.test.ts`
- Modify: `apps/frontend/src/lib/queryKeys.ts` (add a `stay` member to `queryKeys`)

**Interfaces produced** (the UI tasks use exactly these):
- `stayApi.getMine()`, `.record(input)`, `.getBoard(hostelId)`, `.recordForResident(hostelId, tenantId, input)`, `.getSummary()`, `.downloadPoster(hostelId)`
- `queryKeys.stay.mine()`, `.board(hostelId)`, `.summary()`
- `screenFor(stay, hostelName): StayScreen`
- `friendlyDate(iso, today)`, `suggestedLabel(s)`
- `MORE_ACTION_LABEL`, `RETURN_SHEET_TITLE`
- `scanViewFor({ signedIn, role, mine, hostelId }): ScanView`, `SCAN_MESSAGE`, `shouldConfirmPresence(view, stay)`
- `boardSections(board): BoardSection[]`, `roomLines(board)`, `boardHeadline(board)`, `tonightCards(summary): TonightCards | null`
- Types `MoreAction`, `ReturnDateMode`, `OwnerRowAction`, `BoardRow`, `BoardSection`, `TonightCards`

- [ ] **Step 1: Write the wire types** `apps/frontend/src/features/stay/types.ts`

```ts
/** Wire types for Stay Status — mirror `apps/backend/src/services/stay/*`. See ADR-194. */

export type StayStatus = 'PRESENT' | 'ON_LEAVE' | 'RETURNING_TODAY' | 'LATE';
export type LeaveType = 'GOING_HOME' | 'VACATION';
export type StayEventType = 'LEAVE_STARTED' | 'RETURN_DATE_CHANGED' | 'RETURNED' | 'LEAVE_CANCELLED' | 'PRESENCE_CONFIRMED';

export interface SuggestedReturn { date: string; label: 'tomorrow' | 'sunday' }

export interface DateWindow {
  today: string;
  suggestedReturn: SuggestedReturn;
  minReturnDate: string;
  maxReturnDate: string;
}

export interface TenantStay extends DateWindow {
  status: StayStatus;
  leave: { leaveType: LeaveType; startDate: string; expectedReturnDate: string } | null;
}

export interface MyStay {
  tenantId: string | null;
  hostel: { id: string; name: string } | null;
  resident: boolean;
  stay: TenantStay | null;
}

export interface StayEventInput {
  type: StayEventType;
  leaveType?: LeaveType;
  expectedReturnDate?: string;
  idempotencyKey: string;
}

export interface TenantStayEventInput extends StayEventInput {
  source: 'QR' | 'APP';
}

export interface BoardPerson { tenantId: string; name: string; roomNo: string }

export interface StayBoard extends DateWindow {
  residents: number;
  hereTonight: number;
  away: number;
  late: number;
  beds: { capacity: number; occupied: number; free: number };
  meals: { expected: number; lateMayTurnUp: number };
  backToday: Array<BoardPerson & { arrived: boolean }>;
  lateList: Array<BoardPerson & { expectedReturnDate: string; daysLate: number }>;
  awayList: Array<BoardPerson & { leaveType: LeaveType; expectedReturnDate: string }>;
  roomsToCheck: Array<{ roomId: string; roomNo: string; reason: 'EMPTY_TONIGHT' | 'BACK_TODAY'; names: string[] }>;
  here: BoardPerson[];
}

export interface StayHostelSummary {
  hostelId: string;
  hostelName: string;
  residents: number;
  hereTonight: number;
  backToday: number;
  late: number;
  roomsToCheck: number;
  mealsExpected: number;
}

export interface StaySummary {
  totals: Omit<StayHostelSummary, 'hostelId' | 'hostelName'>;
  hostels: StayHostelSummary[];
}
```

- [ ] **Step 2: Write the API wrapper** `apps/frontend/src/features/stay/api/index.ts`

```ts
import api from '@lib/api-client';
import type { MyStay, StayBoard, StayEventInput, StaySummary, TenantStay, TenantStayEventInput } from '../types';

/** `apiResponse` spreads object payloads at the top level; drop the envelope flag. */
function body<T>(response: { data: any }): T {
  const { success: _success, ...rest } = response.data ?? {};
  return rest as T;
}

export const stayApi = {
  getMine: async (): Promise<MyStay> => body<MyStay>(await api.get('/tenant/stay')),

  record: async (input: TenantStayEventInput): Promise<TenantStay> =>
    body<{ stay: TenantStay }>(await api.post('/tenant/stay/events', input)).stay,

  getBoard: async (hostelId: string): Promise<StayBoard> => body<StayBoard>(await api.get(`/hostels/${hostelId}/stay`)),

  recordForResident: async (hostelId: string, tenantId: string, input: StayEventInput): Promise<TenantStay> =>
    body<{ stay: TenantStay }>(await api.post(`/hostels/${hostelId}/stay/tenants/${tenantId}/events`, input)).stay,

  getSummary: async (): Promise<StaySummary> => body<StaySummary>(await api.get('/owner/stay/summary')),

  downloadPoster: async (hostelId: string): Promise<{ blob: Blob; filename: string }> => {
    const response = await api.get(`/hostels/${hostelId}/stay/poster`, { responseType: 'blob' });
    const disposition = String((response.headers as any)?.['content-disposition'] ?? '');
    const match = disposition.match(/filename="?([^"]+)"?/);
    return { blob: response.data as Blob, filename: match?.[1] ?? 'stay-qr.pdf' };
  },
};
```

- [ ] **Step 3: Add the query keys.** In `apps/frontend/src/lib/queryKeys.ts`, add this member to the `queryKeys` object, directly after `notifications: () => ownerKey('notifications'),`:

```ts
  /** Stay Status (ADR-194). The tenant key sits beside the other ['tenant', …] keys. */
  stay: {
    mine: () => ['tenant', 'stay'],
    board: (hostelId: string | null | undefined) => hostelKey(hostelId, 'stay', 'board'),
    summary: () => ownerKey('stay', 'summary'),
  },
```

- [ ] **Step 4: Write the failing test** `apps/frontend/src/features/stay/stayState.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import {
  boardHeadline, boardSections, friendlyDate, roomLines, scanViewFor, screenFor, shouldConfirmPresence,
  suggestedLabel, tonightCards,
} from './stayState';
import type { MyStay, StayBoard, TenantStay } from './types';

const TODAY = '2026-09-14'; // Monday
const WINDOW = { today: TODAY, suggestedReturn: { date: '2026-09-15', label: 'tomorrow' as const }, minReturnDate: '2026-09-15', maxReturnDate: '2026-12-13' };
const stay = (status: TenantStay['status'], expectedReturnDate?: string): TenantStay => ({
  ...WINDOW,
  status,
  leave: expectedReturnDate ? { leaveType: 'GOING_HOME', startDate: '2026-09-12', expectedReturnDate } : null,
});

describe('friendlyDate', () => {
  it('speaks like a person', () => {
    expect(friendlyDate('2026-09-14', TODAY)).toBe('today');
    expect(friendlyDate('2026-09-15', TODAY)).toBe('tomorrow');
    expect(friendlyDate('2026-09-13', TODAY)).toBe('yesterday');
    expect(friendlyDate('2026-09-20', TODAY)).toBe('Sunday');
    expect(friendlyDate('2026-09-30', TODAY)).toBe('30 Sep');
    expect(friendlyDate('2026-09-10', TODAY)).toBe('10 Sep');
  });
});

describe('screenFor — one primary action at most', () => {
  it('present: a confirmation, no button, leave options behind More', () => {
    expect(screenFor(stay('PRESENT'), 'Sri Adithya')).toEqual({
      kind: 'present', headline: "You're in", detail: 'Sri Adithya', primary: null, more: ['GOING_HOME', 'VACATION'],
    });
  });

  it.each([
    ['ON_LEAVE', '2026-09-20', 'Away', 'Back Sunday'],
    ['RETURNING_TODAY', TODAY, 'Back today?', 'Tap when you arrive'],
    ['LATE', '2026-09-13', 'Are you back?', 'You were due back yesterday'],
  ] as const)('%s: one big I’m back', (status, date, headline, detail) => {
    expect(screenFor(stay(status, date), 'Sri Adithya')).toEqual({
      kind: 'away', headline, detail, primary: 'IM_BACK', more: ['CHANGE_DATE', 'CANCEL_LEAVE'],
    });
  });

  it('labels the smart default', () => {
    expect(suggestedLabel({ date: '2026-09-20', label: 'sunday' })).toBe('Back Sunday');
    expect(suggestedLabel({ date: '2026-09-15', label: 'tomorrow' })).toBe('Back tomorrow');
  });
});

describe('scanViewFor', () => {
  const mine: MyStay = { tenantId: 't1', hostel: { id: 'h1', name: 'Sri Adithya' }, resident: true, stay: stay('PRESENT') };
  it('routes every visitor to exactly one screen', () => {
    expect(scanViewFor({ signedIn: false, role: null, mine: undefined, hostelId: 'h1' })).toBe('SIGNED_OUT');
    expect(scanViewFor({ signedIn: true, role: 'OWNER', mine: undefined, hostelId: 'h1' })).toBe('NOT_TENANT');
    expect(scanViewFor({ signedIn: true, role: 'tenant', mine: { ...mine, resident: false, stay: null }, hostelId: 'h1' })).toBe('NOT_RESIDENT');
    expect(scanViewFor({ signedIn: true, role: 'TENANT', mine, hostelId: 'h2' })).toBe('OTHER_HOSTEL');
    expect(scanViewFor({ signedIn: true, role: 'TENANT', mine, hostelId: 'h1' })).toBe('READY');
  });

  it('confirms presence only for a present resident of this hostel', () => {
    expect(shouldConfirmPresence('READY', stay('PRESENT'))).toBe(true);
    expect(shouldConfirmPresence('READY', stay('ON_LEAVE', '2026-09-20'))).toBe(false);
    expect(shouldConfirmPresence('OTHER_HOSTEL', stay('PRESENT'))).toBe(false);
  });
});

const board: StayBoard = {
  ...WINDOW,
  residents: 6, hereTonight: 3, away: 3, late: 1,
  beds: { capacity: 8, occupied: 6, free: 1 },
  meals: { expected: 3, lateMayTurnUp: 1 },
  backToday: [
    { tenantId: 'E', name: 'Esha', roomNo: '103', arrived: false },
    { tenantId: 'F', name: 'Farhan', roomNo: '104', arrived: true },
  ],
  lateList: [{ tenantId: 'D', name: 'Dev', roomNo: '102', expectedReturnDate: '2026-09-11', daysLate: 3 }],
  awayList: [{ tenantId: 'B', name: 'Bala', roomNo: '101', leaveType: 'GOING_HOME', expectedReturnDate: '2026-09-15' }],
  roomsToCheck: [
    { roomId: 'r102', roomNo: '102', reason: 'EMPTY_TONIGHT', names: ['Chitra', 'Dev'] },
    { roomId: 'r103', roomNo: '103', reason: 'BACK_TODAY', names: ['Esha'] },
  ],
  here: [{ tenantId: 'A', name: 'Asha', roomNo: '101' }],
};

describe('owner board — answers in priority order', () => {
  it('orders Late, Back today, Away, then everyone here collapsed', () => {
    const sections = boardSections(board);
    expect(sections.map((s) => [s.id, s.title, s.tone, s.collapsed])).toEqual([
      ['late', 'Late', 'danger', false],
      ['back-today', 'Back today', 'default', false],
      ['away', 'Away', 'default', false],
      ['here', 'Everyone here (1)', 'default', true],
    ]);
  });

  it('gives each row one action and the right words', () => {
    const [late, back, away, here] = boardSections(board);
    expect(late.rows[0]).toEqual({ tenantId: 'D', name: 'Dev', roomNo: '102', detail: '3 days late', primary: 'MARK_BACK', more: ['CHANGE_DATE', 'CANCEL_LEAVE'] });
    expect(back.rows.map((r) => [r.detail, r.primary])).toEqual([['Expected today', 'MARK_BACK'], ['Arrived ✓', null]]);
    expect(away.rows[0].detail).toBe('Back tomorrow');
    expect(here.rows[0]).toMatchObject({ primary: 'PUT_ON_LEAVE', more: [] });
  });

  it('says a single day late as a person would', () => {
    const one = { ...board, lateList: [{ ...board.lateList[0], daysLate: 1 }] };
    expect(boardSections(one)[0].rows[0].detail).toBe('Due back yesterday');
  });

  it('omits empty sections entirely', () => {
    const quiet = { ...board, lateList: [], backToday: [], awayList: [] };
    expect(boardSections(quiet).map((s) => s.id)).toEqual(['here']);
  });

  it('describes rooms that need attention', () => {
    expect(roomLines(board)).toEqual([
      { roomId: 'r102', text: 'Room 102', detail: 'Empty tonight · Chitra, Dev' },
      { roomId: 'r103', text: 'Room 103', detail: 'Esha back today' },
    ]);
  });

  it('headlines the three numbers an owner opens the app for', () => {
    expect(boardHeadline(board)).toEqual({
      here: '3 here tonight',
      meals: '≈ 3 for dinner & breakfast · +1 late may turn up',
      beds: '1 bed free',
    });
  });
});

describe('tonightCards — Owner Home', () => {
  const summary = (late: number, residents = 6) => ({
    totals: { residents, hereTonight: 3, backToday: 2, late, roomsToCheck: 2, mealsExpected: 3 },
    hostels: [],
  });
  it('shows nothing until someone lives here', () => {
    expect(tonightCards(undefined)).toBeNull();
    expect(tonightCards(summary(0, 0))).toBeNull();
  });
  it('answers, and turns red only when someone is late', () => {
    expect(tonightCards(summary(0))).toEqual({
      hereTonight: { value: 3, caption: '≈ 3 meals' },
      backToday: { value: 2, caption: 'Expected back', tone: 'default' },
      roomsToCheck: { value: 2, caption: 'Empty or returning' },
    });
    expect(tonightCards(summary(2))?.backToday).toEqual({ value: 2, caption: '2 late', tone: 'danger' });
  });
});
```

- [ ] **Step 5: Run it and see it fail.** `cd apps/frontend && npx vitest run src/features/stay/stayState.test.ts`. Expected: FAIL (module not found).

- [ ] **Step 6: Implement** `apps/frontend/src/features/stay/stayState.ts`

```ts
import type { MyStay, StayBoard, StaySummary, SuggestedReturn, TenantStay } from './types';

/**
 * Stay Status screen models — pure, so the two-second rule and the
 * "one primary action" rule are tested, not hoped for. Components render
 * these and decide nothing. See ADR-194.
 */

export type MoreAction = 'GOING_HOME' | 'VACATION' | 'CHANGE_DATE' | 'CANCEL_LEAVE';
export type ReturnDateMode = 'GOING_HOME' | 'VACATION' | 'CHANGE_DATE';

export interface StayScreen {
  kind: 'present' | 'away';
  headline: string;
  detail: string;
  /** At most one primary action, ever. */
  primary: 'IM_BACK' | null;
  more: MoreAction[];
}

export const MORE_ACTION_LABEL: Record<MoreAction, string> = {
  GOING_HOME: 'Going home',
  VACATION: 'Vacation',
  CHANGE_DATE: 'Change return date',
  CANCEL_LEAVE: 'Cancel leave',
};

export const RETURN_SHEET_TITLE: Record<ReturnDateMode, string> = {
  GOING_HOME: 'Going home',
  VACATION: 'Vacation — back on',
  CHANGE_DATE: 'New return date',
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function daysFrom(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00.000Z`) - Date.parse(`${from}T00:00:00.000Z`)) / 86_400_000);
}

/** "today", "tomorrow", "yesterday", a weekday within the coming week, else "20 Sep". */
export function friendlyDate(iso: string, today: string): string {
  const days = daysFrom(today, iso);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  const date = new Date(`${iso}T00:00:00.000Z`);
  if (days > 1 && days < 7) return WEEKDAYS[date.getUTCDay()];
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

export function suggestedLabel(suggested: SuggestedReturn): string {
  return suggested.label === 'sunday' ? 'Back Sunday' : 'Back tomorrow';
}

export function screenFor(stay: TenantStay, hostelName: string): StayScreen {
  if (!stay.leave || stay.status === 'PRESENT') {
    return { kind: 'present', headline: "You're in", detail: hostelName, primary: null, more: ['GOING_HOME', 'VACATION'] };
  }
  const back = friendlyDate(stay.leave.expectedReturnDate, stay.today);
  const copy =
    stay.status === 'RETURNING_TODAY'
      ? { headline: 'Back today?', detail: 'Tap when you arrive' }
      : stay.status === 'LATE'
        ? { headline: 'Are you back?', detail: `You were due back ${back}` }
        : { headline: 'Away', detail: `Back ${back}` };
  return { kind: 'away', ...copy, primary: 'IM_BACK', more: ['CHANGE_DATE', 'CANCEL_LEAVE'] };
}

export type ScanView = 'SIGNED_OUT' | 'NOT_TENANT' | 'NOT_RESIDENT' | 'OTHER_HOSTEL' | 'READY';

export function scanViewFor(input: {
  signedIn: boolean;
  role: string | null | undefined;
  mine: MyStay | undefined;
  hostelId: string | undefined;
}): ScanView {
  if (!input.signedIn) return 'SIGNED_OUT';
  if (String(input.role ?? '').toLowerCase() !== 'tenant') return 'NOT_TENANT';
  if (!input.mine?.resident || !input.mine.stay || !input.mine.hostel) return 'NOT_RESIDENT';
  if (input.mine.hostel.id !== input.hostelId) return 'OTHER_HOSTEL';
  return 'READY';
}

export const SCAN_MESSAGE: Record<'NOT_TENANT' | 'NOT_RESIDENT' | 'OTHER_HOSTEL', string> = {
  NOT_TENANT: 'This code is for residents of this hostel.',
  NOT_RESIDENT: "You're not staying here right now. Your dashboard has everything else.",
  OTHER_HOSTEL: 'This code is for another hostel.',
};

/** The QR page records a presence confirmation once, for a present resident of this hostel only. */
export function shouldConfirmPresence(view: ScanView, stay: TenantStay | null | undefined): boolean {
  return view === 'READY' && stay?.status === 'PRESENT';
}

export type OwnerRowAction = 'MARK_BACK' | 'PUT_ON_LEAVE';

export interface BoardRow {
  tenantId: string;
  name: string;
  roomNo: string;
  detail: string;
  primary: OwnerRowAction | null;
  more: Array<'CHANGE_DATE' | 'CANCEL_LEAVE'>;
}

export interface BoardSection {
  id: 'late' | 'back-today' | 'away' | 'here';
  title: string;
  tone: 'danger' | 'default';
  collapsed: boolean;
  rows: BoardRow[];
}

const LEAVE_EDITS: BoardRow['more'] = ['CHANGE_DATE', 'CANCEL_LEAVE'];
const who = (p: { tenantId: string; name: string; roomNo: string }) => ({ tenantId: p.tenantId, name: p.name, roomNo: p.roomNo });

/** The board's people sections, in the order an owner needs them. Empty sections are omitted. */
export function boardSections(board: StayBoard): BoardSection[] {
  const sections: BoardSection[] = [];
  if (board.lateList.length > 0) {
    sections.push({
      id: 'late', title: 'Late', tone: 'danger', collapsed: false,
      rows: board.lateList.map((p) => ({
        ...who(p),
        detail: p.daysLate === 1 ? 'Due back yesterday' : `${p.daysLate} days late`,
        primary: 'MARK_BACK',
        more: LEAVE_EDITS,
      })),
    });
  }
  if (board.backToday.length > 0) {
    sections.push({
      id: 'back-today', title: 'Back today', tone: 'default', collapsed: false,
      rows: board.backToday.map((p) => ({
        ...who(p),
        detail: p.arrived ? 'Arrived ✓' : 'Expected today',
        primary: p.arrived ? null : 'MARK_BACK',
        more: p.arrived ? [] : LEAVE_EDITS,
      })),
    });
  }
  if (board.awayList.length > 0) {
    sections.push({
      id: 'away', title: 'Away', tone: 'default', collapsed: false,
      rows: board.awayList.map((p) => ({
        ...who(p),
        detail: `Back ${friendlyDate(p.expectedReturnDate, board.today)}`,
        primary: 'MARK_BACK',
        more: LEAVE_EDITS,
      })),
    });
  }
  if (board.here.length > 0) {
    sections.push({
      id: 'here', title: `Everyone here (${board.here.length})`, tone: 'default', collapsed: true,
      rows: board.here.map((p) => ({ ...who(p), detail: '', primary: 'PUT_ON_LEAVE', more: [] })),
    });
  }
  return sections;
}

export function roomLines(board: StayBoard): Array<{ roomId: string; text: string; detail: string }> {
  return board.roomsToCheck.map((r) => ({
    roomId: r.roomId,
    text: `Room ${r.roomNo}`,
    detail: r.reason === 'EMPTY_TONIGHT' ? `Empty tonight · ${r.names.join(', ')}` : `${r.names.join(', ')} back today`,
  }));
}

export function boardHeadline(board: StayBoard): { here: string; meals: string; beds: string } {
  const lateNote = board.meals.lateMayTurnUp > 0 ? ` · +${board.meals.lateMayTurnUp} late may turn up` : '';
  return {
    here: `${board.hereTonight} here tonight`,
    meals: `≈ ${board.meals.expected} for dinner & breakfast${lateNote}`,
    beds: `${board.beds.free} ${board.beds.free === 1 ? 'bed' : 'beds'} free`,
  };
}

export interface TonightCards {
  hereTonight: { value: number; caption: string };
  backToday: { value: number; caption: string; tone: 'danger' | 'default' };
  roomsToCheck: { value: number; caption: string };
}

/** Owner Home's "Tonight" row. Null until someone lives here — never a row of zeros. */
export function tonightCards(summary: StaySummary | undefined): TonightCards | null {
  if (!summary || summary.totals.residents === 0) return null;
  const t = summary.totals;
  return {
    hereTonight: { value: t.hereTonight, caption: `≈ ${t.mealsExpected} meals` },
    backToday: { value: t.backToday, caption: t.late > 0 ? `${t.late} late` : 'Expected back', tone: t.late > 0 ? 'danger' : 'default' },
    roomsToCheck: { value: t.roomsToCheck, caption: 'Empty or returning' },
  };
}
```

- [ ] **Step 7: Run the tests and see them pass**

```bash
npx vitest run src/features/stay/stayState.test.ts
npm test 2>&1 | tail -5         # compare to the Task 0 baseline
npm run check:architecture      # the api wrapper must be the only layer calling endpoints
```

- [ ] **Step 8: Commit**

```bash
git add src/features/stay src/lib/queryKeys.ts
git commit -m "feat(stay): frontend contract and tested screen models — one primary action, answers first"
```

---

### Task 11: Tenant surfaces — the QR page and the Home block

Components are thin renderers over Task 10's models. There's no jsdom, so the tests are the models already written. Verification here is `tsc`, the build, and the manual run in Task 14.

**Files:**
- Create: `apps/frontend/src/features/stay/hooks/useMyStay.ts`
- Create: `apps/frontend/src/features/stay/components/ReturnDateSheet.tsx`
- Create: `apps/frontend/src/features/stay/components/StayActionPanel.tsx`
- Create: `apps/frontend/src/platforms/tenant/pages/StayScanPage.tsx`
- Modify: `apps/frontend/src/platforms/tenant/router/TenantRoutes.tsx` (lazy import + route beside `/tenant/farewell`)
- Modify: `apps/frontend/src/platforms/tenant/pages/TenantHomePage.tsx` (a `stayBlock`, in **both** layout branches)

**Design delta (write it into the spec in Task 13):** the QR route sits **outside** `TenantProviderShell`, like `/tenant/farewell`. That shell's guard redirects a signed-out visitor to `/login`, which is the owner landing page: it drops the path and hands a tenant to `/tenant/home` after a 1.6-second handoff. So `StayScanPage` signs people in itself with the shared `LoginModal` and stays on the same URL. `ProtectedTenantRoute` is left untouched.

- [ ] **Step 1:** `apps/frontend/src/features/stay/hooks/useMyStay.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { stayApi } from '../api';
import type { MyStay, TenantStayEventInput } from '../types';

/** The signed-in tenant's stay, and the one way to change it. */
export function useMyStay(enabled = true) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: queryKeys.stay.mine(), queryFn: stayApi.getMine, enabled, staleTime: 15_000 });
  const mutation = useMutation({
    mutationFn: (input: TenantStayEventInput) => stayApi.record(input),
    // The server answers with the new stay: write it straight into the cache
    // so the screen changes on the frame the answer lands. No refetch.
    onSuccess: (stay) => {
      queryClient.setQueryData<MyStay>(queryKeys.stay.mine(), (prev) => (prev ? { ...prev, stay } : prev));
    },
  });
  return {
    mine: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
    record: mutation.mutateAsync,
    isRecording: mutation.isPending,
  };
}
```

- [ ] **Step 2:** `apps/frontend/src/features/stay/components/ReturnDateSheet.tsx`

```tsx
import { useState } from 'react';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { RETURN_SHEET_TITLE, suggestedLabel, type ReturnDateMode } from '../stayState';
import type { SuggestedReturn } from '../types';

interface ReturnDateSheetProps {
  mode: ReturnDateMode;
  suggested: SuggestedReturn;
  minDate: string;
  maxDate: string;
  /** Pre-filled date for the picker — the current return date when changing it. */
  initialDate?: string;
  onPick: (date: string) => void;
  onClose: () => void;
}

/**
 * Going home is ONE button — the smart default ("Back Sunday" Thu–Fri,
 * otherwise "Back tomorrow") — with any other date one tap further down.
 * Vacation and changing a date have no sensible default, so they open on
 * the picker.
 */
export function ReturnDateSheet({ mode, suggested, minDate, maxDate, initialDate, onPick, onClose }: ReturnDateSheetProps) {
  const [showPicker, setShowPicker] = useState(mode !== 'GOING_HOME');
  const [date, setDate] = useState(initialDate ?? suggested.date);

  return (
    <BottomSheet open onOpenChange={(open) => !open && onClose()} title={RETURN_SHEET_TITLE[mode]}>
      <div className="flex flex-col gap-3 pb-2">
        {mode === 'GOING_HOME' && (
          <button
            type="button"
            onClick={() => onPick(suggested.date)}
            className="h-14 w-full rounded-2xl bg-primary text-base font-bold text-primary-foreground active:scale-[0.99]"
          >
            {suggestedLabel(suggested)}
          </button>
        )}
        {showPicker ? (
          <>
            <input
              type="date"
              value={date}
              min={minDate}
              max={maxDate}
              onChange={(e) => setDate(e.target.value)}
              aria-label="Return date"
              className="h-12 w-full rounded-xl border border-border bg-muted px-3 text-base text-foreground"
            />
            <button
              type="button"
              disabled={!date}
              onClick={() => onPick(date)}
              className="h-12 w-full rounded-xl bg-foreground font-bold text-background disabled:opacity-50"
            >
              {mode === 'CHANGE_DATE' ? 'Save new date' : 'Confirm'}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setShowPicker(true)} className="py-2 text-sm font-semibold text-muted-foreground">
            Other date
          </button>
        )}
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Step 3:** `apps/frontend/src/features/stay/components/StayActionPanel.tsx`

```tsx
import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { playSuccessFeedback } from '@shared/ui-patterns/successFeedback';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { parseApiError } from '@lib/errors';
import { MORE_ACTION_LABEL, screenFor, type MoreAction, type ReturnDateMode } from '../stayState';
import type { TenantStay, TenantStayEventInput } from '../types';
import { ReturnDateSheet } from './ReturnDateSheet';

interface StayActionPanelProps {
  stay: TenantStay;
  hostelName: string;
  source: 'QR' | 'APP';
  /** `full` is the QR screen (one huge button); `card` is a Tenant Home block. */
  variant: 'full' | 'card';
  onRecord: (input: TenantStayEventInput) => Promise<unknown>;
  busy: boolean;
}

/**
 * One status line, at most one button, everything else behind More.
 * I'm back is optimistic — the welcome shows on the tap, and only an error
 * takes it back — because the two-second rule is about how it feels.
 */
export function StayActionPanel({ stay, hostelName, source, variant, onRecord, busy }: StayActionPanelProps) {
  const screen = screenFor(stay, hostelName);
  const [moreOpen, setMoreOpen] = useState(false);
  const [sheet, setSheet] = useState<ReturnDateMode | null>(null);
  const [welcomed, setWelcomed] = useState(false);
  const full = variant === 'full';

  const send = async (input: Omit<TenantStayEventInput, 'source' | 'idempotencyKey'>) => {
    try {
      await onRecord({ ...input, source, idempotencyKey: crypto.randomUUID() });
      playSuccessFeedback();
      return true;
    } catch (error) {
      stayoToast.error(parseApiError(error) || 'Could not update your stay. Try again.');
      return false;
    }
  };

  const imBack = async () => {
    setWelcomed(true);
    if (!(await send({ type: 'RETURNED' }))) setWelcomed(false);
  };

  const choose = (action: MoreAction) => {
    setMoreOpen(false);
    if (action === 'CANCEL_LEAVE') void send({ type: 'LEAVE_CANCELLED' });
    else setSheet(action);
  };

  const pickDate = (date: string) => {
    const mode = sheet;
    setSheet(null);
    if (mode === 'CHANGE_DATE') void send({ type: 'RETURN_DATE_CHANGED', expectedReturnDate: date });
    else if (mode) void send({ type: 'LEAVE_STARTED', leaveType: mode, expectedReturnDate: date });
  };

  const showWelcome = welcomed && screen.kind === 'present';
  const headline = showWelcome ? 'Welcome back' : screen.headline;

  return (
    <div className={full ? 'flex w-full flex-col items-center gap-8 text-center' : 'rounded-2xl border border-border bg-card p-4'}>
      <div className={full ? 'flex flex-col items-center gap-3' : 'flex items-center gap-3'}>
        {(screen.kind === 'present' || showWelcome) && (
          <span className={`flex flex-none items-center justify-center rounded-full bg-success/15 text-success ${full ? 'h-20 w-20' : 'h-9 w-9'}`}>
            <Check className={full ? 'h-10 w-10' : 'h-5 w-5'} strokeWidth={2.4} />
          </span>
        )}
        <div className={full ? '' : 'min-w-0 flex-1'}>
          <p className={full ? 'font-display text-4xl font-extrabold tracking-tight' : 'text-[15px] font-bold text-foreground'}>{headline}</p>
          <p className={full ? 'mt-1 text-base text-muted-foreground' : 'text-[13px] text-muted-foreground'}>{screen.detail}</p>
        </div>
      </div>

      {screen.primary === 'IM_BACK' && !showWelcome && (
        <button
          type="button"
          onClick={imBack}
          disabled={busy}
          className={
            full
              ? 'h-20 w-full rounded-3xl bg-primary text-xl font-extrabold text-primary-foreground shadow-lg active:scale-[0.99] disabled:opacity-60'
              : 'mt-3 h-12 w-full rounded-xl bg-primary font-bold text-primary-foreground disabled:opacity-60'
          }
        >
          I'm back
        </button>
      )}

      <div className={full ? 'w-full' : 'mt-2'}>
        <button
          type="button"
          onClick={() => setMoreOpen((open) => !open)}
          aria-expanded={moreOpen}
          className="flex w-full items-center justify-center gap-1 py-2 text-[13px] font-semibold text-muted-foreground"
        >
          More <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? 'rotate-180' : ''}`} />
        </button>
        {moreOpen && (
          <div className="flex flex-col gap-2">
            {screen.more.map((action) => (
              <button
                key={action}
                type="button"
                disabled={busy}
                onClick={() => choose(action)}
                className="h-12 w-full rounded-xl border border-border bg-card text-[15px] font-semibold text-foreground disabled:opacity-60"
              >
                {MORE_ACTION_LABEL[action]}
              </button>
            ))}
          </div>
        )}
      </div>

      {sheet && (
        <ReturnDateSheet
          mode={sheet}
          suggested={stay.suggestedReturn}
          minDate={stay.minReturnDate}
          maxDate={stay.maxReturnDate}
          initialDate={sheet === 'CHANGE_DATE' ? stay.leave?.expectedReturnDate : undefined}
          onPick={pickDate}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}
```

Before relying on them, confirm the colour tokens exist (`grep -n "success" apps/frontend/src/styles/theme.css`). If `bg-success/15` isn't defined, use the tokens `StatCard`'s success value uses (`text-success`), with a neutral `bg-muted` ring.

- [ ] **Step 4:** `apps/frontend/src/platforms/tenant/pages/StayScanPage.tsx`

```tsx
import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@context/AuthContext';
import { StayoLoadingScreen } from '@shared/ui/brand';
import { LoginModal } from '@shared/ui-patterns/LoginModal';
import { useMyStay } from '@features/stay/hooks/useMyStay';
import { StayActionPanel } from '@features/stay/components/StayActionPanel';
import { SCAN_MESSAGE, scanViewFor, shouldConfirmPresence } from '@features/stay/stayState';

/**
 * `/stay/:hostelId` — what the hostel's laminated QR opens. Scan, one tap,
 * done (ADR-194). Present: "You're in ✓", no button. Away: one big I'm back.
 * Everything else is behind More. Signs a first-time visitor in right here
 * and stays on this URL — see TenantRoutes for why it is outside the tenant
 * gate.
 */
export function StayScanPage() {
  const { hostelId } = useParams<{ hostelId: string }>();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const isTenant = String(user?.role ?? '').toLowerCase() === 'tenant';
  const { mine, isLoading, isError, record, isRecording } = useMyStay(isTenant);
  const [loginOpen, setLoginOpen] = useState(true);
  const confirmed = useRef(false);

  const view = scanViewFor({ signedIn: Boolean(user), role: user?.role, mine, hostelId });

  useEffect(() => {
    if (confirmed.current || !shouldConfirmPresence(view, mine?.stay)) return;
    confirmed.current = true;
    // The screen already says "You're in"; this only records that they scanned.
    record({ type: 'PRESENCE_CONFIRMED', source: 'QR', idempotencyKey: crypto.randomUUID() }).catch(() => {});
  }, [view, mine?.stay, record]);

  if (loading || (isTenant && isLoading)) return <StayoLoadingScreen />;

  return (
    <main className="flex min-h-dvh flex-col items-center justify-between bg-background px-6 pb-10 pt-14 text-foreground">
      <p className="text-[12px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {view === 'READY' && mine?.hostel ? mine.hostel.name : 'Stayo'}
      </p>

      <div className="flex w-full max-w-sm flex-1 flex-col items-center justify-center">
        {view === 'SIGNED_OUT' && (
          <div className="flex w-full flex-col items-center gap-4 text-center">
            <p className="font-display text-3xl font-extrabold">Sign in once</p>
            <p className="text-muted-foreground">After this, scanning is one tap.</p>
            <button type="button" onClick={() => setLoginOpen(true)} className="h-14 w-full rounded-2xl bg-primary text-base font-bold text-primary-foreground">
              Sign in
            </button>
            <LoginModal open={loginOpen} mode="tenant" onClose={() => setLoginOpen(false)} onSuccess={() => setLoginOpen(false)} />
          </div>
        )}

        {isTenant && isError && <p className="text-center text-lg font-semibold">Couldn't load your stay. Try scanning again.</p>}

        {view === 'READY' && mine?.stay && mine.hostel && (
          <StayActionPanel stay={mine.stay} hostelName={mine.hostel.name} source="QR" variant="full" onRecord={record} busy={isRecording} />
        )}

        {!isError && (view === 'NOT_TENANT' || view === 'NOT_RESIDENT' || view === 'OTHER_HOSTEL') && (
          <div className="flex flex-col items-center gap-4 text-center">
            <p className="text-lg font-semibold">{SCAN_MESSAGE[view]}</p>
            {view !== 'NOT_TENANT' && (
              <button type="button" onClick={() => navigate('/tenant/home')} className="text-sm font-semibold text-primary">
                Open my dashboard
              </button>
            )}
          </div>
        )}
      </div>

      <p className="text-[11px] text-muted-foreground">Stayo</p>
    </main>
  );
}
```

- [ ] **Step 5: Route it.** In `TenantRoutes.tsx`, add beside the other lazy imports:

```tsx
const StayScanPage = lazy(() => import('../pages/StayScanPage').then((m) => ({ default: m.StayScanPage })));
```

and inside `TenantRoutes()`, directly after the `/tenant/farewell` `<Route>`:

```tsx
      {/*
        * The hostel QR (ADR-194). Also OUTSIDE `TenantProviderShell`: that
        * gate sends a signed-out visitor to /login — the owner landing — and
        * drops this path, so a first scan would end on /tenant/home. The page
        * signs people in itself and stays put: scan, sign in once, tap, done.
        */}
      <Route path="/stay/:hostelId" element={<StayScanPage />} />
```

- [ ] **Step 6: The Tenant Home block.** In `TenantHomePage.tsx`, import the hook and panel:

```tsx
import { useMyStay } from '@features/stay/hooks/useMyStay';
import { StayActionPanel } from '@features/stay/components/StayActionPanel';
```

call `const stay = useMyStay();` beside the other hooks (after `const now = useNow();`), and define the block beside `foodBlock`:

```tsx
  // Same panel as the QR screen, source APP: one line, at most one button, More for the rest.
  const stayBlock = stay.mine?.resident && stay.mine.stay && stay.mine.hostel && (
    <div className="flex flex-col gap-2.5">
      <span className={sectionLabel}>Your stay</span>
      <StayActionPanel
        stay={stay.mine.stay}
        hostelName={stay.mine.hostel.name}
        source="APP"
        variant="card"
        onRecord={stay.record}
        busy={stay.isRecording}
      />
    </div>
  );
```

Insert `{stayBlock}` directly after `{rentCard}` in **both** branches: the desktop left column and the mobile single column.

- [ ] **Step 7: Verify**

```bash
cd apps/frontend
npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "features/stay|StayScanPage|TenantRoutes|TenantHomePage" || echo "no type errors in stay files"
npm run build 2>&1 | tail -5
npm test 2>&1 | tail -3
```

`vite build` does not typecheck, so the filtered `tsc` is the real gate.

- [ ] **Step 8: Commit**

```bash
git add src/features/stay src/platforms/tenant
git commit -m "feat(stay): QR scan page and Tenant Home block — scan, one tap, done"
```

---

### Task 12: Owner surfaces — Home "Tonight" answers and the Stay board

**Files:**
- Create: `apps/frontend/src/features/owner-stay/hooks/useStay.ts`
- Create: `apps/frontend/src/features/owner-stay/components/TonightSection.tsx`
- Create: `apps/frontend/src/features/owner-stay/pages/StayBoardPage.tsx`
- Modify: `apps/frontend/src/features/owner-dashboard/hooks/useOwnerDashboard.ts` (compose `tonight`)
- Modify: `apps/frontend/src/features/owner-dashboard/components/OwnerHomeDashboard.tsx` (props + render above Action Center)
- Modify: `apps/frontend/src/features/owner-onboarding/pages/OwnerDashboardPreviewPage.tsx` (pass the props at every `<OwnerHomeDashboard` site)
- Modify: `apps/frontend/src/platforms/owner/router/OwnerRoutes.tsx` (`/owner/stay`)

- [ ] **Step 1:** `apps/frontend/src/features/owner-stay/hooks/useStay.ts`

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@lib/queryKeys';
import { stayApi } from '@features/stay/api';
import type { StayEventInput } from '@features/stay/types';

/** Owner Home's Tonight answers — portfolio-wide. */
export function useStaySummary() {
  return useQuery({ queryKey: queryKeys.stay.summary(), queryFn: stayApi.getSummary, staleTime: 60_000 });
}

/** One hostel's Stay board. */
export function useStayBoard(hostelId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.stay.board(hostelId),
    queryFn: () => stayApi.getBoard(hostelId as string),
    enabled: Boolean(hostelId),
    staleTime: 30_000,
  });
}

/** The owner updating a resident's stay (source OWNER). Refreshes the board and Home. */
export function useOwnerStayAction(hostelId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ tenantId, input }: { tenantId: string; input: StayEventInput }) =>
      stayApi.recordForResident(hostelId as string, tenantId, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.stay.board(hostelId) });
      queryClient.invalidateQueries({ queryKey: queryKeys.stay.summary() });
    },
  });
}
```

- [ ] **Step 2:** `apps/frontend/src/features/owner-stay/components/TonightSection.tsx`

```tsx
import { StatCard } from '@shared/ui-patterns/StatCard';
import type { TonightCards } from '@features/stay/stayState';

/**
 * Owner Home's answer to "how is my hostel tonight?" — three numbers, each a
 * question answered, all opening the Stay board. Rendered only once someone
 * lives here (`tonightCards` returns null before that). See ADR-194.
 */
export function TonightSection({ cards, onOpen }: { cards: TonightCards; onOpen: () => void }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tonight</h2>
        <button type="button" onClick={onOpen} className="text-[12.5px] font-semibold text-primary">
          Open
        </button>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <StatCard variant="action" label="Here tonight" value={cards.hereTonight.value} caption={cards.hereTonight.caption} onClick={onOpen} />
        <StatCard
          variant="action"
          label="Back today"
          value={cards.backToday.value}
          caption={cards.backToday.tone === 'danger' ? <span className="font-semibold text-destructive">{cards.backToday.caption}</span> : cards.backToday.caption}
          onClick={onOpen}
        />
        <StatCard variant="action" label="Rooms to check" value={cards.roomsToCheck.value} caption={cards.roomsToCheck.caption} onClick={onOpen} />
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Compose it into Home.**
  - In `useOwnerDashboard.ts`, import `useStaySummary` from `@features/owner-stay/hooks/useStay` and `tonightCards` from `@features/stay/stayState`. Call `const staySummaryQuery = useStaySummary();` beside the other queries, and add `tonight: tonightCards(staySummaryQuery.data),` to the returned object, after `actionCenter,`. A failed summary leaves `data` undefined, so `tonight` is null and Home simply doesn't show the row. It never breaks Home.
  - In `OwnerHomeDashboard.tsx`:
    - Import `TonightSection` and `type TonightCards`.
    - Add these to the props interface:
      ```ts
      /** Stay Status answers (ADR-194); null until someone lives here. */
      tonight?: TonightCards | null;
      onOpenStay?: () => void;
      ```
    - Destructure both, and render `{tonight && onOpenStay && <TonightSection cards={tonight} onOpen={onOpenStay} />}` immediately **before** the `{sections.actionCenter && (` block.
  - In `OwnerDashboardPreviewPage.tsx`, at **every** `<OwnerHomeDashboard` element that passes `actionCenter={dash.actionCenter}` (two sites at the time of writing), add:
    ```tsx
    tonight={dash.tonight}
    onOpenStay={() => navigate('/owner/stay')}
    ```

- [ ] **Step 4:** `apps/frontend/src/features/owner-stay/pages/StayBoardPage.tsx`

```tsx
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, MoreHorizontal, Printer } from 'lucide-react';
import { stayoToast } from '@shared/ui-patterns/Toast';
import { BottomSheet } from '@shared/ui-patterns/BottomSheet';
import { parseApiError } from '@lib/errors';
import { useOwnerSession } from '@features/owner-session/useOwnerSession';
import { HostelSwitcher } from '@features/owner-food/components/HostelSwitcher';
import { stayApi } from '@features/stay/api';
import { ReturnDateSheet } from '@features/stay/components/ReturnDateSheet';
import {
  boardHeadline, boardSections, MORE_ACTION_LABEL, roomLines,
  type BoardRow, type BoardSection, type ReturnDateMode,
} from '@features/stay/stayState';
import type { StayEventInput } from '@features/stay/types';
import { useOwnerStayAction, useStayBoard } from '../hooks/useStay';

/**
 * `/owner/stay` — "How is my hostel tonight?" answered: how many are here,
 * how many meals, who is late, who is back today, which rooms need a look.
 * Each person has one action; edits live behind that row's More. The hostel
 * rides on `?hostelId=` like the kitchen sheet — never "the first hostel".
 */
export function StayBoardPage() {
  const session = useOwnerSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const hostelId = searchParams.get('hostelId') ?? session.primaryHostelId;
  const hostelName = session.hostels.find((h) => h.id === hostelId)?.name ?? 'Hostel';
  const boardQuery = useStayBoard(hostelId);
  const action = useOwnerStayAction(hostelId);
  const [dateSheet, setDateSheet] = useState<{ row: BoardRow; mode: ReturnDateMode } | null>(null);
  const [moreFor, setMoreFor] = useState<BoardRow | null>(null);
  const [downloading, setDownloading] = useState(false);
  const board = boardQuery.data;

  const send = async (row: BoardRow, input: Omit<StayEventInput, 'idempotencyKey'>, done: string) => {
    try {
      await action.mutateAsync({ tenantId: row.tenantId, input: { ...input, idempotencyKey: crypto.randomUUID() } });
      stayoToast.success(done);
    } catch (error) {
      stayoToast.error(parseApiError(error) || 'Could not update. Try again.');
    }
  };

  const onPrimary = (row: BoardRow) => {
    if (row.primary === 'MARK_BACK') void send(row, { type: 'RETURNED' }, `${row.name} is back`);
    else if (row.primary === 'PUT_ON_LEAVE') setDateSheet({ row, mode: 'GOING_HOME' });
  };

  const onMoreChoice = (row: BoardRow, choice: 'CHANGE_DATE' | 'CANCEL_LEAVE') => {
    setMoreFor(null);
    if (choice === 'CANCEL_LEAVE') void send(row, { type: 'LEAVE_CANCELLED' }, `${row.name}'s leave cancelled`);
    else setDateSheet({ row, mode: 'CHANGE_DATE' });
  };

  const onPickDate = (date: string) => {
    const pending = dateSheet;
    setDateSheet(null);
    if (!pending) return;
    if (pending.mode === 'CHANGE_DATE') {
      void send(pending.row, { type: 'RETURN_DATE_CHANGED', expectedReturnDate: date }, 'New return date saved');
    } else {
      void send(pending.row, { type: 'LEAVE_STARTED', leaveType: pending.mode, expectedReturnDate: date }, `${pending.row.name} is on leave`);
    }
  };

  // A designed PDF, not window.print() — same reasoning as the kitchen sheet (ADR-144).
  const downloadPoster = async () => {
    if (!hostelId || downloading) return;
    setDownloading(true);
    try {
      const { blob, filename } = await stayApi.downloadPoster(hostelId);
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      stayoToast.error(parseApiError(error) || 'Could not build the QR poster.');
    } finally {
      setDownloading(false);
    }
  };

  const sections = board ? boardSections(board) : [];
  const urgent = sections.filter((s) => s.id === 'late' || s.id === 'back-today');
  const calm = sections.filter((s) => s.id === 'away' || s.id === 'here');
  const rooms = board ? roomLines(board) : [];
  const headline = board ? boardHeadline(board) : null;

  const renderSection = (section: BoardSection) => {
    const list = (
      <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
        {section.rows.map((row) => (
          <li key={row.tenantId} className="flex min-h-[56px] items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-foreground">{row.name}</p>
              <p className="text-[12.5px] text-muted-foreground">
                Room {row.roomNo}
                {row.detail ? ` · ${row.detail}` : ''}
              </p>
            </div>
            {row.primary && (
              <button
                type="button"
                disabled={action.isPending}
                onClick={() => onPrimary(row)}
                className="h-10 flex-none rounded-xl bg-primary px-3.5 text-[13px] font-bold text-primary-foreground disabled:opacity-60"
              >
                {row.primary === 'MARK_BACK' ? 'Mark back' : 'Put on leave'}
              </button>
            )}
            {row.more.length > 0 && (
              <button type="button" aria-label={`More for ${row.name}`} onClick={() => setMoreFor(row)} className="flex h-10 w-10 flex-none items-center justify-center rounded-xl text-muted-foreground">
                <MoreHorizontal className="h-5 w-5" />
              </button>
            )}
          </li>
        ))}
      </ul>
    );
    const title = (
      <span className={`text-xs font-bold uppercase tracking-wider ${section.tone === 'danger' ? 'text-destructive' : 'text-muted-foreground'}`}>
        {section.title}
      </span>
    );
    return section.collapsed ? (
      <details key={section.id} className="flex flex-col gap-2">
        <summary className="cursor-pointer list-none py-1">{title}</summary>
        <div className="mt-2">{list}</div>
      </details>
    ) : (
      <section key={section.id} className="flex flex-col gap-2">
        {title}
        {list}
      </section>
    );
  };

  return (
    <div className="mx-auto flex w-full max-w-[720px] flex-col gap-5 px-4 pb-24 pt-4 sm:px-6">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Tonight</p>
          <h1 className="truncate font-display text-2xl font-extrabold text-foreground">{hostelName}</h1>
        </div>
        <HostelSwitcher
          hostels={session.hostels}
          selectedId={hostelId}
          onSelect={(id) =>
            setSearchParams((prev) => {
              const next = new URLSearchParams(prev);
              next.set('hostelId', id);
              return next;
            }, { replace: true })
          }
        />
      </header>

      {!board || !headline ? (
        <div className="flex justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : board.residents === 0 ? (
        <p className="rounded-2xl border border-border bg-card p-5 text-[15px] text-muted-foreground">
          No one is living here yet. Once residents move in, tonight's picture appears here.
        </p>
      ) : (
        <>
          <section className="rounded-2xl border border-border bg-card p-5">
            <p className="font-display text-4xl font-extrabold tabular-nums tracking-tight text-foreground">{headline.here}</p>
            <p className="mt-1 text-[15px] text-foreground">{headline.meals}</p>
            <p className="text-[13px] text-muted-foreground">{headline.beds} · based on who's staying</p>
          </section>

          {urgent.map(renderSection)}

          {rooms.length > 0 && (
            <section className="flex flex-col gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Rooms to check</span>
              <ul className="divide-y divide-border rounded-2xl border border-border bg-card">
                {rooms.map((room) => (
                  <li key={room.roomId} className="px-4 py-3">
                    <p className="text-[15px] font-semibold text-foreground">{room.text}</p>
                    <p className="text-[12.5px] text-muted-foreground">{room.detail}</p>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {calm.map(renderSection)}
        </>
      )}

      <button
        type="button"
        onClick={downloadPoster}
        disabled={!hostelId || downloading}
        className="flex h-12 items-center justify-center gap-2 rounded-xl border border-border bg-card text-[14px] font-semibold text-foreground disabled:opacity-60"
      >
        {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Printer className="h-4 w-4" />}
        Print hostel QR
      </button>

      {dateSheet && board && (
        <ReturnDateSheet
          mode={dateSheet.mode}
          suggested={board.suggestedReturn}
          minDate={board.minReturnDate}
          maxDate={board.maxReturnDate}
          onPick={onPickDate}
          onClose={() => setDateSheet(null)}
        />
      )}

      {moreFor && (
        <BottomSheet open onOpenChange={(open) => !open && setMoreFor(null)} title={moreFor.name}>
          <div className="flex flex-col gap-2 pb-2">
            {moreFor.more.map((choice) => (
              <button
                key={choice}
                type="button"
                onClick={() => onMoreChoice(moreFor, choice)}
                className="h-12 w-full rounded-xl border border-border bg-card text-[15px] font-semibold text-foreground"
              >
                {MORE_ACTION_LABEL[choice]}
              </button>
            ))}
          </div>
        </BottomSheet>
      )}
    </div>
  );
}
```

Check `useOwnerSession()` exposes `primaryHostelId` and `hostels` (the kitchen sheet uses both), and that `HostelSwitcher`'s `hostels` prop accepts `session.hostels` (its type is `OwnerSessionHostel[]`).

- [ ] **Step 5: Route it.** In `OwnerRoutes.tsx`, add beside the food lazy imports:

```tsx
const StayBoardPage = lazy(() => import('@features/owner-stay/pages/StayBoardPage').then((m) => ({ default: m.StayBoardPage })));
```

and directly after `<Route path="/owner/food/kitchen" element={<KitchenSheetPage />} />`:

```tsx
        <Route path="/owner/stay" element={<StayBoardPage />} />
```

- [ ] **Step 6: Verify**

```bash
cd apps/frontend
npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "owner-stay|features/stay|owner-dashboard|OwnerDashboardPreviewPage|OwnerRoutes" || echo "no type errors in stay files"
npm run build 2>&1 | tail -5
npm test 2>&1 | tail -3
```

- [ ] **Step 7: Commit**

```bash
git add src/features/owner-stay src/features/owner-dashboard src/features/owner-onboarding/pages/OwnerDashboardPreviewPage.tsx src/platforms/owner/router/OwnerRoutes.tsx
git commit -m "feat(stay): owner Tonight answers on Home and the Stay board"
```

---

### Task 13: Documentation — the vault, the ADR, the spec deltas

CLAUDE.md makes this part of the change, not a follow-up. Don't invent anything: if something wasn't verified, write "Unknown / needs clarification".

**Files:**
- Modify under `docs/obsidian/`:
  - `Decisions.md`
  - `Features.md`
  - `APIs.md`
  - `Database.md`
  - `Business-Rules.md`
  - `Backend.md`
  - `Frontend.md`
  - `Changelog.md`
  - `README.md` (Quick Reference row)
- Modify: `docs/data-models/schema.md`
- Modify: `docs/superpowers/specs/2026-09-14-stay-status-design.md` (deltas)

- [ ] **Step 1: Claim the ADR number against `origin/main`, not the local file**

```bash
git fetch origin && git show origin/main:docs/obsidian/Decisions.md | grep -oE '^## ADR-[0-9]+' | sort -t- -k2 -n | tail -1
grep -oE '^## ADR-[0-9]+' docs/obsidian/Decisions.md | sort -t- -k2 -n | tail -1
```

Use the next free number (193 as of 2026-09-14). If it's taken by merge time, renumber every `ADR-194` in the vault **and in code comments** (`grep -rn "ADR-194" apps docs`).

- [ ] **Step 2: Write the ADR** in `Decisions.md`, following the file's existing ADR format. Its content:
  - **Title:** "Stay Status: stay_events is the permanent truth; every surface is a projection"
  - **Context:** there was no absence model. Owners run registers and WhatsApp groups. The PRD asks for a live occupancy engine.
  - **Decision:**
    - Append-only `stay_events` (a DB trigger refuses UPDATE), with a `stay_leaves` projection moved by one pure reducer shared with replay.
    - Status is derived, never stored. Silence = Present.
    - Residents = `OCCUPYING_ALLOCATION_WHERE`, shared with `roomCapacityService`.
    - "Today" is IST, never `hostels.timezone`.
    - Owner surfaces answer questions and never show states.
    - The QR route signs people in itself (outside `TenantProviderShell`).
    - New tables only.
  - **Consequences:** future modules (meals, housekeeping, guardians, analytics, WhatsApp) are new event types and read models. The date and time copy is English-only for now.
  - **Rejected alternatives:** a status column on `tenants` (the blast-radius rule, and no history); computing vacancy again; `window.print()` for the poster.

- [ ] **Step 3: Update the other vault pages.** Each links `[[Decisions#ADR-194|ADR-194]]` and at least one other note.
  - **Features.md:** a "Stay Status (Phase 1)" entry covering what a tenant can do, what an owner sees, and the entry points (`/stay/:hostelId`, the Tenant Home block, the Home Tonight row, `/owner/stay`, the poster).
  - **APIs.md:** the six endpoints with auth, body and response, copied from Task 8's wire-contract table and route docblocks.
  - **Database.md:** `stay_events` and `stay_leaves`, column by column, with the partial unique index, the append-only trigger, RLS-with-no-policies, the migration folder name, and **whether it has been applied to test and prod** (state exactly what Task 14 verified).
  - **Business-Rules.md:**
    - Silence = Present; Late isn't counted as here; "back today" counts as here.
    - The return date runs from tomorrow to 90 days out; the smart default is Thu/Fri → Sunday, otherwise tomorrow.
    - A double Going Home is a no-op, and so is a double I'm Back.
    - An owner can't confirm presence.
    - Only ACTIVE residents may update their stay.
  - **Backend.md / Frontend.md:** the new `src/services/stay/` and `features/stay` / `features/owner-stay` modules and their one-line responsibilities.
  - **Changelog.md:** a dated entry (2026-09-14) naming the ADR.
  - **README.md:** a Quick Reference row for Stay Status pointing at the pages above.
  - **`docs/data-models/schema.md`:** the two tables.

- [ ] **Step 4: Bring the spec in line with what was built.** Edit `docs/superpowers/specs/2026-09-14-stay-status-design.md`:
  - `RETURNED` with no active leave is a **no-op** (not a reject), and a second `LEAVE_STARTED` is a no-op.
  - The QR artefact is an **A4 PDF poster** (`GET /api/hostels/[id]/stay/poster`), not an SVG route.
  - The QR page **signs people in itself**; `ProtectedTenantRoute` and `safeReturnPath` are **not** changed or added.
  - An owner event for a non-resident returns **409 `STAY_INELIGIBLE`** (not 404). A malformed tenant id returns 404.
  - The meal answer always shows, labelled "based on who's staying"; the condition on meal timings is dropped.
  - `stay_events` gains `seq BIGSERIAL` as the replay order.

- [ ] **Step 5: Check the vault's links, then commit**

```bash
grep -c "ADR-194" docs/obsidian/*.md
git add docs
git commit -m "docs(stay): ADR-194, vault pages, schema and spec brought in line with the build"
```

---

### Task 14: Verify end to end, then ship to dev

- [ ] **Step 1: Every automated gate, compared against the Task 0 baseline**

```bash
cd apps/backend
npm run test:pure 2>&1 | tail -5
npx vitest run tests/stay-service.db.test.ts tests/room-capacity-service.test.ts 2>&1 | tail -8
npm run check:invariants
npx tsc --noEmit 2>&1 | grep -E "src/services/stay|app/api/(tenant|owner|hostels/\[id\])/stay|stay-poster|timezone|room-capacity" || echo "clean"
cd ../frontend
npm test 2>&1 | tail -3
npm run build 2>&1 | tail -3
npx tsc --noEmit -p tsconfig.json --ignoreDeprecations 6.0 2>&1 | grep -E "stay|owner-dashboard|OwnerRoutes|TenantRoutes|TenantHomePage" || echo "clean"
grep -rn "stay_events\.\(update\|delete\|upsert\)" ../backend/src ../backend/app ../backend/lib || echo "append-only holds in code"
```

Report actual numbers. Any failure outside the stay files must be shown to be pre-existing (it appeared in the Task 0 baseline) before it's set aside.

- [ ] **Step 2: Manual end-to-end run** (use the `run` skill; backend against the **test** DB, which has the migration)

  1. As an owner on `/owner/stay`: **Print hostel QR**, and open the PDF. It should be one A4 page with the hostel name, "Back? Scan me." and a large QR. Decode the QR (any phone camera) and confirm it's `…/stay/<hostelId>`.
  2. In a signed-out browser, open `/stay/<hostelId>`. You should see "Sign in once". Sign in as a resident tenant: the page stays on `/stay/<hostelId>` and shows **"You're in ✓"** with no button.
  3. The DB has exactly one `PRESENCE_CONFIRMED` row for today. Reload: still one.
  4. **More → Going home** shows one button ("Back tomorrow", or "Back Sunday" on Thu/Fri). Tap it: the screen becomes **Away · Back tomorrow** with one big **I'm back**.
  5. Owner board: here-tonight drops by 1, the tenant is under **Away**, and if they were alone in the room, the room is under **Rooms to check · Empty tonight**. The Home **Tonight** row agrees.
  6. On the owner board, change the date (More → Change return date → today+2). The tenant's screen shows the new date after a refetch.
  7. Tenant taps **I'm back**. "Welcome back ✓" shows on the tap; the board returns to the step-1 numbers, and the tenant shows under Back today as "Arrived ✓".
  8. Scan as a tenant of another hostel: "This code is for another hostel."
  9. `select type, source, effective_date from stay_events where tenant_id = '<id>' order by seq;` shows the full trail. `select * from stay_leaves where tenant_id = '<id>';` shows one RETURNED leave that matches it.

  Time steps 4 and 7 on a phone. Each tap should feel instant; note anything over ~1 second.

- [ ] **Step 3: Production migration — only with the user's explicit go-ahead.** `origin/dev` deploys the production backend (`stayo-testing.vercel.app` behind `yourstayo.com/api`). So the tables must exist in production **before** merging.
  - Confirm the target first: `curl -s https://yourstayo.com/api/health | jq '.auth.supabase.project_ref'` must be `qgfyfbdccjnibdhhvnsr`.
  - Ask the user. On a yes, apply `prisma/migrations/20260914100000_stay_status_events/migration.sql` via the Supabase connector's `apply_migration` for project `qgfyfbdccjnibdhhvnsr`.
  - Verify with `information_schema` (16 + 11 columns, 9 indexes).
  - Record the date in `Database.md`.

- [ ] **Step 4: Merge to dev** (per the git workflow: never push to `main`)

```bash
git fetch origin
git log --oneline origin/main..HEAD          # every commit must be this feature's
git merge origin/main                        # bring main in first; resolve, re-run Step 1 if anything moved
git merge-base --is-ancestor origin/dev HEAD && echo "dev is behind us — fast-forward is safe"
git push origin HEAD:dev
```

If `dev` has diverged, merge `origin/dev` into the branch, re-run Step 1, then push. Report the pushed SHA and what the production `/api/health` reports as the live commit.

---

## Self-review (done while writing)

- **Spec coverage:**
  - Event store, projection, reducer and replay: Tasks 3, 5, 6, 9.
  - Derived status, IST and the smart default: Tasks 1 and 2.
  - Residents from `roomCapacityService`'s predicate: Tasks 1 and 6.
  - Owner answers: Tasks 4, 10 and 12.
  - QR page, progressive disclosure and one primary action: Tasks 10 and 11.
  - Tenant Home block: Task 11. Owner overrides: Tasks 8 and 12. Poster: Tasks 7 and 12.
  - Portfolio summary for Home: Tasks 4, 6, 8 and 12.
  - Invariant coverage: Task 8. Docs and ADR: Task 13. Prod migration gate: Task 14.
- **Deliberate deltas from the spec** (written back in Task 13 Step 4): RETURNED no-op, PDF poster instead of SVG, self-contained sign-in instead of return-path plumbing, owner 409, the meal answer always shown, and `seq`.
- **Types are consistent across tasks:**
  - Backend `TenantStay` / `StayBoardView` equal frontend `TenantStay` / `StayBoard` (both extend `DateWindow`).
  - `StayEventType` strings are identical.
  - `stayApi` (frontend) and `stayService` (backend) are distinct names on purpose.
