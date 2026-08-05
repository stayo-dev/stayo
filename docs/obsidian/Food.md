---
tags: [module, food]
---

# Food

Related: [[Features]] · [[APIs]] · [[Database]] · [[Business-Rules]] · [[Decisions]] · [[Bugs]] · [[Changelog]] · [[Backend]] · [[Frontend]]

The module's home page. Written 2026-08-05 against the code as it stands after the Phase 0–1 pass on `feat/food-phase-0-1` — every claim below was read out of the implementation, and anything that could not be is marked **Unknown / needs clarification** at the bottom rather than asserted.

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

**14 route files under `app/api/food/`, exposing 17 method handlers**, plus one cron. Every one has a live frontend caller through `features/food/api/index.ts` — the audit found **no orphaned food endpoint**, which is the opposite of the Expenses finding. The full per-endpoint table lives in [[APIs]].

Changed on this branch:

- `POST /api/food/schedules/generate` gained **`mode: "BUILD" | "FILL_GAPS" | "START_OVER"`** (defaults to `BUILD` when absent or unrecognised) and can now answer **`409 SCHEDULE_PUBLISHED`**. See §5.

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
| **Hostel picker** | `HostelSwitcher`, Food tab header | Renders nothing for a single-hostel owner. Closes an `hostels[0]` invariant violation — see [[Bugs]]. |
| **Inline add-item** | picker sheet | `useFoodMenuItems.createAndReturn` creates the library item and resolves its id so the caller can place it in the cell immediately. Filling one blank went from seven interactions to two. A failure is **spoken** (the API's own 409 message when the name is a duplicate) and the typed name stays in the field — it is cleared only on success. |
| **Publish pre-flight checks** | above Publish, draft only | See §8. |
| **Undo on live edits** | `stayoToast.undo`, 6s | Fires only when the schedule was already `PUBLISHED`, the cell previously held a real item, **and the newly picked item differs from it** — re-picking what was already there is not a change. The message names the blast radius — *"Changed for every Thursday this month · students see it now"* — and Undo re-PATCHes the previous `menu_item_id`, reporting its own failure rather than passing for a success. |
| **Kitchen sheet** | `/owner/food/kitchen` | §9. |

## 8. Publish pre-flight checks

`apps/frontend/src/features/owner-food/publishChecks.ts` — four checks, all arithmetic over the `WeekGrid` already in hand. No endpoint, no service, no model.

1. **Complete** — all 28 cells filled; names any meal type that is empty *all week*.
2. **Variety** — WARN when one item occupies more than 3 of a slot's 7 days. Reports **every** dominated meal type, not just the worst one: the motivating live menu was Dosa ×7 breakfast *and* Sambar Rice ×7 lunch, and naming only the worst silently endorsed the other.
3. **Runs** — WARN when any item repeats on back-to-back days, **including across the Sunday→Monday wrap**. One row per `(day, meal)` means the week repeats all month, so Sunday's lunch really is followed by Monday's, four times over.
4. **Votes** — PASS when **this schedule** was built from a voting period, read from `generated_from_voting_period_id` via the pure `hasVotesApplied(schedule)`. The predicate used to be "does a voting period exist for this month", which reported *"5 student votes used"* for a carried-forward week assembled from none. The count is `voteCount` — **vote rows, not students**; one tenant may hold several rows per meal type.

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

- One `food_voting_periods` row per `(hostel_id, month)`, `DRAFT | OPEN | CLOSED`, with a start/end window.
- `POST /api/food/tenant/vote` **toggles** a `(meal_type, menu_item_id)` pair. Voting is **multi-select per meal type** — the `food_votes` unique constraint includes `menu_item_id` precisely so a second pick is a second row, not an overwrite. The schema doc-comment claimed single-choice until this branch corrected it; the constraint and the route had been multi-select since [[Decisions#ADR-029|ADR-029]]'s same-day revision.
- Votes reach planning for real: `generate` tallies them per meal type via `groupBy`, ranks by count (ties by name), and falls back to *all active library items, alphabetically* when a meal type has zero votes, so no slot is left empty.
- **Voting is for the month already running.** `tenant/vote` uses `firstOfMonth(new Date())` and the owner page opens voting for the current month. The tenant copy used to say *"Vote for next month"*, which was simply false; it now reads *"Vote on this month's menu"*. **Moving voting to the month being planned is Phase 2 and is not built** — the copy was made true rather than the behaviour changed.
- `assignWeekForMealType` (`lib/services/food-schedule-generator.ts`) is the only real algorithm: largest-remainder proportional allocation of the 7 slots by vote share, then a round-robin deal pass so repeats spread across the week instead of clustering. It labels itself *"v1 heuristic, not claimed-optimal"* and was **explicitly kept, not rewritten** — this branch's contribution was its first tests.

## 11. The daily cron

`app/api/cron/food-carry-forward`, `CRON_SECRET`-protected, registered in `apps/backend/vercel.json` at **`"0 1 * * *"`**. Two responsibilities:

1. **Carry-forward.** For every `ACTIVE` hostel with no schedule row for the current month, clone last month's **published** 28 cells into a new `DRAFT` with `source: CARRIED_FORWARD`. Idempotent via `food_schedules`'s `@@unique([hostel_id, month])`; "no published schedule last month" is counted, not treated as an error.
2. **Voting expiry** (new). Any period still `OPEN` whose `voting_ends_at` has passed is set `CLOSED`, via the pure `shouldAutoClose` in `lib/services/food/voting-expiry.ts`. Nothing could close a period before, which dead-ended the owner: the Generate button is gated on `!voting.period || voting.period.status === 'CLOSED'`.

The route was correct, transactional and idempotent from the day it was written and **`vercel.json` had never scheduled it** — see [[Bugs]]. The response now also reports `votingClosed`.

## 12. Tests

| Suite | Food files | Food tests |
|---|---|---|
| `apps/backend` `npm run test:pure` | `food-schedule-generator`, `food-schedule-rebuild-policy`, `food-voting-expiry` | 9 + 11 + 5 = **25** |
| `apps/frontend` `npm test` | `weekGrid`, `publishChecks`, `kitchenSheet` | 22 + 20 + 8 = **50** |

Totals after this branch: backend **176 pure tests / 10 files**, frontend **225 tests / 10 files**. Before it there were **zero** food tests of any kind.

All food logic worth testing was deliberately written as pure functions, because the backend suite still has no `DATABASE_URL_TEST` and `vitest.pure.config.ts` is the only runnable path. **That config uses an explicit file list, not a glob** — a new test file left out of it is silently skipped while the run still reports success. Every food test file was added to it.

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

## 14. Live data at audit time (production, 2026-08-05)

Recorded because several conclusions changed once the database was queried rather than reasoned about:

- **2 active hostels**, both with food libraries — only one was reachable from the UI before the hostel picker
- **11 menu items**: BREAKFAST 4, DINNER 3, LUNCH 2, SNACKS 2
- **3 schedules**, all PUBLISHED — July ×2 (`source: MANUAL`), August ×1 (`GENERATED`). **`CARRIED_FORWARD`: 0** — proof the cron had never run
- **84 meal rows**, of which **7 were `item_name: "Not set"`** — exactly one meal type × 7 days (snacks), published to tenants
- **1 voting period ever** (July, CLOSED), **2 votes total**; August was generated with `generated_from_voting_period_id: null`, so votes influenced nothing
- **0 food tests**

## 15. Unknown / needs clarification

- **The carry-forward cron has not been observed running.** `vercel.json` now schedules it, but that is deploy-gated and no post-deploy execution or `CARRIED_FORWARD` row has been verified. The clone-from-previous-month branch has *still* never been exercised against a real prior published month — a gap [[Decisions#ADR-029|ADR-029]] first flagged in July and this branch does not close.
- **`START_OVER` has no caller.** The route accepts it and both frontend layers pass it through, but no control sends it. Whether it is reserved for the Phase 2 "Plan `<Month>`" flow or is dead surface that should be removed is undecided.
- **`hostels.food_included` still has zero readers.** It is written by onboarding and `hostel-provisioning-service`, validated in `src/validators/hostels`, and read by nothing in the food module. At audit time it was `false` on both hostels *despite both running published menus* — so the flag is unused **and** wrong. Whether it should gate the Food tab or be dropped is an open product question.
- **The tenant "current month" can still be stale.** `useTenantFoodSchedule` labels the *latest published* month "Current", not the actual calendar month. If September is unpublished, a tenant sees August's Monday presented as today's meals with no staleness cue. Unchanged by this branch.
- **Owner-facing meal times are not configurable and not stored.** `MEAL_TIMES` is a frontend constant; whether real hostels serve at those hours has not been checked with anyone.
- **Publish notifications are in-app only.** Whether tenants actually read them (vs. needing WhatsApp) is unverified — there is no read-tracking on `notifications`.

---

## See also

- [[Decisions#ADR-048|ADR-048]] — the Phase 0–1 decisions, including the Food Polls deletion that supersedes [[Decisions#ADR-029|ADR-029]] point (3)
- [[Decisions#ADR-029|ADR-029]] — why the weekly-pattern grain was chosen, and what it costs
- [[APIs]] · [[Database]] — endpoint and schema detail, not restated here
- [[Bugs]] — the two Phase 0 defects and the `hostels[0]` violation, all fixed
- [[Features]] · [[Changelog]] — what shipped and when
