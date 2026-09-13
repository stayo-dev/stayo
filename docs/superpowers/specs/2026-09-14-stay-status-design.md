# Stay Status — Phase 1 core design

**Date:** 2026-09-14 · **Status:** approved · **Branch:** `feat/stay-status`
**Source:** PRD "Stayo Stay Status System v1.0" · **Audit:** [`docs/audits/stay-status-audit.md`](../../audits/stay-status-audit.md)

## 1. The rule this design exists to protect

> **`stay_events` is the permanent truth. Every UI is a projection of it.**

- Stay updates are **events**, appended and never edited.
- Current state (who is on leave) is a **projection** rebuilt by one pure reducer.
- Owner screens are **read models** that answer questions. They never show database states.

Future modules (meal forecasting, housekeeping automation, guardian notifications, occupancy
analytics) are built as **new read models over the same event stream** and new event types. None
of them changes the core.

Three product rules sit alongside it, and every screen is checked against them:

1. **Reduce decisions, don't display options.** The default state of any screen is a
   confirmation or a single action. Everything else sits behind **More** (progressive disclosure;
   never long-press, which isn't discoverable).
2. **The two-second rule.** QR: scan → one action → done, like Apple Pay. Going home: two taps in
   the common case.
3. **Answer the owner's question.** "How many for dinner?", "Who's back today?", "Which rooms
   need attention?". Not "status = ON_LEAVE, count = 18".

## 2. Scope

**In (Phase 1 core):**
- the event store and projection
- derived stay status
- tenant actions: I'm Back, Going Home, Vacation, change return date, cancel
- the hostel QR landing page
- the tenant Home block
- owner Home answer cards and the owner Stay board
- owner-entered updates
- a printable QR poster

**Out (named follow-ups; each is a new read model or event type):**
- **WhatsApp slice:**
  - Going Home / I'm Back / evening reminder
  - Templates with per-tenant quick-reply payloads
  - A 24-hour-window tracker
  - Opt-out
  - A scheduled send

  It calls the same `recordStayEvent` with source `WHATSAPP`.
- **Phase 2:**
  - `AWAY_TODAY`
  - Meal forecast with participation history
  - Housekeeping tasks (assign or done)
  - Temporary vs permanent vacancy
  - Return waves and weekend patterns
- **Phase 3:** owner push alerts, guardian notifications, NFC.

## 3. Product decisions

| # | Decision | Why |
|---|---|---|
| D1 | **Silence = Present.** | Track intent, not movement. A tenant who says nothing is staying. |
| D2 | Only **two stored states** (present / on leave). *Away Today* waits for the meal slice. | It changes meal counts only, not who sleeps here. |
| D3 | **Going Home and Vacation are one leave with a type tag.** **The return date is required.** | A known date is what makes "back today" and "late" possible. |
| D4 | **The QR primary is context-aware.** On leave → one **[I'm Back]**. Present → "You're in ✓" with no button. | The primary is always the single most likely action. |
| D5 | **Trust-based.** The app and the QR expose the same actions, and every event records its source. | A laminated QR can be photographed; it can't prove presence. Source lets the owner judge. |
| D6 | **Late returns are dashboard-only** in Phase 1 (computed at read time; no cron, no push). | No new infrastructure; alerts arrive with WhatsApp. |
| D7 | A leave **starts today**. | Planned future leaves arrive with the WhatsApp slice. |

## 4. Event store

### `stay_events` (append-only, the source of truth)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `tenant_id` | uuid | the tenancy row |
| `hostel_id` | uuid | |
| `room_id` | uuid null | **snapshot** of the resident's room at event time, so housekeeping and trends survive room transfers |
| `type` | text | see below; validated in the service |
| `effective_date` | date | IST calendar date the event applies to |
| `occurred_at` | timestamptz | default `now()` |
| `leave_type` | text null | `GOING_HOME` \| `VACATION` |
| `expected_return_date` | date null | |
| `source` | text | `QR` \| `APP` \| `OWNER` \| `WHATSAPP` |
| `actor_profile_id` | uuid null | who pressed the button |
| `actor_role` | text | `TENANT` \| `OWNER` \| `SYSTEM` |
| `idempotency_key` | text **unique** | stops double taps and retries |
| `schema_version` | int default 1 | |
| `payload` | jsonb default `{}` | forward-compatible extras |

Indexes: `(hostel_id, occurred_at)`, `(tenant_id, occurred_at)`, `(hostel_id, effective_date)`.
No UPDATE or DELETE is issued by application code.

**Phase 1 event types:**

| Type | Meaning |
|---|---|
| `LEAVE_STARTED` | Going Home / Vacation. Needs `leave_type` and `expected_return_date`. |
| `RETURN_DATE_CHANGED` | extend or shorten an active leave |
| `RETURNED` | I'm Back (tenant) or Mark back (owner) |
| `LEAVE_CANCELLED` | undo a leave started by mistake |
| `PRESENCE_CONFIRMED` | a QR scan by a tenant already present. Key `presence:<tenantId>:<istDate>` limits it to one per tenant per IST day. No UX cost; a signal for trust and trends. |

### `stay_leaves` (a projection, rebuildable)

| Column | Notes |
|---|---|
| `id` | = the `LEAVE_STARTED` event id |
| `tenant_id`, `hostel_id` | |
| `leave_type`, `start_date`, `expected_return_date` | |
| `status` | `ACTIVE` \| `RETURNED` \| `CANCELLED` |
| `returned_at` | |
| `last_event_id` | the most recent event folded in |
| `created_at`, `updated_at` | |

A partial unique index `ON (tenant_id) WHERE status = 'ACTIVE'` allows **one active leave per
tenant**. Index `(hostel_id, status, expected_return_date)`.

### One reducer, two callers

```
applyStayEvent(current: LeaveState | null, event) → { next: LeaveState | null } | { reject: Reason }
replayStayEvents(events[]) → Map<tenantId, LeaveState[]>
```

- The **write path** loads the tenant's active leave, runs `applyStayEvent`, then in **one
  transaction** inserts the event and upserts the projection.
- `replayStayEvents` folds the full stream. Tests assert **replay(events) == live projection**,
  so they can never diverge. A projection bug is fixed by replaying the stream, never by editing
  events.

**Rejections** (400/409 at the route):
- `RETURNED` / `RETURN_DATE_CHANGED` / `LEAVE_CANCELLED` with no active leave
- a return date before tomorrow or more than 90 days out
- an unknown type or leave type

`LEAVE_STARTED` while already on leave is **not** an error. The write is a no-op that returns
the current leave (idempotent double tap).

### Migration and deploy safety

- **New tables only.** No columns are added to `tenants`, `hostels` or `rooms`. Adding a Prisma
  field changes every unselected query on that model (the 2026-08-22 outage), and new models
  change none.
- Types and statuses are plain `text`, validated in the service (repo convention).
- The SQL uses `IF NOT EXISTS`. It is **applied to the test DB and production before any code
  that reads the tables is deployed**. Follow the most recent migration convention at
  implementation time.

## 5. Residents and derived status

**A resident of hostel H** is a `tenants` row with `status = 'ACTIVE'` and an occupying
allocation in H (`is_active = true AND end_date IS NULL`). That's **exactly
`roomCapacityService`'s predicate**, extracted once into an exported constant that both use. So
the board holds this identity by construction:

> **here tonight + away = occupied beds**, and **occupied + vacant = capacity**

```
deriveStayStatus(activeLeave | null, todayIST)
  no active leave                       → PRESENT
  expected_return_date == today         → RETURNING_TODAY   (counts as here tonight)
  expected_return_date <  today         → LATE              (not counted as here)
  otherwise                             → ON_LEAVE
```

- INVITED tenants aren't residents (not moved in).
- **Checked Out** is the existing move-out lifecycle, not a Stay state. An open leave on an ended
  tenancy is harmless, because every read filters to residents.
- **"Today" is always IST.** `istToday()` / `istDateOf()` live in `lib/timezone.ts`, and
  `hostels.timezone` is never read (it is `UTC` in production).

## 6. The owner's questions (read model)

`buildStayBoard({residents, activeLeaves, capacityByRoom, today})` is pure. Each section is an
answer:

| Question | Answer shown | Derivation |
|---|---|---|
| **How many here tonight?** | "31 here tonight" | residents − ON_LEAVE − LATE |
| **How many meals?** | "Dinner tonight · breakfast tomorrow ≈ 31", plus "+2 late may turn up". The caption reads "based on who's staying". | = here tonight. Shown only when meal timings are enabled for the hostel. Phase 2 replaces it with a forecast model; the card stays. |
| **Who's back today?** | names + room, and "✓ back" once they tap | RETURNING_TODAY, plus any `RETURNED` today |
| **Who's late?** | "Rahul · room 204 · expected yesterday" | LATE, oldest first |
| **Which rooms need attention?** | "Empty tonight" rooms (everyone away: clean or check) and "Someone back today" rooms (prepare) | leaves × allocations grouped by room |
| **Beds free?** | "3 vacant" | `roomCapacityService` (never recomputed) |

**Owner Home** (portfolio-wide, `GET /api/owner/stay/summary`):
- It adds answer cards to the existing `actionCenter`: *"31 here tonight"*, *"4 back today"*
  (caption turns red with "2 late"), *"3 rooms to check"*.
- The meal answer lives on the here-tonight card's caption, to avoid a fourth decision.
- The **Fill Vacant Beds** card is unchanged.
- Tapping any card opens the Stay board.

**Stay board** (`/owner/stay`, one hostel via the existing hostel selector):
- The sections above, in priority order: Late → Back today → Rooms to check → Away.
- Each person row has one action (**Mark back** for someone away, **Put on leave** for someone
  present). Changing a return date or cancelling sits behind the row's **More**.
- A header link opens **Print QR**.

## 7. Tenant surfaces

### QR landing `/stay/:hostelId`

| Tenant state | What they see |
|---|---|
| Signed out | Login. After success they return to `/stay/:hostelId` (see 7.3). |
| A resident of this hostel, present | **"You're in ✓"** with the hostel name. No button. A deduped `PRESENCE_CONFIRMED` (source `QR`) is recorded. **More** reveals Going Home and Vacation. |
| A resident of this hostel, away | One full-width **[I'm Back]**. Tap → `RETURNED` (source `QR`) → the "Welcome back ✓" success state with the existing `successFeedback`. **More** reveals Change date / Cancel leave. |
| A tenant of another hostel | One line: "This code is for another hostel." |
| Not a resident (invited, departed) | One line pointing to their normal dashboard. |

### Going Home and Vacation (behind More)

- **Going Home** shows **one smart-default button**, "Back Sunday" from Thursday to Saturday and
  "Back tomorrow" otherwise (IST), which records immediately. "Other date" is disclosed beneath
  it and opens a date picker. That's two taps in the common case.
- **Vacation** opens the date picker directly, since it has no sensible default.

### Deep link through login

- `ProtectedTenantRoute` passes the attempted path in router state, and the login flow honours
  it for tenants.
- A pure `safeReturnPath(raw)` accepts only same-origin absolute paths (a leading `/`, not `//`,
  no scheme). Anything else falls back to the current destination.

### Tenant Home

A `stayBlock` renders the same screen model as the QR page (source `APP`): one status line, at
most one button, and **More**. It goes in both the desktop and mobile layout branches of
`TenantHomePage.tsx`.

## 8. API

| Method | Path | Who | Notes |
|---|---|---|---|
| GET | `/api/tenant/stay` | TENANT | `{hostel:{id,name}, resident:boolean, status, leave}` via `liveTenancyWhere(session.sub)` |
| POST | `/api/tenant/stay/events` | TENANT | `{type, leaveType?, expectedReturnDate?, source:'QR'\|'APP', idempotencyKey}`. 409 `STAY_INELIGIBLE` if not a resident. |
| GET | `/api/hostels/[id]/stay` | OWNER | board; `resolveOwnerScope` → `requireHostelBelongsToOwner` |
| POST | `/api/hostels/[id]/stay/tenants/[tenantId]/events` | OWNER | source `OWNER`. The target must be a resident of that hostel; otherwise 404. |
| GET | `/api/owner/stay/summary` | OWNER | portfolio totals plus per-hostel answers. Takes no `hostelId`, like `/api/owner/portfolio/summary`. |
| GET | `/api/hostels/[id]/stay/qr` | OWNER | SVG from the local `qrcode` package, encoding `${PUBLIC_APP_URL}/stay/<hostelId>` |

- Every write goes through **`stayService.recordStayEvent(input)`**, which is channel-agnostic.
  The WhatsApp handler will call it unchanged.
- The new `src/services/stay` and `app/api/**/stay` folders are added to the scan roots of
  `scripts/architectural-invariants-check.ts`.
- Nothing touches `portfolio-service.ts` or the dashboard cache. Frontend freshness is React Query
  invalidation by key.

## 9. Code layout

**Backend** (`apps/backend`):

| File | Role |
|---|---|
| `lib/timezone.ts` | + `istDateOf`, `istToday` (moved from `payout-promise.ts`, which re-exports it) |
| `lib/services/room-capacity-service.ts` | + exported `OCCUPYING_ALLOCATION_WHERE`, no behaviour change |
| `src/services/stay/stay-events.ts` | types, `applyStayEvent`, `replayStayEvents` (pure) |
| `src/services/stay/stay-status.ts` | `deriveStayStatus`, `validateReturnDate`, `smartReturnDate` (pure) |
| `src/services/stay/stay-board.ts` | `buildStayBoard`, `summarizePortfolio` (pure) |
| `src/services/stay/stay-service.ts` | `recordStayEvent`, `getMyStay`, `getHostelBoard`, `getPortfolioSummary` (I/O) |
| `app/api/tenant/stay/**`, `app/api/hostels/[id]/stay/**`, `app/api/owner/stay/summary` | thin routes |

**Frontend** (`apps/frontend/src`):

| File | Role |
|---|---|
| `features/stay/stayState.ts` (+ `.test.ts`) | `screenFor(stay)`, `smartReturnDate`, `boardSections(board)`, `safeReturnPath` (pure) |
| `features/stay/api/index.ts` | wrappers via `@lib/api-client`; keys in `lib/queryKeys.ts` |
| `features/stay/components/*` | thin renderers: `StayActionPanel` (shared by QR + Home), `ReturnDateSheet` |
| `platforms/tenant/pages/StayScanPage.tsx` | `/stay/:hostelId` |
| `features/owner-stay/pages/{StayBoardPage,StayQrPosterPage}.tsx` | `/owner/stay`, `/owner/stay/qr` |

## 10. Testing

- **Backend pure** (added to `vitest.pure.config.ts`'s explicit allowlist, or they never run):
  - every reducer transition and rejection
  - **replay == projection**
  - derivation at the IST midnight boundary
  - `smartReturnDate` for each weekday
  - `validateReturnDate` bounds
  - each board answer, including rooms-to-check and **here + away = occupied**
- **Backend DB-backed** (`tests/stay-service.test.ts`):
  - a double submit yields one active leave and one event (idempotency key)
  - every write yields exactly one event
  - owner-scope rejection across owners
  - INVITED / FORMER_TENANT exclusion
  - board counts == `roomCapacityService` occupied for the same hostel
  - Baseline an untouched spec first; the test DB has lagged migrations before.
- **Frontend pure:**
  - `screenFor` for each state (never more than one primary)
  - `smartReturnDate`
  - `boardSections` ordering
  - `safeReturnPath` rejecting `//evil`, `https:`, `javascript:`
- **Checks:**
  - backend `npm run check:invariants`, `test:pure`
  - frontend `npm test`, `npm run build`, `tsc --noEmit` filtered to stay files
- **Manual end-to-end:**
  1. Print the poster and scan it while signed out.
  2. Log in and land back on `/stay/...`.
  3. See "You're in ✓".
  4. More → Going Home → Back tomorrow.
  5. The owner board: here-tonight −1, and the room appears under Rooms to check if applicable.
  6. The next day, the tenant shows under Back today.
  7. I'm Back.
  8. The board is restored, and `stay_events` shows the full trail.

## 11. How future modules plug in (no core change)

| Module | New event types | New read model |
|---|---|---|
| Meal forecast | `AWAY_TODAY`, `MEAL_SKIPPED` | per-date/slot counts from events plus participation history |
| Housekeeping | `ROOM_CLEANED` | rooms from leave and return events, minus cleanings |
| Guardian notifications | — | a subscriber on `LEAVE_STARTED` / `RETURNED` |
| Occupancy analytics | — | nightly here-tonight series folded from events |
| WhatsApp | — (source `WHATSAPP`) | a handler calling `recordStayEvent` |
