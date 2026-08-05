# Food module — engineering, product & UX audit

**Date:** 2026-08-05 · **Status:** For review before any Food redesign · Author: engineering audit against live code and live data

Every claim below was verified by reading the implementation and, where noted, by querying the production database. Nothing is inferred from screenshots alone. Where something could not be verified it is marked **Unverified**.

**Scope:** the whole lifecycle — Food Library → Menu Planning → Weekly Schedule → Publishing → Student Experience → Voting → Kitchen Operations → History → Analytics.

**Size of the system under audit:** 14 API routes (~980 lines), 1 service (74 lines), 5 Prisma models, 20 frontend files. It is a small, mostly well-written module. Most of what follows is not "this code is bad" — it is "this code models the wrong thing, and half the product is a mock."

---

## 0. The three findings that matter most

### 0.1 There is no monthly menu. There is one week, repeated.

The screen is called **"Meal Planner — Create and manage your hostel's monthly menu."** The table it writes to is `food_schedule_meals`, keyed by:

```prisma
@@unique([schedule_id, day_of_week, meal_type])   // day_of_week = MONDAY..SUNDAY
```

7 days × 4 meal types = **28 rows per month**. There is no date column anywhere in the food schema. A "month" is a container for exactly one Mon–Sun pattern.

Consequences, all of them structural rather than cosmetic:

- Every Monday in the month is identical, by construction. So is every other weekday.
- **A festival menu is unrepresentable.** So is an exam-week menu, a "special Sunday," a one-off guest meal, or "no dinner on the 15th, the kitchen is closed."
- The Month History list shows "August 2026" expanded into Mon/Tue/Wed… — it is showing you a *pattern*, not what was actually served. Nobody can answer "what did we serve on 14 August?" because that was never recorded.

The tenant hook is honest about this in a comment where the UI is not:

> `useTenantFoodSchedule.ts:38` — *"it's a repeating weekly pattern (Mon–Sun), not calendar-dated, so there's no per-date data to show."*

This is the ceiling on everything else in the module. Voting intelligence, rotation suggestions, cost-per-day, kitchen sheets, "what did students actually eat" — all of them need a date. **Impact: critical. Effort: medium (schema + migration). It is the prerequisite for most of §5–§7.**

### 0.2 "Regenerate" silently unpublishes the live menu and destroys all edits

`app/api/food/schedules/generate/route.ts:99` — the upsert's `update` branch:

```ts
update: {
  status: "DRAFT",              // <- a PUBLISHED schedule is flipped back to DRAFT
  source: "GENERATED",
  ...
}
```
```ts
await tx.food_schedule_meals.deleteMany({ where: { schedule_id: upserted.id } });   // :107
```

The **Regenerate** button sits directly next to the green **PUBLISHED** badge in `WeeklyScheduleGrid.tsx:58-65`. It has no confirmation dialog, no undo, and — unlike the first-time **Generate** button — it is *not* gated by `canGenerate`. One tap:

1. deletes all 28 meal rows, including every manual correction the owner made;
2. sets `status = "DRAFT"`;
3. leaves `published_at` populated, so the row now claims a publish timestamp it no longer honours.

Because `GET /api/food/tenant/schedule` filters on `status: "PUBLISHED"` (`tenant/schedule/route.ts:37`), **every tenant's Food tab goes empty the instant the owner taps Regenerate.** The owner gets no warning that this happened.

The route's own doc comment asserts the opposite:

> *"Re-running overwrites the previous generation — always safe since nothing is published until the owner explicitly publishes."*

That is true only for a schedule that has never been published. It is false in exactly the case the button is most likely to be pressed. **Impact: critical. Effort: small.**

### 0.3 The entire "Food Polls" tab is mock data — and the owner's Home screen promotes it

`useFoodPolls.ts` is seeded from `mockFoodPolls` and never touches the network:

```ts
const [polls, setPolls] = useState<MockFoodPoll[]>(mockFoodPolls);
const publishPoll = (poll, notify) => { setPolls((p) => [poll, ...p]); ... };   // setState only
const closePoll   = (id) => { setPolls(...); stayoToast.success('Voting closed · winner announced'); };
const useWinner   = (...) => { ...; stayoToast.success(`"${winner.name}" added to menu · edit before publishing`); };
```

`useWinner` shows a toast saying the winner was **added to the menu**. It adds nothing to anything. Everything on this tab evaporates on refresh.

Specifics, all verified:

| Thing | Reality |
|---|---|
| Poll list | 4 hardcoded polls, `date: 'Sat, 26 Jul'` |
| "of 180 voted" | `totalTenants: 180` hardcoded in the mock **and** in `useCreatePollDraft.buildPoll()` |
| Date / Closing time fields | Rendered as `<div>`, not inputs (`CreatePollModal.tsx:167,171`) — unchangeable |
| 3 toggles (Anonymous / Multiple / Notify) | Local state; never leave the browser |
| "Edit" button | `stayoToast.info('Opening poll editor…')` — no editor exists |
| Smart Insights ("82% of tenants prefer North Indian meals") | 4 hardcoded strings in `SMART_INSIGHTS` |

Meanwhile a **real** voting system exists and works — `VotingPanel` + `useFoodVoting` against `/api/food/voting-periods` — sitting on the *other* tab, under a different name, with a different mental model.

Worse, the fake flow is a **Home-screen Quick Action**: `useHomeQuickActions.ts:55` navigates to `/owner/food` with `state: { openCreatePoll: true }`, which opens the mock sheet. The owner's home screen advertises a feature that does nothing.

**Impact: critical (trust). Effort: small — delete it, and rename the real one.**

---

## 1. Critical Backend Problems

Answers to the lifecycle questions asked, verified from code.

### 1.1 What happens when Publish is clicked?

`POST /api/food/schedules/[id]/publish` — 75 lines, no service layer:

1. `getSession` → OWNER/ADMIN only; `resolveOwnerScope`.
2. `food_schedules.findFirst({ id, owner_id })` — 404 if not the owner's.
3. `food_schedule_meals.count()` — rejects with `VALIDATION_ERROR` if 0.
4. `food_schedules.update({ status: "PUBLISHED", published_at })`.
5. If it was not already published: `tenants.findMany({ status: "ACTIVE", profile_id: not null })` → one in-app `notificationService.createNotification(...)` per tenant, via `Promise.allSettled`.

**Tables written:** `food_schedules` (1 row), `notifications` (N rows, best-effort).
**Services involved:** none for the state change; `notificationService` for fan-out. All business logic is inline in the route, against `CLAUDE.md`'s "routes stay thin" rule.

### 1.2 Is publish atomic? — **Effectively yes. Correct as-is.**

The state change is a single-row update. The notification fan-out is deliberately outside it (`Promise.allSettled`), so a failed notification cannot roll back a publish. That is the right trade-off and does not need changing.

### 1.3 Is publish idempotent? — **Yes. Correct as-is.**

`wasAlreadyPublished` (`publish/route.ts:41`) preserves the original `published_at` and suppresses a second notification storm. Publishing twice is safe. This is one of the better-considered parts of the module — do not rebuild it.

### 1.4 Is there draft vs live? — **Only nominally. This is a real design gap.**

`FoodScheduleStatus` has `DRAFT | PUBLISHED`, but `@@unique([hostel_id, month])` means **one row per hostel per month**. There is no draft/live *pair*. Once published, that row *is* the live menu, and every edit lands on it instantly:

> `meals/[mealId]/route.ts:13` — *"If the schedule is already PUBLISHED, this same row is what tenants read — there is no separate 'republish' step, per the product spec."*

So an owner cannot draft next month's changes while this month runs, cannot stage a set of edits and review them, and cannot make a correction without it being live mid-keystroke. The UI states this plainly — *"Live — any edit above updates tenants immediately"* — which is honest, but it is a constraint the owner never agreed to.

### 1.5 Does publishing overwrite data? — **Publish does not. Regenerate does.** See §0.2.

### 1.6 Are historical menus immutable? — **No. There is no snapshot.**

`MonthHistoryList` fetches history detail via `foodService.getSchedule(hostelId, month)` — the same mutable row, through the same endpoint the editor uses. There is no `food_schedule_history` table and no versioning. A `PATCH` against a past month's `scheduleId` rewrites history with no audit trail.

**Precise exposure:** `FoodPage.tsx:38` hardcodes `currentMonth` for the editor, so the *UI* only ever mutates the current month — history is read-only in practice. The routes themselves accept any schedule id the owner owns, so the exposure is API-level. It should still be closed: `item_name` is already denormalized specifically so history survives library edits, which shows the intent was immutability. The schedule row itself just never got the same treatment.

### 1.7 How is history stored?

It is not stored separately. "History" = `GET /api/food/schedules/history?hostelId=` → `food_schedules WHERE status = 'PUBLISHED' ORDER BY month DESC`, returning `{id, month, status, published_at}` only; the owner then drills into the live row per month. History is a *filter over current state*, not a record.

### 1.8 How is regeneration implemented? What exactly is "Regenerate"?

`POST /api/food/schedules/generate` with `{hostelId, month, votingPeriodId?}`:

1. For each of the 4 meal types, tally `food_votes` for the month's voting period via `groupBy`, ranked by count desc, ties by name.
2. **If there are zero votes** (or no voting period), fall back to *all active library items for that meal type, alphabetically*.
3. `assignWeekForMealType(ranked)` — the only real algorithm in the module (74 lines, `lib/services/food-schedule-generator.ts`): largest-remainder proportional allocation of 7 slots by vote share, then a round-robin "deal" pass so repeats spread across the week rather than clustering. It is clearly written, correctly handles the zero-vote and empty-library cases, and honestly labels itself *"v1 heuristic, not claimed-optimal."* **This code is fine. Keep it.**
4. Upsert the schedule, `deleteMany` the 28 meals, `createMany` the new 28 — all inside `prisma.$transaction`. **Generation is atomic. Correct as-is.**

"Regenerate" is therefore *not* a refinement — it is a full destroy-and-rebuild of the week from library + votes, discarding every human decision. The word implies iteration; the behaviour is reset.

### 1.9 How does voting work? Are votes connected to menus? Does voting influence planning?

**Mechanically connected; in practice, inert.**

- One `food_voting_periods` row per hostel per month (`@@unique([hostel_id, month])`), `DRAFT | OPEN | CLOSED`.
- `POST /api/food/tenant/vote` toggles a `food_votes` row; tenants may pick multiple items per meal type. Guarded by both `status === 'OPEN'` **and** `now ∈ [voting_starts_at, voting_ends_at]`. Correct.
- The generator reads those votes (§1.8 step 1). So yes, votes reach planning.

But live data shows the loop has never actually closed:

- **1 voting period ever created** (July 2026, hostel `fad5…`, now CLOSED). **2 votes total, across the whole database.**
- The August 2026 schedule was generated with **`generated_from_voting_period_id: null`** — no August voting period exists, so it ranked on the alphabetical fallback. Votes influenced nothing.
- Both July schedules have `source: MANUAL` — the owner hand-edited after generation, overriding whatever the votes produced.

Three structural reasons it stays inert:

1. **Voting is for the month that is already running.** `tenant/vote/route.ts:45` uses `firstOfMonth(new Date())` — the *current* month. `FoodPage.tsx` opens voting for `currentMonth`. So tenants vote in August, for August, whose menu is already published. The tenant UI header says **"Vote for next month"** (`TenantFoodPage.tsx:80`) — that label is simply false.
2. **Voting periods never auto-close.** Nothing transitions `OPEN → CLOSED` when `voting_ends_at` passes; only the manual `POST .../close` does. Votes are correctly rejected after the end time, but `status` stays `OPEN` forever.
3. **That dead-ends the Generate button.** `FoodPage.tsx:60`: `canGenerate = !voting.period || voting.period.status === 'CLOSED'`. An owner who opens voting and forgets to close it can never generate a schedule — the empty state tells them *"Close voting first"*, but the Close button only appears while `isOpen`, and the panel is far above the grid. (Inconsistently, **Regenerate** ignores `canGenerate` entirely — the gate applies only to the first generation.)

### 1.10 Which backend endpoints exist but are never used? — **None. All 14 are wired.**

Worth stating plainly, because it is the opposite of the Expenses module's finding. Every food route has a live frontend caller through `features/food/api/index.ts`. What is unwired here is *parameters and a cron*, not endpoints — see §3.

### 1.11 Which services exist but have zero callers? — **None.**

`food-schedule-generator.ts` is the only service and it is called by the generate route.

### 1.12 Additional backend problems

| # | Problem | Evidence | Impact |
|---|---|---|---|
| 1 | Regenerate unpublishes + destroys edits | §0.2 | **Critical** |
| 2 | No date dimension — one week per month | §0.1 | **Critical** |
| 3 | History mutable, no snapshot | §1.6 | **High** |
| 4 | `food-carry-forward` cron built but never scheduled | §3.1 | **High** |
| 5 | Voting can't auto-close → Generate dead-ends | §1.9 | **High** |
| 6 | All logic inline in routes; no `food-service.ts` | 14 routes, 0 domain services | **Medium** |
| 7 | **Zero tests.** `ls tests \| grep -i food` → empty | — | **Medium** |
| 8 | A meal cell can never be un-set | `meals/[mealId]` requires `menuItemId`; no `null` path | **Medium** |
| 9 | Publish notification is in-app only | `notificationService.createNotification` only; no WhatsApp | **Medium** |
| 10 | `@@unique([hostel_id, meal_type, name])` blocks cross-hostel library reuse | Each hostel retypes its library | **Medium** |
| 11 | Schema comment on `food_votes` contradicts the code | Says *"single-choice — changing a vote updates this row"*; the constraint includes `menu_item_id` and the route toggles multi-select | **Low** (doc drift) |
| 12 | `published_at` survives a Regenerate that sets `DRAFT` | `generate/route.ts:99` | **Low** |

---

## 2. Critical UX Problems

### 2.1 The owner cannot answer "what's for lunch today?"

There is **no today view anywhere in the owner app.** The Food tab opens on the Food Library accordion, then the voting panel, then a 7-day grid of 28 cells. To find today's lunch the owner scrolls to the right weekday and reads one cell. Owner Home has no food card at all. The tenant app has "Today's meals"; the owner does not.

This is the single most-requested piece of information in the module and it is the hardest to get.

### 2.2 Information hierarchy is inverted

Render order of the Monthly Schedule tab (`FoodPage.tsx:99-118`):

```
Food Library accordion        4 collapsible sections   <- maintenance, not daily use
Voting panel                  datetime pickers + tally <- monthly, not daily use
Weekly Schedule grid          28 cells                 <- the actual content
Month History                 collapsed months         <- rare
```

The owner opening this tab wants one of three things: *what's today*, *fix one day*, or *set up next month*. The first is impossible (§2.1), the second requires scrolling past two full sections, and the third is buried under a `datetime-local` pair.

### 2.3 The generated menu is visibly bad, and nothing says so

Live data, hostel `fad5…`, August 2026, currently **published to tenants**:

- Breakfast: **Dosa, all 7 days**
- Lunch: **Sambar Rice, all 7 days**
- Snacks: **"Not set", all 7 days** (`meals_not_set: 7`, `menu_items_by_meal.SNACKS` = 2 across both hostels, 0 active for this one)
- Dinner: Chapati / Paneer Curry alternating

This is the generator working exactly as designed — it round-robins the library, and the library had one active breakfast item. But the product presented it as a finished plan, let it be published, and told tenants *"This month's food menu is live."*

Nothing anywhere warns that a meal type is empty, that an item repeats 7/7, or that the library is too small to produce variety. **The moment to say "add 3 more breakfast items and I can give you a real week" is at generation time, and it is silent.**

### 2.4 "Not set" is a dead end

Snacks renders as italic *"Not set"* in the owner grid and *"Not set"* in the tenant app. Tapping the cell opens the picker, which says *"No snacks items in your library yet."* — and then offers no way to add one. The owner must dismiss the sheet, scroll up, expand the Snacks accordion, tap Add Item, type, confirm, scroll back down, and re-tap the cell. **Seven interactions to fill one blank.**

### 2.5 Editing a week is 4 taps per cell × 28 cells

To change one meal: tap cell → sheet opens → tap item → sheet closes → grid invalidates and refetches. There is no multi-select, no "apply to all Mondays," no "copy Tuesday to Thursday," no drag, no swap, no undo. Changing a full week is 28 sheet round-trips.

`useFoodMenuItems.ts:33` notes that drag-reorder was dropped because *"there's no real ordering concept on the backend"* — a reasonable call at the time, but the result is that the only editing gesture in the module is tap-sheet-tap.

### 2.6 Two voting systems, two names, two models

| | Real | Fake |
|---|---|---|
| Name | "Voting" | "Food Polls" |
| Location | inside Monthly Schedule tab | its own top-level tab |
| Backed by | `food_voting_periods` / `food_votes` | `useState(mockFoodPolls)` |
| Entry point | scroll down the menu tab | **Home Quick Action** + tab + Create button |
| Feeds the menu | yes (`generated_from_voting_period_id`) | no (toast only) |

The discoverable one is fake. The functional one is hidden. An owner exploring this app will find Food Polls first, create one, watch it work, and never learn that the thing that actually shapes the menu is elsewhere.

### 2.7 Multi-property owners get one hostel, silently

`FoodPage.tsx:37-42` passes `session.primaryHostelId` to every hook. That value is:

```ts
// legacyAuthAdapter.ts:40-44
// Convenience default for single-hostel owners only — screens that deal
// with multiple hostels must still let the owner choose explicitly
// rather than silently operating on hostels[0] (see CLAUDE.md's
// "must not fall back to first hostel" invariant).
primaryHostelId: hostels[0]?.id ?? null,
```

The Food tab has **no hostel picker**. A two-property owner sees property #1's library, #1's votes, #1's menu — with nothing on screen naming the hostel — and has no route to property #2's food at all. The adapter's own comment names this as the thing not to do. Live DB confirms it bites: 2 active hostels, both with food libraries (7 items and 4 items) and both with published July schedules; only one is reachable.

### 2.8 Smaller UX defects

- **Tenant "current month" can be stale.** `useTenantFoodSchedule.ts:59` sets `isCurrent` to the *latest published* month, not the actual month. If the owner hasn't published September, the tenant's Home shows August's Monday as "Today's meals," labelled Current, with no staleness cue.
- **Voting panel opens with a 3-day window** (`defaultStart`/`defaultEnd`, `VotingPanel.tsx:15-25`) starting *now*, with no explanation of what the dates mean or what happens at the end.
- **The Publish button says `Publish {current month}`** using `new Date()` rather than the schedule's own month — correct today only because the page hardcodes the current month.
- **No confirmation on library delete.** `deleteChip` fires `DELETE` immediately. It is a soft-delete (`is_active: false`) so nothing is lost, but there is no UI anywhere to see or restore deactivated items — `includeInactive=true` exists on the API and is never sent.
- **The empty-state copy contradicts the enabled state**: *"Close voting first, then generate"* renders even when `canGenerate` is true and the button is live.

---

## 3. Existing Backend Features Not Wired

The module's inverse of the Expenses finding: the endpoints are all wired, but several *capabilities* are built and unreachable.

### 3.1 `food-carry-forward` cron — fully built, never scheduled ⚠️ highest-value unblock

`app/api/cron/food-carry-forward/route.ts` is 95 lines of correct, transactional, idempotent code: for every active hostel with no schedule for the current month, it clones last month's **published** 28 cells into a new `DRAFT` with `source: CARRIED_FORWARD`. It is `CRON_SECRET`-protected and handles "nothing to carry forward" as a non-error.

`apps/backend/vercel.json` registers exactly two crons:

```json
"crons": [
  { "path": "/api/cron/generate-rent",   "schedule": "30 18 * * *" },
  { "path": "/api/cron/rent-reminders",  "schedule": "0 2 * * *"   }
]
```

**It has never run.** `FoodScheduleSource.CARRIED_FORWARD` appears zero times in live data (all 3 schedules are `MANUAL` or `GENERATED`).

The cost of this omission is the module's worst recurring moment: **on the 1st of every month, there is no schedule, so tenants' Food tab silently falls back to showing the previous month's pattern as "Current"** (§2.8), and the owner must generate and publish from scratch. One JSON line makes next month start pre-filled. *Effort: one line. Value: removes the single largest recurring chore.*

### 3.2 `GET /api/food/menu-items` filters — never sent

`mealType` and `includeInactive` are implemented and validated. The frontend only ever calls `foodService.getMenuItems(hostelId)`. `includeInactive` is the missing half of an "archived items / restore" UI.

### 3.3 `hostels.food_included` — captured, never read

Collected in onboarding (`useOnboardingSubmission.ts:164`) and written by the provisioning service. **Zero reads anywhere in the food module.** Live: `hostels_food_included: 0` of 2 — yet both hostels have libraries and published menus. So the flag is both unused and already wrong. It should either gate the Food tab or be removed.

### 3.4 `POST /api/food/menu-items` reactivation — reachable but invisible

Re-adding a soft-deleted item by the same name silently reactivates it (`menu-items/route.ts:84-90`) and returns `200` instead of `201`. Good behaviour; the owner is never told it happened, so a deleted-then-retyped item looks like a new one.

### 3.5 `food_schedules.source` — recorded, never surfaced

`GENERATED | CARRIED_FORWARD | MANUAL` is maintained correctly (the meals PATCH flips it to `MANUAL`). Nothing in the UI shows it. "Carried forward from July — review before publishing" is a one-line read of a field that already exists.

---

## 4. Dead Components

| Item | Status | Recommendation |
|---|---|---|
| `useFoodPolls.ts` | Pure mock state | **Delete** |
| `mockFoodPolls` (`shared/mocks/food.ts:74-150`) | 4 fabricated polls | **Delete** |
| `SMART_INSIGHTS` + `SmartInsightsList.tsx` | 4 hardcoded strings presented as analytics | **Delete** |
| `CreatePollModal.tsx` (183 lines) | Writes nothing | **Delete** |
| `useCreatePollDraft.ts` (123 lines) | Draft state for a fake entity; `totalTenants: 180` | **Delete** |
| `PollCard.tsx`, `PollSegmentedControl.tsx`, `PollResultsSheet.tsx` | Render mock polls | **Delete** |
| `owner-food/types.ts` — `PollTab`, `CreatePollDraft`, `TITLE_SUGGESTIONS`, `EMPTY_CREATE_POLL_DRAFT` | Poll-only | **Delete** |
| `FOOD_LIBRARY_SEED` (`mocks/food.ts:28-33`) | **Zero importers** — verified | **Delete** |
| `POLL_TYPE_META`, `PollType`, `getPollWinner`, `MockFoodPoll*` | Poll-only | **Delete** |
| Home Quick Action → `openCreatePoll` (`useHomeQuickActions.ts:55`) | Routes to the fake sheet | **Repoint** at real voting |
| `PollCard` "Edit" → `stayoToast.info('Opening poll editor…')` | Dead affordance | Dies with the tab |

**That is ~600 lines of frontend deleted and one navigation entry repointed** — roughly 40% of the module's frontend, removing zero real capability.

**Keep, do not delete:** `FOOD_SLOTS`, `MEAL_CATEGORY_META`, `MealSlotKey`, `mealIcons.ts`. These are real design tokens used by 20 files across both owner and tenant apps. They are only *located* in a file named `shared/mocks/food.ts`. Move them to `shared/food/slots.ts` when the mocks are deleted — the name is the debt, not the content.

---

## 5. Business Opportunities

Ranked by owner value. **All are derivable from data the system already stores or trivially could — none require AI.**

1. **Per-hostel food operations for multi-property owners.** The data is already hostel-scoped end to end (`food_menu_items.hostel_id`, `food_schedules.hostel_id`, per-hostel voting periods). Only the UI is missing a picker (§2.7). Same shape as the Expenses audit's #1 finding, and the same small fix.
2. **Cost per meal, per day, per hostel.** `expense-service.ts` already classifies `Food & Groceries` (it even has a keyword matcher: `/(food|rice|milk|grocery|vegetable|kitchen|meal|dal|oil)/`) and already emits an insight when it exceeds 45% of expenses. Joining that to a dated menu answers *"₹38/head/day, up 12% since we added Paneer Curry twice a week."* This is the highest-value business question in the whole module and it needs **one join**, not a new subsystem. Blocked on §0.1 (dates).
3. **Menu templates and cross-hostel copy.** `@@unique([hostel_id, meal_type, name])` currently forces every hostel to retype its library. "Copy library from MG Road" is a `createMany`. "Save this week as a template" is a named 28-row blob.
4. **Real satisfaction signal.** `exit_feedbacks.rating_food` **already exists and is already aggregated** (`move-out-service.ts:795` averages it alongside 7 other dimensions). It is food data the module doesn't know it has.
5. **Vendor ↔ ingredient linkage.** Phase 1 of Expenses built `getExpenseMemory` with per-vendor aggregates. A menu that knows "Sambar Rice runs 14×/month" plus an expense memory that knows "Sri Rice Traders, ₹8,000 avg" is one step from purchase forecasting.

---

## 6. Product Opportunities

### Persona coverage today

| Persona | Needs | Served | Biggest gap |
|---|---|---|---|
| **Small owner** | speed | **Poor** | No today view; 4 taps/cell; carry-forward never runs |
| **Growing hostel** | organisation | **Partial** | Library works; no templates, no archive, no variety check |
| **Multi-property** | consistency | **Not served** | Silently locked to `hostels[0]`; no cross-hostel copy |
| **Kitchen manager** | today's menu | **Not served** | No today view, no kitchen surface, no role |
| **Cook** | printable schedule | **Not served** | No print, no PDF, no export of any kind |
| **Students** | predictable food | **Partial** | Menu visible + voting real; "current month" can be stale; votes never affected a menu |

### Intelligence opportunities — supported by existing data only

Explicitly excluding anything requiring AI or data not already captured.

| Opportunity | Data it needs | Available today? |
|---|---|---|
| **Variety warning at generation** — "Dosa fills 7/7 breakfasts; add 2 items for a varied week" | `food_menu_items` count per meal type | ✅ **Now** — this is arithmetic on data already in hand, and it is the single highest-value nudge in the module (§2.3) |
| **Empty meal-type warning** — "Snacks has no items" | same | ✅ **Now** |
| **Recently-served / rotation hints** in the item picker | `food_schedule_meals` across months | ✅ **Now** (weekly granularity is enough) |
| **Most-used items** ("Sambar Rice, 14× this month") | `groupBy item_name` — the exact query run for this audit | ✅ **Now** |
| **Carried-forward badge** — "Same as July. Review?" | `food_schedules.source` | ✅ **Now** (§3.5) |
| **Student favourites / least-liked** | `food_votes` | ⚠️ Schema ready, **2 votes exist** — needs the voting loop fixed first (§1.9) |
| **Menu templates** (festival, exam week) | new table, or `source: TEMPLATE` | ⚠️ Needs §0.1 for date-specific application |
| **Seasonal patterns** | 12+ months of dated history | ❌ Needs §0.1 **and** time |
| **Cost-aware suggestions** | menu × `expenses` | ❌ Needs §0.1 |

**The honest read:** the four ✅-Now items are all *warnings and counts*, not predictions. They are worth more than everything below them combined, because they fire at the moment the owner is making a decision, and they need no new data, no new tables, and no model.

---

## 7. Cross-module Opportunities

| Module | Opportunity | Reuse or build? |
|---|---|---|
| **Expenses** | `Food & Groceries` category + `getExpenseMemory` vendor aggregates already exist; `expense-service.ts:486-495` already emits a food-cost insight. Join to menu for cost/head/day. | **Reuse.** Compose, don't recalculate — the pattern `CLAUDE.md` mandates via `financial-read-model-service.ts`. Blocked on §0.1. |
| **Universal Search** | Searching *"Dosa"* returns nothing. `useUniversalSearch` indexes tenants/rooms/actions only. Menu items, schedule cells and voting results are all name-keyed and trivially indexable. | **Extend** the existing index. Small. |
| **Action Center** | `src/services/owner-actions/definitions/` holds `agreement`, `payment`, `room`, `tenant` — **no food**. Natural cards: *"No menu published for September"*, *"Voting closes tomorrow"*, *"Snacks empty for 7 days"*, *"Carried forward from July — review"*. | **Reuse** `owner-action-registry.ts`. This is the correct home for every ✅-Now nudge in §6. |
| **Notifications / WhatsApp** | Publish sends in-app only. A full WhatsApp stack exists (templates, webhook router, owner assistant with DUES/PAY commands). "This week's menu" as a WhatsApp message is the highest-reach channel the product has and food doesn't use it. | **Reuse** — but note each template needs Meta approval; see `docs/audits/whatsapp-template-mapping.md` for how that has bitten twice. |
| **Exit feedback** | `exit_feedbacks.rating_food` is captured and averaged already. | **Reuse** — surface it in Food, don't re-collect. |
| **Analytics / dashboard** | No food metric anywhere on owner Home. | Build after §0.1. |
| **Inventory (future)** | A dated menu × headcount = ingredient demand. | Deferred; depends entirely on §0.1. |

---

## 8. Technical Debt

| # | Debt | Detail |
|---|---|---|
| 1 | **Zero test coverage** | No `tests/*food*`. The generator (`assignWeekForMealType`) is a pure function with tricky largest-remainder maths and is completely untested — it is the cheapest possible test target. |
| 2 | **No service layer** | All 14 routes hold their own logic; `firstOfMonth` is copy-pasted into **4 files** (`schedules/route.ts`, `generate/route.ts`, `voting-periods/route.ts`, `tenant/schedule/route.ts`) in two different implementations (string-slice vs `Date.UTC`). Violates `CLAUDE.md`'s "routes stay thin." |
| 3 | **`hostels[0]` fallback in a real screen** | §2.7 — violates the invariant `architectural-invariants-check.ts` exists to enforce, but the check covers backend only, so nothing caught it. |
| 4 | **Real design tokens living in `shared/mocks/`** | §4 — 20 files import `@shared/mocks/food` for legitimate constants. |
| 5 | **Stale schema comment** | `food_votes` doc-comment says single-choice; implementation is multi-select toggle. |
| 6 | **Wrong doc comment on `generate`** | Asserts regeneration is "always safe." It is not (§0.2). |
| 7 | **Unregistered cron** | §3.1. Broader than food — 16 cron routes exist, 2 are scheduled. Worth a separate sweep. |
| 8 | ~~**`docs/obsidian/` has no Food coverage**~~ — **CORRECTED 2026-08-05, this finding was wrong** | The original claim was based on a truncated grep and is **false**. At the time of the audit `APIs.md` already documented every `/api/food/*` endpoint, `Database.md` documented all five `food_*` models, and `Features.md` carried 20 Food references. What genuinely did not exist: a **dedicated `Food.md` module page** (the vault has one per major module) and any **`Business-Rules.md`** entry (0 mentions). The real debt was narrower than stated. |
| 9 | **Tenant label contradicts backend** | "Vote for next month" vs. `firstOfMonth(new Date())`. |

---

## 9. Recommended Product Redesign

### What NOT to change

Stated first, deliberately — most of the backend is right:

- **Publish semantics** (atomic, idempotent, guarded fan-out) — correct. Do not touch.
- **`assignWeekForMealType`** — clean, honest, handles edge cases. Keep as the ranking core.
- **`item_name` denormalization** on `food_schedule_meals` — exactly right for history survival.
- **Soft-delete on library items** — right call.
- **Generation inside `$transaction`** — right.
- **Tenant read isolation** (`status: PUBLISHED` only) — right.
- **The vote-toggle model** (multi-select per meal type) — right, and better than the schema comment claims.

### The one structural change

**Add a date dimension.** Not a rewrite — an additive column plus a backfill:

- `food_schedule_meals.serve_date DATE NULL`, with `@@unique([schedule_id, serve_date, meal_type])` alongside the existing weekday key during migration.
- Backfill: expand each existing 28-row weekly pattern across its month's real dates. Existing weekly data survives as the *default*; deviations become expressible.
- `day_of_week` stays as the **template** layer — "the usual Monday" — which is genuinely the right model for a hostel. Dates become the **instance** layer. Owners plan a week and override specific days.

This unlocks: festival/exam menus, real history ("what did we serve on the 14th"), cost-per-day, kitchen sheets, ingredient forecasting. Nothing else in §5–§7 moves without it.

### Target owner screen

Replacing 4 stacked sections + a fake tab with a hierarchy that matches what owners actually do:

```
TODAY  ·  Thu 5 Aug            [Hostel: MG Road ▾]     <- picker fixes §2.7
  Breakfast  Dosa      Lunch  Sambar Rice
  Snacks     — not set  Dinner Chapati
  [ Change today ]  [ Send to kitchen ]

THIS WEEK                          Published · from July
  Mon Tue Wed Thu Fri Sat Sun      <- compact, tap any cell
  ⚠ Snacks empty all week · Dosa 7/7 breakfasts
  [ Fill gaps ]  [ Publish changes ]

▸ NEXT MONTH        Carried forward from August · not published
▸ FOOD LIBRARY      7 items · 0 snacks ⚠
▸ WHAT STUDENTS WANT  Voting · closes in 3 days
▸ HISTORY           July, August
```

Four principles behind it:

1. **Today is the front door.** It is the most-asked question and currently the hardest to answer.
2. **Warnings sit where the decision is made** — the variety/empty checks render on the week, not in a separate "insights" list.
3. **Everything below Today collapses.** Library and voting are monthly chores, not daily ones.
4. **One name for voting.** "What students want," backed by the real endpoints. The Polls tab dies.

### Fixes that are independent of all of the above

- **Regenerate**: confirm dialog naming what will be lost; never touch `status` on an already-published schedule; offer "regenerate as draft" instead.
- **Auto-close voting** when `voting_ends_at` passes (add to the carry-forward cron — it already runs daily over all active hostels, so this is a few lines in a job that already exists).
- **Move voting one month forward** so tenants vote for the month being *planned*, and fix the tenant label.
- **Register the carry-forward cron.**

---

## 10. Phased Implementation Roadmap

**Phase 0 — Stop the bleeding** *(hours, no schema change)*
1. Confirmation on Regenerate; never demote a `PUBLISHED` schedule to `DRAFT` (§0.2)
2. Register `food-carry-forward` in `vercel.json` — one line (§3.1)
3. Auto-close expired voting periods inside that same cron; unblocks Generate (§1.9)
4. Delete the mock Polls tab; repoint the Home Quick Action at real voting (§0.3, §4)
5. Fix the two wrong doc comments and the stale `food_votes` schema comment (§8)

**Phase 1 — Make it usable** *(days, no schema change)*
6. **Today card** — owner Food tab and owner Home (§2.1)
7. **Hostel picker** on the Food tab (§2.7) — closes a named invariant violation
8. **Variety + empty-meal-type warnings** at generation and on the week (§2.3, §6) — the highest-value nudge available with today's data
9. **Add-item inline from the picker sheet** — kills the 7-interaction dead end (§2.4)
10. **"Carried forward from July — review"** badge from `food_schedules.source` (§3.5)
11. First tests: `assignWeekForMealType` is a pure function and is the obvious start (§8)

**Phase 2 — The structural change** *(schema + migration)*
12. `serve_date` on `food_schedule_meals`; weekday pattern becomes the template layer (§9)
13. Immutable published snapshots so history stops being editable (§1.6)
14. Per-day overrides in the UI: festival, exam week, kitchen closed
15. Move voting to the month being planned; fix the tenant label (§1.9)

**Phase 3 — Kitchen operations & reports** *(needs Phase 2)*
16. Kitchen sheet — today/tomorrow, printable, cook-legible
17. Monthly menu PDF (owner) and student menu PDF — reuse `lib/pdf/` + the `pdf-lib` patterns already proven in `expense-export-service.ts`
18. WhatsApp "this week's menu" broadcast (budget for Meta template approval — see `docs/audits/whatsapp-template-mapping.md`)
19. Food cards in Action Center via `owner-action-registry.ts` (§7)
20. Food in Universal Search (§7)

**Phase 4 — Intelligence** *(needs Phase 2 + real vote volume)*
21. Cost per meal / per head / per day, joining `expenses` (§5.2)
22. Menu templates + cross-hostel library copy (§5.3)
23. Student favourites from real votes; surface `exit_feedbacks.rating_food` (§5.4)
24. Rotation suggestions from dated history

**Cross-cutting prerequisite:** as with Expenses Phase 4, the backend test suite still needs `DATABASE_URL_TEST`. Phase 0–1 is coverable with pure functions and route tests; **Phase 2's migration is not** — a schema change to live published menus should not ship without a test database.

---

## Evidence notes

Live data at time of audit (production, 2026-08-05):

- **2 active hostels**, both with food libraries (7 items and 4 items) — only one reachable from the UI (§2.7)
- **`food_included = true` on 0 of 2 hostels**, despite both running published menus — the flag is unused *and* wrong (§3.3)
- **11 menu items** total: BREAKFAST 4, DINNER 3, LUNCH 2, SNACKS 2
- **3 schedules**, all PUBLISHED: July×2 (`source: MANUAL`), August×1 (`source: GENERATED`). **`CARRIED_FORWARD`: 0** — the cron has never run (§3.1)
- **84 schedule meal rows**; **7 are `item_name: "Not set"` with `menu_item_id: null`** — exactly one meal type × 7 days (snacks, published to tenants)
- **1 voting period ever** (July, CLOSED). **2 votes total.** August generated with `generated_from_voting_period_id: null` — votes influenced nothing (§1.9)
- Most-scheduled items: Sambar Rice ×14, Dosa ×11, Chapati ×10 — across only 84 cells
- **0 food tests** in `apps/backend/tests/`

Verified by reading: all 14 routes under `app/api/food/`, `app/api/cron/food-carry-forward/route.ts`, `lib/services/food-schedule-generator.ts`, `prisma/schema.prisma:2589-2722`, `apps/backend/vercel.json`, and all 20 files under `apps/frontend/src/features/owner-food/`, `src/features/food/`, `src/platforms/tenant/pages/TenantFoodPage.tsx`, `src/features/tenant-home/hooks/useTenantHome.ts`, `src/features/owner-session/adapters/legacyAuthAdapter.ts`.

**Three conclusions changed because of the live-data check:** the carry-forward cron is *unscheduled* rather than merely unused; voting is *inert in practice* rather than simply thin; and the generated August menu is *actively poor and live to tenants* rather than a theoretical edge case.
