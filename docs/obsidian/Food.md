---
tags: [module, food]
---

# Food

Related: [[Features]] · [[APIs]] · [[Database]] · [[Business-Rules]] · [[Decisions]] · [[Bugs]] · [[Changelog]] · [[Backend]] · [[Frontend]]

The module's home page. Written 2026-08-05 against the code as it stands after the Phase 0–1 pass on `feat/food-phase-0-1` — every claim below was read out of the implementation, and anything that could not be is marked **Unknown / needs clarification** at the bottom rather than asserted.

**Updated 2026-08-06** for `feat/food-ux-pass` (seven commits, `d094fec..2502f9f`): the hostel picker's overflow, an atomic meal-swap endpoint, the weekly editor collapsed to one row per day with drag-to-swap, and three voting gaps closed. Same rule — read out of the implementation, not from the plan.

**Updated 2026-08-08:** schedule generation decoupled from voting (deliberate product decision, not a bugfix — see [[Decisions]]). The owner Food tab no longer renders the Voting card, and generation is no longer gated on a voting period's status; the tenant Food tab's voting section is likewise hidden. Voting's code, DB tables and API routes are all left in place, simply unused by the current flow — reversible groundwork for a future, likely different, "polling" feature. §3, §5, §8, §10, §11, §12 and §13 below reflect this.

Baseline documents: `docs/audits/food-module-audit.md` (the lifecycle audit this work came from) and `docs/design/food-module-redesign.md` (the approved redesign; **§8 is binding architecture, not a proposal**).

One correction to the audit, since this page is meant to be trustworthy about its own sources: its finding #8 says the vault had *no* Food coverage. That overstates it — [[APIs]] has carried a full 14-endpoint table and [[Database]] a full five-model section since 2026-07-26, and both are current. What was genuinely missing was a [[Features]] entry, any [[Business-Rules]] coverage, and any page tying the grain, the semantics and the constraints together. This page is that, and it does not restate [[APIs]] or [[Database]].

---

## 1. What the module is

Two jobs that share a tab and almost nothing else:

| | **Operating** | **Planning** |
|---|---|---|
| Question | *What are we serving right now?* | *What will we serve this month?* |
| Frequency | daily, seconds | monthly, minutes |
| Surfaces | Today card, owner Home line, Kitchen sheet, tenant Food tab | Library, voting, weekly grid, publish |

Before Phase 1 the tab served only the second job — it opened on the Food Library accordion, and there was no today view anywhere in the owner app at all. Phase 1 put Operating first without moving Planning off the same screen; a fully separate "Plan `<Month>`" flow is Phase 2 and is **not built**.

## 2. The grain — one week, repeated. This is the ceiling.

`food_schedule_meals` is keyed:

```prisma
@@unique([schedule_id, day_of_week, meal_type])   // FoodDayOfWeek = MONDAY..SUNDAY
```

7 days × 4 `FoodMealType` = **28 rows per schedule**, and **there is no date column anywhere in the food schema**. `food_schedules` is one mutable row per `(hostel_id, month)`. So a "month" is a container for exactly one Mon–Sun pattern.

Consequences, all structural:

- Every Monday in a month is identical by construction, and so is every other weekday. Editing one cell changes **that weekday for the whole month** — the meals-PATCH route now says so in its own doc comment, where it previously did not.
- **A festival menu, an exam-week menu, a one-off guest meal, or "kitchen closed on the 15th" are unrepresentable.**
- Month History shows a *pattern*, not what was served. *"What did we serve on 14 August?"* was never recorded and cannot be answered.
- Cost-per-day, ingredient forecasting and dated analytics are all blocked on the same missing column.

Per-date menus need `food_schedule_meals.serve_date`, which **does not exist**. Adding it is Phase 3 of the redesign; [[Decisions#ADR-029|ADR-029]] already recorded this consequence when the model was chosen.

The five models are inventoried in [[Database]] (`food_menu_items`, `food_voting_periods`, `food_votes`, `food_schedules`, `food_schedule_meals`) — that page is current and is not restated here.

## 3. API surface

**15 route files under `app/api/food/`, exposing 18 method handlers**, plus one cron. Every one has a live frontend caller through `features/food/api/index.ts` — the audit found **no orphaned food endpoint**, which is the opposite of the Expenses finding. The full per-endpoint table lives in [[APIs]].

Changed on `feat/food-phase-0-1` (2026-08-05):

- `POST /api/food/schedules/generate` gained **`mode: "BUILD" | "FILL_GAPS" | "START_OVER"`** (defaults to `BUILD` when absent or unrecognised) and can now answer **`409 SCHEDULE_PUBLISHED`**. See §5.

Changed on `feat/food-ux-pass` (2026-08-06):

- **`POST /api/food/schedules/[id]/meals/swap` is new** — the module's 15th route and its first addition since 2026-07-26. Body `{ aMealId, bMealId }`; exchanges two cells' items in one `$transaction`. See §7.1.
- `POST /api/food/voting-periods` now **notifies tenants** when a round genuinely opens, and returns `notified`. See §10.
- `GET /api/food/voting-periods/[id]/results` gained **`voterCount`** (distinct tenants) and **`eligibleCount`**, alongside the unchanged `totalVotes`. See §10.

Changed 2026-08-08:

- `POST /api/food/schedules/generate` **no longer auto-looks-up an existing voting period** for the hostel+month when `votingPeriodId` is omitted. Voting-ranked generation is now reachable only by a caller explicitly passing `votingPeriodId` — no current caller does. See §10.

Owner routes all follow `getSession` → `resolveOwnerScope` → `requireHostelBelongsToOwner`; `app/api/food` is one of `scripts/architectural-invariants-check.ts`'s scanned roots, so `hostelId` can never become optional and no route may fall back to `hostels[0]` ([[Decisions#ADR-003|ADR-003]]).

## 4. Publish semantics — correct, and deliberately not rebuilt

`POST /api/food/schedules/[id]/publish`:

1. **Atomic in the sense that matters.** The state change is a single-row update. The notification fan-out is deliberately *outside* it, under `Promise.allSettled`, so a failed notification cannot roll back a publish.
2. **Idempotent.** `wasAlreadyPublished` preserves the original `published_at` and suppresses a second notification storm. Publishing twice is safe.
3. **Guarded.** Rejects with `VALIDATION_ERROR` if the schedule has zero meal rows.
4. **Fan-out** is one in-app notification (`food_schedule_published`) per `ACTIVE` tenant of that hostel with a non-null `profile_id`. In-app only — no WhatsApp, no email.

**There is no draft/live pair.** `@@unique([hostel_id, month])` means one row per hostel per month, so once published *that row is the live menu* and every subsequent edit is live the moment it saves. This is per the original product spec, not an oversight. Phase 1's answer to it is an **undo affordance rather than a staging step** (§7), which is why no draft-copy workflow was built.

## 5. Rebuild modes — `decideRebuild`

`apps/backend/lib/services/food/schedule-rebuild-policy.ts` is a pure function that decides what a rebuild request may touch. It exists because the old Regenerate button set `status: "DRAFT"` and `deleteMany`'d all 28 cells unconditionally — see [[Bugs]].

| `mode` | Against a DRAFT / absent month | Against a **PUBLISHED** month |
|---|---|---|
| `BUILD` | replaces all 28 cells, status → `DRAFT` | **refused** — `409 SCHEDULE_PUBLISHED` |
| `START_OVER` | replaces all 28 cells, status → `DRAFT` | **refused** — `409 SCHEDULE_PUBLISHED` |
| `FILL_GAPS` | writes only cells with `menu_item_id: null`, status untouched | **allowed** — the only mode that is |

The decision also carries **`rewritesProvenance`** — true only when `replace === "ALL"`. `source` and `generated_from_voting_period_id` belong to whoever authored the week, so a `FILL_GAPS` run adds cells and claims nothing: a month carried forward from last month keeps saying `CARRIED_FORWARD` after its snacks are filled in, instead of flipping to `GENERATED` and pointing at whatever voting period happened to exist. That matters twice over, because `source` is the sole basis for *"carried forward from July"* vs *"built from student votes"*, and `generated_from_voting_period_id` is the honest input to the votes publish check (§8).

The invariant, stated once: **a `PUBLISHED` schedule is never demoted to `DRAFT` and never has its cells wholesale deleted.** A test enumerates every `(mode × currentStatus)` pair and asserts no combination can ever write `status: "PUBLISHED"`, and another asserts `rewritesProvenance` tracks `replace === "ALL"` exactly.

The status check runs **twice**: once early, for a cheap rejection, and once **inside the `$transaction`** that acts on it. The early read is separated from the write by 5–9 generator round-trips, so a second device publishing in that window could otherwise have its month deleted by the first device's already-made decision. The in-transaction re-assert aborts with the same `409 SCHEDULE_PUBLISHED` shape.

The owner-side control reflects this: the button reads **Rebuild** on a draft (sends `BUILD`) and **Fill gaps** on a published month (sends `FILL_GAPS`). `START_OVER` is accepted by the route and plumbed through `foodService.generateSchedule` and `useFoodSchedule.generate`, but **no UI control currently sends it** — see §12.

## 6. The `WeekGrid` contract — the seam for templates

`apps/frontend/src/features/owner-food/weekGrid.ts`. Design doc §8.1, binding.

> **Rule:** every producer and consumer of a week operates on a `WeekGrid` — `Array<{ id, day_of_week, meal_type, menu_item_id, item_name }>` — never on raw `food_schedules` rows.

Why: a *template* (Exam Week / Festival / Holiday) **is** a week — same 28 cells, same shape, just not bound to a month. So the forward-compatibility seam is not a template system; it is refusing to let anything read schedule rows directly. There are three producers today (generate, carry-forward, manual edit) and `food_schedules.source` is already the enum that names them (`GENERATED | CARRIED_FORWARD | MANUAL`); a template is a fourth producer and one more enum value. The future `food_menu_templates` / `food_template_meals` tables are byte-identical in shape to `food_schedule_meals` and are **not built**.

The module supplies alongside the type:

- `toWeekGrid(meals)` — the one adapter from API rows, silently dropping any row whose day or slot is unrecognised.
- `dayKeyFor(date)` — JS `getDay()` is Sunday-first, the grid is Monday-first.
- `cellAt`, `isFilled`, `dayCompleteness` — `isFilled` is the single definition of "this cell names a real item", and it deliberately treats the generator's `"Not set"` placeholder as empty.
- `MEAL_TIMES` — four default meal times (8am / 1pm / 5pm / 8pm), **not stored anywhere**; if they ever need to be per-hostel, `preferences_config` already exists for it and no new table is required.
- `mealSlotAt(now)` — which meal the owner is most likely asking about, and what follows. Before the day's first meal, breakfast is still "current": at 2am the useful answer is what's coming, not yesterday's dinner.

- `EMPTY_CELL_LABEL` (`"Not set"`) — the one word every surface renders for an empty cell, and the literal `isFilled` recognises. Three spellings of the same state ("Empty", "Not set", "not set") were in use across the surfaces until they were collapsed onto this.

**Every** week reader now consumes `WeekGrid`: the Today card, the Kitchen sheet, the publish checks, the owner Home line, and `WeeklyScheduleGrid`. The editor originally rendered from a second, raw-row `grid` map built beside `weekGrid` in the same hook and open-coded its own filled-ness test; that projection is deleted, so the seam's operative claim — a fourth producer (templates) arrives without any consumer changing — now actually holds. The tenant hook (`useTenantFoodSchedule`) keeps its own separate `grid` and is out of scope for this contract.

`is_manual` (the cell lock — "automation never overwrites a human") is part of the design's `WeekGrid` shape but **the column does not exist yet**, so it is not on the type. That is Phase 2.

## 7. Owner surfaces (Phase 1)

| Surface | Where | Notes |
|---|---|---|
| **Today card** | top of `/owner/food` | Current meal is the hero, next is the subtitle, chosen by `mealSlotAt()`. An unset current meal renders a **Fix** button that opens the picker on that exact cell rather than an empty state. With **no schedule row at all** (new hostel, or the 1st before the cron runs) it says so instead — the Fix buttons would have had no cell to open — and while loading it renders a skeleton. |
| **Current meal on Home** | `OwnerHomeDashboard` | One line, tapping it goes to `/owner/food`. **Renders nothing when today's slot is unset** — a food *gap* belongs in the Action Center (Phase 2, not built), not as an empty card on Home. Deliberately self-fetches via `session.primaryHostelId` rather than taking props, because Home is portfolio-level and per-hostel food is ambiguous there — and for that reason the row **names the hostel** whenever the owner has more than one, so a single property's meal is not presented as a portfolio fact. |
| **Hostel picker** | `HostelSwitcher`, Food tab header | Renders nothing for a single-hostel owner. Closes an `hostels[0]` invariant violation — see [[Bugs]]. **Rebuilt 2026-08-06:** it was a native `<select>`, which sizes itself to its *longest option*, so one real hostel name pushed the control past the viewport and it rendered clipped. Now a `max-w-[46vw]` trigger plus the app's `BottomSheet` — the header is stable at any name length, and the sheet shows names in full rather than truncating the one thing the control exists to disambiguate. `FoodPage` and `KitchenSheetPage` gained `min-w-0` on the title block so the truncation actually engages. |
| **Inline add-item** | picker sheet | `useFoodMenuItems.createAndReturn` creates the library item and resolves its id so the caller can place it in the cell immediately. Filling one blank went from seven interactions to two. A failure is **spoken** (the API's own 409 message when the name is a duplicate) and the typed name stays in the field — it is cleared only on success. |
| **Voting card** | *(removed 2026-08-08)* | `VotingPanel` no longer renders on `/owner/food` and no longer gates Generate — see §10. |
| **Publish pre-flight checks** | above Publish, draft only | See §8. |
| **Undo on live edits** | `stayoToast.undo`, 6s | Fires only when the schedule was already `PUBLISHED`, the cell previously held a real item, **and the newly picked item differs from it** — re-picking what was already there is not a change. The message names the blast radius — *"Changed for every Thursday this month · students see it now"* — and Undo re-PATCHes the previous `menu_item_id`, reporting its own failure rather than passing for a success. |
| **Kitchen sheet** | `/owner/food/kitchen` | §9. |

### 7.1 The compact week, and drag-to-swap (2026-08-06)

**The layout first, because it is what makes the gesture possible.** `WeeklyScheduleGrid` rendered a 2×2 card block per day — 28 cards over roughly seven screens of scrolling. It is now seven rows of four chips (`components/schedule/DayRow.tsx`, new), the same day-label-plus-inline-slots shape `MonthHistoryList` already uses for a published month, so this reuses a pattern the module owns rather than inventing one. Today's row is tinted. The whole week fits in about one screen, which is the difference between a short drag and a drag that fights the page scroll.

One deliberate divergence: an **empty chip renders its own meal-type name** ("Snacks"), not the shared `EMPTY_CELL_LABEL` ("Not set") from §6. A chip that names the slot it is missing invites a fill; "Not set" four times in a row does not. `EMPTY_CELL_LABEL` is unchanged and still the single spelling used by `TodayCard`, `KitchenSheetPage` and `kitchenSheet.ts` — this is an editor-only exception, not a third spelling loose in the codebase.

**The swap is one write, not two.** `POST /api/food/schedules/[id]/meals/swap` exchanges both cells' `menu_item_id` + `item_name` inside a single `$transaction` and flips `food_schedules.source` to `MANUAL`, exactly as a single-cell PATCH does. Two sequential PATCHes are not equivalent: a failure between them leaves one meal duplicated and the other lost, on a row tenants may already be reading. Ownership is checked on `food_schedules.owner_id` before the transaction opens.

> **The rule: a swap is same-meal-type only, and it is enforced in three places.**
> An item belongs to exactly one meal type, so a breakfast item can never legally occupy a dinner slot. That is not a new rule — it is the rule **every** cell write already applied:
> 1. `PATCH /api/food/schedules/[id]/meals/[mealId]` — validates the item against the cell's meal type. The original enforcement point.
> 2. `canSwap` (`apps/backend/lib/services/food/meal-swap.ts`) — pure, 7 tests (the file holds 11 since `swapWritesLanded` joined it). Also refuses a missing cell, a cell swapped with itself, and a cell belonging to another schedule. The route throws `SWAP_REFUSED: <reason>`, matched by prefix in the catch and returned as **`400 VALIDATION_ERROR`** before the generic 500.
> 3. `isValidDrop` (`apps/frontend/src/features/owner-food/dragSwap.ts`) — mirrors `canSwap` client-side so an invalid drag dies silently at the drop, instead of surfacing as a 400 mid-gesture.
>
> Three enforcement points is duplication with a reason: (1) is the true guard, (2) exists so the *transaction* cannot be talked into an illegal write, (3) exists so the owner never sees an error for a gesture the UI could have declined. They are not independently derived — (2) and (3) both restate (1), and both say so in their own doc comments.

**The gesture.** Drag starts from the grip handle only — `dragListener={false}` + `useDragControls` from `motion/react`, the combination `PropertyList.tsx` established and [[Decisions#ADR-042|ADR-042]] records. This reuses that rule rather than setting a new one: the page keeps its vertical scroll and the chip keeps its tap-to-open-the-picker everywhere except the handle. `dragSnapToOrigin` returns the chip home and the true position arrives from the refetch, since the grid is authoritative. A second drag is blocked while a swap is in flight (`dragDisabled={schedule.isSwapping}`) — it would hit-test against the pre-swap grid and write the wrong pair. The hint line appears only once some meal type is filled on two or more days, since there is nothing to swap with before that.

`dragSwap.ts` is pure and holds the two decisions worth testing (8 tests):

- **`findDropTarget` hit-tests measured rects, not `elementFromPoint`.** The dragged chip sits above the pointer for the whole gesture, so `elementFromPoint` would return the chip being dragged, every time.
- **Rects are stored in page coordinates.** `getBoundingClientRect()` is viewport-relative, but motion's `PanInfo.point` is `pageX`/`pageY` — verified in `node_modules/framer-motion/dist/es/events/event-info.mjs`, since the documentation only says "relative to the device or page". `measure()` in `WeeklyScheduleGrid` adds `window.scrollX`/`scrollY` to put both in one space. Getting this wrong makes every drop on a scrolled page land on the wrong cell, and it fails silently. Page coordinates also survive a scroll mid-drag, which rects measured at drag start in viewport space would not. Chips are registered as *elements* and measured at drag start, not at mount, for the same reason.

`useFoodSchedule` exposes `swapMeals`/`isSwapping`; the mutation's `onError` **re-invalidates**, so a rejected swap cannot linger on screen looking applied, while *what to say* is decided per call — a failed undo is a different sentence from a failed swap.

**Blast radius is unchanged, and it is large.** A swap is a cell edit, so it moves both meals for **every** such weekday in the month, not one date (§2).

### 7.2 What the final review sent back (2026-08-06)

The whole-branch review (`.superpowers/sdd/2026-08-05-food-ux-pass/final-review.md`) confirmed the coordinate maths and the three-way meal-type enforcement, and found the gesture's *edges* unfinished. Fixed in one wave:

- **A swap on a PUBLISHED week now has an undo.** It had none, while the tap-to-edit path — half the blast radius, one weekday rather than two — already fired `stayoToast.undo` with a blast-radius line. A successful swap on a published schedule now announces *"Swapped every {dayA} and {dayB} this month · students see it now"*, and undo re-issues the same call, because **a swap is its own inverse**. A failed undo says so in its own words rather than looking like a successful one. Draft schedules stay silent — nothing is live.
- **A drop that lands on nothing now says so.** `handleChipDragEnd` used to `return` in silence when `findDropTarget` yielded `null`, which is the *common* miss: by the review's CSS arithmetic the grid is ~766px against ~590px of usable height on a 390×844 phone, motion does not auto-scroll the page mid-drag, so any two days that are not co-visible cannot be joined by a drag at all. Silence there is indistinguishable from a broken feature. The meal-type refusal now speaks too; a chip dropped back on itself does not, since that is a change of mind.
- **"Move to another day" in the picker sheet** — the same swap, by tapping. It makes Monday↔Sunday reachable without a drag, and it is the **non-pointer equivalent [[Decisions#ADR-042|ADR-042]] point 6 requires**, which this module previously declined (see §13, where it is no longer listed as not built). `useFoodSchedule.moveTargets` lists the other six days holding that meal type, sorted in week order and empty when the cell has nothing to move; `moveMeal` runs the swap and closes the sheet. The hint line now leads with tapping and offers the drag for a nearby day, rather than advertising the pointer-only path first.
- **The grip keeps its box while a swap is in flight.** It was gated on `draggable`, so all 28 grips unmounted and every chip's icon and text jumped ~30px sideways and back, right after a gesture whose whole point was precise placement. It is disabled now, not removed.
- **The grip is `aria-hidden`.** Its `aria-label` sat on a role-less `<span>`, where conforming AT drops it — coverage that was not there. Rather than dress a pointer-only affordance up as an operable control (a grip cannot be dragged from a keyboard), the label is gone and the capability AT *can* reach is the picker sheet's Move list, opened and announced by the chip's own button.
- **A cancelled mouse drag no longer opens the picker.** When `mousedown` lands on the grip and `mouseup` on the chip's text, the browser dispatches `click` at their **common ancestor** — the chip button — which `stopPropagation` on the grip can never intercept. The chip now swallows the click that follows a real drag. Touch never had this: the browser suppresses the click past its slop threshold.
- **The dragged chip is `zIndex: 50`.** At `30` it disappeared behind the shell's `z-40` fixed bottom nav exactly when dragged low.

**One gap remains, recorded rather than papered over.** The gesture wiring still has no automated test: the frontend suite is node-only with no jsdom, so `findDropTarget` and `isValidDrop` are covered as arithmetic and predicates while the wiring between them, motion, and the mutation is not. The interaction has never been exercised in a browser.

## 8. Publish pre-flight checks

`apps/frontend/src/features/owner-food/publishChecks.ts` — three checks, all arithmetic over the `WeekGrid` already in hand. No endpoint, no service, no model.

1. **Complete** — all 28 cells filled; names any meal type that is empty *all week*.
2. **Variety** — WARN when one item occupies more than 3 of a slot's 7 days. Reports **every** dominated meal type, not just the worst one: the motivating live menu was Dosa ×7 breakfast *and* Sambar Rice ×7 lunch, and naming only the worst silently endorsed the other.
3. **Runs** — WARN when any item repeats on back-to-back days, **including across the Sunday→Monday wrap**. One row per `(day, meal)` means the week repeats all month, so Sunday's lunch really is followed by Monday's, four times over.

**Removed 2026-08-08:** a fourth **Votes** check (PASS when the schedule was built from a voting period, via the pure `hasVotesApplied(schedule)`) existed here — deleted along with `hasVotesApplied` now that generation is decoupled from voting (§10) and no schedule is ever built from votes in the current flow.

> **They inform, they never block.** `PublishCheck.status` is `'PASS' | 'WARN'` and there is no third value — a test asserts it, so no future check can acquire the power to disable the Publish button. The owner is the one who knows whether Dosa every day is fine.

This exists because a live menu of Dosa ×7, Sambar Rice ×7 and empty snacks was published to real tenants with nothing anywhere pointing it out.

## 9. Kitchen sheet

`/owner/food/kitchen`, `KitchenSheetPage` + the pure `kitchenSheet.ts`. Two personas — the cook and kitchen staff — that had **nothing at all** before.

- Today's four meals in large type, plus **tomorrow**, because prep starts the night before. That is the whole reason it is a kitchen sheet and not a today screen.
- **Print** (`window.print()`, with `print:` utility classes hiding the controls) and **Send on WhatsApp** via a `wa.me` share link.
- **No backend, no Meta template, no new notification service.** The owner sends from their own WhatsApp — the same `wa.me` pattern the tenant quick-actions already use. A broadcast template is Phase 3 and was explicitly not allowed to block this.
- `whatsappShareUrl` encodes `*` explicitly: `encodeURIComponent` leaves it unescaped, and WhatsApp's `*bold*` markers would otherwise be mangled round-tripping through a URL bar or clipboard.
- The hostel comes from **`?hostelId=`**, carried over by the Food tab's link, falling back to `session.primaryHostelId` only when the screen is reached directly — and `HostelSwitcher` renders here too, updating the search param. It never picks "the first hostel": a two-property owner reading Sri Lakshmi's week and tapping *Send to kitchen* used to get Sri Adithya's menu pre-filled into the `wa.me` share, with no route to the other property's sheet at all.

## 10. Voting

**Decoupled from schedule generation and hidden from both Food tabs, 2026-08-08 — a deliberate product decision, not a bugfix.** The owner wanted Generate to always build straight from the Food Library, with voting/polling coming back later as a separate (likely different) feature rather than a gate on generation. Concretely:

- `VotingPanel` no longer renders on the owner `/owner/food` page, and Generate is no longer gated on voting status (`canGenerate` is gone).
- The tenant Food tab's "Vote on this month's menu" section is likewise removed — it would otherwise have shown a permanent "Voting hasn't started" dead-end once the owner stopped opening rounds.
- `POST /api/food/schedules/generate` no longer auto-attaches an existing voting period; the tally branch below only runs when a caller explicitly passes `votingPeriodId`, which nothing does today.
- **Nothing described below this point was deleted.** `food_voting_periods`/`food_votes` (schema), every `/api/food/voting-periods/*` and `/api/food/tenant/vote*` route, `VotingPanel.tsx`, `useFoodVoting.ts`, and `useTenantFoodVoting.ts` are all left in place, simply unimported from the main flow — reversible groundwork rather than a rebuild-from-scratch requirement for whatever the future polling feature turns out to be. `useTenantHome`'s poll-preview banner (`TenantHomePage.tsx`) still calls `useTenantFoodVoting` too, but is gated on `pollAvailable = Boolean(voting.period && voting.isOpen)`, so with no period ever open it degrades to simply not rendering — no dead-end UI there, unlike the tenant Food tab section that was removed.
- The rest of this section (below) documents that dormant infrastructure as it existed before this change, for whenever it's picked back up.

- One `food_voting_periods` row per `(hostel_id, month)`, `DRAFT | OPEN | CLOSED`, with a start/end window. `POST /api/food/voting-periods` is an **upsert** on that key, which is also how the owner edits an existing window.
- **Opening voting notifies tenants** (2026-08-06). It previously notified *nobody* — there was no notification call in the route at all, while publishing a schedule fanned out to every active tenant. Live data showed **1 voting period and 2 votes in the product's lifetime** (§14); this is the most likely cause, though not proven. The fan-out mirrors publish's exactly: one in-app notification (`food_voting_opened`) per `ACTIVE` tenant of that hostel with a non-null `profile_id`, under `Promise.allSettled` so a failed notification cannot fail the write. The response gains **`notified`** — the count, or `0` when suppressed.
  - **Guarded by `isNewRound`**, mirroring publish's `wasAlreadyPublished`. Because the route is an upsert and *is* the edit-the-window path, an unguarded fan-out would notify on every date tweak, which trains tenants to ignore it.
  - ✅ **Hardened 2026-08-06 (final review, Minor 2).** `isNewRound` was a `findUnique` taken *before* the upsert — a read-then-write race in which two genuinely concurrent first-opens both see no `OPEN` row and both fan out, notifying every tenant twice. The round is **claimed** instead: a conditional `updateMany` on `status: { not: "OPEN" }`, which only one concurrent request can win because row locking makes the loser re-evaluate the predicate after the winner commits; the create race is caught on the `(hostel_id, month)` unique key (`P2002`) and demoted to an edit. Note a transaction alone would **not** have fixed this — under READ COMMITTED both readers still see no row. `notified` also now counts **fulfilled** `Promise.allSettled` results; it was assigned `tenants.length` before the fan-out ran, so a wholly failed fan-out still reported full delivery.
  - ✅ **Fixed before merge (`9f7cb8c`).** The notification title first shipped as *"Vote on next month's menu"* — the copy this module deliberately corrected on the previous branch, reintroduced in a second place, since `FoodPage` opens voting for `new Date().toISOString().slice(0,7)`, **the current month**. It now reads *"Vote on this month's menu"*, matching the tenant Food tab. Worth keeping in the record because it was **found by documenting**: the copy was checked against which month the route actually operates on, rather than against the plan that specified the string.
- **Turnout is a distinct-tenant count** (2026-08-06). `GET .../results` gained **`voterCount`** — `food_votes` with `distinct: ["tenant_id"]` — and **`eligibleCount`**, the `ACTIVE`, profiled tenants of the period's hostel. `VotingPanel` reads *"N of M students voted."* `totalVotes` is **retained and unchanged**: it counts vote *rows*, and a tenant may pick several items per meal type, so the two numbers legitimately differ and mean different things. This is the same distinction the previous branch's `voterCount` → `voteCount` rename was making — the honest turnout number simply did not exist until now.
- **The owner can edit an open voting window** (2026-08-06). Once voting opened, the only action on the panel was *Close Voting*; the dates could not be changed. The backend upsert already supported it — only the UI was missing — another built-but-unreachable capability, of which this module has had several. The Edit-window control pre-fills from the current window and re-posts through the same `openVoting` mutation. **No new endpoint.** Reopening a *closed* round, or running a second round in one month, is still not possible and was deliberately not built.
  - ✅ **Fixed before merge (final review, Important 1).** The prefill first shipped as `toISOString().slice(0,16)` — a **UTC** wall clock — while `<input type="datetime-local">` has no offset and is therefore read back as **local** time. An open-and-save that changed nothing subtracted the owner's UTC offset, and it *compounded*: −5h30m per save in IST, −11h after two. A window ending within 5h30m landed in the past, so `POST /api/food/tenant/vote` answered `409 VOTING_CLOSED` to every tenant while the panel still showed the green OPEN badge and `status` was still `"OPEN"`. The same screen contradicted itself — "11:00 pm" in the header, "17:30" in the field. Both directions now go through the pure `features/owner-food/votingWindow.ts` (`toLocalInputValue` / `fromLocalInputValue`, 9 tests); `defaultStart`/`defaultEnd` carried the same bug latently — benign only because nothing round-tripped them — and use it too. The tests pin **no** timezone: `process.env.TZ` is untyped in this app's tsconfig and mutating it would leak across vitest workers, so the size of the old drift is asserted as `getTimezoneOffset()` and holds in every zone.
- **Turnout waits for its own load** (2026-08-06, final review Minor 8). The panel rendered a confident *"0 of 0 students voted"* for the duration of every results request, on hostels with plenty of both. `isLoadingResults` was already exposed by `useFoodVoting` and simply not consulted; it now shows a skeleton, the pattern `TodayCard` already set in this module.
- `POST /api/food/tenant/vote` **toggles** a `(meal_type, menu_item_id)` pair. Voting is **multi-select per meal type** — the `food_votes` unique constraint includes `menu_item_id` precisely so a second pick is a second row, not an overwrite. The schema doc-comment claimed single-choice until `feat/food-phase-0-1` corrected it; the constraint and the route had been multi-select since [[Decisions#ADR-029|ADR-029]]'s same-day revision.
- When explicitly asked to (§ above — no current caller does this): `generate` tallies votes per meal type via `groupBy`, ranks by count (ties by name), and falls back to *all active library items, alphabetically* when a meal type has zero votes, so no slot is left empty.
- **Voting is for the month already running.** `tenant/vote` uses `firstOfMonth(new Date())` and the owner page opens voting for the current month. The tenant copy used to say *"Vote for next month"*, which was simply false; it now reads *"Vote on this month's menu"*. **Moving voting to the month being planned is Phase 2 and is not built** — the copy was made true rather than the behaviour changed.
- `assignWeekForMealType` (`lib/services/food-schedule-generator.ts`) is the only real algorithm: largest-remainder proportional allocation of the 7 slots by vote share, then a round-robin deal pass so repeats spread across the week instead of clustering. It labels itself *"v1 heuristic, not claimed-optimal"* and was **explicitly kept, not rewritten** — `feat/food-phase-0-1`'s contribution was its first tests.

## 11. The daily cron

`app/api/cron/food-carry-forward`, `CRON_SECRET`-protected, registered in `apps/backend/vercel.json` at **`"0 1 * * *"`**. Two responsibilities:

1. **Carry-forward.** For every `ACTIVE` hostel with no schedule row for the current month, clone last month's **published** 28 cells into a new `DRAFT` with `source: CARRIED_FORWARD`. Idempotent via `food_schedules`'s `@@unique([hostel_id, month])`; "no published schedule last month" is counted, not treated as an error.
2. **Voting expiry** (new). Any period still `OPEN` whose `voting_ends_at` has passed is set `CLOSED`, via the pure `shouldAutoClose` in `lib/services/food/voting-expiry.ts`. Originally added because nothing could close a period before, which dead-ended the owner — the Generate button was gated on `!voting.period || voting.period.status === 'CLOSED'`. That gate is gone as of 2026-08-08 (§10), so this responsibility is now dormant rather than load-bearing, but is left running since voting periods can still be opened directly via the API.

The route was correct, transactional and idempotent from the day it was written and **`vercel.json` had never scheduled it** — see [[Bugs]]. The response now also reports `votingClosed`.

## 12. Tests

| Suite | Food files | Food tests |
|---|---|---|
| `apps/backend` `npm run test:pure` | `food-schedule-generator`, `food-schedule-rebuild-policy`, `food-voting-expiry`, `food-meal-swap` | 9 + 11 + 5 + 11 = **36** |
| `apps/frontend` `npm test` | `weekGrid`, `publishChecks`, `kitchenSheet`, `dragSwap`, `votingWindow` | 22 + 12 + 8 + 8 + 9 = **59** |

Totals after `feat/food-ux-pass` and its fix wave: backend **187 pure tests / 11 files**, frontend **242 tests / 12 files**, 9/9 architectural invariants passing. (Before the fix wave, 183/11 and 233/11; after `feat/food-phase-0-1` it was 176/10 and 225/10; before that there were **zero** food tests of any kind.)

**Since 2026-08-08:** `publishChecks.test.ts` dropped from 17 to 12 tests — the 2 `votes`-check assertions and the 3-test `hasVotesApplied` suite were removed along with the code they covered (§8, §10). Frontend total: **237 tests / 12 files**. Backend counts are unchanged — no pure-tested backend file covered the removed auto-lookup (it lived directly in the route, which this suite doesn't reach; see the note above).

The fix wave's two new pure surfaces both exist *because* the suite is pure-only — that is the only way to cover them here. `votingWindow.ts` holds both halves of the `datetime-local` round trip. `swapWritesLanded` (beside `canSwap` in `lib/services/food/meal-swap.ts`) holds the concurrent-swap verdict, since the route it guards is not reachable from the pure suite but the rule is.

All food logic worth testing was deliberately written as pure functions, because the backend suite still has no `DATABASE_URL_TEST` and `vitest.pure.config.ts` is the only runnable path. **That config uses an explicit file list, not a glob** — a new test file left out of it is silently skipped while the run still reports success. Every food test file was added to it, `food-meal-swap` included.

What that shape cannot reach, stated plainly: **the drag gesture.** The frontend suite runs in `environment: 'node'` with no jsdom, so `findDropTarget` and `isValidDrop` are covered as arithmetic and predicates, while the wiring that feeds them — motion's `PanInfo`, the rect registry, the mutation — is not. See §7.1.

## 13. Explicitly NOT built

Stated so this page cannot be read as overstating the module. All of these are Phases 2–3 of `docs/design/food-module-redesign.md`:

- `serve_date` and per-date overrides — festival menus, exam weeks, "change just this Thursday", real history, cost per meal
- Menu templates (`food_menu_templates` / `food_template_meals`) — only the `WeekGrid` seam that makes them additive
- `food_schedule_meals.is_manual` cell locks — the "automation never overwrites a human" rule
- `food-memory-service` — the one read model for served-count / last-served / co-occurrence, and the library stats, picker suggestions and History story that would compose it
- Action Center food cards (*no menu for September*, *snacks empty*, *voting closes tomorrow*)
- Universal Search food source
- Cost per meal, and any Food↔Expenses join (see §8.4 of the design: **no cost field on `food_menu_items`**, ever; cost is derived, and the only honest join before Inventory exists is aggregate `hostel × month`)
- One-tap "Ask students" and moving voting to the month being planned
- Immutable published snapshots — history is still editable at the API level
- A `food-service.ts` extraction; `firstOfMonth` is still copy-pasted into 4 route files in two different implementations
- WhatsApp broadcast via an approved Meta template (the `wa.me` share is the Phase 1 answer)
- **Reopening a closed voting round, or a second round in one month** — deliberately out of scope for the 2026-08-06 voting work; only editing an *open* window was added
- **Auto-scroll while dragging a chip** — motion does not scroll the page mid-drag, so a drag still only reaches co-visible days. The picker sheet's "Move to another day" (§7.2) is the answer to the reach problem, not a scroll implementation
- **A rebuilt polling feature** — voting was decoupled from schedule generation and hidden from both Food tabs on 2026-08-08 (§10). The old voting UI/hooks/routes/tables still exist, unused, but a fresh design for "polling" (the owner's term) is not started

## 14. Live data at audit time (production, 2026-08-05)

Recorded because several conclusions changed once the database was queried rather than reasoned about:

- **2 active hostels**, both with food libraries — only one was reachable from the UI before the hostel picker
- **11 menu items**: BREAKFAST 4, DINNER 3, LUNCH 2, SNACKS 2
- **3 schedules**, all PUBLISHED — July ×2 (`source: MANUAL`), August ×1 (`GENERATED`). **`CARRIED_FORWARD`: 0** — proof the cron had never run
- **84 meal rows**, of which **7 were `item_name: "Not set"`** — exactly one meal type × 7 days (snacks), published to tenants
- **1 voting period ever** (July, CLOSED), **2 votes total**; August was generated with `generated_from_voting_period_id: null`, so votes influenced nothing
- **0 food tests**

## 15. Unknown / needs clarification

- **The carry-forward cron has not been observed running.** `vercel.json` now schedules it, but that is deploy-gated and no post-deploy execution or `CARRIED_FORWARD` row has been verified. The clone-from-previous-month branch has *still* never been exercised against a real prior published month — a gap [[Decisions#ADR-029|ADR-029]] first flagged in July and neither branch closes.
- **`START_OVER` has no caller.** The route accepts it and both frontend layers pass it through, but no control sends it. Whether it is reserved for the Phase 2 "Plan `<Month>`" flow or is dead surface that should be removed is undecided.
- **`hostels.food_included` still has zero readers.** It is written by onboarding and `hostel-provisioning-service`, validated in `src/validators/hostels`, and read by nothing in the food module. At audit time it was `false` on both hostels *despite both running published menus* — so the flag is unused **and** wrong. Whether it should gate the Food tab or be dropped is an open product question.
- **The tenant "current month" can still be stale.** `useTenantFoodSchedule` labels the *latest published* month "Current", not the actual calendar month. If September is unpublished, a tenant sees August's Monday presented as today's meals with no staleness cue. Unchanged by either branch.
- **Owner-facing meal times are not configurable and not stored.** `MEAL_TIMES` is a frontend constant; whether real hostels serve at those hours has not been checked with anyone.
- **Food notifications are in-app only** — both `food_schedule_published` and, since 2026-08-06, `food_voting_opened`. Whether tenants actually read them (vs. needing WhatsApp) is unverified: there is no read-tracking on `notifications`. Which means the voting-notification fix's *effect* is also unverified — that the missing notification is why the product has seen 1 voting period and 2 votes (§14) is the most plausible reading of the live data, not a proven cause.
- **Drag-to-swap has never been exercised in a browser.** Its two pure decisions are tested; the gesture itself has no automated coverage (§7.1, §12) and no manual device run is recorded. In particular the page-vs-viewport coordinate handling — the part that fails silently and only on a scrolled page — is unverified end to end.

---

## 16. Food Polls (real feature, added 2026-08-08) — deliberately a third, separate system

Three things now share the word "poll/vote" in this module and must not be confused:

1. **§10's monthly voting window** (`food_voting_periods`/`food_votes`) — real, dormant since §10's "Decoupled" note; was tied to schedule generation.
2. **The mock "Food Polls"** ([[Decisions#ADR-048|ADR-048]]) — deleted `ee51a83`, pure `useState`, no backend, never votable by a real tenant.
3. **This section** — a new, real, independent feature: ad-hoc, owner-created, single-instance polls (`food_polls`/`food_poll_options`/`food_poll_votes`), unrelated to (1) and not a revival of (2)'s code (rebuilt from scratch against real data, reusing only (2)'s visual design as a reference — confirmed via `git show ee51a83^:...` — plus a few concrete field names it never actually got to use for real).

This intentionally revisits territory [[Decisions#ADR-048|ADR-048]] warned about ("two voting systems under two names was itself a top-three audit finding") — now a third. See [[Decisions#ADR-057|ADR-057]] for why: it's deliberate, made with (1)'s continued existence known, and driven by the product wanting ad-hoc single-meal polls as a genuinely different shape than a monthly recurring window.

**Schema** (`prisma/schema.prisma`, "Food Polls (V1)" section): `FoodPollType` (`SINGLE_CHOICE | MULTIPLE_CHOICE | RATING | YES_NO`), `FoodPollStatus` (`OPEN | CLOSED`). `food_polls` (one row per poll — title, poll_type, meal_type, poll_date, closes_at, is_anonymous, allow_multiple, status, closed_at). `food_poll_options` (owner-authored labels for `SINGLE_CHOICE`/`MULTIPLE_CHOICE`; **`RATING`/`YES_NO` polls also use this table** — the frontend resolves their fixed labels, "Yes"/"No" or "5 stars".."1 star", at creation time, so one options+votes model covers all four poll types with no nullable rating-value column). `food_poll_votes` (`@@unique([poll_id, tenant_id, option_id])`, same shape as `food_votes`).

Applied via a hand-written migration (`prisma/migrations/20260808130000_add_food_polls/migration.sql`), executed directly rather than through `prisma migrate deploy`/`db push` — both were blocked in this dev environment at the time by **pre-existing, unrelated** issues: a failed migration already recorded against `20260501000000_add_late_fee` (blocks `migrate deploy` entirely until resolved — still unaddressed, `migrate deploy` remains unusable here), and `schema.prisma` no longer declaring two `tenants` columns (`reservation_policy`, `minimum_reservation_deposit`, removed from the schema in `9597421` without a matching migration) that still held real rows in the live dev DB (`db push` would silently drop them).

**Resolved 2026-08-10** ([[Decisions#ADR-062|ADR-062]]): the next schema change (`rooms.sort_order`, Rooms tab reorder) did hit this exact wall — `npm run prisma:push` dropped both `tenants` columns (729 rows each at the time) as a side effect of syncing `schema.prisma`. This was not new data loss: migration `062_tenancy_per_row.sql` already contained `DROP COLUMN IF EXISTS` for both, per the deliberate removal in [[Decisions#ADR-052|ADR-052]]/[[Decisions#ADR-053|ADR-053]] — the columns were dead (no code referenced them; `tests/activation-enforcement-coverage.test.ts` asserts the opposite), just never actually applied to this particular dev database until `db push` finally caught it up. The landmine is gone; `db push` is safe to run again for future schema changes. The `migrate deploy` blocker is separate and still unresolved.

**Vote-cast logic** (`POST /api/food/tenant/polls/[id]/vote`): `allow_multiple = true` toggles the `(poll, tenant, option)` row, same as `food_votes`. `allow_multiple = false` replaces — any other vote row this tenant holds on the poll is deleted first, and tapping the already-selected option unselects it rather than being a no-op.

**API** (`app/api/food/polls/*`, `app/api/food/tenant/polls/*`): `POST /api/food/polls` creates **and publishes** in one step — there is no draft state, matching the single "Publish Poll" action. `GET /api/food/polls` / `GET .../[id]/results` return per-option tallies plus `voterCount` (distinct tenants) and `eligibleCount` (`ACTIVE`, profiled tenants of the hostel), same distinction §10 established for the other system. `POST .../[id]/close` is idempotent. Auto-close is the daily `food-carry-forward` cron's **third** responsibility now (`lib/services/food/poll-expiry.ts`'s `shouldAutoClosePoll`, same shape as §11's `shouldAutoClose`), reported as `pollsClosed` in the cron's response.

**Owner UI**: new route `/owner/food/polls` (`FoodPollsPage.tsx`), reached via a "Food Polls" link on the main Food tab (next to "Send to kitchen"). `CreatePollModal.tsx` is a close rebuild of the deleted mock's sheet, with two deliberate, necessary deviations: Date/Closing-time are real `<input type="date"/"time">` (the mock rendered them as permanently static text — never wired to anything), and option reordering uses `Reorder.Group`/`useDragControls`/`DragHandle` (`motion/react`, [[Decisions#ADR-042|ADR-042]]) instead of the mock's native HTML5 drag, for the same touch-support reason every other drag surface in this module made that choice (§7.1). `PollResultsSheet.tsx`'s "Use Winning Option →" is now real — it calls the same `useFoodMenuItems.createAndReturn` the schedule picker uses, adding the winning label to the Food Library. This is a manual, one-off owner action and does **not** reconnect polls to schedule generation — [[Decisions#ADR-056|ADR-056]]'s decoupling stays intact.

**Tenant UI**: a "Food polls" section on `/tenant/food` (`useTenantFoodPolls.ts`), visually following the pattern the removed §10 tenant section used (button-per-option, `Check` icon when selected) — renders nothing when there are no open polls, rather than a permanent empty-state card, since polls are ad-hoc and often nonexistent.

**Not carried over from the mock, both because neither ever actually worked there either:** the "Scheduled" poll tab/status (nothing can produce a not-yet-open poll; Active/Closed only), and "Edit" on a poll card (the mock's `onEdit` had no real implementation behind it — flagged as a genuine follow-up, not built).

**Anonymity — an honest scope note.** `is_anonymous` is stored and toggleable (screenshot fidelity, per explicit instruction to keep it), but neither the deleted mock's results sheet nor this one ever shows a per-voter breakdown — only aggregate counts/percentages/bars. So the toggle currently has **no visible behavioral effect**; `tenant_id` is always stored server-side regardless, since it's required to prevent duplicate votes and compute participation. Documented here rather than left to look like working functionality that silently isn't.

**Known minor inconsistency, inherited from the screenshot rather than introduced:** "Poll Type: Single Choice/Multiple Choice" and the separate "Allow multiple selections" toggle are not reconciled — `allowMultiple` sent to the API is literally the toggle's value, independent of which Poll Type is selected, so an owner could pick "Single Choice" with the toggle on. This mirrors the deleted mock's own unreconciled fields exactly; nobody asked for it to be fixed, and it wasn't part of the fields flagged for removal.

**Tests:** none yet — this environment has no `DATABASE_URL_TEST` (§12), and the vote toggle/replace logic and `shouldAutoClosePoll` are the kind of pure logic this codebase's `test:pure` convention would cover, not yet extracted/written.

## See also

- [[Decisions#ADR-056|ADR-056]] — decoupling schedule generation from §10's voting window
- [[Decisions#ADR-057|ADR-057]] — the real Food Polls feature (§16), and why a third poll/vote system is deliberate
- [[Decisions#ADR-048|ADR-048]] — the Phase 0–1 decisions, including the Food Polls **deletion** (§16 point 2) that supersedes [[Decisions#ADR-029|ADR-029]] point (3)
- [[Decisions#ADR-029|ADR-029]] — why the weekly-pattern grain was chosen, and what it costs
- [[APIs]] · [[Database]] — endpoint and schema detail, not restated here
- [[Bugs]] — the two Phase 0 defects and the `hostels[0]` violation, all fixed
- [[Features]] · [[Changelog]] — what shipped and when
