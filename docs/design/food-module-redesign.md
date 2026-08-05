# Food module — product redesign proposal

**Date:** 2026-08-05 · **Status:** Proposal, for approval before any implementation
**Baseline:** `docs/audits/food-module-audit.md` (not repeated here)

---

## 1. Product Vision

### The sentence

> **Stayo runs your food service. You confirm it.**

Not "Stayo helps you plan menus." Planning is a monthly event. **Running food service is a daily one**, and it is where all the owner's actual time goes. The current module is built entirely around the monthly event and offers nothing for the other 29 days.

### The reframe: two modes, not one screen

Everything in this module falls into one of two jobs, and they have almost nothing in common:

| | **Operating** | **Planning** |
|---|---|---|
| Question | *Is today happening correctly?* | *What will we serve next month?* |
| Frequency | Daily, ~10 seconds | Monthly, ~5 minutes |
| Mental state | Glance, confirm, move on | Sit down, decide, review |
| Failure mode | Missing a gap until the cook calls | Publishing a bad month |
| Right default | Read-only, one glance | Deliberate, reviewable |

The current Food tab opens on **Food Library** — a planning artifact — which means **29 mornings out of 30 the owner scrolls past two sections of monthly chores to reach the thing they came for.**

That is the whole bug. Not the ordering. The containment.

### Three rules the redesign is built on

**1. The Food tab is Operating. Planning is a place you go.**
You do not scroll past next month's plan to see today's lunch. Planning is entered deliberately, once a month, and the screen tells you when it's time.

**2. Automation never overwrites a human decision.**
The moment the owner edits a cell by hand, that cell is theirs. No suggestion, shuffle, or rebuild may touch it again unless they release it. This single rule is worth more to trust than every intelligence feature combined — and today's product violates it with a button placed next to the word PUBLISHED.

**3. A number appears only when it is true.**
"Served 1×" is noise. "Served 14× · last on Thursday" is knowledge. Below the threshold, show nothing. This is already the codebase's own established rule — `typicalDayOfMonth` returns `null` below three occurrences ([ADR-047](../obsidian/Decisions.md)) — and it should govern every stat in the Food library.

### What "calm" means concretely

- Zero decisions on the daily path. The morning screen has **no inputs**.
- The screen changes with the calendar so the owner never has to remember. "Plan September" is a quiet line on the 5th and the loudest thing on the screen on the 26th.
- Warnings appear **where the decision is made**, never in a separate insights list you have to go read.
- Checks **inform, never block**. A publish button that can be disabled is a product that argues with its owner.

---

## 2. User Journeys

### Persona 1 — Owner · daily, 10 seconds

> 7:40am, one hand, walking. Opens Stayo.

Home already answers *what needs attention*. If food is fine, food is **not** on Home. If Snacks is empty for the week, there is one Action Center card. The owner taps Food only when they want to look.

```
Food →  "Now: Breakfast — Dosa.  Next: Lunch 1pm — Sambar Rice."
        Done. Closed the app.
```

No taps. No decisions. **The daily interaction with this module should usually be zero taps** — the information is in the first line.

### Persona 1 — Owner · monthly, 5 minutes

> 26 August. Home shows one card: *"September menu not planned — 5 days left."*

```
Tap card
  → Plan September
  → "Here's a starting week from your library and what students asked for."
  → Owner changes 3 cells. Those 3 lock.
  → "Shuffle the rest" — the 3 locked cells don't move.
  → Review:  ✓ All 28 filled   ✓ Nothing repeats twice running
             ⚠ Breakfast is 4× Dosa — add items?     ✓ 12 students voted
  → Publish September
  → "Published. 34 tenants notified."
```

Five minutes, once. **The review step is the emotional centre of this module** — it is where "I hope this is right" becomes "I know this is right."

### Persona 2 — Cook · no account, ever

The cook does not log in. The cook does not have a role, a password, or a screen with tabs.

```
Owner taps "Send to kitchen"
  → WhatsApp opens on the owner's own phone, pre-filled:

    *Thursday 6 Aug — Sri Adithya*
    Breakfast  Dosa
    Lunch      Sambar Rice
    Snacks     Bajji
    Dinner     Chapati

    Changed today: Dinner was Paneer Curry.

  → Owner sends to the kitchen group. Done.
```

No voting. No library. No history. No analytics. **One message.** And it costs zero backend work — the owner's own WhatsApp, via the `wa.me` pattern already used for tenants in `searchActions.ts`.

### Persona 3 — Kitchen staff · a sheet on a wall

Same content, printed. A `/owner/food/kitchen` route that renders large, high-contrast, print-clean: **today and tomorrow, side by side**, with today's changes flagged. `Ctrl+P` produces something that survives a kitchen wall.

Tomorrow matters as much as today — prep starts the night before. Today's screens show only today. That is a gap for this persona specifically.

### Persona 4 — Student · already close to right

The tenant Food tab is the healthiest surface in the module. It needs three fixes, not a redesign:

- **Today first.** Currently opens on a horizontally-scrolling week. Today's four meals should be the first thing, then the week.
- **Stop lying about "current."** It labels the *latest published* month as current; in September it shows August's menu as today's.
- **"Vote for next month" should be true.** Today it votes for the month already running and already published.

### Persona 5 — Accountant · honestly, not yet

The accountant needs cost per meal. **Cost per meal is not computable** — nothing links a dish to an ingredient or an expense, and there is no date on a menu cell to join against.

Two things *are* honest today:

- **Food spend per head per day** = `Food & Groceries` expenses ÷ (tenants × days). Needs no menu data at all. Both inputs already exist.
- The existing `Food & Groceries` insight in `expense-service.ts` already fires at >45% of expenses.

So: **until Phase 3, the accountant is served by Expenses, not by Food.** I am not proposing a food-cost screen that would have to fabricate its numbers.

---

## 3. Screen-by-screen redesign

### Your proposed hierarchy — my verdict

> TODAY → THIS WEEK → NEXT MONTH → Library → History → Analytics

**The order is right. The containment is wrong.** If all six are sections of one scrolling screen, you have rebuilt today's problem with better sorting: the owner still scrolls past planning artifacts every morning, and the screen still answers six questions at once.

Those six are **two screens and four destinations**:

```
FOOD  (the tab — Operating)          "What are we serving?"
├── Today            hero
├── This week        strip
└── Next month       one status line, grows loud near month-end

PLAN <MONTH>  (entered)              "What will we serve?"
KITCHEN       (entered)              "What do we cook?"
LIBRARY       (entered)              "What can we serve?"
HISTORY       (entered)              "What happened?"
```

Analytics is **not a destination**. It is History with the numbers turned on. A separate analytics screen for a module with 84 rows of data would be a dashboard about nothing.

---

### Screen A — **Food** (the tab) · *"What are we serving?"*

The only screen on the daily path. Read-mostly.

```
┌──────────────────────────────────────────┐
│ Food                    [Sri Adithya ▾]  │  ← picker hidden if 1 hostel
│                                          │
│  NOW · Breakfast                         │
│  ┌────────────────────────────────────┐  │
│  │  Dosa                              │  │  ← 32px, the answer
│  │  Next · Lunch 1:00pm  Sambar Rice  │  │
│  └────────────────────────────────────┘  │
│                                          │
│  Snacks 5pm  — not set          [Fix]    │  ← only if there's a gap
│  Dinner 8pm  Chapati                     │
│                                          │
│  THIS WEEK                     Published │
│  M  T  W  T  F  S  S                     │
│  ●  ●  ●  ◐  ●  ●  ●    ⚠ Snacks empty   │
│                                          │
│  September not planned · 5 days left  →  │  ← quiet on the 5th, loud on the 26th
│                                          │
│  ┌────────────────────────────────────┐  │
│  │        Send to kitchen             │  │  ← thumb zone, bottom
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
   Library · History                          ← small text links, footer
```

**Hierarchy.** The single largest element on screen is the answer to the single most-asked question. Everything else recedes.

**Why "NOW" and not four equal meals.** Meals have a time. At 7:40am the owner cares about breakfast; at 6pm, dinner. Showing four identical cards makes the owner do the work of finding the relevant one. Showing the current meal as hero and the next as a subtitle does that work for them. *(Meal times: four sensible defaults to start — 8am / 1pm / 5pm / 8pm. If they need to be per-hostel later, `preferences_config` already exists for exactly this kind of setting; no new table.)*

**Why gaps are conditional.** "Snacks — not set" appears only when there is a gap, with a **[Fix]** that opens the picker *and lets you add a new item inline*. Today filling one blank costs seven interactions because the picker dead-ends at "No snacks items in your library yet." That is the single worst micro-interaction in the module.

**Why the week is seven dots.** The owner does not need 28 cells every morning. They need "is the week OK?" — `●` complete, `◐` has a gap. Tapping opens the week.

**Why next month is one line that grows.** The owner should never have to remember. On the 5th it is grey and small. On the 26th it is the second-loudest thing on screen. The screen tracks the calendar so the owner doesn't have to. *This is what "remove decisions" means in practice.*

**What is NOT here:** Food Library. Voting. History. Analytics. Any alert list. Home already owns *"what needs my attention"* — duplicating it here would mix two mental models on one screen.

---

### Screen B — **This Week** · *"Is the week right?"*

Opened by tapping the dot strip. Today's column is pinned and highlighted.

The crucial honesty fix: **today, editing a cell changes every Thursday of the month, and nothing says so.** One row per `(schedule, day_of_week, meal_type)` means Thursday's lunch *is* the pattern. An owner fixing "this Thursday" silently changes four Thursdays.

Until `serve_date` exists, the edit sheet must say so plainly:

> Changing Thursday lunch changes **every Thursday this month**.
> *(One-off day changes are coming.)*

That sentence costs nothing, prevents a real misunderstanding, and makes the Phase 3 unlock something the owner is already waiting for rather than something we have to explain.

**Every edit to the live month gets an undo toast:**

> *Dinner changed to Paneer Curry · every Thursday · students notified* **[Undo]**

No draft, no publish ceremony for daily corrections. If you change tonight's dinner, students **should** see it now. The fix isn't a staging area — it's making the consequence visible and reversible. That removes a whole workflow instead of adding one.

---

### Screen C — **Plan September** · *"What will we serve?"*

Entered once a month. Draft until published. This is where the real thinking happens, so this is the only screen allowed to be dense.

#### Challenging "Generate"

**"Generate" is the wrong word and it caused the worst bug in the module.** It is machine language — it implies the machine owns the output and you receive it. It also makes re-running feel free, which is exactly why a destructive rebuild ended up as a one-tap link beside the word PUBLISHED.

The owner's actual mental model is: *I am building next month's menu, and the app gives me a head start.*

| Now | Proposed | Why |
|---|---|---|
| **Generate Schedule** | **Build September** | The owner builds. The app assists. |
| *(the result)* | *"Here's a starting week from your library and what students asked for. Change anything."* | Sets it up as a draft to edit, not an output to accept |
| **Regenerate** ⚠️ | **Shuffle unlocked days** | Non-destructive. Never touches a hand-edited cell. |
| — | **Fill gaps only** | Touches empty cells only. Zero risk. The safe button. |
| — | **Start over** | Destructive, confirmed by name, **draft-only** |

**"Regenerate" is deleted as a concept.** It is replaced by three verbs whose blast radius is stated in the label. `Fill gaps` and `Shuffle unlocked` are safe by construction; `Start over` names its own consequence and cannot be reached from a published month.

The **lock rule** makes this work: once the owner edits a cell, it shows a small lock and no automation touches it. Tap the lock to release. One boolean per cell, and it retires the entire "the app ate my work" class of failure.

#### Publishing as a review, not a button

Publishing should feel like a decision, not a keystroke. But **checks inform; they never block.** The Publish button is always enabled.

```
  READY TO PUBLISH
  ✓  All 28 meals filled
  ✓  Nothing repeats two days running
  ⚠  Breakfast is Dosa 4 of 7 days      [Add breakfast items]
  ✓  12 students voted — top picks used
  ✓  Different from August

  ┌────────────────────────────────────┐
  │        Publish September           │
  └────────────────────────────────────┘
  34 tenants will be notified.
```

Every one of those five lines is **arithmetic on data already stored** — cell counts, adjacency comparison, per-item frequency, `generated_from_voting_period_id`, a diff against last month's cells. No new tables, no model, no AI, and every line is explainable in one sentence if the owner asks.

The `⚠` is the line that matters. Live production right now has a published August menu of **Dosa ×7 breakfasts, Sambar Rice ×7 lunches, and Snacks empty all week**, and nothing anywhere told the owner. This checklist is the fix, and it is the highest-value thing in the entire redesign.

**Publishing also states its consequence** — *"34 tenants will be notified"* — because a button that quietly messages 34 people should say so.

---

### Screen D — **Kitchen** · *"What do we cook?"*

Deliberately the dumbest screen in the product. No navigation, no state, nothing tappable except print and share.

```
   THURSDAY 6 AUGUST          Sri Adithya

   Breakfast    Dosa
   Lunch        Sambar Rice
   Snacks       Bajji
   Dinner       Chapati          ← changed today

   ───────────────────────────────────────
   TOMORROW · Friday 7 August
   Dosa · Sambar Rice · Bajji · Chapati

   [ Print ]              [ Send on WhatsApp ]
```

**Tomorrow is on the sheet** because prep starts the night before — that is the whole reason a kitchen sheet exists rather than a today screen.

**"Send on WhatsApp" needs no backend and no Meta template approval.** It opens `wa.me` with pre-filled text from the owner's own phone — the exact pattern `searchActions.ts` already uses. An approved broadcast template can come later; it must not be a prerequisite for serving the cook, given how that dependency has bitten twice already (`docs/audits/whatsapp-template-mapping.md`).

**One route serves two personas** — cook via WhatsApp, kitchen staff via print — with essentially zero backend.

---

### Screen E — **Library** · *"What can we serve?"*

Demoted from first thing on screen to a destination, because it is maintained monthly, not daily.

```
  BREAKFAST                                   4
  ┌────────────────────────────────────────┐
  │ Dosa                                   │
  │ Served 14× · last week · 8 votes       │  ← only shown when true
  ├────────────────────────────────────────┤
  │ Idli                                   │
  │ Served 3×                              │  ← fewer facts, honestly
  ├────────────────────────────────────────┤
  │ Poha                            [new]  │  ← no stats yet: say nothing
  └────────────────────────────────────────┘

  SNACKS                                    0
  ⚠ No snacks items — snacks show as
    "not set" to your students.  [Add]
```

**What each item honestly knows, today, with zero new capture:**

| Fact | Source | Available now? |
|---|---|---|
| Times served | `groupBy` on `food_schedule_meals` | ✅ |
| Last served | same, by month | ✅ (month precision) |
| Votes received | `food_votes` | ✅ (but ~zero data yet) |
| Last modified | `food_menu_items.updated_at` | ✅ |
| **Student rating** | — | ❌ **Nothing rates a dish.** `exit_feedbacks.rating_food` is hostel-level, collected at move-out. It cannot become a dish rating. |
| **Estimated cost** | — | ❌ No dish↔ingredient or dish↔expense link |
| **Seasonality** | — | ❌ Needs 12 months of *dated* history |

I am proposing **only the four that are real**, and the ≥3-occurrence threshold before any of them render. A library that shows "Served 1× · rated 4.2★" when nobody rated anything is worse than a library that shows a name.

**One addition, because it removes real work:** *Copy library from another hostel.* A two-property owner retypes their entire library per hostel today — the unique constraint is `[hostel_id, meal_type, name]`. This is a `createMany` and it saves a multi-property owner twenty minutes.

---

### Screen F — **History** · *"What happened?"*

You're right that months-with-a-badge is not a story. Here is the story, entirely from data that already exists:

```
  AUGUST 2026                      Published
  Published 4 Aug · carried forward from July
  28 meals · 3 changed after publishing
  12 students voted · Dosa most picked
  ⚠ Snacks were unset all month

  JULY 2026                        Published
  Published 26 Jul · built from student votes
  28 meals · 9 changed after publishing
```

**Every line is derivable now:**

- *carried forward / built from votes / built by hand* → `food_schedules.source` — recorded correctly today, displayed nowhere
- *3 changed after publishing* → count of `food_schedule_meals` where `updated_at > published_at`. **The data is already there** — the PATCH route sets `updated_at` on every edit.
- *12 students voted · Dosa most picked* → `food_votes`
- *Snacks unset all month* → count of `item_name = 'Not set'`

That is a narrative, not a table, and it required no new column. **Analytics is this screen with more months in it** — not a separate destination.

---

### Screen G — **"What students want"** (inside Plan)

Not a tab. Not called "Polls." Not called "Voting."

The current flow is a five-step ceremony — open a period, choose a start datetime, choose an end datetime, wait, remember to close it, then generate — for a signal that has produced **1 period and 2 votes in the product's lifetime**. The ceremony is the reason.

**Replace all of it with one tap:**

```
  Ask students what they want            [ Ask ]
  → Open for 7 days. Closes on its own.
     Results shape September's menu.
```

Zero inputs. No datetime pickers. Auto-closes. And it asks about **the month being planned**, not the month already running and already published — which is what it does today, while the tenant app labels it "Vote for next month."

*"Remove decisions instead of creating more decisions"* applied literally: **two `datetime-local` inputs → zero.**

---

### Universal Search

Reuse `useUniversalSearch`. Add a source; do not build a food search.

```
  "dosa"
  ┌────────────────────────────────────────┐
  │ 🍽  Dosa                    Breakfast   │
  │    Served 14× · next Thursday          │
  │    [Today's menu]  [Add to week]       │
  └────────────────────────────────────────┘
```

One row per menu item, with the same two facts the library shows and actions that use the existing quick-action pattern in `searchActions.ts`.

> **Verified 2026-08-05, before Phase 2a was planned — two corrections to this document.** Both were assumptions written before the integration points were read, and both are wrong as originally stated.
>
> **1. Universal Search is server-backed, not a client-side index.** `useUniversalSearch` debounces into `ownerService.universalSearch()` → `GET /api/owner/search` → `lib/services/search/search-service.ts`. That service already has exactly the right shape: a `SearchProvider` interface (`type`, `label`, `order`, `search({ownerId, query, limit})`) and a `SEARCH_PROVIDERS` array holding `tenantProvider`, `hostelProvider`, `roomProvider`, run in parallel and individually fault-isolated. **Adding food is one new `providers/food-provider.ts` plus one array entry** — better than assumed, but a *backend* change. Use `room-provider.ts` as the template; note its contract comment: *"Must be owner-scoped. Must never throw for a bad query — return [] so one failing source cannot blank the whole search."*
>
> **2. Action Center cards are NOT `owner-action-registry.ts`.** §7 below originally said to reuse it. That registry is a *per-entity action* registry — `listForEntity(entity, ctx)`, for things like "send reminder on this tenant" — and has nothing to do with the Home cards. The Action Center cards (Collect Rent, Review Agreements, Activate Tenants, Fill Vacant Beds) are composed **client-side in `useOwnerDashboard.ts`** from existing queries. Food cards belong there, following the `collectRent` / `activateTenants` / `fillVacantBeds` shape.
>
> The third seam checked out as described: `Food & Groceries` exists in `expense-service.ts`, and `active_tenants` comes from `dashboard-snapshot-service.ts`, so food spend per head per day is composable with no new capture.

---

## 4. UX improvements — small change, large impact

Ranked by (impact ÷ effort). Every one is a few hours.

| # | Change | Why it matters |
|---|---|---|
| 1 | **Inline "Add item" in the meal picker** | Filling one blank costs **7 interactions** today because the picker dead-ends at "No snacks items yet." This makes it 2. |
| 2 | **State the blast radius on the edit sheet** | *"changes every Thursday this month"* — owners are currently changing 4 days thinking they changed 1 |
| 3 | **Undo toast on live edits** | Removes the need for a draft/publish workflow on the daily path entirely |
| 4 | **Hide the hostel picker at 1 hostel, show it at 2+** | Zero friction for most; fixes a silent `hostels[0]` lock-out for the rest |
| 5 | **Publish states its consequence** — *"34 tenants will be notified"* | A button that messages 34 people should say so |
| 6 | **`source` badge** — *"Carried forward from July · review"* | Field is recorded correctly and displayed nowhere |
| 7 | **Empty meal-type warning in the library header** | "Snacks 0" is a shrug; "⚠ students see 'not set'" is a call to act |
| 8 | **Next-month line grows with the calendar** | Replaces remembering with noticing |
| 9 | **Never show a stat below 3 occurrences** | The difference between a library that knows things and one that guesses |
| 10 | **Tenant "today" before tenant "week"** | Students ask the same first question owners do |

---

## 5. Backend implications

Deliberately short. **The backend is mostly right** — the audit found all 14 endpoints wired, publish correctly atomic and idempotent, generation correctly transactional, and the generator heuristic clean. Most of this redesign is composition and deletion.

### Reused unchanged — explicitly not rebuilt

`assignWeekForMealType` · publish atomicity + idempotency · `item_name` denormalization · library soft-delete · tenant read isolation · the vote-toggle model · `owner-action-registry.ts` · `useUniversalSearch` · `expense-service` food category · `lib/pdf/` · `notificationService` · the `wa.me` pattern in `searchActions.ts`

### Genuinely required

| Change | Size | Phase | Why |
|---|---|---|---|
| Regenerate cannot demote a `PUBLISHED` schedule | 3 lines | 0 | Stops the destructive path |
| Register `food-carry-forward` in `vercel.json` | 1 line | 0 | A correct cron that has never run |
| Auto-close expired voting (inside that same cron) | ~10 lines | 0 | Cron already loops all active hostels daily |
| Vote for the **planned** month, not the current one | small | 1 | Makes the tenant label true |
| `food_schedule_meals.is_manual BOOLEAN` | 1 column | 2 | The lock rule. Retires "the app ate my work." |
| `food-service.ts` — extract logic from 14 routes | refactor | 2 | `firstOfMonth` is copy-pasted into 4 files, 2 different impls |
| Menu-item stats — one `groupBy`, composed not recalculated | ~40 lines | 2 | Serves library + search + history from one read model |
| Copy library between hostels | ~30 lines | 2 | `createMany` |
| **`food_schedule_meals.serve_date`** | migration + backfill | 3 | The one structural change. Everything below waits on it. |
| Immutable published snapshots | with above | 3 | History currently editable via API |

### Explicitly NOT built

- **No new search service** — a source on the existing index
- **No new notification service** — `wa.me` first; an approved template later, never as a blocker
- **No food cost service** — nothing links a dish to an expense. Phase 3 or honestly absent.
- **No dish ratings** — nothing rates a dish; `exit_feedbacks.rating_food` is hostel-level at move-out and cannot become one
- **No analytics endpoint** — History composes what already exists

---

## 6. Future opportunities

### Can build now — no schema change

Today view · Kitchen sheet (print + WhatsApp) · Pre-flight publish checks · Variety & empty warnings · Undo toast · Hostel picker · Inline add-item · `source` badge · Library stats (served count, last served, votes) · History as story · One-tap "Ask students" · Action Center food cards · Universal Search food source · Copy library between hostels · **Food spend per head per day** (expenses ÷ tenants × days — needs no menu data)

### Needs `serve_date`

Everything here is blocked by one column, which is why it is the only structural change proposed:

- **One-off day changes** — *"change just this Thursday"*, the thing owners will ask for first
- **Festival and exam-week menus** — currently unrepresentable
- **Real history** — *"what did we serve on 14 August?"* was never recorded
- **Cost per meal / per day** — needs a date to join expenses against
- **Ingredient forecasting** — a dated menu × headcount
- **Seasonality** — needs 12 months of dated history *and* 12 months of waiting

### Deliberately not proposed

- Kitchen manager **role** — you said lightweight, and a WhatsApp message plus a print route serves both kitchen personas without auth, accounts, or a permissions model
- Dish-level ratings — would require asking students to rate every meal; high friction, low return, and no data today
- A separate Analytics screen — History with more months is the same screen
- AI anything

---

## 7. Roadmap

Ordered by **product value**, not engineering convenience.

### Phase 0 — Stop lying, stop destroying · *hours*
The product currently has a button that empties every tenant's Food tab, and a tab that pretends to work.

1. Regenerate cannot demote a published schedule; `Start over` is draft-only and confirmed
2. Delete the mock Polls tab (~600 lines); repoint the Home Quick Action at real voting
3. Register `food-carry-forward` — one line, and the 1st of the month stops being a cliff
4. Auto-close expired voting periods — unblocks a Generate button that can currently dead-end forever
5. Fix "Vote for next month", the two wrong route comments, and the stale `food_votes` schema comment

*No new UI. Removes a data-loss path and ~40% of the frontend.*

### Phase 1 — Win the 10 seconds · *the highest-value phase*
Serves owner, cook, and kitchen staff. **Zero schema change.**

6. **Today view** — hero on the Food tab, card on owner Home
7. **Kitchen sheet** — print + `wa.me`. Two personas, ~no backend.
8. **Pre-flight publish checks** — the fix for a live Dosa×7 menu nobody was warned about
9. **Variety + empty-meal warnings** at build time
10. **Hostel picker** (hidden at 1 hostel) — closes the `hostels[0]` invariant violation
11. **Inline add-item** in the picker — 7 interactions → 2
12. **Undo toast** on live edits — deletes the need for a draft workflow
13. First tests: `assignWeekForMealType` is a pure function with tricky largest-remainder maths and **zero coverage**

### Phase 2 — Planning that earns trust · *no schema change except one boolean*

14. **Plan <Month>** as a focused flow; "Generate" retired for Build / Fill gaps / Shuffle unlocked / Start over
15. **`is_manual` lock** — automation never overwrites a human
16. **One-tap "Ask students"**, moved to the month being planned
17. **Library knowledge** — served count, last served, votes; ≥3 threshold
18. **History as story**
19. **Action Center food cards** — *no menu for September*, *snacks empty*, *voting closes tomorrow*
20. **Universal Search** food source
21. **Copy library between hostels**
22. `food-service.ts` extraction; kill the 4 copies of `firstOfMonth`
23. **Food spend per head per day** — the one honest accountant number available now

### Phase 3 — The structural unlock · *needs a migration*

24. **`serve_date`** — weekday pattern becomes the template layer, dates become the instance layer
25. **"Change just today"** — one-off overrides
26. **Festival / exam-week templates**
27. **Immutable published snapshots**
28. **Cost per meal**, joining expenses
29. Real analytics on dated history
30. WhatsApp broadcast template (budget for Meta approval; never a blocker for Phase 1's `wa.me`)

**Prerequisite for Phase 3:** the backend test suite still needs `DATABASE_URL_TEST`. Phases 0–2 are coverable with pure functions and route tests. **A migration against live published menus should not ship without a test database.**

---

## The test every item above had to pass

> *Will this help a hostel owner complete today's work faster and with more confidence?*

The things that scored highest were not features. They were **a removal** (the fake Polls tab), **a sentence** ("changes every Thursday"), **a threshold** (don't show a stat below 3), **a default** (voting auto-closes), and **a lock** (never overwrite a human).

The one genuinely new screen — the Kitchen sheet — exists because two personas currently have nothing at all.

Everything that did not pass is in *"Deliberately not proposed."*

---

## 8. Architecture addendum — forward compatibility

**Approved 2026-08-05.** Four constraints that bind implementation from Phase 0 onward. None of them is a feature; each is a decision about *shape* that keeps a later feature from requiring a redesign.

### 8.1 Templates: the **WeekGrid** contract

Exam Week / Festival Week / Holiday / Normal Week must be introducible without touching the planning module.

**The observation that makes this cheap:** a template *is* a week. Same 28 cells, same shape, just not bound to a month. So the seam is not a template system — it is refusing to let anything read `food_schedules` directly.

> **Binding rule:** every producer and consumer of a week operates on a **`WeekGrid`** — `Array<{ day_of_week, meal_type, menu_item_id, item_name, is_manual }>` — never on `food_schedules` rows.

Today there are three producers: `generate`, `carry-forward`, `manual edit`. A template is a fourth, and `food_schedules.source` is **already** the enum that names them (`GENERATED | CARRIED_FORWARD | MANUAL`) — adding `TEMPLATE` is one enum value.

The future table is then obvious and additive:

```
food_menu_templates      id, hostel_id, owner_id, name, kind, created_at
food_template_meals      template_id, day_of_week, meal_type, menu_item_id, item_name
                         ^ byte-identical shape to food_schedule_meals
```

"Save this week as a template" is a copy. "Apply template" is a copy back, **skipping locked cells** — which is why `is_manual` belongs on the cell (§8.4 of the roadmap, Phase 2) and must be part of `WeekGrid` from the day it exists.

**Phase 1 consequence:** the Today view and Kitchen sheet are the first new grid readers. They must consume `WeekGrid`, not raw schedule rows, or the contract is dead on arrival. *Note:* applying a template to a **specific calendar week** (the actual "Exam Week" use case) still needs `serve_date` — Phase 3. Template *storage and reuse* does not.

### 8.2 Suggestions while planning — one read model, four consumers

Historical assistance, never replacement. All three signals are arithmetic over existing tables:

| Signal | Derivation | Honest today? |
|---|---|---|
| **Served often** | `groupBy(menu_item_id)` over `food_schedule_meals` | ✅ |
| **Not served recently** | `max(month)` per item vs. current month | ✅ (month precision) |
| **Usually served with** | co-occurrence of items within the same `(schedule, day_of_week)` across meal types | ⚠️ **Weak for a long time.** Every day currently carries the same items, so pairings are degenerate. Build the plumbing; render nothing until it clears the threshold. |

> **Binding rule:** these live in **one** `food-memory-service.ts`, deliberately mirroring `getExpenseMemory` from Expenses Phase 1 — same shape, same ≥3-occurrence threshold, same *compose, don't recalculate* rule from `CLAUDE.md`.

**One read model, four consumers:** picker suggestions · library stats · Universal Search · History story. If any of those four computes "times served" independently, we have reproduced the exact drift the financial read model exists to prevent.

Suggestions surface **inside the picker sheet**, ranked, each carrying its reason in plain words — *"not served in 2 months"*, *"served 14×"* — and **never auto-apply**. An unexplained ranking is indistinguishable from a guess, and a suggestion that applies itself is the lock rule violated by another name.

### 8.3 Universal Search — one source, extensible to expenses

Confirmed as Phase 2, fed by `food-memory-service` rather than its own queries. Because the facts arrive from the shared read model, the later extension to *"Dosa → Sri Rice Traders, ₹8,000 avg"* is a join on an existing surface, not a second search path.

> **Binding rule:** add a **source** to the existing search index. Do not add a food search endpoint.

**Confirmed 2026-08-05:** search is **server-backed**. The source attaches as `apps/backend/lib/services/search/providers/food-provider.ts` registered in `SEARCH_PROVIDERS`. See the verification note at the end of §3.

### 8.4 Food ↔ Expenses ↔ Vendors ↔ Inventory — the seam, and the trap

The tempting move is a `estimated_cost` column on `food_menu_items`. **We should not.** It is an owner-maintained number that goes stale the week after it is entered, it is unverifiable, and once it exists it becomes the thing a real recipe model has to fight.

The honest position:

| Module | Owns | Grain |
|---|---|---|
| **Food** | what we *serve* | dish × day |
| **Expenses** | what we *spent* | vendor × purchase |
| **Inventory** (future) | what we *consumed* | ingredient × quantity |

**Food and Expenses do not share a key today, and inventing one would be fiction.** A dish is "Sambar Rice"; an expense is "Rice 50kg, Sri Rice Traders." Bridging them requires a recipe, and a recipe is Inventory.

> **Binding rules:**
> 1. **No cost field on `food_menu_items`.** Cost is *derived*, never stored on a dish.
> 2. Until Inventory exists, the only legitimate Food↔Expenses join is **aggregate**: `hostel × month`. That yields food spend per head per day (Phase 2) and cost per meal once `serve_date` lands (Phase 3) — both honest, neither per-dish.
> 3. The designed seam for later is a join table, named now so nobody invents a worse one:
>    ```
>    food_recipe_items   menu_item_id → inventory_item_id, quantity, unit
>    ```
>    Building it is out of scope. Naming it is the point.

**Vendors** already have a home — `getExpenseMemory`'s vendor-keyed aggregates from Expenses Phase 1. Food should read them, never re-derive them.
